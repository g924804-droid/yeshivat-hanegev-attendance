import { Fragment, useEffect, useState } from 'react';
import { RefreshCw, Mail } from 'lucide-react';
import { api } from '../lib/api';
import { todayStr } from '../lib/utils';

type Slot = { date: string; time: string; track: string; period: number; periods: number };
type Teacher = { id: string; name: string; required: number; filled: number; missing: Slot[] };
type Snapshot = { from: string; to: string; teachers: Teacher[] };

const DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const he = (d: string) => `${DOW[new Date(`${d}T00:00:00`).getDay()]} ${d.split('-').reverse().map(Number).slice(0, 2).join('/')}`;
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** תמונת מצב: לכל מורה — כמה שיבוצים היו, על כמה מולאה נוכחות תלמידות, ואילו חסרים */
export function AttendanceSnapshotTab({ isFullAdmin }: { isFullAdmin: boolean }) {
  const today = todayStr();
  const weekStart = addDays(today, -new Date(`${today}T00:00:00`).getDay());
  const ranges = [
    { label: 'השבוע', from: weekStart, to: today },
    { label: 'השבוע שעבר', from: addDays(weekStart, -7), to: addDays(weekStart, -1) },
    { label: 'החודש', from: `${today.slice(0, 7)}-01`, to: today },
  ];
  const [from, setFrom] = useState(weekStart);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = (fresh = false) => {
    setLoading(true);
    setError('');
    api
      .get<Snapshot>('/reports/attendanceSnapshot', { from, to, ...(fresh ? { fresh: 1 } : {}) })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    if (from && to && from <= to) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const required = data?.teachers.reduce((s, t) => s + t.required, 0) || 0;
  const missing = data?.teachers.reduce((s, t) => s + t.missing.length, 0) || 0;
  const pct = required ? Math.round(((required - missing) / required) * 100) : 100;

  return (
    <div>
      <div className="card mb-4 flex flex-wrap items-end gap-3">
        <div className="flex gap-1">
          {ranges.map((r) => (
            <button
              key={r.label}
              className={`px-3 py-1.5 rounded-lg text-sm border ${from === r.from && to === r.to ? 'bg-navy text-white border-navy' : 'bg-white text-slate-600'}`}
              onClick={() => {
                setFrom(r.from);
                setTo(r.to);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
        <label className="text-sm">
          מתאריך
          <input type="date" className="input mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          עד תאריך
          <input type="date" className="input mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button className="btn-outline" onClick={() => load(true)} disabled={loading} title="חישוב מחדש עם הנתונים העדכניים">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> רענון
        </button>
      </div>

      {error && <div className="mb-4 text-sm bg-red-50 text-red-700 rounded-xl px-4 py-2">{error}</div>}

      {loading && !data ? (
        <div className="card text-slate-500">מחשב את תמונת המצב... (כמה שניות)</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="card text-center py-3">
              <div className="text-xs text-slate-500">מולאה נוכחות</div>
              <div className={`text-2xl font-bold ${pct >= 90 ? 'text-green-700' : pct >= 60 ? 'text-amber-700' : 'text-red-700'}`}>{pct}%</div>
            </div>
            <div className="card text-center py-3">
              <div className="text-xs text-slate-500">שיבוצים חסרים</div>
              <div className="text-2xl font-bold text-red-700">{missing}</div>
            </div>
            <div className="card text-center py-3">
              <div className="text-xs text-slate-500">מורות עם חוסרים</div>
              <div className="text-2xl font-bold text-navy">
                {data.teachers.filter((t) => t.missing.length).length}/{data.teachers.length}
              </div>
            </div>
          </div>

          <div className={`card p-0 overflow-x-auto ${loading ? 'opacity-60' : ''}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 border-b bg-slate-50 text-right">
                  <th className="py-2.5 px-3">מורה</th>
                  <th className="px-3">מולא / נדרש</th>
                  <th className="px-3">חסרים</th>
                  <th className="px-3 w-1/3"></th>
                </tr>
              </thead>
              <tbody>
                {data.teachers.map((t) => {
                  const p = Math.round((t.filled / t.required) * 100);
                  const isOpen = open === t.id;
                  return (
                    <Fragment key={t.id}>
                      <tr
                        className={`border-b ${t.missing.length ? 'cursor-pointer hover:bg-slate-50' : ''}`}
                        onClick={() => t.missing.length && setOpen(isOpen ? null : t.id)}
                      >
                        <td className="py-2 px-3 font-semibold text-navy">{t.name}</td>
                        <td className="px-3">
                          {t.filled}/{t.required}
                        </td>
                        <td className={`px-3 font-bold ${t.missing.length ? 'text-red-700' : 'text-green-700'}`}>
                          {t.missing.length ? `${t.missing.length} ${isOpen ? '▲' : '▼'}` : '✓'}
                        </td>
                        <td className="px-3">
                          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div className={`h-full ${p >= 90 ? 'bg-green-500' : p >= 60 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${p}%` }} />
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-red-50/50 border-b">
                          <td colSpan={4} className="px-4 py-2">
                            <div className="flex flex-wrap gap-1.5">
                              {t.missing.map((m, i) => (
                                <span key={i} className="text-xs bg-white border border-red-200 rounded-lg px-2 py-0.5">
                                  {he(m.date)} {m.time} · {m.track}
                                  {m.periods > 1 && ` (שעה ${m.period}/${m.periods})`}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {!data.teachers.length && <p className="text-center text-slate-400 py-6">אין שיעורים בטווח הזה</p>}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            שיבוץ = שיעור של 45 דק׳ למסלול אחד לפי מערכת השעות. שיעורים שבוטלו וימים עתידיים לא נספרים. לחיצה על מורה — רשימת החסרים.
          </p>
        </>
      ) : null}

      {isFullAdmin && <DigestSettings />}
    </div>
  );
}

/** מי מקבלת את המייל השבועי (שישי בבוקר), ושליחת בדיקה */
function DigestSettings() {
  const [users, setUsers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ recipients: string[]; users: { id: string; name: string; email: string }[] }>('/reports/attendanceDigest')
      .then((r) => {
        setUsers(r.users);
        setRecipients(r.recipients);
      })
      .catch((e) => setMsg(e.message));
  }, []);

  async function save(next: string[]) {
    setRecipients(next);
    setMsg('');
    try {
      await api.post('/reports/attendanceDigest', { recipients: next });
      setMsg('נשמר');
    } catch (e: any) {
      setMsg(e.message);
    }
  }
  async function sendTest() {
    setBusy(true);
    setMsg('');
    try {
      const r = await api.post<{ to: string }>('/reports/attendanceDigest/send', { test: true });
      setMsg(`נשלח מייל בדיקה אל ${r.to}`);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  const chosen = users.filter((u) => recipients.includes(u.id));
  const q = search.trim();
  const options = q ? users.filter((u) => !recipients.includes(u.id) && u.name.includes(q)).slice(0, 8) : [];

  return (
    <div className="card mt-6">
      <h3 className="font-bold text-navy mb-1 flex items-center gap-2">
        <Mail size={18} /> מייל שבועי — תמונת מצב
      </h3>
      <p className="text-sm text-slate-600 mb-3">נשלח בכל יום שישי בבוקר: השבוע ומתחילת החודש, לכל מורה כמה מילאה וכמה חסר.</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {chosen.map((u) => (
          <span key={u.id} className="badge bg-navy text-white text-sm flex items-center gap-1">
            {u.name} <span className="opacity-70 text-xs">{u.email}</span>
            <button className="mr-1 opacity-80 hover:opacity-100" onClick={() => save(recipients.filter((x) => x !== u.id))} title="הסרה">
              ✕
            </button>
          </span>
        ))}
        {!chosen.length && <span className="text-sm text-slate-400">עדיין לא נבחרו נמענות</span>}
      </div>
      <div className="relative max-w-sm">
        <input className="input" placeholder="הוספת נמענת — הקלידי שם" value={search} onChange={(e) => setSearch(e.target.value)} />
        {!!options.length && (
          <div className="absolute z-10 bg-white border rounded-xl shadow mt-1 w-full">
            {options.map((u) => (
              <button
                key={u.id}
                className="block w-full text-right px-3 py-1.5 text-sm hover:bg-slate-50"
                onClick={() => {
                  save([...recipients, u.id]);
                  setSearch('');
                }}
              >
                {u.name} <span className="text-slate-400 text-xs">{u.email}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button className="btn-outline" onClick={sendTest} disabled={busy}>
          {busy ? 'שולח...' : 'שליחת מייל בדיקה אליי'}
        </button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
    </div>
  );
}
