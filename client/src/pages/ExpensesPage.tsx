import { useEffect, useMemo, useState, Fragment } from 'react';
import { Plus, Pencil, Trash2, FileSpreadsheet, Upload, Search, Paperclip, X, Settings2 } from 'lucide-react';
import { Layout } from '../components/Layout';
import { api, FILTER_BLOCKED_MESSAGE } from '../lib/api';
import { toHebrewDateString } from '../lib/utils';

type ExpenseFile = { id: string; kind: 'invoice' | 'receipt'; fileName: string };
type Expense = {
  id: string;
  date: string;
  hebrewDate: string | null;
  topic: string | null;
  expenseType: string | null;
  typeAmounts?: Record<string, number> | null; // כשנבחרו כמה סוגים — הסכום של כל סוג
  groupMonth?: string; // החודש שתחתיו השורה מוצגת (מהשרת) — YYYY-MM, או '' בלי תאריך
  payee: string;
  invoiceText: string | null;
  invoiceUrl: string | null;
  receiptText: string | null;
  receiptUrl: string | null;
  details: string | null;
  paymentMethod: string | null;
  amount: number | null;
  accountDetails: string | null;
  paymentDate: string | null;
  notes: string | null;
  files: ExpenseFile[];
};
type Category = {
  id: string;
  name: string;
  year: string;
  budget: number;
  used: number; // כולל קטגוריות שיורדות ממנה
  ownUsed: number;
  childUsed: number;
  childNames: string[];
  // כמה ירד בכל חודש מכל קטגוריה שיורדת מהקטגוריה הזו (למשל ק"ק פעילות בתוך פעילות חברתית)
  childByMonth?: { month: string; name: string; amount: number; count: number }[];
  parentId: string | null;
  count: number;
};
type Overview = { year: string; years: string[]; categories: Category[] };

const PAYMENT_METHODS = ['העברה', 'משכורת', "צ'ק", 'מזומן', 'אשראי'];
const isTransfer = (method: string | null) => !!method && method.includes('העברה');

/**
 * סוגי הוצאה (הרשימה של המשתמשת, 26/11/2026) — לכל הוצאה בוחרים אחד או יותר (נשמרים מופרדים בפסיק),
 * ואז אפשר לחפש לפי סוג בכל התוכניות. "אוכל" בסוף — תגית לחיפוש בלבד.
 */
const EXPENSE_TYPES = ['פעילות חברתית', 'לימודי שוטף', 'מסלולים', 'אחזקה', 'משרדיות', 'מתנות', 'נסיעות', 'הרצאות', 'דפוס', 'גיוס תלמידים', "שנה ג'", 'אוכל'];
/** סוגים ישנים שלא הועברו — מוצגים על הוצאות קיימות, לא מוצעים להוצאה חדשה */
const LEGACY_TYPES = ['ספרים', 'אחר'];
const ALL_TYPES = [...EXPENSE_TYPES, ...LEGACY_TYPES];
const TYPE_COLORS: Record<string, string> = {
  'פעילות חברתית': 'bg-rose-100 text-rose-800',
  'לימודי שוטף': 'bg-indigo-100 text-indigo-800',
  'מסלולים': 'bg-fuchsia-100 text-fuchsia-800',
  'אחזקה': 'bg-stone-200 text-stone-800',
  'משרדיות': 'bg-teal-100 text-teal-800',
  'מתנות': 'bg-pink-100 text-pink-800',
  'נסיעות': 'bg-violet-100 text-violet-800',
  'הרצאות': 'bg-blue-100 text-blue-800',
  'דפוס': 'bg-sky-100 text-sky-800',
  'גיוס תלמידים': 'bg-cyan-100 text-cyan-800',
  "שנה ג'": 'bg-amber-100 text-amber-800',
  'אוכל': 'bg-orange-100 text-orange-800',
  'ספרים': 'bg-lime-100 text-lime-800',
  'אחר': 'bg-slate-200 text-slate-800',
};
const splitTypes = (v: string | null | undefined) => (v ? v.split(',').map((t) => t.trim()).filter(Boolean) : []);
/** "אוכל" — תגית לחיפוש בלבד: יחד עם סוג אחר, הסכום כולו הולך לסוג האחר (כמו בשרת) */
const SEARCH_ONLY_TYPE = 'אוכל';
const amountTypes = (types: string[]) => (types.length > 1 ? types.filter((t) => t !== SEARCH_ONLY_TYPE) : types);
function TypeBadge({ type }: { type: string | null }) {
  const types = splitTypes(type);
  if (!types.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {types.map((t) => (
        <span key={t} className={`badge ${TYPE_COLORS[t] || 'bg-slate-100 text-slate-700'}`}>
          {t}
        </span>
      ))}
    </span>
  );
}

const shekel = (n: number) => `₪${n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '');
const heDate = (iso: string) => (iso ? toHebrewDateString(new Date(`${iso}T12:00:00`)) : '');

function readPref(key: string): string {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* דפדפן בלי אחסון — לא נורא */
  }
}

export function ExpensesPage() {
  const [year, setYear] = useState(readPref('expenses.year'));
  const [overview, setOverview] = useState<Overview | null>(null);
  const [categoryId, setCategoryId] = useState(readPref('expenses.category'));
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [categoryModal, setCategoryModal] = useState<Category | 'new' | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [typeSearch, setTypeSearch] = useState(false);

  async function loadOverview(y = year) {
    try {
      const o = await api.get<Overview>('/expenses/overview', { year: y || undefined });
      setOverview(o);
      if (!y) setYear(o.year);
      if (!o.categories.some((c) => c.id === categoryId)) setCategoryId(o.categories[0]?.id || '');
    } catch (err: any) {
      setError(err.message);
    }
  }
  async function loadExpenses(id = categoryId) {
    if (!id) return setExpenses([]);
    try {
      setExpenses((await api.get<{ expenses: Expense[] }>('/expenses/list', { categoryId: id })).expenses);
    } catch (err: any) {
      setError(err.message);
    }
  }
  const reload = () => Promise.all([loadOverview(), loadExpenses()]);
  // העברת השורות המסומנות ללשונית אחרת
  const [moveTo, setMoveTo] = useState('');
  const [moving, setMoving] = useState(false);
  async function moveSelected() {
    const target = overview?.categories.find((c) => c.id === moveTo);
    if (!target) return;
    if (!confirm(`להעביר ${selected.size} הוצאות ללשונית "${target.name}"?`)) return;
    setMoving(true);
    try {
      await api.post('/expenses/expenses/move', { expenseIds: Array.from(selected), categoryId: target.id });
      setSelected(new Set());
      setMoveTo('');
      await reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMoving(false);
    }
  }

  useEffect(() => {
    loadOverview(year);
    writePref('expenses.year', year);
  }, [year]);
  useEffect(() => {
    setExpenses(null);
    setSelected(new Set());
    loadExpenses(categoryId);
    writePref('expenses.category', categoryId);
  }, [categoryId]);

  const category = overview?.categories.find((c) => c.id === categoryId);
  const shown = useMemo(() => {
    const q = search.trim();
    if (!q || !expenses) return expenses || [];
    return expenses.filter((e) =>
      [e.topic, e.expenseType, e.payee, e.details, e.paymentMethod, e.accountDetails, e.notes, e.invoiceText, e.receiptText, fmtDate(e.date), fmtDate(e.paymentDate || ''), ...e.files.map((f) => f.fileName)]
        .some((v) => v && v.includes(q))
    );
  }, [expenses, search]);
  const payees = useMemo(() => Array.from(new Set((expenses || []).map((e) => e.payee).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'he')), [expenses]);
  const topics = useMemo(() => Array.from(new Set((expenses || []).map((e) => e.topic || '').filter(Boolean))), [expenses]);
  const withTopic = topics.length > 0;
  // סה"כ לכל נושא פעילות — מוצג בשורה הראשונה של הקבוצה
  const topicTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of expenses || []) if (e.topic) m.set(e.topic, (m.get(e.topic) || 0) + (e.amount || 0));
    return m;
  }, [expenses]);
  // סה"כ לכל חודש — מוצג בשורת הכותרת של החודש
  const monthTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of expenses || []) m.set(e.groupMonth || '', (m.get(e.groupMonth || '') || 0) + (e.amount || 0));
    return m;
  }, [expenses]);
  // קטגוריות שיורדות מקטגוריה אחרת כבר נכללות בה — לא סופרים אותן פעמיים
  const totals = overview?.categories
    .filter((c) => !c.parentId)
    .reduce((s, c) => ({ budget: s.budget + c.budget, used: s.used + c.used }), { budget: 0, used: 0 });
  const parentOf = (c: Category) => overview?.categories.find((p) => p.id === c.parentId);

  async function remove(e: Expense) {
    if (!confirm(`למחוק את ההוצאה "${e.payee || e.details || ''}"${e.date ? ` מ-${fmtDate(e.date)}` : ''}?`)) return;
    try {
      await api.delete(`/expenses/expenses/${e.id}`);
      reload();
    } catch (err: any) {
      setError(err.message);
    }
  }

  const allShownSelected = shown.length > 0 && shown.every((e) => selected.has(e.id));
  function toggleRow(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected((s) => {
      const n = new Set(s);
      shown.forEach((e) => (allShownSelected ? n.delete(e.id) : n.add(e.id)));
      return n;
    });
  }

  if (!overview) {
    return <Layout title="פנקס הוצאות" wide>{error ? <p className="text-red-700">{error}</p> : 'טוען...'}</Layout>;
  }

  return (
    <Layout title="פנקס הוצאות" wide>
      {/* שנה וכלים */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select className="input w-auto" value={year} onChange={(e) => setYear(e.target.value)}>
          {overview.years.map((y) => (
            <option key={y} value={y}>
              שנת {y}
            </option>
          ))}
        </select>
        <button
          className={`py-2 ${typeSearch ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setTypeSearch(!typeSearch)}
        >
          <Search size={16} /> {typeSearch ? 'חזרה לפנקס' : 'חיפוש לפי סוג הוצאה בכל הפנקס'}
        </button>
        <div className="flex-1" />
        <button className="btn-outline py-2" onClick={() => setShowImport(true)}>
          <Upload size={16} /> ייבוא מאקסל
        </button>
        <button className="btn-outline py-2" onClick={() => setShowExport(true)} disabled={!overview.categories.length}>
          <FileSpreadsheet size={16} /> ייצוא לאקסל / הדפסת חשבוניות
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-xl bg-red-50 text-red-700 px-4 py-2 text-sm flex justify-between">
          {error}
          <button onClick={() => setError(null)}>
            <X size={16} />
          </button>
        </div>
      )}

      {typeSearch ? (
        <TypeSearch year={year} onChanged={loadOverview} />
      ) : (
      <>
      {/* קטגוריות */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {overview.categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategoryId(c.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium border transition-colors ${
              c.id === categoryId ? 'bg-navy text-white border-navy' : 'bg-white text-navy border-slate-300 hover:bg-slate-50'
            }`}
          >
            {c.name} <span className="opacity-60">({c.count})</span>
          </button>
        ))}
        <button className="rounded-full px-3 py-1.5 text-sm text-navy border border-dashed border-slate-400 hover:bg-slate-50" onClick={() => setCategoryModal('new')}>
          <Plus size={14} className="inline" /> קטגוריה חדשה
        </button>
      </div>

      {!overview.categories.length ? (
        <div className="card text-center text-slate-500 py-10">
          עדיין אין קטגוריות בשנת {year}. אפשר ליצור קטגוריה חדשה או לייבא את קובץ האקסל הקיים.
        </div>
      ) : (
        category && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <SummaryCard label={`תקציב שנתי — ${category.name}`} value={shekel(category.budget)} />
              <SummaryCard label="עד כה נוצל" value={shekel(category.used)} />
              <SummaryCard
                label="יתרה לניצול"
                value={shekel(category.budget - category.used)}
                tone={category.budget - category.used < 0 ? 'red' : 'green'}
              />
              <SummaryCard label={`כל הקטגוריות — נוצל מתוך ${shekel(totals!.budget)}`} value={shekel(totals!.used)} />
            </div>
            {category.childUsed > 0 && (
              <p className="text-sm text-slate-600 -mt-2 mb-4">
                הניצול כולל {shekel(category.childUsed)} מ{category.childNames.join(', ')} (הוצאות ישירות כאן: {shekel(category.ownUsed)})
              </p>
            )}
            {parentOf(category) && (
              <p className="text-sm text-slate-600 -mt-2 mb-4">
                כל הוצאה כאן יורדת גם מהתקציב של <b>{parentOf(category)!.name}</b> — שם נשארו{' '}
                {shekel(parentOf(category)!.budget - parentOf(category)!.used)}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 mb-3">
              <button className="btn-gold py-2" onClick={() => setEditing('new')}>
                <Plus size={16} /> הוצאה חדשה
              </button>
              <button className="btn-outline py-2" onClick={() => setCategoryModal(category)}>
                <Settings2 size={16} /> תקציב ושם הקטגוריה
              </button>
              <div className="relative flex-1 min-w-[180px] max-w-xs mr-auto">
                <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input pr-9 py-2" placeholder="חיפוש..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>

            {/* חודשים שיש בהם הוצאות ק"ק אבל אין בהם הוצאות בקטגוריה עצמה — לא מופיעה להם כותרת חודש בטבלה */}
            {(() => {
              const months = new Set((expenses || []).map((e) => e.groupMonth || ''));
              const orphan = (category?.childByMonth || []).filter((c) => !months.has(c.month));
              if (!orphan.length || search) return null;
              return (
                <div className="mb-2 rounded-xl bg-sky-50 border border-sky-200 px-4 py-2 text-sm space-y-0.5">
                  {orphan.map((c) => (
                    <p key={`${c.month}-${c.name}`}>
                      <span className="font-semibold text-sky-900">
                        ירד מ{c.name} ב{monthLabel(c.month)}: {shekel(c.amount)}
                      </span>
                      <span className="text-slate-500 mr-2">({c.count} הוצאות — אין החודש הוצאות אחרות בלשונית הזו)</span>
                    </p>
                  ))}
                </div>
              );
            })()}

            {selected.size > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-gold/15 px-4 py-2 text-[15px]">
                <span className="font-semibold text-navy">סומנו {selected.size} שורות</span>
                <button className="btn-outline py-1.5" onClick={() => setShowExport(true)}>
                  <FileSpreadsheet size={15} /> ייצוא / הדפסת חשבוניות של המסומנות
                </button>
                <span className="flex items-center gap-1.5">
                  <select className="input w-auto py-1.5" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                    <option value="">העברה ללשונית...</option>
                    {(overview?.categories || [])
                      .filter((c) => c.id !== categoryId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                  <button className="btn-outline py-1.5" disabled={!moveTo || moving} onClick={moveSelected}>
                    {moving ? 'מעביר...' : 'העברה'}
                  </button>
                </span>
                <button className="text-sm text-slate-600 hover:underline" onClick={() => setSelected(new Set())}>
                  ניקוי סימון
                </button>
              </div>
            )}

            {/* בלי גלילה לצדדים: הטקסט נשבר לשורות, והתאריך העברי מתחת ללועזי */}
            <div className="card p-0 overflow-x-auto">
              <table className="w-full text-[15px] leading-snug">
                <thead className="bg-navy text-white">
                  <tr>
                    <th className="px-2 py-3 w-8">
                      <input type="checkbox" className="h-4 w-4 accent-gold cursor-pointer" checked={allShownSelected} onChange={toggleAll} title="סימון הכל" />
                    </th>
                    {[...(withTopic ? ['נושא הפעילות'] : []), 'תאריך', 'שם בקבלה / שם הרב', 'פרוט', 'אופן תשלום', 'סכום', 'חשבונית', 'פרטי חשבון', 'תאריך תשלום', 'קבלה / הערות', ''].map((h) => (
                      <th key={h} className="px-2.5 py-3 text-right font-bold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {expenses === null ? (
                    <tr>
                      <td colSpan={withTopic ? 12 : 11} className="px-3 py-6 text-center text-slate-400">
                        טוען...
                      </td>
                    </tr>
                  ) : !shown.length ? (
                    <tr>
                      <td colSpan={withTopic ? 12 : 11} className="px-3 py-6 text-center text-slate-400">
                        {search ? 'לא נמצאו הוצאות' : 'אין עדיין הוצאות בקטגוריה הזו'}
                      </td>
                    </tr>
                  ) : (
                    shown.map((e, i) => {
                      const month = e.groupMonth || '';
                      const firstOfMonth = i === 0 || (shown[i - 1].groupMonth || '') !== month;
                      const firstOfTopic = !!e.topic && (firstOfMonth || shown[i - 1]?.topic !== e.topic);
                      const isSel = selected.has(e.id);
                      return (
                      <Fragment key={e.id}>
                      {firstOfMonth && (
                        <tr className="bg-amber-50 border-t-2 border-amber-200">
                          <td colSpan={withTopic ? 12 : 11} className="px-3 py-2">
                            <span className="font-bold text-navy text-base">{monthLabel(month)}</span>
                            <span className="text-sm text-slate-600 mr-3">סה"כ {shekel(monthTotals.get(month) || 0)}</span>
                          </td>
                        </tr>
                      )}
                      {firstOfMonth &&
                        (category?.childByMonth || [])
                          .filter((c) => c.month === month)
                          .map((c) => (
                            <tr key={`${month}-${c.name}`} className="bg-sky-50 border-t border-sky-200">
                              <td colSpan={withTopic ? 12 : 11} className="px-3 py-2 text-sm">
                                <span className="font-semibold text-sky-900">
                                  ירד מ{c.name} ב{monthLabel(month)}: {shekel(c.amount)}
                                </span>
                                <span className="text-slate-500 mr-2">
                                  ({c.count} הוצאות — הפירוט בלשונית "{c.name}")
                                </span>
                              </td>
                            </tr>
                          ))}
                      <tr
                        className={`border-t align-top ${isSel ? 'bg-gold/10' : 'hover:bg-slate-50/60'} ${firstOfTopic && i > 0 ? 'border-slate-300' : 'border-slate-100'}`}
                      >
                        <td className="px-2 py-2.5">
                          <input type="checkbox" className="h-4 w-4 accent-gold cursor-pointer" checked={isSel} onChange={() => toggleRow(e.id)} />
                        </td>
                        {withTopic && (
                          <td className="px-2.5 py-2.5 min-w-[110px]">
                            {firstOfTopic && (
                              <>
                                <p className="font-bold text-navy">{e.topic}</p>
                                <p className="text-xs text-slate-500">סה"כ {shekel(topicTotals.get(e.topic!) || 0)}</p>
                              </>
                            )}
                          </td>
                        )}
                        <td className="px-2.5 py-2.5 whitespace-nowrap">
                          {fmtDate(e.date)}
                          <p className="text-xs text-slate-500">{e.date ? heDate(e.date) : e.hebrewDate}</p>
                        </td>
                        <td className="px-2.5 py-2.5 font-medium text-navy min-w-[110px]">{e.payee}</td>
                        <td className="px-2.5 py-2.5 min-w-[120px]">
                          {e.details}
                          {e.expenseType && (
                            <p className="mt-1">
                              <TypeBadge type={e.expenseType} />
                            </p>
                          )}
                        </td>
                        <td className="px-2.5 py-2.5">{e.paymentMethod}</td>
                        <td className="px-2.5 py-2.5 whitespace-nowrap font-semibold">{e.amount !== null ? shekel(e.amount) : ''}</td>
                        <td className="px-2.5 py-2.5">
                          <FileLinks files={e.files.filter((f) => f.kind === 'invoice')} text={e.invoiceText} url={e.invoiceUrl} />
                        </td>
                        <td className="px-2.5 py-2.5 min-w-[110px] break-words">
                          {e.accountDetails ||
                            (isTransfer(e.paymentMethod) && <span className="badge bg-red-100 text-red-700">חסרים פרטי חשבון</span>)}
                        </td>
                        <td className="px-2.5 py-2.5 whitespace-nowrap">
                          {e.paymentDate ? fmtDate(e.paymentDate) : <span className="text-slate-400 text-xs">טרם שולם</span>}
                        </td>
                        <td className="px-2.5 py-2.5">
                          <FileLinks files={e.files.filter((f) => f.kind === 'receipt')} text={e.receiptText} url={e.receiptUrl} />
                          {e.notes && <p className="text-xs text-slate-500 mt-1">{e.notes}</p>}
                        </td>
                        <td className="px-1.5 py-2 whitespace-nowrap">
                          <button className="p-1.5 rounded-lg hover:bg-slate-100 text-navy" title="עריכה" onClick={() => setEditing(e)}>
                            <Pencil size={15} />
                          </button>
                          <button className="p-1.5 rounded-lg hover:bg-red-50 text-red-600" title="מחיקה" onClick={() => remove(e)}>
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                      </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
      </>
      )}

      {editing && category && (
        <ExpenseModal
          expense={editing === 'new' ? null : editing}
          categoryId={category.id}
          payees={payees}
          topics={topics}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {categoryModal && (
        <CategoryModal
          category={categoryModal === 'new' ? null : categoryModal}
          categories={overview?.categories || []}
          year={year}
          onClose={() => setCategoryModal(null)}
          onSaved={(id) => {
            setCategoryModal(null);
            if (id) setCategoryId(id);
            loadOverview();
          }}
        />
      )}
      {showImport && (
        <ImportModal
          year={year}
          onClose={() => setShowImport(false)}
          onDone={() => {
            setShowImport(false);
            reload();
          }}
        />
      )}
      {showExport && (
        <ExportModal
          year={year}
          categories={overview.categories}
          currentCategoryId={categoryId}
          selectedIds={Array.from(selected)}
          onClose={() => setShowExport(false)}
        />
      )}
    </Layout>
  );
}

const EXPORT_COLUMNS = [
  { key: 'topic', title: 'נושא הפעילות' },
  { key: 'expenseType', title: 'סוג הוצאה' },
  { key: 'date', title: 'תאריך' },
  { key: 'hebrewDate', title: 'תאריך עברי' },
  { key: 'payee', title: 'שם בקבלה / שם הרב' },
  { key: 'details', title: 'פרוט' },
  { key: 'method', title: 'אופן תשלום' },
  { key: 'amount', title: 'סכום לתשלום' },
  { key: 'invoice', title: 'חשבונית' },
  { key: 'account', title: 'פרטי חשבון' },
  { key: 'paymentDate', title: 'תאריך תשלום' },
  { key: 'receipt', title: 'קבלה' },
  { key: 'notes', title: 'הערות' },
  { key: 'byType', title: 'עמודה לכל סוג הוצאה (אוכל, נסיעות...)' },
];

async function download(path: string, fallbackName: string): Promise<Response> {
  const res = await fetch(path, { credentials: 'include' });
  if (res.status === 418) throw new Error(FILTER_BLOCKED_MESSAGE);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `ההורדה נכשלה (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return res;
}

function ExportModal({
  year,
  categories,
  currentCategoryId,
  selectedIds,
  onClose,
}: {
  year: string;
  categories: Category[];
  currentCategoryId: string;
  selectedIds: string[];
  onClose: () => void;
}) {
  const [onlySelected, setOnlySelected] = useState(selectedIds.length > 0);
  const [cats, setCats] = useState<Set<string>>(new Set(categories.map((c) => c.id)));
  const [cols, setCols] = useState<Set<string>>(new Set(EXPORT_COLUMNS.map((c) => c.key)));
  const [summary, setSummary] = useState(true);
  const [kinds, setKinds] = useState<Set<string>>(new Set(['invoice']));
  const [busy, setBusy] = useState<'excel' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const n = new Set(set);
    n.has(key) ? n.delete(key) : n.add(key);
    setter(n);
  };

  function query() {
    const p = new URLSearchParams({ year });
    if (onlySelected) {
      p.set('categoryIds', currentCategoryId);
      p.set('expenseIds', selectedIds.join(','));
    } else p.set('categoryIds', Array.from(cats).join(','));
    return p;
  }

  async function excel() {
    setBusy('excel');
    setError(null);
    setNote(null);
    try {
      const p = query();
      p.set('columns', Array.from(cols).join(','));
      p.set('summary', summary ? '1' : '0');
      await download(`/api/expenses/exportExcel?${p}`, `הוצאות ${year}.xlsx`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }
  async function excelByType() {
    setBusy('excel');
    setError(null);
    setNote(null);
    try {
      await download(`/api/expenses/exportByType?${query()}`, `הוצאות לפי סוג ${year}.xlsx`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }
  async function pdf() {
    setBusy('pdf');
    setError(null);
    setNote(null);
    try {
      const p = query();
      p.set('kinds', Array.from(kinds).join(','));
      const res = await download(`/api/expenses/printFiles?${p}`, `חשבוניות ${year}.pdf`);
      const included = Number(res.headers.get('X-Files-Included') || 0);
      const missing = Number(res.headers.get('X-Files-Missing') || 0);
      setNote(
        `צורפו ${included} קבצים לקובץ אחד — אפשר לפתוח ולהדפיס בבת אחת.` +
          (missing ? ` ${missing} קישורים לא נפתחו (כנראה לא משותפים בדרייב "לכל מי שיש לו את הקישור") — אותם צריך להדפיס בנפרד או להעלות את הקובץ להוצאה.` : '')
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const nothing = onlySelected ? !selectedIds.length : !cats.size;
  const box = 'h-4 w-4 accent-navy cursor-pointer';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-navy text-lg">ייצוא והדפסה — {year}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <section className="space-y-2">
          <p className="font-bold text-navy">מה לייצא?</p>
          {selectedIds.length > 0 && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" checked={onlySelected} onChange={() => setOnlySelected(true)} />
              רק {selectedIds.length} השורות שסימנתי בטבלה
            </label>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={!onlySelected} onChange={() => setOnlySelected(false)} />
            קטגוריות שלמות:
          </label>
          {!onlySelected && (
            <div className="grid grid-cols-2 gap-1.5 pr-6">
              {categories.map((c) => (
                <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className={box} checked={cats.has(c.id)} onChange={() => toggle(cats, setCats, c.id)} />
                  {c.name} <span className="text-slate-400 text-sm">({c.count})</span>
                </label>
              ))}
              <button
                className="col-span-2 text-sm text-blue-700 hover:underline text-right"
                onClick={() => setCats(cats.size === categories.length ? new Set() : new Set(categories.map((c) => c.id)))}
              >
                {cats.size === categories.length ? 'ביטול הכל' : 'סימון הכל'}
              </button>
            </div>
          )}
        </section>

        <section className="space-y-2 border-t pt-3">
          <p className="font-bold text-navy">אקסל — אילו עמודות?</p>
          <div className="grid grid-cols-2 gap-1.5">
            {EXPORT_COLUMNS.map((c) => (
              <label key={c.key} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className={box} checked={cols.has(c.key)} onChange={() => toggle(cols, setCols, c.key)} />
                {c.title}
              </label>
            ))}
            <label className="flex items-center gap-2 cursor-pointer col-span-2">
              <input type="checkbox" className={box} checked={summary} onChange={() => setSummary(!summary)} />
              גיליון סיכום תקציבים
            </label>
          </div>
          <button className="btn-primary w-full" onClick={excel} disabled={!!busy || nothing || !cols.size}>
            <FileSpreadsheet size={16} /> {busy === 'excel' ? 'מייצא...' : 'הורדת אקסל'}
          </button>
          <button className="btn-outline w-full" onClick={excelByType} disabled={!!busy || nothing}>
            <FileSpreadsheet size={16} /> אקסל לפי סוג הוצאה — גיליון לכל חודש (כמו קופה קטנה)
          </button>
        </section>

        <section className="space-y-2 border-t pt-3">
          <p className="font-bold text-navy">הדפסה — כל הקבצים ב-PDF אחד</p>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className={box} checked={kinds.has('invoice')} onChange={() => toggle(kinds, setKinds, 'invoice')} />
              חשבוניות
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className={box} checked={kinds.has('receipt')} onChange={() => toggle(kinds, setKinds, 'receipt')} />
              קבלות
            </label>
          </div>
          <button className="btn-gold w-full" onClick={pdf} disabled={!!busy || nothing || !kinds.size}>
            <Paperclip size={16} /> {busy === 'pdf' ? 'מאחד קבצים... (יכול לקחת קצת זמן)' : 'הורדת PDF להדפסה'}
          </button>
        </section>

        {note && <p className="text-sm text-green-800 bg-green-50 rounded-lg px-3 py-2">{note}</p>}
        {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' }) {
  const color = tone === 'green' ? 'text-green-700' : tone === 'red' ? 'text-red-700' : 'text-navy';
  return (
    <div className="card py-3 text-center">
      <p className="text-slate-500 text-xs mb-1">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}

function FileLinks({ files, text, url }: { files: ExpenseFile[]; text?: string | null; url?: string | null }) {
  return (
    <div className="space-y-0.5">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-700 hover:underline" title="קישור מהאקסל">
          <Paperclip size={13} className="shrink-0" />
          <span className="truncate max-w-[130px]">{text || 'קישור'}</span>
        </a>
      ) : (
        text && <span className="text-slate-600">{text}</span>
      )}
      {files.map((f) => (
        <a key={f.id} href={`/api/expenses/files/${f.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-700 hover:underline">
          <Paperclip size={13} className="shrink-0" />
          <span className="truncate max-w-[130px]">{f.fileName}</span>
        </a>
      ))}
    </div>
  );
}

function ExpenseModal({
  expense,
  categoryId,
  payees,
  topics,
  onClose,
  onSaved,
}: {
  expense: Expense | null;
  categoryId: string;
  payees: string[];
  topics: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    date: expense ? expense.date : new Date().toISOString().slice(0, 10),
    hebrewDate: expense?.hebrewDate || '',
    topic: expense?.topic || '',
    expenseType: expense?.expenseType || '',
    payee: expense?.payee || '',
    invoiceText: expense?.invoiceText || '',
    invoiceUrl: expense?.invoiceUrl || '',
    receiptText: expense?.receiptText || '',
    receiptUrl: expense?.receiptUrl || '',
    details: expense?.details || '',
    paymentMethod: expense?.paymentMethod || '',
    amount: expense?.amount != null ? String(expense.amount) : '',
    accountDetails: expense?.accountDetails || '',
    paymentDate: expense?.paymentDate || '',
    notes: expense?.notes || '',
  });
  // כמה סוגים — סכום לכל סוג, כדי שבאקסל כל חלק ייכנס לעמודה של הסוג שלו
  const [split, setSplit] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(expense?.typeAmounts || {}).map(([k, v]) => [k, String(v)]))
  );
  // סדר הבחירה: הסוג שנבחר ראשון ("העיקרי") מקבל את היתרה, כך שהוספת סוג לא מוחקת את הסכום —
  // ממלאים רק כמה שייך לסוגים שנוספו
  const [order, setOrder] = useState<string[]>(() => splitTypes(expense?.expenseType));
  const pickedTypes = amountTypes(order);
  const foodTagOnly = order.length > 1 && order.includes(SEARCH_ONLY_TYPE);
  const multi = pickedTypes.length > 1;
  const mainType = pickedTypes[0];
  const total = Number(String(form.amount).replace(/[₪,\s]/g, '')) || 0;
  const othersSum = pickedTypes.slice(1).reduce((s, t) => s + (Number(split[t]) || 0), 0);
  const mainShare = Math.round((total - othersSum) * 100) / 100;
  function toggleType(t: string) {
    const next = order.includes(t) ? order.filter((x) => x !== t) : [...order, t];
    setOrder(next);
    setForm({ ...form, expenseType: ALL_TYPES.filter((x) => next.includes(x)).join(', ') });
  }
  const [files, setFiles] = useState<ExpenseFile[]>(expense?.files || []);
  const [invoice, setInvoice] = useState<FileList | null>(null);
  const [receipt, setReceipt] = useState<FileList | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const needsAccount = isTransfer(form.paymentMethod) && !form.accountDetails.trim();

  async function save() {
    if (!form.expenseType) return setError('יש לבחור סוג הוצאה');
    if (multi) {
      if (!total) return setError('יש למלא סכום לתשלום');
      if (mainShare < 0) return setError(`הסכומים של הסוגים שנוספו גדולים מהסכום לתשלום (${total})`);
    }
    if (!form.date && !form.hebrewDate && !form.topic.trim()) return setError('חסר תאריך');
    if (!form.payee.trim() && !form.details.trim()) return setError('חסר שם בקבלה או פרוט');
    if (needsAccount) return setError('בתשלום בהעברה חובה למלא פרטי חשבון');
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (multi)
        fd.append(
          'typeAmounts',
          JSON.stringify(Object.fromEntries(pickedTypes.map((t) => [t, t === mainType ? mainShare : Number(split[t]) || 0])))
        );
      fd.append('categoryId', categoryId);
      Array.from(invoice || []).forEach((f) => fd.append('invoice', f));
      Array.from(receipt || []).forEach((f) => fd.append('receipt', f));
      if (expense) await api.putForm(`/expenses/expenses/${expense.id}`, fd);
      else await api.postForm('/expenses/expenses', fd);
      onSaved();
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function removeFile(f: ExpenseFile) {
    if (!confirm(`למחוק את הקובץ ${f.fileName}?`)) return;
    try {
      await api.delete(`/expenses/files/${f.id}`);
      setFiles(files.filter((x) => x.id !== f.id));
    } catch (err: any) {
      setError(err.message);
    }
  }

  const fileSection = (kind: 'invoice' | 'receipt', label: string, onPick: (f: FileList | null) => void) => (
    <div>
      <label className="label">{label}</label>
      {form[`${kind}Url`] && (
        <div className="flex items-center gap-2 text-sm mb-1">
          <a href={form[`${kind}Url`]} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline truncate">
            <Paperclip size={13} className="inline" /> {form[`${kind}Text`] || 'קישור'} (מהאקסל)
          </a>
          <button
            className="text-red-600 hover:bg-red-50 rounded p-0.5"
            title="הסרת הקישור"
            onClick={() => setForm({ ...form, [`${kind}Url`]: '', [`${kind}Text`]: '' })}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {files
        .filter((f) => f.kind === kind)
        .map((f) => (
          <div key={f.id} className="flex items-center gap-2 text-sm mb-1">
            <a href={`/api/expenses/files/${f.id}`} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline truncate">
              <Paperclip size={13} className="inline" /> {f.fileName}
            </a>
            <button className="text-red-600 hover:bg-red-50 rounded p-0.5" title="מחיקת הקובץ" onClick={() => removeFile(f)}>
              <X size={14} />
            </button>
          </div>
        ))}
      <input type="file" multiple accept="application/pdf,image/*" className="text-sm" onChange={(e) => onPick(e.target.files)} />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg space-y-3 max-h-[92vh] overflow-y-auto">
        <h3 className="font-bold text-navy text-lg">{expense ? 'עריכת הוצאה' : 'הוצאה חדשה'}</h3>
        <div>
          <label className="label">סוג הוצאה * <span className="font-normal text-slate-500 text-xs">(אפשר לבחור יותר מאחד)</span></label>
          <div className="flex flex-wrap gap-2">
            {[...EXPENSE_TYPES, ...LEGACY_TYPES.filter((t) => order.includes(t))].map((t) => {
              const on = order.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium border transition-colors ${
                    on ? 'bg-navy text-white border-navy' : 'bg-white text-navy border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {on && '✓ '}
                  {t === 'אוכל' ? 'אוכל (לחיפוש)' : t}
                </button>
              );
            })}
          </div>
          {foodTagOnly && !multi && (
            <p className="mt-2 text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
              "אוכל" מסומן לחיפוש בלבד — כל הסכום נכנס ל"{pickedTypes[0]}" (גם באקסל).
            </p>
          )}
          {multi && (
            <div className="mt-2 rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
              <p className="text-sm text-slate-600">
                כמה מהסכום שייך לסוגים שנוספו? היתרה נשארת ב"{mainType}". (באקסל כל סכום ייכנס לעמודה שלו)
              </p>
              {foodTagOnly && <p className="text-xs text-slate-500">"אוכל" מסומן לחיפוש בלבד — לא מקבל חלק מהסכום.</p>}
              <div className="grid grid-cols-2 gap-2">
                {pickedTypes.map((t) =>
                  t === mainType ? (
                    <label key={t} className="text-sm">
                      {t} (₪) — היתרה
                      <input className={`input mt-1 bg-slate-100 ${mainShare < 0 ? 'text-red-700' : ''}`} readOnly value={total ? String(mainShare) : ''} />
                    </label>
                  ) : (
                    <label key={t} className="text-sm">
                      {t} (₪)
                      <input
                        className="input mt-1"
                        inputMode="decimal"
                        value={split[t] ?? ''}
                        onChange={(e) => setSplit({ ...split, [t]: e.target.value.replace(/[^\d.]/g, '') })}
                      />
                    </label>
                  )
                )}
              </div>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">תאריך *</label>
            <input type="date" className="input" value={form.date} onChange={set('date')} />
            <p className="text-xs text-slate-400 mt-1">{form.date ? heDate(form.date) : form.hebrewDate}</p>
          </div>
          <div>
            <label className="label">סכום לתשלום (₪)</label>
            <input className="input" inputMode="decimal" value={form.amount} onChange={set('amount')} />
            {multi && <p className="text-xs text-slate-400 mt-1">הסכום הכולל — מתחלק לפי הסוגים למעלה</p>}
          </div>
        </div>
        <div>
          <label className="label">נושא הפעילות</label>
          <input className="input" list="expense-topics" value={form.topic} onChange={set('topic')} placeholder="למשל: כנס פתיחה (לא חובה)" />
          <datalist id="expense-topics">
            {topics.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="label">שם בקבלה / שם הרב</label>
          <input className="input" list="expense-payees" value={form.payee} onChange={set('payee')} />
          <datalist id="expense-payees">
            {payees.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">פרוט</label>
            <input className="input" value={form.details} onChange={set('details')} placeholder="הרצאה" />
          </div>
          <div>
            <label className="label">אופן תשלום</label>
            <input className="input" list="expense-methods" value={form.paymentMethod} onChange={set('paymentMethod')} />
            <datalist id="expense-methods">
              {PAYMENT_METHODS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">פרטי חשבון{isTransfer(form.paymentMethod) ? ' *' : ''}</label>
            <input
              className={`input ${needsAccount ? 'border-red-400' : ''}`}
              value={form.accountDetails}
              onChange={set('accountDetails')}
              placeholder="בנק, סניף, חשבון, שם בעל החשבון"
            />
            {needsAccount && <p className="text-xs text-red-600 mt-1">חובה בתשלום בהעברה</p>}
          </div>
          <div>
            <label className="label">תאריך תשלום</label>
            <input type="date" className="input" value={form.paymentDate} onChange={set('paymentDate')} />
            <p className="text-xs text-slate-400 mt-1">{form.paymentDate ? heDate(form.paymentDate) : 'ריק = טרם שולם'}</p>
          </div>
        </div>
        {fileSection('invoice', 'חשבונית', setInvoice)}
        {fileSection('receipt', 'קבלה', setReceipt)}
        <div>
          <label className="label">הערות</label>
          <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} />
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex gap-2 justify-end pt-1">
          <button className="btn-outline" onClick={onClose}>
            ביטול
          </button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'שומר...' : 'שמירה'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CategoryModal({
  category,
  categories,
  year,
  onClose,
  onSaved,
}: {
  category: Category | null;
  categories: Category[];
  year: string;
  onClose: () => void;
  onSaved: (id?: string) => void;
}) {
  const [name, setName] = useState(category?.name || '');
  const [budget, setBudget] = useState(category ? String(category.budget) : '');
  const [parentId, setParentId] = useState(category?.parentId || '');
  const [error, setError] = useState<string | null>(null);
  // רמה אחת בלבד: אב לא יכול לרדת מאחר, וקטגוריה שיורדת לא יכולה להיות אב
  const parentOptions = categories.filter((c) => c.id !== category?.id && !c.parentId);
  const hasChildren = !!category?.childNames.length;

  async function save() {
    setError(null);
    try {
      if (category) {
        await api.put(`/expenses/categories/${category.id}`, { name, budget, parentId });
        onSaved();
      } else {
        const r = await api.post<{ category: Category }>('/expenses/categories', { name, budget, year, parentId });
        onSaved(r.category.id);
      }
    } catch (err: any) {
      setError(err.message);
    }
  }
  async function remove() {
    if (!category || !confirm(`למחוק את הקטגוריה "${category.name}"?`)) return;
    try {
      await api.delete(`/expenses/categories/${category.id}`);
      onSaved();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-3">
        <h3 className="font-bold text-navy text-lg">{category ? 'עריכת קטגוריה' : `קטגוריה חדשה — ${year}`}</h3>
        <div>
          <label className="label">שם הקטגוריה *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="הרצאות" />
        </div>
        <div>
          <label className="label">תקציב שנתי (₪)</label>
          <input className="input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </div>
        <div>
          <label className="label">ההוצאות יורדות גם מתקציב של</label>
          {hasChildren ? (
            <p className="text-sm text-slate-500">לא זמין — {category!.childNames.join(', ')} יורדות מהקטגוריה הזו</p>
          ) : (
            <select className="input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">— לא יורד מקטגוריה אחרת —</option>
              {parentOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {error &&<p className="text-sm text-red-700">{error}</p>}
        <div className="flex gap-2 justify-end pt-1">
          {category && !category.count && (
            <button className="btn-danger ml-auto" onClick={remove}>
              <Trash2 size={15} /> מחיקה
            </button>
          )}
          <button className="btn-outline" onClick={onClose}>
            ביטול
          </button>
          <button className="btn-primary" onClick={save} disabled={!name.trim()}>
            שמירה
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportModal({ year, onClose, onDone }: { year: string; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ category: string; imported: number; skipped: number }[] | null>(null);
  const isCsv = !!file && /\.csv$/i.test(file.name);

  function pick(f: File | null) {
    setFile(f);
    setResult(null);
    setCategoryName(f?.name.match(/\(([^)]+)\)/)?.[1]?.trim() || '');
  }

  async function run() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('year', year);
      if (isCsv) fd.append('categoryName', categoryName);
      setResult((await api.postForm<{ summary: { category: string; imported: number; skipped: number }[] }>('/expenses/import', fd)).summary);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-3">
        <h3 className="font-bold text-navy text-lg">ייבוא מאקסל — שנת {year}</h3>
        <p className="text-sm text-slate-500">
          קובץ Excel: כל גיליון נכנס כקטגוריה בשם הגיליון, עם התקציב השנתי שבשורה הראשונה. קובץ CSV נכנס לקטגוריה אחת. ייבוא חוזר של
          אותו קובץ לא מכפיל שורות.
        </p>
        <input type="file" accept=".xlsx,.csv" className="text-sm" onChange={(e) => pick(e.target.files?.[0] || null)} />
        {isCsv && (
          <div>
            <label className="label">לאיזו קטגוריה?</label>
            <input className="input" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="הרצאות" />
          </div>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}
        {result && (
          <ul className="text-sm bg-green-50 text-green-800 rounded-xl px-4 py-2 space-y-0.5">
            {result.map((r) => (
              <li key={r.category}>
                {r.category}: נוספו {r.imported} שורות{r.skipped ? ` · ${r.skipped} כבר היו קיימות` : ''}
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2 justify-end pt-1">
          {result ? (
            <button className="btn-primary" onClick={onDone}>
              סגירה
            </button>
          ) : (
            <>
              <button className="btn-outline" onClick={onClose}>
                ביטול
              </button>
              <button className="btn-primary" onClick={run} disabled={!file || busy || (isCsv && !categoryName.trim())}>
                {busy ? 'מייבא...' : 'ייבוא'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

/** 2026-10 ← "אוקטובר 2026"; ריק ← "בלי תאריך" */
type SearchExpense = Expense & { category: { id: string; name: string } };

/** חיפוש בכל הפנקס של השנה לפי סוג הוצאה — למשל כל האוכל מכל התוכניות */
function TypeSearch({ year, onChanged }: { year: string; onChanged: () => void }) {
  const [type, setType] = useState(() => {
    const saved = readPref('expenses.type');
    // סוג ששמור מפעם קודם ובינתיים שונה (למשל "דרייברים") — חוזרים לברירת המחדל
    return saved && (saved === 'none' || ALL_TYPES.includes(saved)) ? saved : EXPENSE_TYPES[0];
  });
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ counts: Record<string, number>; expenses: SearchExpense[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setData(await api.get('/expenses/search', { year: year || undefined, type: type || undefined }));
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    setData(null);
    load();
    writePref('expenses.type', type);
  }, [year, type]);

  const shown = useMemo(() => {
    const s = q.trim();
    if (!data) return [];
    if (!s) return data.expenses;
    return data.expenses.filter((e) =>
      [e.category.name, e.topic, e.payee, e.details, e.paymentMethod, e.notes, fmtDate(e.date)].some((v) => v && v.includes(s))
    );
  }, [data, q]);
  const total = shown.reduce((s, e) => s + (e.amount || 0), 0);
  const byProgram = useMemo(() => {
    const m = new Map<string, { count: number; sum: number }>();
    for (const e of shown) {
      const cur = m.get(e.category.name) || { count: 0, sum: 0 };
      cur.count++;
      cur.sum += e.amount || 0;
      m.set(e.category.name, cur);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].sum - a[1].sum);
  }, [shown]);

  async function changeType(e: SearchExpense, t: string) {
    try {
      await api.put(`/expenses/expenses/${e.id}/type`, { expenseType: t });
      await load();
      onChanged();
    } catch (err: any) {
      setError(err.message);
    }
  }

  const chip = (value: string, label: string) => (
    <button
      key={value || 'all'}
      onClick={() => setType(value)}
      className={`rounded-full px-4 py-1.5 text-sm font-medium border transition-colors ${
        type === value ? 'bg-navy text-white border-navy' : 'bg-white text-navy border-slate-300 hover:bg-slate-50'
      }`}
    >
      {label}
      {data && value && <span className="opacity-60"> ({data.counts[value] || 0})</span>}
    </button>
  );

  return (
    <div>
      <p className="text-sm text-slate-600 mb-2">כל ההוצאות של שנת {year} מכל התוכניות, לפי סוג הוצאה:</p>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {EXPENSE_TYPES.map((t) => chip(t, t === 'אוכל' ? 'אוכל (חיפוש)' : t))}
        {data && LEGACY_TYPES.filter((t) => data.counts[t]).map((t) => chip(t, `${t} (סוג ישן)`))}
        {chip('none', 'בלי סוג')}
        {chip('', 'הכל')}
      </div>

      {error && (
        <div className="mb-3 rounded-xl bg-red-50 text-red-700 px-4 py-2 text-sm flex justify-between">
          {error}
          <button onClick={() => setError(null)}>
            <X size={16} />
          </button>
        </div>
      )}

      {type === 'none' && (
        <p className="text-sm text-slate-600 mb-3">
          אלה הוצאות שעוד לא שויכו לסוג (למשל הוצאות ישנות). אפשר לבחור סוג ישירות בעמודה "סוג הוצאה", וזה נשמר מיד.
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <SummaryCard label={`סה"כ ${type === 'none' ? 'בלי סוג' : type || 'כל ההוצאות'}`} value={shekel(total)} />
        <SummaryCard label="מספר הוצאות" value={String(shown.length)} />
      </div>
      {byProgram.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4 text-sm">
          {byProgram.map(([name, v]) => (
            <span key={name} className="rounded-lg bg-slate-100 px-3 py-1.5">
              <b className="text-navy">{name}</b>: {shekel(v.sum)} <span className="text-slate-500">({v.count})</span>
            </span>
          ))}
        </div>
      )}

      <div className="relative max-w-xs mb-3">
        <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input pr-9 py-2" placeholder="חיפוש בתוצאות (שם, תוכנית, פרוט...)" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-[15px] leading-snug">
          <thead className="bg-navy text-white">
            <tr>
              {['תוכנית', 'סוג הוצאה', 'תאריך', 'נושא הפעילות', 'שם בקבלה / שם הרב', 'פרוט', 'סכום', 'חשבונית', 'תאריך תשלום'].map((h) => (
                <th key={h} className="px-2.5 py-3 text-right font-bold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!data ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-400">
                  טוען...
                </td>
              </tr>
            ) : !shown.length ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-400">
                  לא נמצאו הוצאות
                </td>
              </tr>
            ) : (
              shown.map((e) => (
                <tr key={e.id} className="border-t border-slate-100 align-top hover:bg-slate-50/60">
                  <td className="px-2.5 py-2.5 font-medium text-navy">{e.category.name}</td>
                  <td className="px-2.5 py-2">
                    {splitTypes(e.expenseType).length > 1 ? (
                      <TypeBadge type={e.expenseType} />
                    ) : (
                    <select
                      className={`rounded-lg border px-2 py-1 text-sm ${e.expenseType ? TYPE_COLORS[e.expenseType] || '' : 'border-amber-400 bg-amber-50'}`}
                      value={e.expenseType || ''}
                      onChange={(ev) => changeType(e, ev.target.value)}
                    >
                      <option value="">— בחירה —</option>
                      {[...EXPENSE_TYPES, ...LEGACY_TYPES.filter((t) => t === e.expenseType)].map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    )}
                  </td>
                  <td className="px-2.5 py-2.5 whitespace-nowrap">
                    {fmtDate(e.date)}
                    <p className="text-xs text-slate-500">{e.date ? heDate(e.date) : e.hebrewDate}</p>
                  </td>
                  <td className="px-2.5 py-2.5">{e.topic}</td>
                  <td className="px-2.5 py-2.5 font-medium text-navy">{e.payee}</td>
                  <td className="px-2.5 py-2.5">{e.details}</td>
                  <td className="px-2.5 py-2.5 whitespace-nowrap font-semibold">{e.amount !== null ? shekel(e.amount) : ''}</td>
                  <td className="px-2.5 py-2.5">
                    <FileLinks files={e.files.filter((f) => f.kind === 'invoice')} text={e.invoiceText} url={e.invoiceUrl} />
                  </td>
                  <td className="px-2.5 py-2.5 whitespace-nowrap">
                    {e.paymentDate ? fmtDate(e.paymentDate) : <span className="text-slate-400 text-xs">טרם שולם</span>}
                  </td>
                </tr>
              ))
            )}
            {shown.length > 0 && (
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                <td colSpan={6} className="px-2.5 py-2.5 text-left">
                  סה"כ
                </td>
                <td className="px-2.5 py-2.5 whitespace-nowrap">{shekel(total)}</td>
                <td colSpan={2} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function monthLabel(month: string): string {
  if (!month) return 'בלי תאריך';
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS_HE[m - 1]} ${y}`;
}
