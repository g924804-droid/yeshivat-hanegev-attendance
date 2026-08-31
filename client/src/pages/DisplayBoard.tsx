import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CalendarDays, Megaphone } from 'lucide-react';
import { DOW_HE, startMinutes, toHebrewDateString } from '../lib/utils';

type Lesson = {
  id: string;
  className: string;
  subject?: string;
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
const ANNOUNCEMENT_ROTATE_MS = 60_000; // כל דקה מתחלפת הודעת הטקסט שמוצגת למטה
const SLIDE_ROTATE_MS = 60_000; // כל דקה מתחלף בין היום / השבוע / קבצים שהועלו

type Slide = { kind: 'today' } | { kind: 'week' } | { kind: 'file'; announcement: Announcement };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`שגיאה בטעינה (${res.status})`);
  return res.json();
}

export function DisplayBoard() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [teachers, setTeachers] = useState<Ref[]>([]);
  const [tracks, setTracks] = useState<Ref[]>([]);
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
      fetchJson<{ lessons: Lesson[]; teachers: Ref[]; tracks: Ref[] }>('/api/display/schedule')
        .then((d) => {
          setLessons(d.lessons);
          setTeachers(d.teachers);
          setTracks(d.tracks);
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
    () => lessons.filter((l) => l.dayOfWeek === todayDow).sort((a, b) => startMinutes(a.time) - startMinutes(b.time)),
    [lessons, todayDow]
  );

  function teacherName(ids?: string[]) {
    return ids?.map((id) => teachers.find((t) => t.id === id)?.name).filter(Boolean).join(', ') || '';
  }

  function trackName(ids?: string[]) {
    return ids?.map((id) => tracks.find((t) => t.id === id)?.name).filter(Boolean).join(', ') || '';
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
      className="relative min-h-screen text-navy flex flex-col overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #fdf8f1 0%, #f7ece8 55%, #f3e6e9 100%)' }}
      dir="rtl"
    >
      {hasLogo && (
        <img
          src="/api/display/logo"
          alt=""
          aria-hidden="true"
          className="pointer-events-none select-none absolute inset-0 m-auto max-h-[70vh] max-w-[70vw] object-contain opacity-[0.07]"
        />
      )}

      <header className="relative z-10 flex items-center justify-between px-8 py-4 bg-white/70 backdrop-blur-sm shadow-sm">
        <div className="flex items-center gap-3">
          {hasLogo ? (
            <img src="/api/display/logo" alt={siteName} className="h-11 w-11 rounded-xl object-contain bg-white shadow border border-amber-100" />
          ) : (
            <div className="h-11 w-11 rounded-xl bg-gold text-navy flex items-center justify-center text-2xl font-black shadow">
              {siteName.trim().charAt(0) || 'נ'}
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold text-navy leading-tight">{siteName}</h1>
            <p className="text-navy-light/70 truncate max-w-md text-sm leading-tight">{headerSubtitle}</p>
          </div>
        </div>
        <div className="text-left">
          <div className="text-2xl font-black tabular-nums text-navy leading-tight">{timeStr}</div>
          <div className="text-navy-light/70 text-sm leading-tight">{dateStr}</div>
          {hebrewDateStr && <div className="text-navy-light/60 text-xs leading-tight">{hebrewDateStr}</div>}
        </div>
      </header>

      <main className="relative z-10 flex-1 p-5 overflow-hidden min-h-0">
        {slide.kind === 'today' && (
          <section className="h-full bg-white/80 rounded-2xl p-5 overflow-y-auto shadow-md border border-amber-100">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-gold-dark">
              <CalendarClock size={22} /> היום — {todayDow}
            </h2>
            <div className="grid grid-cols-2 gap-2.5">
              {todayLessons.map((l) => (
                <div key={l.id} className="flex items-center gap-3 bg-amber-50/70 rounded-xl px-3 py-2 border border-amber-100">
                  <div className="text-lg font-black text-gold-dark w-20 shrink-0 tabular-nums">{l.time}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-bold truncate text-navy">{l.subject || l.className}</div>
                    <div className="text-navy-light/70 text-xs truncate">
                      {l.subject && `כיתה ${l.className} · `}
                      {trackName(l.track) && `${trackName(l.track)} · `}
                      {teacherName(l.teacher)} {l.room ? `· חדר ${l.room}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {todayLessons.length === 0 && <p className="text-navy-light/50 text-xl py-16 text-center">אין שיעורים היום</p>}
          </section>
        )}

        {slide.kind === 'week' && (
          <section className="h-full bg-white/80 rounded-2xl p-4 overflow-hidden shadow-md border border-amber-100">
            <h2 className="text-xl font-bold mb-3 flex items-center gap-2 text-gold-dark">
              <CalendarDays size={22} /> השבוע
            </h2>
            <div className="grid grid-cols-5 gap-2.5 h-[calc(100%-2.5rem)]">
              {DAYS.map((day) => {
                const dayLessons = lessons
                  .filter((l) => l.dayOfWeek === day)
                  .sort((a, b) => startMinutes(a.time) - startMinutes(b.time));
                const isToday = day === todayDow;
                return (
                  <div
                    key={day}
                    className={`rounded-xl p-2 overflow-y-auto border ${
                      isToday ? 'bg-gold/10 border-gold' : 'bg-amber-50/50 border-amber-100'
                    }`}
                  >
                    <div className={`text-sm font-bold mb-1.5 ${isToday ? 'text-gold-dark' : 'text-navy'}`}>
                      {day} {isToday ? '(היום)' : ''}
                    </div>
                    <div className="space-y-1">
                      {dayLessons.map((l) => (
                        <div key={l.id} className="text-[11px] leading-tight bg-white rounded-md px-1.5 py-1 border border-amber-100/80">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-semibold text-navy truncate">{l.subject || l.className}</span>
                            <span className="text-navy-light/60 shrink-0">{l.time}</span>
                          </div>
                          {l.subject && <div className="text-navy-light/60 truncate">כיתה {l.className}</div>}
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
          <section className="h-full bg-white/80 rounded-2xl p-4 overflow-hidden shadow-md border border-amber-100 flex flex-col">
            {slide.announcement.text && (
              <p className="text-xl font-bold text-gold-dark px-3 pt-1 pb-2 shrink-0">{slide.announcement.text}</p>
            )}
            <div className="flex-1 min-h-0">
              {slide.announcement.fileMime?.startsWith('image/') ? (
                <img
                  src={`/api/display/announcements/${slide.announcement.id}/file`}
                  alt={slide.announcement.text || 'הודעה'}
                  className="h-full w-full object-contain rounded-xl"
                />
              ) : (
                <iframe
                  src={`/api/display/announcements/${slide.announcement.id}/file`}
                  title={slide.announcement.text || 'הודעה'}
                  className="h-full w-full rounded-xl border-0"
                />
              )}
            </div>
          </section>
        )}
      </main>

      {textAnnouncements.length > 0 && (
        <footer className="relative z-10 bg-gold text-navy px-8 py-3 flex items-center gap-3 shadow-inner">
          <Megaphone size={22} className="shrink-0" />
          <p className="text-lg font-bold leading-snug">
            {textAnnouncements[textAnnouncementIdx % textAnnouncements.length]?.text}
          </p>
        </footer>
      )}
    </div>
  );
}
