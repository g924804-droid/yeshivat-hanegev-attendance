import { useEffect, useMemo, useState } from 'react';
import { Plus, History, Monitor, Clock } from 'lucide-react';
import { Layout } from '../components/Layout';
import { api } from '../lib/api';
import { DOW_HE } from '../lib/utils';

type Lesson = {
  id: string;
  className: string;
  dayOfWeek: string;
  time: string;
  track: string[];
  teacher: string[];
  room: string;
};
type Ref = { id: string; name: string };
type HistoryRow = { id: string; description: string; changedAt: string; changedBy: string | null };

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי']; // אין לימודים בימי שישי כרגע

const TIME_SLOTS = [
  { time: '8:30-9:00', label: '' },
  { time: '9:00-9:45', label: 'שיעור ראשון' },
  { time: '9:45-10:30', label: 'שיעור שני' },
  { time: '10:30-11:00', label: 'הפסקה' },
  { time: '11:00-11:45', label: 'שיעור שלישי' },
  { time: '11:45-12:30', label: 'שיעור רביעי' },
  { time: '12:30-12:45', label: 'הפסקה' },
  { time: '12:45-13:30', label: 'שיעור חמישי' },
  { time: '13:30-14:15', label: 'שיעור שישי' },
  { time: '14:15-14:30', label: 'הפסקה' },
  { time: '14:30-15:15', label: 'שיעור שביעי' },
  { time: '15:15-16:00', label: 'שיעור שמיני' },
];
const CUSTOM_TIME = '__custom__';

const TRACK_COLORS = [
  'bg-blue-50 border-blue-200 text-blue-800',
  'bg-purple-50 border-purple-200 text-purple-800',
  'bg-emerald-50 border-emerald-200 text-emerald-800',
  'bg-amber-50 border-amber-200 text-amber-800',
  'bg-rose-50 border-rose-200 text-rose-800',
  'bg-teal-50 border-teal-200 text-teal-800',
  'bg-indigo-50 border-indigo-200 text-indigo-800',
  'bg-orange-50 border-orange-200 text-orange-800',
];

function trackColor(trackId: string | undefined, trackIds: string[]) {
  if (!trackId) return 'bg-slate-50 border-slate-200 text-slate-700';
  const idx = trackIds.indexOf(trackId);
  return TRACK_COLORS[idx % TRACK_COLORS.length] || TRACK_COLORS[0];
}

export function SchedulePage() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [teachers, setTeachers] = useState<Ref[]>([]);
  const [tracks, setTracks] = useState<Ref[]>([]);
  const [trackFilter, setTrackFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);

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

  function teacherName(ids: string[]) {
    return ids?.map((id) => teachers.find((t) => t.id === id)?.name).filter(Boolean).join(', ') || '';
  }

  async function openHistory() {
    const data = await api.get<{ history: HistoryRow[] }>('/schedule/getScheduleHistory');
    setHistory(data.history);
    setShowHistory(true);
  }

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

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {DAYS.map((day) => {
          const isToday = day === todayDow;
          const dayLessons = filtered
            .filter((l) => l.dayOfWeek === day)
            .sort((a, b) => a.time?.localeCompare(b.time));
          return (
            <div key={day} className={`card ${isToday ? 'ring-2 ring-gold' : ''}`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-navy">{day}</h3>
                {isToday && <span className="badge bg-gold/20 text-gold-dark">היום</span>}
              </div>
              <div className="space-y-2">
                {dayLessons.map((l) => (
                  <div key={l.id} className={`rounded-xl border p-3 ${trackColor(l.track?.[0], trackIds)}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{l.className}</span>
                      <span className="flex items-center gap-1 text-xs font-medium shrink-0">
                        <Clock size={12} /> {l.time}
                      </span>
                    </div>
                    <div className="text-xs opacity-80 mt-0.5">
                      {teacherName(l.teacher)} {l.room ? `· חדר ${l.room}` : ''}
                    </div>
                  </div>
                ))}
                {dayLessons.length === 0 && <p className="text-slate-300 text-xs py-2">אין שיעורים</p>}
              </div>
            </div>
          );
        })}
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
  teachers,
  tracks,
  onTeacherAdded,
  onClose,
  onSaved,
}: {
  teachers: Ref[];
  tracks: Ref[];
  onTeacherAdded: (teacher: Ref) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ className: '', dayOfWeek: 'ראשון', trackId: '', room: '' });
  const [timeChoice, setTimeChoice] = useState(TIME_SLOTS[0].time);
  const [customTime, setCustomTime] = useState('');
  const [teacherIds, setTeacherIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [newTeacherName, setNewTeacherName] = useState('');
  const [addingTeacher, setAddingTeacher] = useState(false);

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
      await api.post('/schedule/updateScheduleLesson', { ...form, time, teacherIds });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  const time = timeChoice === CUSTOM_TIME ? customTime.trim() : timeChoice;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-3 max-h-[85vh] overflow-y-auto">
        <h3 className="font-bold text-navy text-lg">שיעור חדש</h3>
        <input className="input" placeholder="שם הכיתה" value={form.className} onChange={(e) => setForm({ ...form, className: e.target.value })} />
        <select className="input" value={form.dayOfWeek} onChange={(e) => setForm({ ...form, dayOfWeek: e.target.value })}>
          {DAYS.map((d) => <option key={d}>{d}</option>)}
        </select>

        <div>
          <label className="label">שעה</label>
          <select className="input" value={timeChoice} onChange={(e) => setTimeChoice(e.target.value)}>
            {TIME_SLOTS.map((s) => (
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
          <option value="">מסלול</option>
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
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-outline" onClick={onClose}>ביטול</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !form.className || !time}>שמירה</button>
        </div>
      </div>
    </div>
  );
}
