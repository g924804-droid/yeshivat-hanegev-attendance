import { useMemo, useState } from 'react';
import { X, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { SCHOOL_MONTHS, StudentRow, shekel } from '../../lib/payments';

type Item = {
  line: number;
  customer: string;
  amount: number;
  kind: string;
  notes: string;
  key: string;
  studentName: string | null;
  how: 'saved' | 'exact' | 'family' | 'ambiguous' | 'none';
  candidates: string[];
  hasCharge: boolean;
  owed: number | null;
  alreadyPaid: number | null;
  imported: boolean;
};
type Preview = { tag: string; date: string; month: string; year: string; items: Item[]; studentNames: string[]; total: number };

const HOW_LABEL: Record<Item['how'], string> = {
  saved: 'כמו בפעם הקודמת',
  exact: 'הותאמה',
  family: 'לפי שם משפחה — לבדוק',
  ambiguous: 'יש כמה אפשרויות — לבחור',
  none: 'לא נמצאה — לבחור',
};

/**
 * ייבוא דוח מס"ב (הוראות קבע ששודרו): מעלים את הקובץ, בודקים את ההתאמה של כל שורה לתלמידה,
 * ומאשרים — לכל בת נרשם תשלום בהוראת קבע לחודש שנבחר, והחודש מסומן ✓.
 */
export function MasavImportModal({ students, onClose, onDone }: { students: StudentRow[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choice, setChoice] = useState<Record<number, string>>({});
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(f: File, month?: string, year?: string) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      if (month) fd.append('month', month);
      if (year) fd.append('year', year);
      const p = await api.postForm<Preview>('/payments/masavPreview', fd);
      setPreview(p);
      setDate(p.date);
      setChoice(Object.fromEntries(p.items.map((i) => [i.line, i.studentName || ''])));
    } catch (err: any) {
      setError(err.message || 'שגיאה בקריאת הקובץ');
    } finally {
      setBusy(false);
    }
  }

  const monthlyOf = useMemo(() => new Map(students.map((s) => [s.name, s.monthlyAmount])), [students]);
  const items = preview?.items || [];
  const toRecord = items.filter((i) => !i.imported && choice[i.line]);
  const missing = items.filter((i) => !i.imported && !choice[i.line]);
  const sum = toRecord.reduce((s, i) => s + i.amount, 0);
  const newCharges = new Set(toRecord.filter((i) => !(i.hasCharge && choice[i.line] === i.studentName)).map((i) => choice[i.line]));

  async function apply() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ recorded: number; skipped: number; students: number; chargesCreated: number }>('/payments/masavApply', {
        tag: preview.tag,
        date,
        month: preview.month,
        year: preview.year,
        items: toRecord.map((i) => ({
          line: i.line,
          key: i.key,
          studentName: choice[i.line],
          amount: i.amount,
          kind: i.kind,
          chargeAmount: monthlyOf.get(choice[i.line]) || 0,
        })),
      });
      onDone(
        `מס"ב ${preview.month} ${preview.year}: נרשמו ${r.recorded} תשלומים ל-${r.students} תלמידות (${shekel(sum)})` +
          (r.chargesCreated ? `, נפתחו ${r.chargesCreated} חיובים חדשים` : '') +
          (r.skipped ? `, ${r.skipped} שורות כבר יובאו קודם` : '') +
          (missing.length ? `. ${missing.length} שורות לא שויכו לתלמידה ולא נרשמו.` : '.')
      );
    } catch (err: any) {
      setError(err.message || 'שגיאה ברישום');
      setBusy(false);
    }
  }

  const years = preview ? [Number(preview.year) - 1, Number(preview.year), Number(preview.year) + 1].map(String) : [];
  // קודם מה שצריך לבדוק
  const order: Record<Item['how'], number> = { none: 0, ambiguous: 1, family: 2, exact: 3, saved: 4 };
  const sorted = [...items].sort((a, b) => order[a.how] - order[b.how] || a.line - b.line);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-5 w-full max-w-4xl max-h-[92vh] overflow-y-auto space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-navy text-lg">ייבוא קובץ מס"ב (הוראות קבע ששודרו)</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <label className="btn-outline cursor-pointer inline-flex">
          <Upload size={16} /> {file ? file.name : 'בחירת קובץ (CSV או אקסל)'}
          <input
            type="file"
            accept=".csv,.xlsx,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setFile(f);
                load(f);
              }
              e.target.value = '';
            }}
          />
        </label>
        {busy && !preview && <p className="text-sm text-slate-500">קורא את הקובץ ומתאים לתלמידות...</p>}
        {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {preview && (
          <>
            <div className="flex flex-wrap items-end gap-3 text-sm">
              <label>
                לחודש
                <select
                  className="input mt-1"
                  value={preview.month}
                  onChange={(e) => file && load(file, e.target.value, preview.year)}
                  disabled={busy}
                >
                  {SCHOOL_MONTHS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label>
                שנה
                <select className="input mt-1" value={preview.year} onChange={(e) => file && load(file, preview.month, e.target.value)} disabled={busy}>
                  {years.map((y) => (
                    <option key={y}>{y}</option>
                  ))}
                </select>
              </label>
              <label>
                תאריך התשלום
                <input type="date" className="input mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <p className="text-slate-600 pb-2">
                {items.length} שורות בקובץ · סה"כ {shekel(preview.total)}
              </p>
            </div>

            <div className="overflow-x-auto border rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="p-2 text-right">שם בקובץ</th>
                    <th className="p-2 text-right">סכום</th>
                    <th className="p-2 text-right">תלמידה</th>
                    <th className="p-2 text-right">מצב</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((i) => {
                    const chosen = choice[i.line] || '';
                    const warn = !i.imported && (i.how === 'none' || i.how === 'ambiguous' || i.how === 'family') && chosen === (i.studentName || '');
                    const opts = [...i.candidates, ...preview.studentNames.filter((n) => !i.candidates.includes(n))];
                    return (
                      <tr key={i.line} className={`border-t ${i.imported ? 'text-slate-400' : warn ? 'bg-amber-50' : ''}`}>
                        <td className="p-2">
                          {i.customer}
                          {i.kind && <span className="text-xs text-slate-500"> · {i.kind}</span>}
                        </td>
                        <td className="p-2 whitespace-nowrap">{shekel(i.amount)}</td>
                        <td className="p-2">
                          <select
                            className="input py-1"
                            value={chosen}
                            disabled={i.imported}
                            onChange={(e) => setChoice({ ...choice, [i.line]: e.target.value })}
                          >
                            <option value="">— לא לרשום —</option>
                            {opts.map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2 text-xs whitespace-nowrap">
                          {i.imported ? (
                            'כבר יובא'
                          ) : !chosen ? (
                            <span className="text-red-700">לא יירשם</span>
                          ) : (
                            <>
                              <span className={warn ? 'text-amber-700 font-medium' : 'text-green-700'}>
                                {chosen === i.studentName ? HOW_LABEL[i.how] : 'נבחרה ידנית'}
                              </span>
                              {chosen === i.studentName && !i.hasCharge && <div className="text-slate-500">ייפתח לה חיוב לחודש</div>}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="text-sm bg-slate-50 rounded-xl px-4 py-2 space-y-1">
              <p>
                יירשמו <strong>{toRecord.length}</strong> תשלומים בהוראת קבע, סה"כ <strong>{shekel(sum)}</strong>, ל{preview.month} {preview.year}.
              </p>
              {newCharges.size > 0 && <p className="text-slate-600">ל-{newCharges.size} תלמידות אין עדיין חיוב בחודש הזה — ייפתח להן חיוב בסכום החודשי שלהן.</p>}
              {missing.length > 0 && <p className="text-red-700">{missing.length} שורות בלי תלמידה — לא יירשמו.</p>}
              <p className="text-slate-500">ההתאמות נשמרות, ובחודש הבא אותם הורים יותאמו אוטומטית.</p>
            </div>

            <div className="flex gap-2">
              <button className="btn-primary" onClick={apply} disabled={busy || !toRecord.length || !date}>
                {busy ? 'רושם...' : `רישום ${toRecord.length} תשלומים`}
              </button>
              <button className="btn-outline" onClick={onClose}>
                ביטול
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
