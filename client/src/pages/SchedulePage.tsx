import { useEffect, useMemo, useState } from 'react';
import { Plus, History, Monitor, Clock, Pencil, Trash2, Minimize2, Maximize2 } from 'lucide-react';
import { Layout } from '../components/Layout';
import { FitScale } from '../components/FitScale';
import { AnnouncementsManager } from '../components/AnnouncementsManager';
import { api } from '../lib/api';
import {
  DOW_HE,
  startMinutes,
  todayStr,
  ALL_TIME_SLOTS,
  TIME_SLOTS,
  TUESDAY_TIME_SLOTS,
  getTimeSlotsForDay,
  trackColor,
  lessonColor,
  compareLessonDisplayOrder,
} from '../lib/utils';

const DEFAULT_TIME_SET = new Set(TIME_SLOTS.map((s) => s.time));
const TUESDAY_TIME_SET = new Set(TUESDAY_TIME_SLOTS.map((s) => s.time));

type Lesson = {
  id: string;
  className: string;
  subject: string | null;
  dayOfWeek: string;
  time: string;
  track: string[];
  teacher: string[];
  room: string;
  notes?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
};
type Ref = { id: string; name: string };
type HistoryRow = {
  id: string;
  description: string;
  changedAt: string;
  changedBy: string | null;
  fromDate?: string | null;
  toDate?: string | null;
};

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי']; // אין לימודים בימי שישי כרגע

const CUSTOM_TIME = '__custom__';


export function SchedulePage() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [teachers, setTeachers] = useState<Ref[]>([]);
  const [tracks, setTracks] = useState<Ref[]>([]);
  const [trackFilter, setTrackFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  // תצוגה קומפקטית: עמודות וכרטיסי שיעור צרים וקטנים יותר, כדי שכל השבוע ייכנס בלי גלילה
  // אופקית במסכים רגילים. נשמר ב-localStorage כדי שהבחירה תישאר גם ברענון/כניסה הבאה.
  const [compact, setCompact] = useState(() => localStorage.getItem('scheduleCompact') === '1');
  useEffect(() => {
    localStorage.setItem('scheduleCompact', compact ? '1' : '0');
  }, [compact]);

  async function load() {
    const data = await api.get<{ lessons: Lesson[]; teachers: Ref[]; tracks: Ref[] }>('/schedule/getSchedule');
    setLessons(data.lessons);
    setTeachers(data.teachers);
    setTracks(data.tracks);
  }
  useEffect(() => {
    load();
  }, []);

  const trackIds = useMemo(() => tracks.map((t) => t.id), [tracks]);
  const todayDow = DOW_HE[new Date().getDay()];

  const filtered = useMemo(
    () => (trackFilter ? lessons.filter((l) => l.track?.includes(trackFilter)) : lessons),
    [lessons, trackFilter]
  );

  const rows = useMemo(() => {
    const known = new Set(ALL_TIME_SLOTS.map((s) => s.time));
    const extraTimes = new Set(filtered.map((l) => l.time).filter((t) => t && !known.has(t)));
    const all = [...ALL_TIME_SLOTS, ...Array.from(extraTimes).map((time) => ({ time, label: '' }))];
    return all.sort((a, b) => startMinutes(a.time) - startMinutes(b.time));
  }, [filtered]);

  function teacherName(ids: string[]) {
    return ids?.map((id) => teachers.find((t) => t.id === id)?.name).filter(Boolean).join(', ') || '';
  }

  function trackName(ids: string[] | undefined) {
    return ids?.map((id) => tracks.find((t) => t.id === id)?.name).filter(Boolean).join(', ') || '';
  }

  async function openHistory() {
    const data = await api.get<{ history: HistoryRow[] }>('/schedule/getScheduleHistory');
    setHistory(data.history);
    setShowHistory(true);
  }

  const tableNode = (
    <table className={`w-full border-collapse ${compact ? 'text-xs' : 'text-sm'}`}>
          <thead>
            <tr>
              <th
                className={`border border-slate-200 bg-slate-50 text-slate-500 shrink-0 ${
                  compact ? 'p-1 w-14 text-[10px]' : 'p-2 w-28'
                }`}
              >
                <Clock size={compact ? 10 : 13} className="inline ml-1" /> {!compact && 'שעה'}
              </th>
              {DAYS.slice(0, 2).map((day) => (
                <th
                  key={day}
                  className={`border border-slate-200 text-navy ${compact ? 'p-1 min-w-[90px] text-[11px]' : 'p-2 min-w-[160px]'} ${
                    day === todayDow ? 'bg-gold/15' : 'bg-slate-50'
                  }`}
                >
                  {day}
                  {day === todayDow && (
                    <span className={`block font-normal text-gold-dark ${compact ? 'text-[9px]' : 'text-xs'}`}>היום</span>
                  )}
                </th>
              ))}
              {/* עמודת שעה כפולה, צמודה ליום שלישי — נוחות ויזואלית כשמסתכלים על שלישי בלי לחפש
                  את עמודת השעה הראשית עד לקצה הטבלה (בקשה מפורשת, בהשראת איך שזה נראה ב-Zite). */}
              <th
                className={`border border-slate-200 bg-slate-50 text-slate-500 ${compact ? 'p-1 w-12 text-[10px]' : 'p-2 w-20'}`}
              >
                <Clock size={compact ? 10 : 13} className="inline ml-1" /> {!compact && 'שעה'}
              </th>
              {DAYS.slice(2).map((day) => (
                <th
                  key={day}
                  className={`border border-slate-200 text-navy ${compact ? 'p-1 min-w-[90px] text-[11px]' : 'p-2 min-w-[160px]'} ${
                    day === todayDow ? 'bg-gold/15' : 'bg-slate-50'
                  }`}
                >
                  {day}
                  {day === todayDow && (
                    <span className={`block font-normal text-gold-dark ${compact ? 'text-[9px]' : 'text-xs'}`}>היום</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isBreak = row.label === 'הפסקה';
              // עמודת השעה הרגילה מציגה רק שעות שרלוונטיות לשאר הימים; עמודת השעה של שלישי מציגה רק
              // שעות שרלוונטיות לשלישי. שעה משותפת (כמו תפילה) מוצגת בשתיהן; שעה לא מוכרת נופלת לעמודה הרגילה.
              const inDefault = DEFAULT_TIME_SET.has(row.time);
              const inTuesday = TUESDAY_TIME_SET.has(row.time);
              const showMainHour = inDefault || !inTuesday;
              const showTuesdayHour = inTuesday;

              const cellPad = compact ? 'p-1' : 'p-2';
              const hourTextSize = compact ? 'text-[10px]' : 'text-xs';

              if (isBreak) {
                return (
                  <tr key={row.time} className="bg-slate-100">
                    <td className={`${cellPad} border border-slate-200 text-slate-500 ${hourTextSize} align-middle`}>
                      {showMainHour && (
                        <>
                          <div className="font-medium">{row.time}</div>
                          {!compact && <div>הפסקה</div>}
                        </>
                      )}
                    </td>
                    <td colSpan={2} className={`${cellPad} border border-slate-200 text-center text-slate-400 ${hourTextSize}`}>
                      {showMainHour && 'הפסקה'}
                    </td>
                    <td className={`${cellPad} border border-slate-200 text-slate-500 ${hourTextSize} align-middle bg-slate-100`}>
                      {showTuesdayHour && (
                        <>
                          <div className="font-medium">{row.time}</div>
                          {!compact && <div>הפסקה</div>}
                        </>
                      )}
                    </td>
                    <td colSpan={3} className={`${cellPad} border border-slate-200 text-center text-slate-400 ${hourTextSize}`}>
                      {showTuesdayHour && 'הפסקה'}
                    </td>
                  </tr>
                );
              }

              function dayCell(day: string) {
                const cellLessons = filtered
                  .filter((l) => l.dayOfWeek === day && l.time === row.time)
                  .sort((a, b) => compareLessonDisplayOrder(a, b, tracks));
                return (
                  <td key={day} className={`${compact ? 'p-1' : 'p-1.5'} border border-slate-200 align-top`}>
                    <div className="flex flex-wrap gap-1">
                      {cellLessons.map((l) => (
                        <div
                          key={l.id}
                          onDoubleClick={() => setEditingLesson(l)}
                          className={`group relative rounded-lg border cursor-pointer flex-1 ${lessonColor(l, tracks)} ${
                            compact ? 'px-1 py-1 text-[10px] min-w-[80px]' : 'px-2 py-1.5 text-xs min-w-[120px]'
                          }`}
                        >
                          <button
                            onClick={() => setEditingLesson(l)}
                            title="עריכה"
                            className="absolute top-1 left-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-black/10 transition-opacity"
                          >
                            <Pencil size={compact ? 9 : 11} />
                          </button>
                          {l.notes && (
                            <span
                              title={l.notes}
                              className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white flex items-center justify-center text-[9px] font-black ring-1 ring-white"
                            >
                              !
                            </span>
                          )}
                          <div className={`font-semibold truncate ${compact ? 'pl-3' : 'pl-4'}`}>{l.subject || l.className}</div>
                          {!compact && l.subject && <div className="opacity-70 truncate">כיתה {l.className}</div>}
                          {!compact && trackName(l.track) && <div className="opacity-70 truncate">{trackName(l.track)}</div>}
                          <div className="opacity-80 truncate">
                            {teacherName(l.teacher)} {!compact && l.room ? `· ${l.room}` : ''}
                          </div>
                          {!compact && l.notes && (
                            <div className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-amber-200 border border-amber-400 text-amber-900 px-1.5 py-0.5 max-w-full">
                              <span className="w-1 h-1 rounded-full bg-red-500 shrink-0" />
                              <span className="truncate">{l.notes}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </td>
                );
              }

              return (
                <tr key={row.time}>
                  <td className={`${cellPad} border border-slate-200 text-slate-500 ${hourTextSize} align-top`}>
                    {showMainHour && (
                      <>
                        <div className="font-medium text-navy">{row.time}</div>
                        {!compact && row.label && <div>{row.label}</div>}
                      </>
                    )}
                  </td>
                  {DAYS.slice(0, 2).map((day) => dayCell(day))}
                  <td className={`${cellPad} border border-slate-200 text-slate-500 ${hourTextSize} align-top bg-slate-50/60`}>
                    {showTuesdayHour && (
                      <>
                        <div className="font-medium text-navy">{row.time}</div>
                        {!compact && row.label && <div>{row.label}</div>}
                      </>
                    )}
                  </td>
                  {DAYS.slice(2).map((day) => dayCell(day))}
                </tr>
              );
            })}
          </tbody>
        </table>
  );

  return (
    <Layout title="מערכת שעות">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <select className="input w-auto" value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)}>
            <option value="">כל המסלולים</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {!trackFilter && (
            <div className="hidden lg:flex items-center gap-1.5 flex-wrap">
              {tracks.map((t) => (
                <span key={t.id} className={`badge border ${trackColor(t.id, trackIds)}`}>{t.name}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button className="btn-outline" onClick={() => setCompact((c) => !c)}>
            {compact ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
            {compact ? 'תצוגה מלאה' : 'תצוגה קומפקטית'}
          </button>
          <a href="/display" target="_blank" rel="noreferrer" className="btn-outline">
            <Monitor size={16} /> מסך תצוגה
          </a>
          <button className="btn-outline" onClick={openHistory}>
            <History size={16} /> היסטוריה
          </button>
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={16} /> שיעור חדש
          </button>
        </div>
      </div>

      {compact ? (
        <FitScale className="card p-0" style={{ height: 'calc(100vh - 230px)' }}>
          {tableNode}
        </FitScale>
      ) : (
        <div className="card overflow-x-auto p-0">{tableNode}</div>
      )}

      <div className="mt-6">
        <AnnouncementsManager />
      </div>

      {showModal && (
        <LessonModal
          teachers={teachers}
          tracks={tracks}
          onTeacherAdded={(teacher) => setTeachers((prev) => [...prev, teacher])}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
            load();
          }}
        />
      )}

      {editingLesson && (
        <LessonModal
          lesson={editingLesson}
          teachers={teachers}
          tracks={tracks}
          onTeacherAdded={(teacher) => setTeachers((prev) => [...prev, teacher])}
          onClose={() => setEditingLesson(null)}
          onSaved={() => {
            setEditingLesson(null);
            load();
          }}
        />
      )}

      {showHistory && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto space-y-2">
            <h3 className="font-bold text-navy text-lg mb-2">היסטוריית שינויים</h3>
            {history.map((h) => (
              <div key={h.id} className="text-sm border-b pb-2">
                <p>{h.description}</p>
                <p className="text-slate-400 text-xs">{h.changedBy} · {new Date(h.changedAt).toLocaleString('he-IL')}</p>
              </div>
            ))}
            <button className="btn-outline mt-3" onClick={() => setShowHistory(false)}>סגירה</button>
          </div>
        </div>
      )}
    </Layout>
  );
}

function LessonModal({
  lesson,
  teachers,
  tracks,
  onTeacherAdded,
  onClose,
  onSaved,
}: {
  lesson?: Lesson;
  teachers: Ref[];
  tracks: Ref[];
  onTeacherAdded: (teacher: Ref) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    className: lesson?.className || '',
    subject: lesson?.subject || '',
    dayOfWeek: lesson?.dayOfWeek || 'ראשון',
    trackId: lesson?.track?.[0] || '',
    room: lesson?.room || '',
    notes: lesson?.notes || '',
    // מתאריך חובה (שיעור חדש מתחיל היום כברירת מחדל); עד תאריך לא חובה — ריק אומר "עדיין בתוקף".
    fromDate: lesson?.fromDate || todayStr(),
    toDate: lesson?.toDate || '',
  });
  const daySlots = getTimeSlotsForDay(form.dayOfWeek);
  const knownTime = lesson && daySlots.some((s) => s.time === lesson.time);
  const [timeChoice, setTimeChoice] = useState(lesson ? (knownTime ? lesson.time : CUSTOM_TIME) : daySlots[0].time);
  const [customTime, setCustomTime] = useState(lesson && !knownTime ? lesson.time : '');
  const [teacherIds, setTeacherIds] = useState<string[]>(lesson?.teacher || []);
  const [busy, setBusy] = useState(false);
  const [newTeacherName, setNewTeacherName] = useState('');
  const [addingTeacher, setAddingTeacher] = useState(false);

  function changeDay(day: string) {
    const newSlots = getTimeSlotsForDay(day);
    setForm((prev) => ({ ...prev, dayOfWeek: day }));
    if (timeChoice !== CUSTOM_TIME && !newSlots.some((s) => s.time === timeChoice)) {
      setTimeChoice(newSlots[0].time);
    }
  }

  function toggleTeacher(id: string) {
    setTeacherIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  async function addNewTeacher() {
    const name = newTeacherName.trim();
    if (!name) return;
    setAddingTeacher(true);
    try {
      const r = await api.post<{ recordId: string }>('/students/addTeacher', { name });
      const teacher = { id: r.recordId, name };
      onTeacherAdded(teacher);
      setTeacherIds((prev) => [...prev, teacher.id]);
      setNewTeacherName('');
    } finally {
      setAddingTeacher(false);
    }
  }

  async function submit() {
    const time = timeChoice === CUSTOM_TIME ? customTime.trim() : timeChoice;
    if (!time) return;
    setBusy(true);
    try {
      // אין יותר שדה "כיתה" נפרד בטופס — שם המסלול הוא ההזדהות של השיעור, אז זה מה שנשמר בשדה הישן.
      const className = tracks.find((t) => t.id === form.trackId)?.name || form.className;
      await api.post('/schedule/updateScheduleLesson', { id: lesson?.id, ...form, className, time, teacherIds });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!lesson) return;
    if (!confirm(`למחוק את השיעור "${lesson.subject || lesson.className}" (${lesson.dayOfWeek} ${lesson.time})?`)) return;
    setBusy(true);
    try {
      await api.post('/schedule/deleteScheduleLesson', { id: lesson.id });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  const time = timeChoice === CUSTOM_TIME ? customTime.trim() : timeChoice;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-3 max-h-[85vh] overflow-y-auto">
        <h3 className="font-bold text-navy text-lg">{lesson ? 'עריכת שיעור' : 'שיעור חדש'}</h3>
        <input className="input" placeholder="נושא (למשל: חשבון)" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        <select className="input" value={form.dayOfWeek} onChange={(e) => changeDay(e.target.value)}>
          {DAYS.map((d) => <option key={d}>{d}</option>)}
        </select>

        <div>
          <label className="label">שעה</label>
          <select className="input" value={timeChoice} onChange={(e) => setTimeChoice(e.target.value)}>
            {daySlots.map((s) => (
              <option key={s.time} value={s.time}>
                {s.time}{s.label ? ` — ${s.label}` : ''}
              </option>
            ))}
            <option value={CUSTOM_TIME}>שעה מותאמת אישית...</option>
          </select>
          {timeChoice === CUSTOM_TIME && (
            <input
              className="input mt-2"
              placeholder="לדוגמה: 16:00-16:45"
              value={customTime}
              onChange={(e) => setCustomTime(e.target.value)}
            />
          )}
        </div>

        <select className="input" value={form.trackId} onChange={(e) => setForm({ ...form, trackId: e.target.value })}>
          <option value="">מסלול (חובה)</option>
          {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>

        <div>
          <label className="label">מורות (אפשר לבחור כמה)</label>
          <div className="border rounded-xl p-2 max-h-32 overflow-y-auto space-y-1">
            {teachers.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm px-1 py-0.5 rounded hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={teacherIds.includes(t.id)} onChange={() => toggleTeacher(t.id)} />
                {t.name}
              </label>
            ))}
            {teachers.length === 0 && <p className="text-slate-400 text-xs">אין מורות זמינות</p>}
          </div>
          <div className="flex gap-2 mt-2">
            <input
              className="input py-1.5 text-sm"
              placeholder="שם מורה חדשה..."
              value={newTeacherName}
              onChange={(e) => setNewTeacherName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addNewTeacher())}
            />
            <button
              type="button"
              className="btn-outline text-sm py-1.5 px-3 shrink-0"
              onClick={addNewTeacher}
              disabled={addingTeacher || !newTeacherName.trim()}
            >
              <Plus size={14} /> הוספת מורה
            </button>
          </div>
        </div>

        <input className="input" placeholder="חדר" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} />

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">מתאריך (חובה)</label>
            <input
              type="date"
              className="input"
              value={form.fromDate}
              onChange={(e) => setForm({ ...form, fromDate: e.target.value })}
            />
          </div>
          <div>
            <label className="label">עד תאריך (לא חובה — ריק = בתוקף)</label>
            <input
              type="date"
              className="input"
              value={form.toDate}
              onChange={(e) => setForm({ ...form, toDate: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="label">הערה (לא חובה) — לשינוי/הוספה חד-פעמית, תופיע מודגשת במסך התצוגה</label>
          <input
            className="input"
            placeholder="לדוגמה: הוחלף לשיעור העשרה"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        <div className="flex gap-2 justify-between pt-2">
          {lesson ? (
            <button className="btn-outline text-red-600 border-red-200 hover:bg-red-50" onClick={handleDelete} disabled={busy}>
              <Trash2 size={14} /> מחיקה
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button className="btn-outline" onClick={onClose}>ביטול</button>
            <button className="btn-primary" onClick={submit} disabled={busy || !form.trackId || !form.fromDate || !time}>
              שמירה
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
