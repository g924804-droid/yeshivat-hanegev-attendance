import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CalendarDays, Megaphone } from 'lucide-react';
import { DOW_HE, startMinutes, toHebrewDateString, TIME_SLOTS, trackColor } from '../lib/utils';

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
const SCHEDULE_POLL_MS = 15 * 60_000; // מערכת השעות מגיעה מ-Airtable — רבע שעה מספיק ומקל על מכסת הבקשות המשותפת
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
  const trackIds = useMemo(() => tracks.map((t) => t.id), [tracks]);
  // שורה אחת לכל שעה קבועה ביום (כמו במסך הניהול), כדי שהשעות תמיד יסתדרו זו מתחת לזו
  // בטור אחד ברור, במקום להתפזר בין עמודות. שעות לא סטנדרטיות שיש להן שיעור בפועל נוספות בסוף.
  const todayRows = useMemo(() => {
    const known = new Set(TIME_SLOTS.map((s) => s.time));
    const extraTimes = new Set(todayLessons.map((l) => l.time).filter((t) => t && !known.has(t)));
    const all = [...TIME_SLOTS, ...Array.from(extraTimes).map((time) => ({ time, label: '' }))];
    return all.sort((a, b) => startMinutes(a.time) - startMinutes(b.time));
  }, [todayLessons]);
  // כדי שהכל ייכנס במבט אחד בלי גלילה (המסך בבניין לא ניתן לגלילה) — ככל שיש יותר שורות, מקטינים את הטקסט.
  const todayScale = todayRows.length <= 9 ? 1 : todayRows.length <= 12 ? 0.85 : todayRows.length <= 15 ? 0.72 : 0.6;

  // אותו עיקרון עבור מסך השבוע: לפי היום העמוס ביותר (כדי שכל העמודות יישארו באותו גודל אחיד), כדי שלא יהיה צורך לגלול.
  const maxDayLessons = useMemo(
    () => Math.max(1, ...DAYS.map((day) => lessons.filter((l) => l.dayOfWeek === day).length)),
    [lessons]
  );
  const weekScale =
    maxDayLessons <= 6 ? 1 : maxDayLessons <= 10 ? 0.82 : maxDayLessons <= 14 ? 0.68 : maxDayLessons <= 20 ? 0.56 : 0.46;

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
          <section className="h-full bg-white/80 rounded-2xl p-5 overflow-hidden shadow-md border border-amber-100 flex flex-col">
            <h2 className="text-xl font-bold mb-3 flex items-center gap-2 text-gold-dark shrink-0">
              <CalendarClock size={22} /> היום — {todayDow}
            </h2>
            <div className="flex-1 min-h-0 flex flex-col gap-1.5">
              {todayRows.map((row) => {
                const isBreak = row.label === 'הפסקה';
                const cellLessons = todayLessons.filter((l) => l.time === row.time);
                if (isBreak) {
                  return (
                    <div
                      key={row.time}
                      className="flex-1 min-h-0 flex items-center gap-3 rounded-lg bg-slate-100 border border-slate-200 px-3"
                    >
                      <span
                        className="font-bold text-slate-500 shrink-0 tabular-nums"
                        style={{ fontSize: `${0.95 * todayScale}rem`, width: `${5.5 * todayScale}rem` }}
                      >
                        {row.time}
                      </span>
                      <span className="text-slate-400" style={{ fontSize: `${0.85 * todayScale}rem` }}>
                        הפסקה
                      </span>
                    </div>
                  );
                }
                return (
                  <div key={row.time} className="flex-1 min-h-0 flex items-stretch gap-3">
                    <div
                      className="shrink-0 flex flex-col justify-center border-l-2 border-amber-100 pl-3"
                      style={{ width: `${5.5 * todayScale}rem` }}
                    >
                      <span className="font-black text-gold-dark tabular-nums" style={{ fontSize: `${1.05 * todayScale}rem` }}>
                        {row.time}
                      </span>
                      {row.label && (
                        <span className="text-navy-light/50 truncate" style={{ fontSize: `${0.65 * todayScale}rem` }}>
                          {row.label}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5 overflow-hidden">
                      {cellLessons.map((l) => (
                        <div
                          key={l.id}
                          className={`rounded-lg border overflow-hidden flex-1 min-w-[9rem] ${trackColor(l.track?.[0], trackIds)}`}
                          style={{ padding: `${0.35 * todayScale}rem ${0.6 * todayScale}rem` }}
                        >
                          <div className="font-bold truncate" style={{ fontSize: `${0.95 * todayScale}rem` }}>
                            {l.subject || l.className}
                          </div>
                          <div className="opacity-80 truncate" style={{ fontSize: `${0.7 * todayScale}rem` }}>
                            {l.subject && `כיתה ${l.className} · `}
                            {trackName(l.track) && `${trackName(l.track)} · `}
                            {teacherName(l.teacher)} {l.room ? `· חדר ${l.room}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
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
                    className={`rounded-xl overflow-hidden border flex flex-col ${
                      isToday ? 'bg-gold/10 border-gold' : 'bg-amber-50/50 border-amber-100'
                    }`}
                    style={{ padding: `${0.5 * weekScale}rem` }}
                  >
                    <div
                      className={`font-bold shrink-0 ${isToday ? 'text-gold-dark' : 'text-navy'}`}
                      style={{ fontSize: `${0.875 * weekScale}rem`, marginBottom: `${0.375 * weekScale}rem` }}
                    >
                      {day} {isToday ? '(היום)' : ''}
                    </div>
                    <div className="flex-1 min-h-0 flex flex-col" style={{ gap: `${0.25 * weekScale}rem` }}>
                      {dayLessons.map((l) => (
                        <div
                          key={l.id}
                          className={`leading-tight rounded-md border overflow-hidden ${trackColor(l.track?.[0], trackIds)}`}
                          style={{ fontSize: `${0.7 * weekScale}rem`, padding: `${0.25 * weekScale}rem ${0.375 * weekScale}rem` }}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-semibold truncate">{l.subject || l.className}</span>
                            <span className="opacity-70 shrink-0">{l.time}</span>
                          </div>
                          <div className="opacity-80 truncate">
                            {l.subject && `כיתה ${l.className} · `}
                            {teacherName(l.teacher)} {l.room ? `· חדר ${l.room}` : ''}
                          </div>
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
