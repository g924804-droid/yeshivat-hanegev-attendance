import { useEffect, useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Layout } from '../components/Layout';
import { api } from '../lib/api';
import { useAuth } from '../lib/permissions';

/**
 * הערכה כללית לתלמידות. מורה: כותבת במילים הערכה לכל תלמידה שלה (נשמר אוטומטית כשיוצאים מהתיבה).
 * בחודש שההנהלה קבעה אי אפשר להגיש את דוח הנוכחות בלי הערכה לכל התלמידות.
 * הנהלה: קובעת את החודש, ורואה מי מילאה וכמה + את כל ההערכות.
 */
type Student = { id: string; name: string; tracks: string[]; text: string; updatedAt: string | null };
type AdminData = {
  month: string | null;
  current: string | null;
  teachers: { id: string; name: string; department: string | null; total: number; done: number }[];
  evaluations: { id: string; teacherName: string; studentName: string; text: string; updatedAt: string }[];
};

const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const monthLabel = (m: string) => `${MONTHS_HE[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }).slice(0, 7);

export function EvaluationsPage() {
  const { user } = useAuth();
  const isManager = !!user && (user.role === 'מנהל' || user.isAttendanceManager || user.canManageAllStudentTracks);
  const isTeacher = user?.role === 'מורה';
  const [tab, setTab] = useState<'mine' | 'admin'>(isTeacher ? 'mine' : 'admin');

  return (
    <Layout title="הערכה כללית לתלמידות">
      {isManager && isTeacher && (
        <div className="flex gap-2 mb-4">
          {(['mine', 'admin'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium border ${tab === t ? 'bg-navy text-white border-navy' : 'bg-white text-navy border-slate-300'}`}
            >
              {t === 'mine' ? 'ההערכות שלי' : 'ניהול — מי מילאה'}
            </button>
          ))}
        </div>
      )}
      {tab === 'admin' && isManager ? <AdminView /> : <TeacherView />}
    </Layout>
  );
}

function TeacherView() {
  const [month, setMonth] = useState<string | null | undefined>(undefined);
  const [students, setStudents] = useState<Student[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    api
      .get<{ month: string | null; students: Student[] }>('/evaluations/mine')
      .then((r) => {
        setMonth(r.month);
        setStudents(r.students);
        setDrafts(Object.fromEntries(r.students.map((s) => [s.id, s.text])));
      })
      .catch((e) => {
        setError(e.message);
        setMonth(null);
      });
  }, []);

  async function save(s: Student) {
    const text = (drafts[s.id] || '').trim();
    if (text === s.text.trim()) return;
    setSaving((p) => ({ ...p, [s.id]: 'saving' }));
    try {
      await api.put('/evaluations/mine', { studentId: s.id, text });
      setStudents((list) => list.map((x) => (x.id === s.id ? { ...x, text } : x)));
      setSaving((p) => ({ ...p, [s.id]: 'saved' }));
    } catch (e: any) {
      setSaving((p) => ({ ...p, [s.id]: 'error' }));
      setError(`${s.name}: ${e.message}`);
    }
  }

  const done = students.filter((s) => s.text.trim()).length;
  const shown = useMemo(() => {
    const t = q.trim();
    return t ? students.filter((s) => s.name.includes(t) || s.tracks.some((x) => x.includes(t))) : students;
  }, [students, q]);

  if (month === undefined) return <p className="text-slate-400 text-center py-10 animate-pulse">טוען תלמידות...</p>;
  if (!month)
    return <p className="text-slate-500 text-center py-10">{error || 'כרגע לא נדרשת הערכה כללית.'}</p>;
  if (!students.length)
    return <p className="text-slate-500 text-center py-10">לא נמצאו תלמידות במסלולים שלך, אין צורך למלא הערכה.</p>;

  let lastTrack = '';
  return (
    <div>
      <div className="card mb-4 space-y-2">
        <p>
          כתבי הערכה כללית במילים לכל תלמידה, לחודש <b>{monthLabel(month)}</b>. ההערכה נשמרת אוטומטית כשיוצאים מהתיבה.
        </p>
        <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
          אי אפשר להגיש את דוח הנוכחות של {monthLabel(month)} לפני שממלאים הערכה לכל התלמידות.
        </p>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2.5 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 transition-all" style={{ width: `${(done / students.length) * 100}%` }} />
          </div>
          <span className={`text-sm font-bold ${done === students.length ? 'text-green-700' : 'text-navy'}`}>
            מולאו {done} מתוך {students.length}
          </span>
        </div>
      </div>

      {error && <div className="mb-3 text-sm bg-red-50 text-red-700 rounded-xl px-4 py-2">{error}</div>}

      <div className="relative max-w-xs mb-3">
        <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input pr-9 py-2" placeholder="חיפוש תלמידה או מסלול" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="space-y-3">
        {shown.map((s) => {
          const track = s.tracks[0] || '';
          const header = track !== lastTrack ? track : null;
          lastTrack = track;
          const st = saving[s.id];
          return (
            <div key={s.id}>
              {header && <h3 className="font-bold text-navy mt-5 mb-2">{header}</h3>}
              <div className={`card py-3 ${s.text.trim() ? 'border-r-4 border-r-green-500' : 'border-r-4 border-r-amber-400'}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-navy">{s.name}</span>
                  <span className="text-xs">
                    {st === 'saving' ? (
                      <span className="text-slate-400">שומר...</span>
                    ) : st === 'error' ? (
                      <span className="text-red-600">לא נשמר</span>
                    ) : s.text.trim() ? (
                      <span className="text-green-700 inline-flex items-center gap-1">
                        <Check size={14} /> נשמר
                      </span>
                    ) : (
                      <span className="text-amber-700">חסר</span>
                    )}
                  </span>
                </div>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="הערכה כללית על התלמידה..."
                  value={drafts[s.id] ?? ''}
                  onChange={(e) => setDrafts((p) => ({ ...p, [s.id]: e.target.value }))}
                  onBlur={() => save(s)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AdminView() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newMonth, setNewMonth] = useState(thisMonth());
  const [teacher, setTeacher] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    setData(null);
    api
      .get<AdminData>('/evaluations/admin')
      .then(setData)
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function setMonth(month: string | null) {
    if (!month && !confirm('לבטל את חובת ההערכה הכללית? המורות יוכלו להגיש את הדוח בלי למלא.')) return;
    setBusy(true);
    try {
      await api.put('/evaluations/month', { month });
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const evals = (data?.evaluations || []).filter((e) => !teacher || e.teacherName === teacher);
  const sorted = [...(data?.teachers || [])].sort((a, b) => a.done / a.total - b.done / b.total || a.name.localeCompare(b.name, 'he'));
  const complete = sorted.filter((t) => t.done >= t.total).length;

  return (
    <div className="space-y-4">
      {error && <div className="text-sm bg-red-50 text-red-700 rounded-xl px-4 py-2">{error}</div>}
      <div className="card space-y-2">
        <p className="font-bold text-navy">חובת הערכה כללית</p>
        {data?.current ? (
          <div className="flex flex-wrap items-center gap-3">
            <span>
              נדרשת לחודש <b>{monthLabel(data.current)}</b>. מורה לא יכולה להגיש את דוח הנוכחות של החודש הזה בלי הערכה לכל התלמידות שלה.
            </span>
            <button className="btn-outline text-sm py-1.5" disabled={busy} onClick={() => setMonth(null)}>
              ביטול החובה
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span>כרגע לא נדרשת. להפעיל לחודש:</span>
            <input type="month" className="input w-auto" value={newMonth} onChange={(e) => setNewMonth(e.target.value)} />
            <button className="btn-primary text-sm py-1.5" disabled={busy || !newMonth} onClick={() => setMonth(newMonth)}>
              הפעלה
            </button>
          </div>
        )}
      </div>

      {!data ? (
        <p className="text-slate-400 text-center py-10 animate-pulse">טוען...</p>
      ) : !data.month ? null : (
        <>
          <div className="card p-0 overflow-x-auto">
            <div className="px-4 py-3 font-bold text-navy">
              מי מילאה — {complete} מתוך {sorted.length} מורות סיימו
            </div>
            <table className="w-full text-sm">
              <thead className="bg-navy text-white">
                <tr>
                  {['מורה', 'מחלקה', 'מולאו', 'סטטוס', ''].map((h) => (
                    <th key={h} className="px-3 py-2 text-right font-bold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="px-3 py-2 font-medium text-navy">{t.name}</td>
                    <td className="px-3 py-2 text-slate-500">{t.department}</td>
                    <td className="px-3 py-2">
                      {t.done} / {t.total}
                    </td>
                    <td className="px-3 py-2">
                      {t.done >= t.total ? (
                        <span className="badge bg-green-100 text-green-800">הושלם</span>
                      ) : t.done ? (
                        <span className="badge bg-amber-100 text-amber-800">בתהליך</span>
                      ) : (
                        <span className="badge bg-red-100 text-red-700">לא התחילה</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {t.done > 0 && (
                        <button className="text-blue-700 text-xs hover:underline" onClick={() => setTeacher(t.name)}>
                          הצגת ההערכות
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-navy">ההערכות ({evals.length})</span>
              <select className="input w-auto py-1.5" value={teacher} onChange={(e) => setTeacher(e.target.value)}>
                <option value="">כל המורות</option>
                {[...new Set(data.evaluations.map((e) => e.teacherName))].sort().map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </div>
            {!evals.length ? (
              <p className="text-slate-400 text-sm">עוד אין הערכות.</p>
            ) : (
              <div className="divide-y">
                {evals.map((e) => (
                  <div key={e.id} className="py-2">
                    <p className="text-sm">
                      <b className="text-navy">{e.studentName}</b> <span className="text-slate-500">— {e.teacherName}</span>
                    </p>
                    <p className="text-sm whitespace-pre-wrap">{e.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
