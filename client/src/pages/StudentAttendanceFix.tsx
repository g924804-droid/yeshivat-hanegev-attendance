import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarX, Link2, Trash2, ExternalLink } from 'lucide-react';
import { Layout } from '../components/Layout';
import { api } from '../lib/api';
import { todayStr, toHebrewDateString } from '../lib/utils';

type Batch = {
  key: string;
  date: string;
  hebDate: string;
  dayOfWeek: string;
  markedAt: string;
  trackName: string;
  recordIds: string[];
  present: number;
  absentNames: string[];
  lateNames: string[];
  duplicateOfEarlier: boolean;
  lessonOptions: { id: string; name: string; time: string }[];
};
type Missing = {
  date: string;
  hebDate: string;
  dayOfWeek: string;
  trackId: string;
  trackName: string;
  lessonId: string;
  lessonName: string;
  time: string;
  teacher: string;
};

function schoolYearStart(): string {
  const now = new Date();
  const year = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-09-01`;
}

function hebrewOf(iso: string): string {
  return iso ? toHebrewDateString(new Date(`${iso}T12:00:00`)) : '';
}

function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const it of items) m.set(key(it), [...(m.get(key(it)) || []), it]);
  return Array.from(m.entries());
}

/**
 * תיקון נתוני נוכחות תלמידות מתחילת השנה:
 * - שיעורים שלפי המערכת התקיימו ולא נרשמה בהם נוכחות — עם קישור ישיר למסך הסימון.
 * - סימונים ישנים שלא שויכו לשיעור — לשייך לשיעור, או למחוק אם זה סימון כפול.
 */
export function StudentAttendanceFix() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'missing' | 'unassigned'>('missing');
  const [from, setFrom] = useState(schoolYearStart());
  const [to, setTo] = useState(todayStr());
  const [batches, setBatches] = useState<Batch[]>([]);
  const [missing, setMissing] = useState<Missing[]>([]);
  const [trackFilter, setTrackFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<{ batches: Batch[]; missing: Missing[] }>('/students/attendanceIssues', { from, to });
      setBatches(r.batches);
      setMissing(r.missing);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trackNames = useMemo(
    () => Array.from(new Set(missing.map((m) => m.trackName))).sort((a, b) => a.localeCompare(b, 'he')),
    [missing]
  );
  const shownMissing = useMemo(() => missing.filter((m) => !trackFilter || m.trackName === trackFilter), [missing, trackFilter]);

  async function assign(b: Batch) {
    const lessonId = chosen[b.key];
    if (!lessonId) return setError('יש לבחור שיעור לפני השיוך');
    setBusyKey(b.key);
    setError(null);
    try {
      await api.post('/students/assignAttendanceLesson', { recordIds: b.recordIds, lessonId });
      setBatches((prev) => prev.filter((x) => x.key !== b.key));
      setNotice(`${b.recordIds.length} סימונים שויכו לשיעור`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyKey(null);
    }
  }

  async function remove(list: Batch[], label: string) {
    const ids = list.flatMap((b) => b.recordIds);
    if (!window.confirm(`למחוק ${ids.length} סימונים (${label})? אי אפשר לבטל את המחיקה.`)) return;
    setBusyKey(list[0].key);
    setError(null);
    try {
      for (let i = 0; i < ids.length; i += 200) {
        await api.post('/students/deleteAttendanceRecords', { recordIds: ids.slice(i, i + 200) });
      }
      const keys = new Set(list.map((b) => b.key));
      setBatches((prev) => prev.filter((x) => !keys.has(x.key)));
      setNotice(`${ids.length} סימונים נמחקו`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyKey(null);
    }
  }

  const unassignedCount = batches.reduce((s, b) => s + b.recordIds.length, 0);

  return (
    <Layout title="תיקון נתוני נוכחות">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate('/students/report')} className="btn-outline text-sm py-2">
          <ArrowRight size={16} /> חזרה לדוחות
        </button>
      </div>

      {error && <div className="mb-4 text-sm bg-red-50 text-red-700 rounded-xl px-4 py-2">{error}</div>}
      {notice && <div className="mb-4 text-sm bg-green-50 text-green-800 rounded-xl px-4 py-2">{notice}</div>}

      <div className="card mb-4 flex flex-wrap gap-3 items-end">
        <label className="text-sm">
          מתאריך
          <input type="date" className="input mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="block text-xs text-slate-500 mt-1 h-4">{hebrewOf(from)}</span>
        </label>
        <label className="text-sm">
          עד תאריך
          <input type="date" className="input mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
          <span className="block text-xs text-slate-500 mt-1 h-4">{hebrewOf(to)}</span>
        </label>
        <button className="btn-primary py-2 mb-5" onClick={load} disabled={loading}>
          {loading ? 'בודק...' : 'בדיקה'}
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          className={`badge cursor-pointer py-2 px-4 text-sm ${tab === 'missing' ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600'}`}
          onClick={() => setTab('missing')}
        >
          <CalendarX size={14} className="inline ml-1" /> שיעורים בלי נוכחות ({missing.length})
        </button>
        <button
          className={`badge cursor-pointer py-2 px-4 text-sm ${tab === 'unassigned' ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600'}`}
          onClick={() => setTab('unassigned')}
        >
          <Link2 size={14} className="inline ml-1" /> סימונים שלא שויכו לשיעור ({unassignedCount})
        </button>
      </div>

      {tab === 'missing' && (
        <div className="card">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <p className="text-sm text-slate-600">
              שיעורים שלפי מערכת השעות התקיימו, ולא נרשמה בהם נוכחות לאף תלמידה. לחיצה על "לסימון" פותחת את מסך
              הנוכחות בדיוק ביום ובשיעור. שיעור שבוטל — אפשר להתעלם ממנו.
            </p>
            <select className="input w-auto" value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)}>
              <option value="">כל המסלולים</option>
              {trackNames.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          {groupBy(shownMissing, (m) => m.date).map(([date, rows]) => (
            <div key={date} className="mb-3">
              <div className="font-bold text-navy text-sm bg-slate-100 rounded-lg px-3 py-1.5">
                יום {rows[0].dayOfWeek}, {rows[0].hebDate}
              </div>
              {rows.map((m) => (
                <div key={`${m.lessonId}|${m.trackId}`} className="flex items-center gap-3 px-3 py-1.5 border-b last:border-0 text-sm">
                  <span className="text-slate-500 w-24 shrink-0">{m.time}</span>
                  <span className="w-36 shrink-0">{m.trackName}</span>
                  <span className="flex-1 font-medium">{m.lessonName}</span>
                  <span className="text-slate-500 hidden sm:inline">{m.teacher}</span>
                  <button
                    className="btn-outline text-xs py-1 px-2"
                    onClick={() => navigate(`/students/${m.trackId}?date=${m.date}&lessonId=${m.lessonId}`)}
                  >
                    <ExternalLink size={13} /> לסימון
                  </button>
                </div>
              ))}
            </div>
          ))}
          {shownMissing.length === 0 && !loading && <p className="text-center text-slate-400 py-6">אין שיעורים בלי נוכחות 🎉</p>}
        </div>
      )}

      {tab === 'unassigned' && (
        <div className="card">
          <p className="text-sm text-slate-600 mb-3">
            סימונים מתחילת השנה שנשמרו בלי שיוך לשיעור, ולכן לא נכללים בדוחות. כל שורה היא סימון אחד שנעשה ברצף. אפשר
            לשייך אותה לשיעור הנכון, או למחוק אם זה סימון חוזר (מסומן "נראה כפול").
          </p>
          {groupBy(batches, (b) => b.date).map(([date, list]) => (
            <details key={date} className="mb-3 border rounded-xl" open={list.length <= 4}>
              <summary className="cursor-pointer font-bold text-navy text-sm bg-slate-100 rounded-xl px-3 py-2 flex items-center justify-between">
                <span>
                  יום {list[0].dayOfWeek}, {list[0].hebDate} — {list.length} סימונים ({list.reduce((s, b) => s + b.recordIds.length, 0)} רישומים)
                </span>
                <button
                  className="text-red-600 hover:bg-red-50 rounded-lg px-2 py-1 text-xs font-normal flex items-center gap-1"
                  disabled={!!busyKey}
                  onClick={(e) => {
                    e.preventDefault();
                    remove(list, `כל הסימונים הלא משויכים של ${list[0].hebDate}`);
                  }}
                >
                  <Trash2 size={13} /> מחיקת כל היום
                </button>
              </summary>
              {list.map((b) => (
                <div key={b.key} className={`px-3 py-2 border-t text-sm ${b.duplicateOfEarlier ? 'bg-amber-50' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-500">סומן ב-{b.markedAt}</span>
                    <span className="font-medium">{b.trackName}</span>
                    <span className="badge bg-slate-100 text-slate-600">{b.recordIds.length} בנות</span>
                    <span className="text-green-700">{b.present} נוכחות</span>
                    {b.duplicateOfEarlier && <span className="badge bg-amber-100 text-amber-800">נראה כפול</span>}
                  </div>
                  {(b.absentNames.length > 0 || b.lateNames.length > 0) && (
                    <div className="text-xs mt-1">
                      {b.absentNames.length > 0 && <span className="text-red-600">חסרות: {b.absentNames.join(', ')} </span>}
                      {b.lateNames.length > 0 && <span className="text-amber-700">איחור: {b.lateNames.join(', ')}</span>}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <select
                      className="input w-auto text-sm py-1"
                      value={chosen[b.key] || ''}
                      onChange={(e) => setChosen((c) => ({ ...c, [b.key]: e.target.value }))}
                    >
                      <option value="">בחירת שיעור...</option>
                      {b.lessonOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.time} {o.name}
                        </option>
                      ))}
                    </select>
                    <button className="btn-primary text-xs py-1.5" disabled={busyKey === b.key || !chosen[b.key]} onClick={() => assign(b)}>
                      <Link2 size={13} /> שיוך
                    </button>
                    <button
                      className="text-red-600 hover:bg-red-50 rounded-lg px-2 py-1 text-xs flex items-center gap-1"
                      disabled={!!busyKey}
                      onClick={() => remove([b], `הסימון של ${b.markedAt}`)}
                    >
                      <Trash2 size={13} /> מחיקה
                    </button>
                  </div>
                </div>
              ))}
            </details>
          ))}
          {batches.length === 0 && !loading && <p className="text-center text-slate-400 py-6">כל הסימונים משויכים לשיעורים 🎉</p>}
        </div>
      )}
    </Layout>
  );
}
