import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CalendarDays, Megaphone } from 'lucide-react';
import { DOW_HE, toHebrewDateString } from '../lib/utils';

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
type Announcement = { id: string; text: string | null; fileName: string | null; fileMime: string | null };

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי']; // אין לימודים בימי שישי כרגע
const SCHEDULE_POLL_MS = 60_000;
const ANNOUNCEMENT_POLL_MS = 60_000;
const ANNOUNCEMENT_ROTATE_MS = 2 * 60_000; // כל כמה דקות מתחלפת הודעת הטקסט שמוצגת למטה
const SLIDE_ROTATE_MS = 2 * 60_000; // כל כמה דקות מתחלף בין היום / השבוע / קבצים שהועלו

type Slide = { kind: 'today' } | { kind: 'week' } | { kind: 'file'; announcement: Announcement };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`שגיאה בטעינה (${res.status})`);
  return res.json();
}

export function DisplayBoard() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [teachers, setTeachers] = useState<Ref[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [textAnnouncementIdx, setTextAnnouncementIdx] = useState(0);
  const [slideIdx, setSlideIdx] = useState(0);
  const [now, setNow] = useState(new Date());
  const [siteName, setSiteName] = useState('ישיבת הנגב');
  const [hasLogo, setHasLogo] = useState(false);

  useEffect(() => {
    fetchJson<{ siteName: string | null; hasLogo: boolean }>('/api/display/settings')
      .then((d) => {
        if (d.siteName) setSiteName(d.siteName);
        setHasLogo(d.hasLogo);
      })
      .catch(() => {});
  }, []);

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

  const textAnnouncements = useMemo(() => announcements.filter((a) => a.text && !a.fileName), [announcements]);
  const fileAnnouncements = useMemo(() => announcements.filter((a) => a.fileName), [announcements]);

  const slides: Slide[] = useMemo(
    () => [{ kind: 'today' }, { kind: 'week' }, ...fileAnnouncements.map((a) => ({ kind: 'file' as const, announcement: a }))],
    [fileAnnouncements]
  );

  useEffect(() => {
    if (textAnnouncements.length < 2) return;
    const t = setInterval(() => setTextAnnouncementIdx((i) => (i + 1) % textAnnouncements.length), ANNOUNCEMENT_ROTATE_MS);
    return () => clearInterval(t);
  }, [textAnnouncements.length]);

  useEffect(() => {
    if (slides.length < 2) return;
    const t = setInterval(() => setSlideIdx((i) => (i + 1) % slides.length), SLIDE_ROTATE_MS);
    return () => clearInterval(t);
  }, [slides.length]);

  const slide = slides[slideIdx % slides.length] || { kind: 'today' };

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
  const hebrewDateStr = useMemo(() => {
    try {
      return toHebrewDateString(now);
    } catch {
      return '';
    }
  }, [now]);

  const headerSubtitle =
    slide.kind === 'today'
      ? `מערכת שעות — ${DOW_HE[now.getDay()]}`
      : slide.kind === 'week'
      ? 'מערכת שעות — השבוע'
      : slide.announcement.text || 'הודעה';

  return (
    <div
      className="min-h-screen text-navy flex flex-col overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #fdf8f1 0%, #f7ece8 55%, #f3e6e9 100%)' }}
      dir="rtl"
    >
      <header className="flex items-center justify-between px-10 py-6 bg-white/70 backdrop-blur-sm shadow-sm">
        <div className="flex items-center gap-4">
          {hasLogo ? (
            <img src="/api/display/logo" alt={siteName} className="h-14 w-14 rounded-2xl object-contain bg-white shadow border border-amber-100" />
          ) : (
            <div className="h-14 w-14 rounded-2xl bg-gold text-navy flex items-center justify-center text-3xl font-black shadow">
              {siteName.trim().charAt(0) || 'נ'}
            </div>
          )}
          <div>
            <h1 className="text-3xl font-bold text-navy">{siteName}</h1>
            <p className="text-navy-light/70 truncate max-w-md">{headerSubtitle}</p>
          </div>
        </div>
        <div className="text-left">
          <div className="text-4xl font-black tabular-nums text-navy">{timeStr}</div>
          <div className="text-navy-light/70">{dateStr}</div>
          {hebrewDateStr && <div className="text-navy-light/60 text-sm">{hebrewDateStr}</div>}
        </div>
      </header>

      <main className="flex-1 p-8 overflow-hidden">
        {slide.kind === 'today' && (
          <section className="h-full bg-white/80 rounded-3xl p-10 overflow-y-auto shadow-md border border-amber-100">
            <h2 className="text-3xl font-bold mb-8 flex items-center gap-3 text-gold-dark">
              <CalendarClock size={32} /> היום — {todayDow}
            </h2>
            <div className="grid grid-cols-2 gap-4">
              {todayLessons.map((l) => (
                <div key={l.id} className="flex items-center gap-6 bg-amber-50/70 rounded-2xl px-6 py-5 border border-amber-100">
                  <div className="text-3xl font-black text-gold-dark w-32 shrink-0 tabular-nums">{l.time}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-2xl font-bold truncate text-navy">{l.className}</div>
                    <div className="text-navy-light/70 text-lg truncate">
                      {teacherName(l.teacher)} {l.room ? `· חדר ${l.room}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {todayLessons.length === 0 && <p className="text-navy-light/50 text-2xl py-20 text-center">אין שיעורים היום</p>}
          </section>
        )}

        {slide.kind === 'week' && (
          <section className="h-full bg-white/80 rounded-3xl p-8 overflow-hidden shadow-md border border-amber-100">
            <h2 className="text-3xl font-bold mb-6 flex items-center gap-3 text-gold-dark">
              <CalendarDays size={32} /> השבוע
            </h2>
            <div className="grid grid-cols-5 gap-4 h-[calc(100%-4rem)]">
              {DAYS.map((day) => {
                const dayLessons = lessons
                  .filter((l) => l.dayOfWeek === day)
                  .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
                const isToday = day === todayDow;
                return (
                  <div
                    key={day}
                    className={`rounded-2xl p-4 overflow-y-auto border ${
                      isToday ? 'bg-gold/10 border-gold' : 'bg-amber-50/50 border-amber-100'
                    }`}
                  >
                    <div className={`text-lg font-bold mb-3 ${isToday ? 'text-gold-dark' : 'text-navy'}`}>
                      {day} {isToday ? '(היום)' : ''}
                    </div>
                    <div className="space-y-2">
                      {dayLessons.map((l) => (
                        <div key={l.id} className="text-sm bg-white rounded-lg px-2 py-1.5 border border-amber-100/80">
                          <div className="font-semibold text-navy truncate">{l.className}</div>
                          <div className="text-navy-light/60 text-xs">{l.time}</div>
                        </div>
                      ))}
                      {dayLessons.length === 0 && <p className="text-navy-light/40 text-xs">אין שיעורים</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {slide.kind === 'file' && (
          <section className="h-full bg-white/80 rounded-3xl p-4 overflow-hidden shadow-md border border-amber-100 flex flex-col">
            {slide.announcement.text && (
              <p className="text-2xl font-bold text-gold-dark px-4 pt-2 pb-3 shrink-0">{slide.announcement.text}</p>
            )}
            <div className="flex-1 min-h-0">
              {slide.announcement.fileMime?.startsWith('image/') ? (
                <img
                  src={`/api/display/announcements/${slide.announcement.id}/file`}
                  alt={slide.announcement.text || 'הודעה'}
                  className="h-full w-full object-contain rounded-2xl"
                />
              ) : (
                <iframe
                  src={`/api/display/announcements/${slide.announcement.id}/file`}
                  title={slide.announcement.text || 'הודעה'}
                  className="h-full w-full rounded-2xl border-0"
                />
              )}
            </div>
          </section>
        )}
      </main>

      {textAnnouncements.length > 0 && (
        <footer className="bg-gold text-navy px-10 py-6 flex items-center gap-4 shadow-inner">
          <Megaphone size={32} className="shrink-0" />
          <p className="text-2xl font-bold leading-snug">
            {textAnnouncements[textAnnouncementIdx % textAnnouncements.length]?.text}
          </p>
        </footer>
      )}
    </div>
  );
}
