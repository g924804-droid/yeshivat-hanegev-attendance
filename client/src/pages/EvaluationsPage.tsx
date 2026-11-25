import { useEffect, useMemo, useState } from 'react';
import { Check, FileSpreadsheet, Search } from 'lucide-react';
import { Layout } from '../components/Layout';
import { api } from '../lib/api';

/**
 * הערכה כללית לתלמידות. מורה: כותבת במילים הערכה לכל תלמידה שלה (נשמר אוטומטית כשיוצאים מהתיבה).
 * בחודש שההנהלה קבעה אי אפשר להגיש את דוח הנוכחות בלי הערכה לכל התלמידות.
 * הנהלה: קובעת את החודש, ורואה מי מילאה וכמה + את כל ההערכות.
 */
type Group = { key: string; subject: string; trackName: string; students: { id: string; name: string }[] };
type AdminData = {
  month: string | null;
  current: string | null;
  teachers: { id: string; name: string; department: string | null; total: number; done: number; ackAt: string | null; ackVia: string | null }[];
  evaluations: { id: string; teacherName: string; studentName: string; lessons: string; tracks: string; text: string; updatedAt: string }[];
};

const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const monthLabel = (m: string) => `${MONTHS_HE[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }).slice(0, 7);

export function EvaluationsPage() {
  // ניהול ההערכה — רק למי שהשרת מאשר (מיכל פיינהנדלר); כל השאר רואות רק את ההערכות שלהן
  const [status, setStatus] = useState<{ required: boolean; isAdmin: boolean } | null>(null);
  useEffect(() => {
    api
      .get<{ required: boolean; isAdmin: boolean }>('/evaluations/status')
      .then(setStatus)
      .catch(() => setStatus({ required: false, isAdmin: false }));
  }, []);
  const isManager = !!status?.isAdmin;
  const isTeacher = !!status?.required;
  const [tab, setTab] = useState<'mine' | 'admin' | null>(null);
  const shownTab = tab || (isManager && !isTeacher ? 'admin' : 'mine');
  if (!status) return <Layout title="הערכה כללית לתלמידות"><p className="text-slate-400 text-center py-10 animate-pulse">טוען...</p></Layout>;

  return (
    <Layout title="הערכה כללית לתלמידות">
      {isManager && isTeacher && (
        <div className="flex gap-2 mb-4">
          {(['mine', 'admin'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium border ${shownTab === t ? 'bg-navy text-white border-navy' : 'bg-white text-navy border-slate-300'}`}
            >
              {t === 'mine' ? 'ההערכות שלי' : 'ניהול — מי מילאה'}
            </button>
          ))}
        </div>
      )}
      {shownTab === 'admin' && isManager ? <AdminView /> : <TeacherView />}
    </Layout>
  );
}

/**
 * המורה רואה את השיעורים שהיא מלמדת (מקצוע — מסלול) ואת התלמידות בכל שיעור. הערכה אחת לכל תלמידה:
 * תלמידה שמופיעה בכמה שיעורים — אותה תיבה בכל מקום, מה שנכתב באחד מופיע בכולם.
 */
function TeacherView() {
  const [month, setMonth] = useState<string | null | undefined>(undefined);
  const [groups, setGroups] = useState<Group[]>([]);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ month: string | null; groups: Group[]; evaluations: Record<string, string> }>('/evaluations/mine')
      .then((r) => {
        setMonth(r.month);
        setGroups(r.groups);
        setSaved(r.evaluations);
        setDrafts(r.evaluations);
        if (r.groups.length === 1) setOpenGroup(r.groups[0].key);
      })
      .catch((e) => {
        setError(e.message);
        setMonth(null);
      });
  }, []);

  async function save(studentId: string, name: string) {
    const text = (drafts[studentId] || '').trim();
    if (text === (saved[studentId] || '').trim()) return;
    setSaving((p) => ({ ...p, [studentId]: 'saving' }));
    try {
      await api.put('/evaluations/mine', { studentId, text });
      setSaved((p) => ({ ...p, [studentId]: text }));
      setSaving((p) => ({ ...p, [studentId]: 'saved' }));
    } catch (e: any) {
      setSaving((p) => ({ ...p, [studentId]: 'error' }));
      setError(`${name}: ${e.message}`);
    }
  }

  const allIds = useMemo(() => [...new Set(groups.flatMap((g) => g.students.map((s) => s.id)))], [groups]);
  // באילו שיעורים כל תלמידה — כדי להראות שזו הערכה אחת על כל המקצועות
  const lessonsOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const g of groups) for (const s of g.students) m.set(s.id, [...(m.get(s.id) || []), g.key]);
    return m;
  }, [groups]);
  const groupLabel = (key: string) => {
    const g = groups.find((x) => x.key === key);
    return g ? `${g.subject}${g.trackName ? ` — ${g.trackName}` : ''}` : '';
  };
  const isDone = (id: string) => !!(saved[id] || '').trim();
  const done = allIds.filter(isDone).length;
  const search = q.trim();

  if (month === undefined) return <p className="text-slate-400 text-center py-10 animate-pulse">טוען שיעורים...</p>;
  if (!month) return <p className="text-slate-500 text-center py-10">{error || 'כרגע לא נדרשת הערכה כללית.'}</p>;
  if (!groups.length) return <p className="text-slate-500 text-center py-10">לא נמצאו שיעורים עם תלמידות במערכת השעות שלך, אין צורך למלא הערכה.</p>;

  return (
    <div>
      <div className="card mb-4 space-y-2">
        <p>
          כתבי הערכה כללית במילים לכל תלמידה, לחודש <b>{monthLabel(month)}</b>. לוחצים על שיעור כדי לראות את התלמידות שלו. ההערכה
          נשמרת אוטומטית כשיוצאים מהתיבה. <b>הערכה אחת לכל תלמידה על כל המקצועות שאת מלמדת אותה</b> — תלמידה שלומדת
          אצלך בכמה שיעורים מופיעה בכל אחד מהם, אבל זו אותה הערכה.
        </p>
        <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
          אי אפשר להגיש את דוח הנוכחות של {monthLabel(month)} לפני שממלאים הערכה לכל התלמידות.
        </p>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2.5 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 transition-all" style={{ width: `${(done / allIds.length) * 100}%` }} />
          </div>
          <span className={`text-sm font-bold ${done === allIds.length ? 'text-green-700' : 'text-navy'}`}>
            מולאו {done} מתוך {allIds.length} תלמידות
          </span>
        </div>
      </div>

      {error && <div className="mb-3 text-sm bg-red-50 text-red-700 rounded-xl px-4 py-2">{error}</div>}

      <div className="relative max-w-xs mb-3">
        <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input pr-9 py-2" placeholder="חיפוש תלמידה" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="space-y-3">
        {groups.map((g) => {
          const students = search ? g.students.filter((s) => s.name.includes(search)) : g.students;
          if (search && !students.length) return null;
          const gDone = g.students.filter((s) => isDone(s.id)).length;
          const open = !!search || openGroup === g.key;
          return (
            <div key={g.key} className="card p-0 overflow-hidden">
              <button
                className={`w-full flex items-center justify-between px-4 py-3 text-right ${open ? 'bg-slate-50 border-b' : ''}`}
                onClick={() => setOpenGroup(open && !search ? null : g.key)}
              >
                <span className="font-bold text-navy">
                  {g.subject}
                  {g.trackName && <span className="font-normal text-slate-500"> — {g.trackName}</span>}
                </span>
                <span className={`text-sm font-semibold ${gDone === g.students.length ? 'text-green-700' : 'text-amber-700'}`}>
                  {gDone === g.students.length ? '✓ ' : ''}
                  {gDone}/{g.students.length}
                </span>
              </button>
              {open && (
                <div className="p-3 space-y-3">
                  {students.map((s) => {
                    const st = saving[s.id];
                    return (
                      <div key={s.id} className={`rounded-xl border p-3 ${isDone(s.id) ? 'border-r-4 border-r-green-500' : 'border-r-4 border-r-amber-400'}`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-semibold text-navy">
                            {s.name}
                            {(lessonsOf.get(s.id) || []).length > 1 && (
                              <span className="block text-xs font-normal text-slate-500">
                                הערכה אחת גם ל: {(lessonsOf.get(s.id) || []).filter((k) => k !== g.key).map(groupLabel).join(', ')}
                              </span>
                            )}
                          </span>
                          <span className="text-xs">
                            {st === 'saving' ? (
                              <span className="text-slate-400">שומר...</span>
                            ) : st === 'error' ? (
                              <span className="text-red-600">לא נשמר</span>
                            ) : isDone(s.id) ? (
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
                          placeholder="הערכה כללית על התלמידה, על כל המקצועות שאת מלמדת אותה..."
                          value={drafts[s.id] ?? ''}
                          onChange={(e) => setDrafts((p) => ({ ...p, [s.id]: e.target.value }))}
                          onBlur={() => save(s.id, s.name)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
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

  const [downloading, setDownloading] = useState(false);
  const [resending, setResending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function resend(userId: string, name: string) {
    if (!confirm(`לשלוח שוב את המייל ל${name}?`)) return;
    setResending(userId);
    setNotice(null);
    try {
      await api.post('/evaluations/email/resend', { userId });
      setNotice(`המייל נשלח שוב ל${name}`);
    } catch (e: any) {
      setError(`${name}: ${e.message}`);
    } finally {
      setResending(null);
    }
  }
  async function downloadExcel() {
    if (!data?.month) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/evaluations/admin/excel?month=${data.month}`, { credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `ההורדה נכשלה (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `הערכה כללית ${data.month}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDownloading(false);
    }
  }
  const evals = (data?.evaluations || []).filter((e) => !teacher || e.teacherName === teacher);
  const sorted = [...(data?.teachers || [])].sort((a, b) => a.done / a.total - b.done / b.total || a.name.localeCompare(b.name, 'he'));
  const complete = sorted.filter((t) => t.done >= t.total).length;

  return (
    <div className="space-y-4">
      {error && <div className="text-sm bg-red-50 text-red-700 rounded-xl px-4 py-2">{error}</div>}
      {notice && <div className="text-sm bg-green-50 text-green-800 rounded-xl px-4 py-2">{notice}</div>}
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

      <EmailPanel onSent={load} />

      {!data ? (
        <p className="text-slate-400 text-center py-10 animate-pulse">טוען...</p>
      ) : !data.month ? null : (
        <>
          <div className="card p-0 overflow-x-auto">
            <div className="px-4 py-3 font-bold text-navy">
              מי מילאה — {complete} מתוך {sorted.length} מורות סיימו · {sorted.filter((t) => t.ackAt).length} אישרו שקראו את ההודעה
            </div>
            <table className="w-full text-sm">
              <thead className="bg-navy text-white">
                <tr>
                  {['מורה', 'מחלקה', 'אישרה קריאה', 'מולאו', 'סטטוס', ''].map((h) => (
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
                      {t.ackAt ? (
                        <span className="text-green-700">
                          ✓ {new Date(t.ackAt).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          <span className="text-slate-400 text-xs"> ({t.ackVia === 'email' ? 'במייל' : 'באתר'})</span>
                        </span>
                      ) : (
                        <span className="text-red-600">עוד לא</span>
                      )}
                    </td>
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
                      {!t.ackAt && (
                        <button className="text-blue-700 text-xs hover:underline mr-3" disabled={resending === t.id} onClick={() => resend(t.id, t.name)}>
                          {resending === t.id ? 'שולח...' : 'שליחת המייל שוב'}
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
              <button className="btn-primary text-sm py-1.5 mr-auto" onClick={downloadExcel} disabled={downloading}>
                <FileSpreadsheet size={16} /> {downloading ? 'מוריד...' : 'הורדת אקסל עם כל הנתונים'}
              </button>
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
                      {e.lessons && <span className="text-slate-400 text-xs"> · {e.lessons}{e.tracks ? ` (${e.tracks})` : ''}</span>}
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

type EmailInfo = {
  subject: string;
  html: string;
  recipients: { id: string; name: string; hasEmail: boolean; isTeacher: boolean; chosen: boolean }[];
  sentThisMonth: boolean;
  month: string;
  emailConfigured: boolean;
  myEmail: string;
};

/** מייל למורות: תצוגה מקדימה, מייל בדיקה, ושליחה לכולן (שמפעילה גם את החובה לחודש הנוכחי) */
function EmailPanel({ onSent }: { onSent: () => void }) {
  const [info, setInfo] = useState<EmailInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState<'test' | 'send' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // מי שמסומנת — מקבלת את המייל וחייבת בהערכה. ברירת מחדל: כל מי שתפקידה "מורה"
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  function load() {
    api
      .get<EmailInfo>('/evaluations/email')
      .then((r) => {
        setInfo(r);
        setSelected((s) => s || new Set(r.recipients.filter((x) => x.isTeacher).map((x) => x.id)));
        setTestTo((t) => t || r.myEmail);
      })
      .catch((e) => setMsg({ ok: false, text: e.message }));
  }
  useEffect(load, []);

  async function test() {
    setBusy('test');
    setMsg(null);
    try {
      await api.post('/evaluations/email/test', { to: testTo });
      setMsg({ ok: true, text: `מייל בדיקה נשלח ל-${testTo}` });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(null);
    }
  }

  const [adding, setAdding] = useState<string | null>(null);
  async function addTeacher(id: string, name: string) {
    if (!confirm(`להוסיף את ${name} לרשימה ולשלוח לה את המייל? היא תחויב במילוי ההערכה.`)) return;
    setAdding(id);
    setMsg(null);
    try {
      const r = await api.post<{ message: string }>('/evaluations/email/add', { userId: id });
      setMsg({ ok: true, text: r.message });
      load();
      onSent();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setAdding(null);
    }
  }

  async function send() {
    if (!info) return;
    const withEmail = info.recipients.filter((r) => r.hasEmail && isOn(r.id)).length;
    if (!confirm(`לשלוח את המייל ל-${withEmail} מורות ולהפעיל את חובת ההערכה ל${monthLabel(info.month)}? רק מי שמסומנת תחויב במילוי.`)) return;
    setBusy('send');
    setMsg(null);
    try {
      const r = await api.post<{ sent: number; errors: string[] }>('/evaluations/email/send', { ids: info.recipients.filter((r) => isOn(r.id)).map((r) => r.id) });
      setMsg({ ok: r.sent > 0, text: `נשלחו ${r.sent} מיילים. החובה הופעלה.${r.errors.length ? ` לא נשלח ל: ${r.errors.join('; ')}` : ''}` });
      load();
      onSent();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(null);
    }
  }

  const isOn = (id: string) => !!selected?.has(id);
  if (!info) return msg ? <div className="text-sm bg-red-50 text-red-700 rounded-xl px-4 py-2">{msg.text}</div> : null;
  const chosen = info.recipients.filter((r) => isOn(r.id));
  const noEmail = chosen.filter((r) => !r.hasEmail);
  const teachers = info.recipients.filter((r) => r.isTeacher);
  const others = info.recipients.filter((r) => !r.isTeacher);
  const offTeachers = teachers.filter((r) => !isOn(r.id)).length;
  const row = (r: EmailInfo['recipients'][number]) => (
    <label key={r.id} className="flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" className="h-4 w-4 accent-navy" checked={isOn(r.id)} onChange={() => toggle(r.id)} disabled={info.sentThisMonth} />
      <span className={isOn(r.id) ? '' : 'line-through text-slate-400'}>{r.name}</span>
      {!r.hasEmail && <span className="text-xs text-amber-700">(אין מייל)</span>}
    </label>
  );
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold text-navy">מייל למורות — משוב לקראת חנוכה</p>
        {info.sentThisMonth && <span className="badge bg-green-100 text-green-800">נשלח החודש ✓</span>}
      </div>
      <p className="text-sm">
        יישלח ל-<b>{chosen.length - noEmail.length}</b> מורות של סמינר מאיר שיש להן תלמידות.
        {offTeachers > 0 && <span className="text-slate-500"> ({offTeachers} הורדו מהרשימה)</span>}
        {noEmail.length > 0 && <span className="text-amber-700"> בלי כתובת מייל (לא יקבלו): {noEmail.map((r) => r.name).join(', ')}</span>}
      </p>
      <button className="text-sm text-blue-700 hover:underline" onClick={() => setOpen(!open)}>
        {open ? 'הסתרת' : 'הצגת'} המייל ורשימת המורות (להורדת מורות מהרשימה)
      </button>
      {open && (
        <div className="space-y-2">
          <p className="text-sm">
            <b>נושא:</b> {info.subject}
          </p>
          <div className="border rounded-xl p-4 bg-white max-h-[60vh] overflow-y-auto" dangerouslySetInnerHTML={{ __html: info.html }} />
          <div className="border rounded-xl p-3">
            <p className="text-sm font-semibold text-navy mb-1">למי לשלוח? מורה בלי וי לא תקבל את המייל ולא תחויב במילוי ההערכה.</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1">{teachers.map(row)}</div>
            {others.length > 0 && (
              <>
                <p className="text-sm font-semibold text-navy mt-3 mb-1">
                  עובדות נוספות שמלמדות (מוגדרות "עובד" ולא "מורה") — מסמנים רק את מי שצריכה לקבל:
                </p>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1">{others.map(row)}</div>
              </>
            )}
          </div>
        </div>
      )}
      {info.sentThisMonth && info.recipients.some((r) => !r.chosen) && (
        <div className="border rounded-xl p-3 space-y-1.5">
          <p className="text-sm font-semibold text-navy">מורות שמלמדות ולא נכללו ברשימה — אפשר להוסיף ולשלוח להן עכשיו:</p>
          {info.recipients
            .filter((r) => !r.chosen)
            .map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span>{r.name}</span>
                {!r.hasEmail && <span className="text-xs text-amber-700">(אין מייל — תראה את ההודעה באתר)</span>}
                <button className="text-blue-700 hover:underline text-xs" disabled={adding === r.id} onClick={() => addTeacher(r.id, r.name)}>
                  {adding === r.id ? 'שולח...' : 'הוספה ושליחת המייל'}
                </button>
              </div>
            ))}
        </div>
      )}
      {!info.emailConfigured && <p className="text-sm text-red-700">שליחת מייל לא מוגדרת בשרת.</p>}
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <input className="input w-64" dir="ltr" placeholder="כתובת למייל בדיקה" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
        <button className="btn-outline text-sm py-1.5" disabled={!!busy || !testTo} onClick={test}>
          {busy === 'test' ? 'שולח...' : 'שליחת מייל בדיקה'}
        </button>
      </div>
      {!info.sentThisMonth && (
        <button className="btn-primary w-full" disabled={!!busy || !info.emailConfigured} onClick={send}>
          {busy === 'send' ? 'שולח...' : `שליחה לכל המורות והפעלת החובה ל${monthLabel(info.month)}`}
        </button>
      )}
      {msg && <p className={`text-sm rounded-lg px-3 py-2 ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}
    </div>
  );
}
