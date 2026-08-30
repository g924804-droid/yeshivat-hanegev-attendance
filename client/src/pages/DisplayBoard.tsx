import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CalendarDays, Megaphone } from 'lucide-react';
import { DOW_HE } from '../lib/utils';

type Lesson = {
  id: string;
  className: string;
  dayOfWeek: string;
  time: string;
  track?: string[];
  teacher?: string[];
  room: string;
};
type Ref = { id: string; name: string };
type Announcement = { id: string; text: string };

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];
const SCHEDULE_POLL_MS = 60_000;
const ANNOUNCEMENT_POLL_MS = 60_000;
const ANNOUNCEMENT_ROTATE_MS = 8_000;
const SLIDE_ROTATE_MS = 15_000;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`שגיאה בטעינה (${res.status})`);
  return res.json();
}

export function DisplayBoard() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [teachers, setTeachers] = useState<Ref[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementIdx, setAnnouncementIdx] = useState(0);
  const [slide, setSlide] = useState<'today' | 'week'>('today');
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const load = () =>
      fetchJson<{ lessons: Lesson[]; teachers: Ref[] }>('/api/display/schedule')
        .then((d) => {
          setLessons(d.lessons);
          setTeachers(d.teachers);
        })
        .catch(() => {});
    load();
    const interval = setInterval(load, SCHEDULE_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const load = () =>
      fetchJson<{ announcements: Announcement[] }>('/api/display/announcements')
        .then((d) => setAnnouncements(d.announcements))
        .catch(() => {});
    load();
    const interval = setInterval(load, ANNOUNCEMENT_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const clockTimer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clockTimer);
  }, []);

  useEffect(() => {
    if (announcements.length < 2) return;
    const t = setInterval(() => setAnnouncementIdx((i) => (i + 1) % announcements.length), ANNOUNCEMENT_ROTATE_MS);
    return () => clearInterval(t);
  }, [announcements.length]);

  useEffect(() => {
    const t = setInterval(() => setSlide((s) => (s === 'today' ? 'week' : 'today')), SLIDE_ROTATE_MS);
    return () => clearInterval(t);
  }, []);

  const todayDow = DAYS[now.getDay()] ?? null;
  const todayLessons = useMemo(
    () => lessons.filter((l) => l.dayOfWeek === todayDow).sort((a, b) => (a.time || '').localeCompare(b.time || '')),
    [lessons, todayDow]
  );

  function teacherName(ids?: string[]) {
    return ids?.map((id) => teachers.find((t) => t.id === id)?.name).filter(Boolean).join(', ') || '';
  }

  const dateStr = now.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
  const timeStr = now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="min-h-screen bg-navy text-white flex flex-col overflow-hidden" dir="rtl">
      <header className="flex items-center justify-between px-10 py-6 border-b border-white/10">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-gold text-navy flex items-center justify-center text-3xl font-black">
            נ
          </div>
          <div>
            <h1 className="text-3xl font-bold">ישיבת הנגב</h1>
            <p className="text-slate-300">{slide === 'today' ? `מערכת שעות — ${DOW_HE[now.getDay()]}` : 'מערכת שעות — השבוע'}</p>
          </div>
        </div>
        <div className="text-left">
          <div className="text-4xl font-black tabular-nums">{timeStr}</div>
          <div className="text-slate-300">{dateStr}</div>
        </div>
      </header>

      <main className="flex-1 p-8 overflow-hidden">
        {slide === 'today' ? (
          <section className="h-full bg-white/5 rounded-3xl p-10 overflow-y-auto">
            <h2 className="text-3xl font-bold mb-8 flex items-center gap-3 text-gold">
              <CalendarClock size={32} /> היום — {todayDow}
            </h2>
            <div className="grid grid-cols-2 gap-4">
              {todayLessons.map((l) => (
                <div key={l.id} className="flex items-center gap-6 bg-white/5 rounded-2xl px-6 py-5">
                  <div className="text-3xl font-black text-gold w-32 shrink-0 tabular-nums">{l.time}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-2xl font-bold truncate">{l.className}</div>
                    <div className="text-slate-300 text-lg truncate">
                      {teacherName(l.teacher)} {l.room ? `· חדר ${l.room}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {todayLessons.length === 0 && <p className="text-slate-400 text-2xl py-20 text-center">אין שיעורים היום</p>}
          </section>
        ) : (
          <section className="h-full bg-white/5 rounded-3xl p-8 overflow-hidden">
            <h2 className="text-3xl font-bold mb-6 flex items-center gap-3 text-gold">
              <CalendarDays size={32} /> השבוע
            </h2>
            <div className="grid grid-cols-6 gap-4 h-[calc(100%-4rem)]">
              {DAYS.map((day) => {
                const dayLessons = lessons
                  .filter((l) => l.dayOfWeek === day)
                  .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
                const isToday = day === todayDow;
                return (
                  <div
                    key={day}
                    className={`rounded-2xl p-4 overflow-y-auto ${isToday ? 'bg-gold/15 ring-2 ring-gold' : 'bg-white/5'}`}
                  >
                    <div className={`text-lg font-bold mb-3 ${isToday ? 'text-gold' : 'text-slate-200'}`}>
                      {day} {isToday ? '(היום)' : ''}
                    </div>
                    <div className="space-y-2">
                      {dayLessons.map((l) => (
                        <div key={l.id} className="text-sm bg-white/5 rounded-lg px-2 py-1.5">
                          <div className="font-semibold text-slate-100 truncate">{l.className}</div>
                          <div className="text-slate-400 text-xs">{l.time}</div>
                        </div>
                      ))}
                      {dayLessons.length === 0 && <p className="text-slate-500 text-xs">אין שיעורים</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>

      {announcements.length > 0 && (
        <footer className="bg-gold text-navy px-10 py-6 flex items-center gap-4">
          <Megaphone size={32} className="shrink-0" />
          <p className="text-2xl font-bold leading-snug">{announcements[announcementIdx % announcements.length]?.text}</p>
        </footer>
      )}
    </div>
  );
}
