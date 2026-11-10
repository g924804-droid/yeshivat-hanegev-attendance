import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Search, UserPlus, Upload, Printer, Pencil, Trash2, Plus, Check, ArrowRight, Download } from 'lucide-react';
import { Layout } from '../components/Layout';
import { api } from '../lib/api';

type SearchResult = {
  id: string;
  name: string;
  idNumber: string;
  year: string;
  tracks: string[];
  status: string;
  gradYear: string;
};

type YearRow = { id: string; schoolYear: string; track: string | null; amountDue: number; amountPaid: number; notes: string | null };
type Debt = { id: string; schoolYear: string | null; subject: string; description: string | null; done: boolean; doneAt: string | null };
type StudentFile = {
  student: { id: string; name: string; fields: Record<string, string>; year: string; tracks: string[]; needsCompletion: boolean };
  profile: {
    status: string;
    gradYear: string;
    notes: string;
    birthDateHe: string;
    birthDate: string;
    teachingStudies: string;
    openingDebt: number;
  };
  years: YearRow[];
  yearMonths: Record<string, { month: number; amount: number | null; amountText: string | null; method: string | null; debt: number; debtText: string | null }[]>;
  yearsSummary: {
    schoolYear: string;
    manual: YearRow | null;
    live: { owed: number; paid: number; balance: number; months: number } | null;
    attendance: { present: number; absent: number; late: number } | null;
  }[];
  livePayments: { schoolYear: string; month: string; year: number; owed: number; scholarship: number; paid: number; balance: number }[];
  debts: Debt[];
  grades: { id: string; test: string; score: number | null; date: string; notes: string }[];
  totals: { balance: number; openDebts: number };
};

const PERSONAL: { key: string; label: string }[] = [
  { key: 'שם פרטי', label: 'שם פרטי' },
  { key: 'שם מלא', label: 'שם משפחה' },
  { key: 'תעודת זהות', label: 'תעודת זהות' },
  { key: 'פרטי קשר', label: 'טלפון / פרטי קשר' },
  { key: 'כתובת', label: 'כתובת' },
  { key: 'עיר', label: 'עיר' },
  { key: 'תיכון', label: 'תיכון' },
  { key: 'קופת חולים', label: 'קופת חולים' },
  { key: 'התמחות', label: 'התמחות' },
  { key: 'שם אמא', label: 'שם אמא' },
  { key: 'ת.ז אמא', label: 'ת.ז. אמא' },
  { key: 'טלפון אמא', label: 'טלפון אמא' },
  { key: 'שם אבא', label: 'שם אבא' },
  { key: 'ת.ז אבא', label: 'ת.ז. אבא' },
  { key: 'טלפון אבא', label: 'טלפון אבא' },
];

const HEB_MONTHS = ['', 'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const money = (n: number) => `₪${Math.round(n).toLocaleString('he-IL')}`;

// ---------------------------------------------------------------------------
// חיפוש
// ---------------------------------------------------------------------------

export function StudentFilesPage() {
  const { id } = useParams();
  return id ? <StudentFileView id={id} /> : <StudentSearch />;
}

function StudentSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [gradYear, setGradYear] = useState('');
  const [schoolYear, setSchoolYear] = useState('');
  const [gradYears, setGradYears] = useState<string[]>([]);
  const [schoolYears, setSchoolYears] = useState<string[]>([]);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showPayImport, setShowPayImport] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .get<{ results: SearchResult[]; total: number; gradYears: string[]; schoolYears: string[] }>('/studentFiles/search', {
          q,
          status,
          gradYear: gradYear || undefined,
          schoolYear: schoolYear || undefined,
        })
        .then((r) => {
          setResults(r.results);
          setTotal(r.total);
          setGradYears(r.gradYears || []);
          setSchoolYears(r.schoolYears || []);
          setError('');
        })
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q, status, gradYear, schoolYear, reload]);

  return (
    <Layout title="תיק תלמידה">
      <div className="card mb-4">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input pr-9 text-lg"
              placeholder="הקלידי ת.ז. או שם (פרטי / משפחה)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </div>
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">כולן</option>
            <option value="פעילה">תלמידות פעילות</option>
            <option value="בוגרת">בוגרות</option>
          </select>
          <select className="input w-auto" value={gradYear} onChange={(e) => setGradYear(e.target.value)} title="מחזור — שנת הסיום">
            <option value="">כל המחזורים</option>
            {gradYears.map((y) => (
              <option key={y} value={y}>מחזור {y}</option>
            ))}
          </select>
          <select className="input w-auto" value={schoolYear} onChange={(e) => setSchoolYear(e.target.value)} title="בנות שלמדו בשנה הזו">
            <option value="">כל שנות הלימוד</option>
            {schoolYears.map((y) => (
              <option key={y} value={y}>למדו ב{y}</option>
            ))}
          </select>
          <button className="btn-outline" onClick={() => setShowAdd(true)}>
            <UserPlus size={18} /> הוספת תלמידה / בוגרת
          </button>
          <button className="btn-outline" onClick={() => setShowImport(true)}>
            <Upload size={18} /> ייבוא מאקסל
          </button>
          <button className="btn-outline" onClick={() => setShowPayImport(true)}>
            <Upload size={18} /> ייבוא דוח תשלומים
          </button>
        </div>
      </div>

      {error && <div className="mb-4 text-sm bg-red-50 text-red-700 rounded-xl px-4 py-2">{error}</div>}

      <div className="card">
        {!results ? (
          <div className="text-gray-500">טוען...</div>
        ) : !results.length ? (
          <div className="text-gray-500">לא נמצאו תלמידות</div>
        ) : (
          <>
            <div className="text-sm text-gray-500 mb-2">
              {total} תלמידות{total > results.length ? ` (מוצגות ${results.length} — אפשר לצמצם בחיפוש)` : ''}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right text-gray-500 border-b">
                    <th className="py-2 px-2">שם</th>
                    <th className="py-2 px-2">ת.ז.</th>
                    <th className="py-2 px-2">סטטוס</th>
                    <th className="py-2 px-2">מסלולים / שנה</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((s) => (
                    <tr key={s.id} className="border-b hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/student-files/${s.id}`)}>
                      <td className="py-2 px-2 font-semibold text-navy">{s.name}</td>
                      <td className="py-2 px-2">{s.idNumber}</td>
                      <td className="py-2 px-2">
                        {s.status === 'בוגרת' ? (
                          <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs">בוגרת {s.gradYear}</span>
                        ) : (
                          <span className="rounded-full bg-green-100 text-green-800 px-2 py-0.5 text-xs">פעילה</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-gray-600">{[...s.tracks, s.year].filter(Boolean).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showAdd && <AddStudentModal onClose={() => setShowAdd(false)} onCreated={(id) => navigate(`/student-files/${id}`)} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} onDone={() => setReload((n) => n + 1)} />}
      {showPayImport && <PaymentsImportModal onClose={() => setShowPayImport(false)} />}
    </Layout>
  );
}

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className={`bg-white rounded-2xl p-5 w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-bold text-navy text-lg mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function AddStudentModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [alumni, setAlumni] = useState(true);
  const [gradYear, setGradYear] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const r = await api.post<{ id: string }>('/studentFiles/student', {
        fields,
        profile: { status: alumni ? 'בוגרת' : 'פעילה', gradYear },
      });
      onCreated(r.id);
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <Modal title="הוספת תלמידה / בוגרת" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        {PERSONAL.slice(0, 6).map((f) => (
          <label key={f.key} className="text-sm">
            {f.label}
            <input className="input mt-1" value={fields[f.key] || ''} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={alumni} onChange={(e) => setAlumni(e.target.checked)} /> בוגרת
        </label>
        {alumni && (
          <label className="text-sm flex items-center gap-2">
            מחזור (שנת סיום)
            <input className="input w-28" placeholder='תשפ"ד' value={gradYear} onChange={(e) => setGradYear(e.target.value)} />
          </label>
        )}
      </div>
      <p className="text-xs text-gray-500 mt-2">שאר הפרטים, השנים והכספים — בתיק עצמו אחרי היצירה.</p>
      {error && <div className="mt-3 text-sm bg-red-50 text-red-700 rounded-xl px-3 py-2">{error}</div>}
      <div className="flex gap-2 mt-4">
        <button className="btn-primary" disabled={saving} onClick={save}>
          {saving ? 'שומר...' : 'יצירה ופתיחת התיק'}
        </button>
        <button className="btn-outline" onClick={onClose}>
          ביטול
        </button>
      </div>
    </Modal>
  );
}

type ImportPreview = {
  newCount: number;
  existingCount: number;
  yearsCount: number;
  debtsCount: number;
  financialDebtCount: number;
  sheets: { name: string; rows: number; years: string[] }[];
  people: { name: string; idNumber: string; existing: boolean; gradYear: string; alumni: boolean; years: string[]; debts: number }[];
  problems: { row: string; message: string }[];
};

type PayPreview = {
  schoolYear: string;
  sheets: { name: string; rows: number }[];
  matchedCount: number;
  totalPaid: number;
  totalDebt: number;
  withDebt: number;
  textCells: number;
  extrasCount: number;
  people: { name: string; sheet: string; paid: number; debt: number; months: number; notes: number }[];
  problems: { row: string; message: string }[];
  review?: ReviewRow[];
};
type ReviewRow = { name: string; sheet: string; emptyMonths: number; debt: number; notes: string };

/** בנות עם 4+ חודשים ריקים בקובץ (נחשבו חוב) — לבדיקה: אולי שילמו בבת אחת, כפי שרשום בהערה */
function ReviewList({ rows }: { rows: ReviewRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="mt-2 bg-sky-50 text-sky-900 rounded-xl px-4 py-2 text-sm max-h-56 overflow-y-auto">
      <div className="font-semibold mb-1">
        לבדיקה ({rows.length}) — חודשים ריקים בקובץ נחשבו חוב. אם הבת שילמה בבת אחת (כמו שרשום בהערה), מתקנים בתיק שלה:
      </div>
      {rows.map((r, i) => (
        <div key={i} className="border-t border-sky-100 py-1">
          <b>{r.name}</b> ({r.sheet}) · {r.emptyMonths} חודשים ריקים · חוב {money(r.debt)}
          {r.notes && <div className="text-xs text-sky-800">הערה: {r.notes}</div>}
        </div>
      ))}
    </div>
  );
}

/** ייבוא דוח תשלומים שנתי — גיליון לכל כיתה, עמודה לכל חודש */
function PaymentsImportModal({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [schoolYear, setSchoolYear] = useState('');
  const [preview, setPreview] = useState<PayPreview | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [doneReview, setDoneReview] = useState<ReviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async (commit: boolean) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('commit', String(commit));
      fd.append('schoolYear', schoolYear);
      const r = await api.postForm<any>('/studentFiles/importPayments', fd);
      if (commit) {
        setDone(r.imported);
        setDoneReview(r.review || []);
      }
      else {
        setPreview(r);
        setSchoolYear(r.schoolYear);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="ייבוא דוח תשלומים שנתי" onClose={onClose} wide>
      {done !== null ? (
        <div>
          <div className="bg-green-50 text-green-800 rounded-xl px-4 py-3">הייבוא הסתיים: עודכנו התשלומים של {done} בנות.</div>
          <ReviewList rows={doneReview} />
          <button className="btn-primary mt-4" onClick={onClose}>
            סגירה
          </button>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-700 mb-3">
            קובץ עם גיליון לכל כיתה: שם משפחה, שם פרטי, ת"ז, ולכל חודש — "חודש 9", אופן תשלום, סה"כ חוב. הבנות מזוהות לפי ת.ז. בלבד.
            גיליון "תשלומים נוספים" נכנס כהערה. ייבוא חוזר של אותה שנה מחליף את מה שיובא קודם.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setPreview(null);
              }}
            />
            <label className="text-sm flex items-center gap-2">
              שנת לימודים
              <input
                className="input w-28"
                placeholder="לפי שם הקובץ"
                value={schoolYear}
                onChange={(e) => {
                  setSchoolYear(e.target.value);
                  setPreview(null);
                }}
              />
            </label>
          </div>
          {error && <div className="mt-3 text-sm bg-red-50 text-red-700 rounded-xl px-3 py-2">{error}</div>}
          {preview && (
            <div className="mt-4">
              <div className="text-xs text-gray-600 mb-2">
                שנת {preview.schoolYear} · גיליונות: {preview.sheets.map((s) => `${s.name} (${s.rows})`).join(' · ')}
              </div>
              <div className="bg-slate-50 rounded-xl px-4 py-3 text-sm">
                יעודכנו <b>{preview.matchedCount}</b> בנות · שולם {money(preview.totalPaid)} · חוב {money(preview.totalDebt)} ({preview.withDebt} בנות עם חוב)
                {preview.extrasCount ? ` · ${preview.extrasCount} עם תשלומים נוספים` : ''}
                {preview.textCells ? (
                  <div className="text-amber-800 mt-1">
                    {preview.textCells} חודשים עם הערה במקום סכום (למשל "לגבות 720") — נשמרים כמו שהם בפירוט החודשי, אבל לא נספרים בסכומים.
                  </div>
                ) : null}
              </div>
              {!!preview.problems.length && (
                <div className="mt-2 bg-amber-50 text-amber-800 rounded-xl px-4 py-2 text-sm max-h-40 overflow-y-auto">
                  <div className="font-semibold mb-1">לא ייובאו ({preview.problems.length}):</div>
                  {preview.problems.map((p, i) => (
                    <div key={i}>
                      {p.row}: {p.message}
                    </div>
                  ))}
                </div>
              )}
              <ReviewList rows={preview.review || []} />
              <div className="max-h-64 overflow-y-auto mt-2 border rounded-xl">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr className="text-right text-gray-500">
                      <th className="py-1 px-2">שם</th>
                      <th className="py-1 px-2">גיליון</th>
                      <th className="py-1 px-2">שולם</th>
                      <th className="py-1 px-2">חוב</th>
                      <th className="py-1 px-2">חודשים</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.people.map((p, i) => (
                      <tr key={i} className="border-t">
                        <td className="py-1 px-2">{p.name}</td>
                        <td className="py-1 px-2">{p.sheet}</td>
                        <td className="py-1 px-2">{money(p.paid)}</td>
                        <td className={`py-1 px-2 ${p.debt > 0 ? 'text-red-700 font-semibold' : ''}`}>{p.debt ? money(p.debt) : ''}</td>
                        <td className="py-1 px-2">
                          {p.months}
                          {p.notes ? ` (${p.notes} עם הערה)` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="flex gap-2 mt-4">
            {!preview ? (
              <button className="btn-primary" disabled={!file || busy} onClick={() => send(false)}>
                {busy ? 'בודק...' : 'בדיקה'}
              </button>
            ) : (
              <button className="btn-gold" disabled={busy || !preview.matchedCount} onClick={() => send(true)}>
                {busy ? 'מייבא...' : `אישור וייבוא (${preview.matchedCount})`}
              </button>
            )}
            <button className="btn-outline" onClick={onClose}>
              ביטול
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [markAlumni, setMarkAlumni] = useState(true);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; years: number; debts: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async (commit: boolean) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('commit', String(commit));
      fd.append('markAlumni', String(markAlumni));
      const r = await api.postForm<any>('/studentFiles/import', fd);
      if (commit) {
        setResult(r);
        onDone();
      } else setPreview(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="ייבוא תלמידות / בוגרות מאקסל" onClose={onClose} wide>
      {result ? (
        <div>
          <div className="bg-green-50 text-green-800 rounded-xl px-4 py-3">
            הייבוא הסתיים: {result.created} תלמידות חדשות, {result.updated} קיימות עודכנו, {result.years} שנות לימוד, {result.debts} חובות לימודיים.
          </div>
          <button className="btn-primary mt-4" onClick={onClose}>
            סגירה
          </button>
        </div>
      ) : (
        <>
          <ol className="text-sm text-gray-700 list-decimal pr-5 space-y-1 mb-4">
            <li>
              מורידים את התבנית, ממלאים <b>שורה לכל שנה</b> שהתלמידה למדה (תלמידה שלמדה שנתיים = שתי שורות עם אותה ת.ז.).
            </li>
            <li>מעלים את הקובץ ולוחצים "בדיקה" — רואים מה ייכנס, עוד לפני שמשהו נשמר.</li>
            <li>תלמידה שכבר קיימת (לפי ת.ז. או שם) לא תיווצר שוב — רק יתווספו לה הנתונים. שדות שכבר מלאים לא ישתנו.</li>
          </ol>
          <a className="btn-outline inline-flex mb-4" href="/api/studentFiles/importTemplate">
            <Download size={18} /> הורדת תבנית אקסל
          </a>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setPreview(null);
              }}
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={markAlumni} onChange={(e) => { setMarkAlumni(e.target.checked); setPreview(null); }} />
              לסמן כבוגרות גם כשאין מחזור (מחזור שעוד לומד — תמיד פעילות)
            </label>
          </div>
          {error && <div className="mt-3 text-sm bg-red-50 text-red-700 rounded-xl px-3 py-2">{error}</div>}

          {preview && (
            <div className="mt-4">
              {preview.sheets.length > 1 && (
                <div className="text-xs text-gray-600 mb-2">
                  גיליונות שנקראו: {preview.sheets.map((s) => `${s.name} (${s.rows})`).join(' · ')}
                </div>
              )}
              <div className="bg-slate-50 rounded-xl px-4 py-3 text-sm">
                ייווצרו <b>{preview.newCount}</b> תלמידות חדשות, יעודכנו <b>{preview.existingCount}</b> קיימות · {preview.yearsCount} שנות לימוד ·{' '}
                {preview.debtsCount} חובות לימודיים
                {preview.financialDebtCount ? ` · ${preview.financialDebtCount} עם חוב כספי` : ''}
              </div>
              {!!preview.problems.length && (
                <div className="mt-2 bg-amber-50 text-amber-800 rounded-xl px-4 py-2 text-sm">
                  <div className="font-semibold mb-1">שורות עם בעיה (לא ייובאו במלואן):</div>
                  {preview.problems.map((p, i) => (
                    <div key={i}>
                      שורה {p.row}: {p.message}
                    </div>
                  ))}
                </div>
              )}
              <div className="max-h-64 overflow-y-auto mt-2 border rounded-xl">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr className="text-right text-gray-500">
                      <th className="py-1 px-2">שם</th>
                      <th className="py-1 px-2">ת.ז.</th>
                      <th className="py-1 px-2">מצב</th>
                      <th className="py-1 px-2">שנים</th>
                      <th className="py-1 px-2">חובות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.people.map((p, i) => (
                      <tr key={i} className="border-t">
                        <td className="py-1 px-2">{p.name}</td>
                        <td className="py-1 px-2">{p.idNumber}</td>
                        <td className="py-1 px-2">
                          {p.existing ? 'קיימת — תעודכן' : 'חדשה'}
                          {p.alumni ? ` · בוגרת ${p.gradYear}` : ''}
                        </td>
                        <td className="py-1 px-2">{p.years.join(', ')}</td>
                        <td className="py-1 px-2">{p.debts || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-2 mt-4">
            {!preview ? (
              <button className="btn-primary" disabled={!file || busy} onClick={() => send(false)}>
                {busy ? 'בודק...' : 'בדיקה'}
              </button>
            ) : (
              <button className="btn-gold" disabled={busy || !preview.people.length} onClick={() => send(true)}>
                {busy ? 'מייבא...' : `אישור וייבוא (${preview.people.length})`}
              </button>
            )}
            <button className="btn-outline" onClick={onClose}>
              ביטול
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// התיק
// ---------------------------------------------------------------------------

function StudentFileView({ id }: { id: string }) {
  const [data, setData] = useState<StudentFile | null>(null);
  const [error, setError] = useState('');
  const [editPersonal, setEditPersonal] = useState(false);
  const [editYear, setEditYear] = useState<Partial<YearRow> | null>(null);
  const [editDebt, setEditDebt] = useState<Partial<Debt> | null>(null);
  const [openYears, setOpenYears] = useState<Set<string>>(new Set());

  const load = () =>
    api
      .get<StudentFile>(`/studentFiles/student/${id}`)
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    setData(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <Layout title="תיק תלמידה"><div className="text-red-700">{error}</div></Layout>;
  if (!data) return <Layout title="תיק תלמידה">טוען את התיק...</Layout>;

  const { student, profile } = data;
  const f = student.fields;
  const isAlumni = profile.status === 'בוגרת';

  const toggleDebt = async (d: Debt) => {
    await api.post('/studentFiles/debt', { ...d, studentId: id, done: !d.done });
    load();
  };
  const deleteDebt = async (d: Debt) => {
    if (!window.confirm(`למחוק את החוב "${d.subject}"?`)) return;
    await api.delete(`/studentFiles/debt/${d.id}`);
    load();
  };
  const deleteYear = async (y: YearRow) => {
    if (!window.confirm(`למחוק את שנת ${y.schoolYear} מהתיק?`)) return;
    await api.delete(`/studentFiles/year/${y.id}`);
    load();
  };

  return (
    <Layout title={`תיק תלמידה — ${student.name}`}>
      <div className="flex items-center justify-between mb-4 print:hidden flex-wrap gap-2">
        <Link to="/student-files" className="text-navy flex items-center gap-1">
          <ArrowRight size={18} /> חזרה לחיפוש
        </Link>
        <button className="btn-primary" onClick={() => window.print()}>
          <Printer size={18} /> הדפסת דוח
        </button>
      </div>

      {/* כותרת לדוח המודפס */}
      <div className="hidden print:block mb-4">
        <div className="text-2xl font-bold">דוח תלמידה — {student.name}</div>
        <div className="text-sm text-gray-600">הופק בתאריך {new Date().toLocaleDateString('he-IL')}</div>
      </div>

      {/* סיכום עליון */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <SummaryTile label="סטטוס" value={isAlumni ? `בוגרת${profile.gradYear ? ` ${profile.gradYear}` : ''}` : 'תלמידה פעילה'} />
        <SummaryTile label="ת.ז." value={f['תעודת זהות'] || '—'} />
        <SummaryTile label="חוב כספי" value={money(data.totals.balance)} alert={data.totals.balance > 0} />
        <SummaryTile label="חובות לימודיים פתוחים" value={String(data.totals.openDebts)} alert={data.totals.openDebts > 0} />
      </div>

      {/* פרטים אישיים */}
      <Section
        title="פרטים אישיים"
        action={
          <button className="btn-outline py-1.5 print:hidden" onClick={() => setEditPersonal(true)}>
            <Pencil size={16} /> עריכה
          </button>
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-sm">
          {PERSONAL.filter((p) => f[p.key]).map((p) => (
            <div key={p.key}>
              <span className="text-gray-500">{p.label}: </span>
              <span className="font-medium">{f[p.key]}</span>
            </div>
          ))}
          {!!student.tracks.length && (
            <div>
              <span className="text-gray-500">מסלולים: </span>
              <span className="font-medium">{student.tracks.join(', ')}</span>
            </div>
          )}
          {profile.birthDateHe && (
            <div>
              <span className="text-gray-500">תאריך לידה עברי: </span>
              <span className="font-medium">{profile.birthDateHe}</span>
            </div>
          )}
          {profile.birthDate && (
            <div>
              <span className="text-gray-500">תאריך לידה: </span>
              <span className="font-medium">{/^\d{4}-\d{2}-\d{2}/.test(profile.birthDate) ? new Date(profile.birthDate).toLocaleDateString('he-IL') : profile.birthDate}</span>
            </div>
          )}
          {profile.teachingStudies && (
            <div>
              <span className="text-gray-500">לימודי הוראה: </span>
              <span className="font-medium">{profile.teachingStudies}</span>
            </div>
          )}
          {student.year && (
            <div>
              <span className="text-gray-500">שנה: </span>
              <span className="font-medium">{student.year}</span>
            </div>
          )}
        </div>
        {profile.notes && <div className="mt-3 text-sm bg-slate-50 rounded-xl px-3 py-2">הערות: {profile.notes}</div>}
      </Section>

      {/* שנים וכספים */}
      <Section
        title="שנים שלמדה וכספים"
        action={
          <button className="btn-outline py-1.5 print:hidden" onClick={() => setEditYear({})}>
            <Plus size={16} /> הוספת שנה
          </button>
        }
      >
        {profile.openingDebt > 0 && (
          <div className="mb-3 text-sm bg-red-50 text-red-800 rounded-xl px-3 py-2">
            חוב כספי מהעבר: <b>{money(profile.openingDebt)}</b> (נכלל בסך החוב; לעדכון — "עריכה" בפרטים האישיים)
          </div>
        )}
        {!data.yearsSummary.length ? (
          <div className="text-sm text-gray-500">עוד לא נרשמו שנים</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-gray-500 border-b">
                  <th className="py-2 px-2">שנת לימודים</th>
                  <th className="py-2 px-2">מסלול</th>
                  <th className="py-2 px-2">לתשלום</th>
                  <th className="py-2 px-2">שולם</th>
                  <th className="py-2 px-2">יתרת חוב</th>
                  <th className="py-2 px-2">נוכחות</th>
                  <th className="py-2 px-2 print:hidden"></th>
                </tr>
              </thead>
              <tbody>
                {data.yearsSummary.map((y) => {
                  const due = (y.manual?.amountDue || 0) + (y.live?.owed || 0);
                  const paid = (y.manual?.amountPaid || 0) + (y.live?.paid || 0);
                  const balance = Math.max(0, (y.manual ? y.manual.amountDue - y.manual.amountPaid : 0)) + (y.live?.balance || 0);
                  const months = data.yearMonths?.[y.schoolYear] || [];
                  const open = openYears.has(y.schoolYear);
                  return (
                    <Fragment key={y.schoolYear}>
                    <tr className="border-b">
                      <td className="py-2 px-2 font-semibold">
                        {y.schoolYear}
                        {!!months.length && (
                          <button
                            className="block text-xs text-navy font-normal print:hidden"
                            onClick={() => setOpenYears((s) => { const n = new Set(s); if (n.has(y.schoolYear)) n.delete(y.schoolYear); else n.add(y.schoolYear); return n; })}
                          >
                            {open ? '▲ הסתרת פירוט' : '▼ פירוט חודשי'}
                          </button>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        {y.manual?.track || ''}
                        {y.manual?.notes && <div className="text-xs text-gray-500 max-w-[320px]">{y.manual.notes}</div>}
                      </td>
                      <td className="py-2 px-2">{due ? money(due) : '—'}</td>
                      <td className="py-2 px-2">{paid ? money(paid) : '—'}</td>
                      <td className={`py-2 px-2 ${balance > 0 ? 'text-red-700 font-semibold' : ''}`}>{due ? money(balance) : '—'}</td>
                      <td className="py-2 px-2 text-gray-600">
                        {y.attendance ? `${y.attendance.present} נוכחת · ${y.attendance.absent} חסרה · ${y.attendance.late} איחור` : ''}
                      </td>
                      <td className="py-2 px-2 print:hidden whitespace-nowrap">
                        {y.manual ? (
                          <>
                            <button className="text-navy p-1" title="עריכה" onClick={() => setEditYear(y.manual!)}>
                              <Pencil size={15} />
                            </button>
                            <button className="text-red-600 p-1" title="מחיקה" onClick={() => deleteYear(y.manual!)}>
                              <Trash2 size={15} />
                            </button>
                          </>
                        ) : y.live ? (
                          <span className="text-xs text-gray-400">ממערכת התשלומים</span>
                        ) : null}
                      </td>
                    </tr>
                    {!!months.length && (
                      <tr className={`${open ? '' : 'hidden'} print:table-row border-b bg-slate-50`}>
                        <td colSpan={7} className="py-2 px-4">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-right text-gray-500">
                                <th className="py-1 px-2">חודש</th>
                                <th className="py-1 px-2">שולם</th>
                                <th className="py-1 px-2">אופן תשלום</th>
                                <th className="py-1 px-2">חוב</th>
                              </tr>
                            </thead>
                            <tbody>
                              {months.map((m) => (
                                <tr key={m.month} className="border-t border-slate-200">
                                  <td className="py-1 px-2">{HEB_MONTHS[m.month]}</td>
                                  <td className="py-1 px-2">{m.amount !== null ? money(m.amount) : <span className="text-amber-800">{m.amountText}</span>}</td>
                                  <td className="py-1 px-2">{m.method}</td>
                                  <td className={`py-1 px-2 ${m.debt > 0 ? 'text-red-700 font-semibold' : ''}`}>
                                    {m.debt ? money(m.debt) : ''}
                                    {m.debtText && <span className="text-amber-800"> {m.debtText}</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!!data.livePayments.length && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-navy">פירוט חודשי ממערכת התשלומים ({data.livePayments.length} חודשים)</summary>
            <table className="w-full text-sm mt-2">
              <thead>
                <tr className="text-right text-gray-500 border-b">
                  <th className="py-1 px-2">חודש</th>
                  <th className="py-1 px-2">לתשלום</th>
                  <th className="py-1 px-2">מלגה</th>
                  <th className="py-1 px-2">שולם</th>
                  <th className="py-1 px-2">יתרה</th>
                </tr>
              </thead>
              <tbody>
                {data.livePayments.map((p, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-1 px-2">
                      {p.month} {p.year}
                    </td>
                    <td className="py-1 px-2">{money(p.owed)}</td>
                    <td className="py-1 px-2">{p.scholarship ? money(p.scholarship) : ''}</td>
                    <td className="py-1 px-2">{money(p.paid)}</td>
                    <td className={`py-1 px-2 ${p.balance > 0 ? 'text-red-700' : ''}`}>{money(p.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </Section>

      {/* חובות לימודיים */}
      <Section
        title="חובות לימודיים"
        action={
          <button className="btn-outline py-1.5 print:hidden" onClick={() => setEditDebt({})}>
            <Plus size={16} /> הוספת חוב
          </button>
        }
      >
        {student.needsCompletion && (
          <div className="mb-2 text-sm bg-amber-50 text-amber-800 rounded-xl px-3 py-2">בטבלת התלמידות מסומן "צריך השלמה"</div>
        )}
        {!data.debts.length ? (
          <div className="text-sm text-gray-500">אין חובות לימודיים</div>
        ) : (
          <ul className="space-y-2">
            {data.debts.map((d) => (
              <li key={d.id} className={`flex items-start gap-2 text-sm ${d.done ? 'text-gray-400 line-through' : ''}`}>
                <button
                  className={`mt-0.5 h-5 w-5 rounded border flex items-center justify-center print:hidden ${d.done ? 'bg-green-600 border-green-600 text-white' : 'border-gray-400'}`}
                  title={d.done ? 'סימון כפתוח' : 'סימון כהושלם'}
                  onClick={() => toggleDebt(d)}
                >
                  {d.done && <Check size={14} />}
                </button>
                <div className="flex-1">
                  <span className="font-medium">{d.subject}</span>
                  {d.schoolYear && <span className="text-gray-500"> · {d.schoolYear}</span>}
                  {d.description && <div className="text-gray-600">{d.description}</div>}
                  {d.done && d.doneAt && <span className="text-xs"> (הושלם {new Date(d.doneAt).toLocaleDateString('he-IL')})</span>}
                </div>
                <button className="text-navy p-1 print:hidden" onClick={() => setEditDebt(d)}>
                  <Pencil size={15} />
                </button>
                <button className="text-red-600 p-1 print:hidden" onClick={() => deleteDebt(d)}>
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ציונים */}
      <Section title="ציונים">
        {!data.grades.length ? (
          <div className="text-sm text-gray-500">אין ציונים במערכת</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-gray-500 border-b">
                <th className="py-1 px-2">מבחן / מטלה</th>
                <th className="py-1 px-2">תאריך</th>
                <th className="py-1 px-2">ציון</th>
                <th className="py-1 px-2">הערות</th>
              </tr>
            </thead>
            <tbody>
              {data.grades.map((g) => (
                <tr key={g.id} className="border-b">
                  <td className="py-1 px-2">{g.test}</td>
                  <td className="py-1 px-2">{g.date ? new Date(g.date).toLocaleDateString('he-IL') : ''}</td>
                  <td className="py-1 px-2 font-semibold">{g.score ?? ''}</td>
                  <td className="py-1 px-2 text-gray-600">{g.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {editPersonal && (
        <EditPersonalModal data={data} onClose={() => setEditPersonal(false)} onSaved={() => { setEditPersonal(false); load(); }} />
      )}
      {editYear && (
        <EditYearModal studentId={id} year={editYear} onClose={() => setEditYear(null)} onSaved={() => { setEditYear(null); load(); }} />
      )}
      {editDebt && (
        <EditDebtModal studentId={id} debt={editDebt} onClose={() => setEditDebt(null)} onSaved={() => { setEditDebt(null); load(); }} />
      )}
    </Layout>
  );
}

function SummaryTile({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={`card py-3 ${alert ? 'border border-red-200 bg-red-50' : ''}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${alert ? 'text-red-700' : 'text-navy'}`}>{value}</div>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card mb-4 break-inside-avoid">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-navy">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function SaveButtons({ saving, onSave, onClose, error }: { saving: boolean; onSave: () => void; onClose: () => void; error: string }) {
  return (
    <>
      {error && <div className="mt-3 text-sm bg-red-50 text-red-700 rounded-xl px-3 py-2">{error}</div>}
      <div className="flex gap-2 mt-4">
        <button className="btn-primary" disabled={saving} onClick={onSave}>
          {saving ? 'שומר...' : 'שמירה'}
        </button>
        <button className="btn-outline" onClick={onClose}>
          ביטול
        </button>
      </div>
    </>
  );
}

function useSave(fn: () => Promise<unknown>, onSaved: () => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await fn();
      onSaved();
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  };
  return { saving, error, save };
}

function EditPersonalModal({ data, onClose, onSaved }: { data: StudentFile; onClose: () => void; onSaved: () => void }) {
  const [fields, setFields] = useState<Record<string, string>>(data.student.fields);
  const [profile, setProfile] = useState(data.profile);
  const { saving, error, save } = useSave(() => api.put(`/studentFiles/student/${data.student.id}`, { fields, profile }), onSaved);

  return (
    <Modal title="עריכת פרטים" onClose={onClose} wide>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {PERSONAL.map((f) => (
          <label key={f.key} className="text-sm">
            {f.label}
            <input className="input mt-1" value={fields[f.key] || ''} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-4 flex-wrap">
        <label className="text-sm flex items-center gap-2">
          סטטוס
          <select className="input w-auto" value={profile.status} onChange={(e) => setProfile({ ...profile, status: e.target.value })}>
            <option value="פעילה">תלמידה פעילה</option>
            <option value="בוגרת">בוגרת</option>
          </select>
        </label>
        <label className="text-sm flex items-center gap-2">
          מחזור (שנת סיום)
          <input className="input w-28" placeholder='תשפ"ד' value={profile.gradYear} onChange={(e) => setProfile({ ...profile, gradYear: e.target.value })} />
        </label>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
        <label className="text-sm">
          תאריך לידה עברי
          <input className="input mt-1" value={profile.birthDateHe} onChange={(e) => setProfile({ ...profile, birthDateHe: e.target.value })} />
        </label>
        <label className="text-sm">
          תאריך לידה לועזי
          <input className="input mt-1" value={profile.birthDate} onChange={(e) => setProfile({ ...profile, birthDate: e.target.value })} />
        </label>
        <label className="text-sm">
          לימודי הוראה
          <input className="input mt-1" value={profile.teachingStudies} onChange={(e) => setProfile({ ...profile, teachingStudies: e.target.value })} />
        </label>
        <label className="text-sm">
          חוב כספי מהעבר (₪)
          <input
            className="input mt-1"
            type="number"
            value={profile.openingDebt || ''}
            onChange={(e) => setProfile({ ...profile, openingDebt: Number(e.target.value) || 0 })}
          />
        </label>
      </div>
      <label className="text-sm block mt-3">
        הערות
        <textarea className="input mt-1" rows={2} value={profile.notes} onChange={(e) => setProfile({ ...profile, notes: e.target.value })} />
      </label>
      <SaveButtons saving={saving} onSave={save} onClose={onClose} error={error} />
    </Modal>
  );
}

function EditYearModal({ studentId, year, onClose, onSaved }: { studentId: string; year: Partial<YearRow>; onClose: () => void; onSaved: () => void }) {
  const [y, setY] = useState({
    schoolYear: year.schoolYear || '',
    track: year.track || '',
    amountDue: year.amountDue ?? '',
    amountPaid: year.amountPaid ?? '',
    notes: year.notes || '',
  });
  const { saving, error, save } = useSave(() => api.post('/studentFiles/year', { id: year.id, studentId, ...y }), onSaved);

  return (
    <Modal title={year.id ? `עריכת שנת ${year.schoolYear}` : 'הוספת שנת לימודים'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          שנת לימודים
          <input className="input mt-1" placeholder='תשפ"ב' value={y.schoolYear} onChange={(e) => setY({ ...y, schoolYear: e.target.value })} />
        </label>
        <label className="text-sm">
          מסלול / כיתה
          <input className="input mt-1" value={y.track} onChange={(e) => setY({ ...y, track: e.target.value })} />
        </label>
        <label className="text-sm">
          סכום לתשלום בשנה (₪)
          <input className="input mt-1" type="number" value={y.amountDue} onChange={(e) => setY({ ...y, amountDue: e.target.value })} />
        </label>
        <label className="text-sm">
          שולם (₪)
          <input className="input mt-1" type="number" value={y.amountPaid} onChange={(e) => setY({ ...y, amountPaid: e.target.value })} />
        </label>
      </div>
      <label className="text-sm block mt-3">
        הערות
        <input className="input mt-1" value={y.notes} onChange={(e) => setY({ ...y, notes: e.target.value })} />
      </label>
      <p className="text-xs text-gray-500 mt-2">לשנים שמנוהלות במסך התשלומים אין צורך להוסיף — הן מופיעות כאן אוטומטית.</p>
      <SaveButtons saving={saving} onSave={save} onClose={onClose} error={error} />
    </Modal>
  );
}

function EditDebtModal({ studentId, debt, onClose, onSaved }: { studentId: string; debt: Partial<Debt>; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState({
    subject: debt.subject || '',
    schoolYear: debt.schoolYear || '',
    description: debt.description || '',
    done: !!debt.done,
  });
  const { saving, error, save } = useSave(() => api.post('/studentFiles/debt', { id: debt.id, studentId, ...d }), onSaved);

  return (
    <Modal title={debt.id ? 'עריכת חוב לימודי' : 'הוספת חוב לימודי'} onClose={onClose}>
      <label className="text-sm block">
        מה חסר (מקצוע / מבחן / עבודה)
        <input className="input mt-1" value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} autoFocus />
      </label>
      <label className="text-sm block mt-3">
        שנת לימודים
        <input className="input mt-1 w-32" placeholder='תשפ"ו' value={d.schoolYear} onChange={(e) => setD({ ...d, schoolYear: e.target.value })} />
      </label>
      <label className="text-sm block mt-3">
        פירוט
        <textarea className="input mt-1" rows={2} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
      </label>
      {debt.id && (
        <label className="flex items-center gap-2 text-sm mt-3">
          <input type="checkbox" checked={d.done} onChange={(e) => setD({ ...d, done: e.target.checked })} /> הושלם
        </label>
      )}
      <SaveButtons saving={saving} onSave={save} onClose={onClose} error={error} />
    </Modal>
  );
}
