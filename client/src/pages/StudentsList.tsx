import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, CalendarClock, ChevronRight, ChevronLeft, CheckCheck, Check, Search, User, MapPin, AlertTriangle } from 'lucide-react';
import { Layout } from '../components/Layout';
import { api } from '../lib/api';
import { todayStr, DOW_HE, getTimeSlotsForDay } from '../lib/utils';
import { familyFirstName } from '../lib/studentName';

type Student = {
  id: string;
  name: string;
  className: string;
  phone: string;
  attendanceId: string | null;
  status: string | null;
  avgGrade: number | null;
};
// periods — שיעור ארוך (שעה וחצי וכו') = כמה שיעורים של 45 דק', וכל אחד מסומן בנפרד
type Lesson = { id: string; className: string; time: string; room: string; teacherName: string; periods: number; periodTimes: string[] };
type MissingSlot = { date: string; time: string; lessonId: string; period: number; periods: number };

const STATUS_OPTIONS = ['נוכחת', 'חסרה', 'איחור'];
const STATUS_COLOR: Record<string, string> = {
  נוכחת: 'bg-green-100 text-green-800',
  חסרה: 'bg-red-100 text-red-700',
  איחור: 'bg-amber-100 text-amber-800',
};

function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function displayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function slotLabel(dayOfWeek: string, time: string): string {
  const slot = getTimeSlotsForDay(dayOfWeek).find((s) => s.time === time);
  return slot?.label || '';
}

export function StudentsList() {
  const { trackId } = useParams();
  const navigate = useNavigate();
  // קישור ישיר לתאריך ושיעור מסוימים (למשל ממסך "תיקון נתוני נוכחות")
  const [searchParams] = useSearchParams();
  const initialDate = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('date') || '') ? searchParams.get('date')! : todayStr();
  const [students, setStudents] = useState<Student[]>([]);
  const [schedule, setSchedule] = useState<Lesson[]>([]);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [activePeriod, setActivePeriod] = useState(1);
  // הגנה: לתאריך שעוד לא הגיע אי אפשר לסמן נוכחות (גם השרת חוסם)
  const [isFuture, setIsFuture] = useState(false);
  const [hebrewDate, setHebrewDate] = useState('');
  const [trackName, setTrackName] = useState('');
  // תאריך בר-בחירה, לא נעול ל"היום" — כדי שאפשר יהיה לחזור אחורה ולמלא נוכחות שהוחמצה
  // (למשל מזכירה שממלאת במקום מורה שלא הספיקה בימים קודמים באותו חודש).
  const [date, setDate] = useState(initialDate);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [missingSlots, setMissingSlots] = useState<MissingSlot[]>([]);
  // עד הטעינה הראשונה — "טוען", לא "אין שיעור"/"אין תלמידות" שמתחלפים אחרי שנייה
  const [loaded, setLoaded] = useState(false);

  // מקבל תאריך מפורש (לא סומך על ה-state) כדי שקפיצה ליום אחר (חצים/בחירת תאריך/לחיצה על
  // "תאריך חסר") תמיד תביא את הנתונים של היום הנכון, בלי מרוץ בין קריאה ישנה לחדשה.
  async function load(targetDate: string, lessonId?: string | null, period?: number) {
    try {
      const data = await api.get<{
        track: { name: string };
        students: Student[];
        schedule: Lesson[];
        activeLessonId: string | null;
        activePeriod: number;
        isFuture?: boolean;
        hebrewDate: string;
      }>('/students/getStudentsByTrack', { trackId, date: targetDate, lessonId: lessonId || undefined, period: period || undefined });
      setTrackName(data.track.name);
      setStudents(data.students);
      setSchedule(data.schedule);
      setActiveLessonId(data.activeLessonId);
      setActivePeriod(data.activePeriod || 1);
      setIsFuture(!!data.isFuture);
      setLoaded(true);
      setHebrewDate(data.hebrewDate);
    } catch (err: any) {
      setError(err.message);
      setLoaded(true);
    }
  }

  function goToDate(targetDate: string, lessonId?: string, period?: number) {
    setDate(targetDate);
    load(targetDate, lessonId, period);
  }

  useEffect(() => {
    load(date, searchParams.get('lessonId'));
    api
      .get<{ missing: MissingSlot[] }>('/students/getMissingAttendanceForTrack', { trackId })
      .then((r) => setMissingSlots(r.missing))
      .catch(() => setMissingSlots([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  function selectLesson(lessonId: string, period = 1) {
    if (lessonId === activeLessonId && period === activePeriod) return;
    load(date, lessonId, period);
  }

  function refreshMissing() {
    api
      .get<{ missing: MissingSlot[] }>('/students/getMissingAttendanceForTrack', { trackId })
      .then((r) => setMissingSlots(r.missing))
      .catch(() => {});
  }

  async function mark(student: Student, status: string) {
    setError(null);
    setMarkingId(student.id);
    try {
      await api.post('/students/markStudentAttendance', {
        studentId: student.id,
        status,
        date,
        existingAttendanceId: student.attendanceId || undefined,
        lessonId: activeLessonId || undefined,
        period: activePeriod,
      });
      await load(date, activeLessonId, activePeriod);
      refreshMissing();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMarkingId(null);
    }
  }

  async function markAllPresent() {
    setBusy(true);
    try {
      await api.post('/students/bulkMarkAttendance', {
        trackId,
        date,
        lessonId: activeLessonId || undefined,
        period: activePeriod,
        status: 'נוכחת',
      });
      await load(date, activeLessonId, activePeriod);
      refreshMissing();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const activeLesson = schedule.find((l) => l.id === activeLessonId);
  const isToday = date === todayStr();
  const dayOfWeek = DOW_HE[new Date(`${date}T00:00:00`).getDay()];

  const filteredStudents = useMemo(
    () =>
      students
        .map((s) => ({ ...s, displayName: familyFirstName(s.name) }))
        .filter((s) => s.name.includes(search.trim()) || s.displayName.includes(search.trim()))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'he')),
    [students, search]
  );

  const stats = useMemo(() => {
    const present = students.filter((s) => s.status === 'נוכחת').length;
    const absent = students.filter((s) => s.status === 'חסרה' || s.status === 'איחור').length;
    const notReported = students.length - present - absent;
    return { present, absent, notReported, total: students.length };
  }, [students]);

  return (
    <Layout title={trackName || 'תלמידות'}>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate('/students')} className="btn-outline text-sm py-2">
          <ArrowRight size={16} /> חזרה למסלולים
        </button>
      </div>

      {error && <div className="mb-4 text-sm bg-red-50 text-red-700 rounded-xl px-4 py-2">{error}</div>}
      {isFuture && (
        <div className="mb-4 text-sm bg-amber-50 text-amber-800 rounded-xl px-4 py-2">
          התאריך הזה עוד לא הגיע — אי אפשר לסמן נוכחות לשיעור שעוד לא התקיים.
        </div>
      )}

      {/* תאריכים/שעות שעדיין חסרה בהם נוכחות תלמידות — כדי שלא תצטרך לחפש בלוח שנה */}
      {missingSlots.length > 0 && (
        <div className="card mb-4 border-amber-300 bg-amber-50">
          <h3 className="font-bold text-amber-900 mb-2 flex items-center gap-2">
            <AlertTriangle size={18} /> נוכחות תלמידות חסרה
          </h3>
          <div className="flex flex-wrap gap-2">
            {missingSlots.map((s) => (
              <button
                key={`${s.date}-${s.lessonId}-${s.period}`}
                onClick={() => goToDate(s.date, s.lessonId, s.period)}
                className="badge cursor-pointer bg-white border border-amber-400 text-amber-900 hover:bg-amber-100"
              >
                {displayDate(s.date)} · {s.time}
                {s.periods > 1 && ` (שעה ${s.period} מתוך ${s.periods})`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ניווט תאריך */}
      <div className="card mb-4 flex items-center justify-between gap-2">
        <button
          onClick={() => goToDate(addDays(date, -1))}
          className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 shrink-0"
          title="יום קודם"
        >
          <ChevronRight size={20} />
        </button>

        <div className="flex-1 text-center">
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {isToday && <span className="badge bg-amber-100 text-amber-800">היום</span>}
            <span className="font-bold text-navy flex items-center gap-1.5">
              <CalendarClock size={18} /> יום {dayOfWeek} {displayDate(date)}
            </span>
          </div>
          {hebrewDate && <div className="text-xs text-slate-400 mt-1">{hebrewDate}</div>}
          <input
            type="date"
            className="input w-auto mt-2 text-sm py-1"
            value={date}
            onChange={(e) => goToDate(e.target.value)}
          />
        </div>

        <button
          onClick={() => goToDate(addDays(date, 1))}
          className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 shrink-0"
          title="יום הבא"
        >
          <ChevronLeft size={20} />
        </button>
      </div>

      {/* שיעורים מתוכננים */}
      <div className="card mb-4">
        <h3 className="font-bold text-navy mb-2 flex items-center gap-2">
          <CalendarClock size={18} /> שיעורים מתוכננים ליום {dayOfWeek}
        </h3>
        {schedule.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {schedule.map((l) => {
              const label = slotLabel(dayOfWeek, l.time);
              const active = l.id === activeLessonId;
              return (
                <button
                  key={l.id}
                  onClick={() => selectLesson(l.id)}
                  title={l.periods > 1 ? `שיעור כפול — ${l.periods} סימוני נוכחות` : undefined}
                  className={`badge cursor-pointer transition-colors flex items-center gap-1.5 ${
                    active ? 'bg-navy text-white' : 'bg-navy-50 text-navy hover:bg-navy-100'
                  }`}
                >
                  <span>{l.time}</span>
                  {l.periods > 1 && <span className="opacity-80">×{l.periods}</span>}
                  {label && <span className="opacity-80">{label}</span>}
                  {l.teacherName && (
                    <span className="flex items-center gap-0.5 opacity-80">
                      <User size={12} /> {l.teacherName}
                    </span>
                  )}
                  {l.room && (
                    <span className="flex items-center gap-0.5 opacity-80">
                      <MapPin size={12} /> {l.room}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <p className={`text-slate-400 text-sm ${loaded ? '' : 'animate-pulse'}`}>
            {loaded ? 'אין שיעור רשום למסלול הזה בתאריך הזה' : 'טוען שיעורים...'}
          </p>
        )}
        {activeLesson && activeLesson.periods > 1 && (
          <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-3">
            <p className="text-sm text-amber-900 mb-2">
              זה שיעור כפול — יש לסמן נוכחות {activeLesson.periods === 2 ? 'פעמיים' : `${activeLesson.periods} פעמים`}, פעם לכל 45 דקות:
            </p>
            <div className="flex flex-wrap gap-2">
              {activeLesson.periodTimes.map((t, i) => (
                <button
                  key={i}
                  onClick={() => selectLesson(activeLesson.id, i + 1)}
                  className={`badge cursor-pointer transition-colors ${
                    activePeriod === i + 1 ? 'bg-amber-500 text-white' : 'bg-white border border-amber-300 text-amber-900 hover:bg-amber-100'
                  }`}
                >
                  שעה {i + 1} · {t}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* סיכום */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="card text-center py-3">
          <div className="text-2xl font-bold text-slate-400">{stats.notReported}</div>
          <div className="text-xs text-slate-500 mt-1">לא דווח</div>
        </div>
        <div className="card text-center py-3">
          <div className="text-2xl font-bold text-red-600">{stats.absent}</div>
          <div className="text-xs text-slate-500 mt-1">חסרות</div>
        </div>
        <div className="card text-center py-3">
          <div className="text-2xl font-bold text-green-600">{stats.present}</div>
          <div className="text-xs text-slate-500 mt-1">נוכחות</div>
        </div>
        <div className="card text-center py-3">
          <div className="text-2xl font-bold text-navy">{stats.total}</div>
          <div className="text-xs text-slate-500 mt-1">סה"כ</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input pr-9"
            placeholder="חיפוש לפי שם..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button onClick={markAllPresent} disabled={busy || !students.length || isFuture} className="btn-primary text-sm py-2">
          <CheckCheck size={16} /> סמן הכל נוכחות
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm text-center">
          <thead>
            <tr className="text-slate-500 border-b">
              <th className="py-2">שם</th>
              <th>כיתה</th>
              <th>ממוצע ציונים</th>
              <th>נוכחות — {date}</th>
            </tr>
          </thead>
          <tbody>
            {filteredStudents.map((s) => (
              <tr key={s.id} className="border-b last:border-0 hover:bg-slate-50">
                <td className="py-2">{s.displayName}</td>
                <td>{s.className || '—'}</td>
                <td>{s.avgGrade ?? '—'}</td>
                <td>
                  <div className="flex gap-1.5 justify-center">
                    {STATUS_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => mark(s, opt)}
                        disabled={markingId === s.id || isFuture}
                        className={`badge transition-transform flex items-center gap-1 font-bold ${
                          markingId === s.id
                            ? 'opacity-40 cursor-wait'
                            : 'cursor-pointer hover:scale-105'
                        } ${
                          s.status === opt
                            ? `${STATUS_COLOR[opt]} ring-2 ring-offset-1 shadow-sm ${
                                opt === 'נוכחת'
                                  ? 'ring-green-500'
                                  : opt === 'חסרה'
                                  ? 'ring-red-500'
                                  : 'ring-amber-500'
                              }`
                            : 'bg-slate-100 text-slate-500 font-normal'
                        }`}
                      >
                        {s.status === opt && (
                          <span
                            className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-white shrink-0 ${
                              opt === 'נוכחת' ? 'bg-green-600' : opt === 'חסרה' ? 'bg-red-600' : 'bg-amber-600'
                            }`}
                          >
                            <Check size={12} strokeWidth={3.5} />
                          </span>
                        )}
                        {opt}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredStudents.length === 0 && (
          <p className={`text-center text-slate-400 py-6 ${loaded ? '' : 'animate-pulse'}`}>{loaded ? 'אין תלמידות להצגה' : 'טוען תלמידות...'}</p>
        )}
      </div>
    </Layout>
  );
}
