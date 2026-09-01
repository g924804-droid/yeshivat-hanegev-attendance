import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CalendarClock, CalendarDays, Megaphone } from 'lucide-react';
import {
  DOW_HE,
  startMinutes,
  toHebrewDateString,
  getTimeSlotsForDay,
  ALL_TIME_SLOTS,
  lessonColor,
  compareLessonDisplayOrder,
} from '../lib/utils';

/**
 * המסך הפיזי בבניין לא ניתן לגלילה, וכמות השיעורים משתנה מיום ליום — אז במקום לנחש
 * גודל טקסט לפי כמות שורות, מודדים בפועל את הגובה שהתוכן היה תופס בגודל מלא, ומכווצים
 * (transform: scale) בדיוק כמה שצריך כדי שהכל ייכנס בלי גלישה, ולא פחות מזה.
 */
function FitScale({ children, className }: { children: ReactNode; className?: string }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const measure = () => {
      const outerH = outer.clientHeight;
      const innerH = inner.scrollHeight;
      if (outerH > 0 && innerH > 0) {
        const next = Math.min(1, outerH / innerH);
        setScale((prev) => (Math.abs(prev - next) > 0.01 ? next : prev));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(inner);
    ro.observe(outer);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={outerRef} className={className} style={{ overflow: 'hidden' }}>
      <div
        ref={innerRef}
        style={{ transform: `scale(${scale})`, transformOrigin: 'top right', width: scale < 1 ? `${100 / scale}%` : '100%' }}
      >
        {children}
      </div>
    </div>
  );
}

type Lesson = {
  id: string;
  className: string;
  subject?: string;
  dayOfWeek: string;
  time: string;
  track?: string[];
  teacher?: string[];
  room: string;
  notes?: string | null;
};
type Ref = { id: string; name: string };
type Announcement = { id: string; text: string | null; fileName: string | null; fileMime: string | null };

/** תא יום בודד בשורת מסך השבוע — יכול להכיל כמה שיעורים מקבילים (למשל יג/יד באותה שעה). */
function WeekDayCell({
  day,
  row,
  lessons,
  teachers,
  trackIds,
}: {
  day: string;
  row: { time: string; label: string };
  lessons: Lesson[];
  teachers: Ref[];
  trackIds: string[];
}) {
  const cellLessons = lessons
    .filter((l) => l.dayOfWeek === day && l.time === row.time)
    .sort(compareLessonDisplayOrder);
  if (cellLessons.length === 0) return <div />;

  function teacherName(ids?: string[]) {
    return ids?.map((id) => teachers.find((t) => t.id === id)?.name).filter(Boolean).join(', ') || '';
  }

  return (
    <div className="flex flex-col gap-0.5">
      {cellLessons.map((l) => (
        <div
          key={l.id}
          className={`relative text-[10px] leading-tight rounded px-1 py-0.5 overflow-hidden ${lessonColor(l, trackIds)}`}
        >
          {l.notes && (
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500 text-white flex items-center justify-center text-[8px] font-black ring-1 ring-white">
              !
            </span>
          )}
          <div className="font-semibold truncate">{l.subject || l.className}</div>
          <div className="opacity-80 truncate">
            {l.subject && `כיתה ${l.className} · `}
            {teacherName(l.teacher)}
          </div>
          {l.notes && (
            <div className="mt-0.5 inline-flex items-center gap-0.5 rounded-full bg-amber-200 border border-amber-400 text-amber-900 px-1 py-0.5 max-w-full">
              <span className="w-1 h-1 rounded-full bg-red-500 shrink-0" />
              <span className="truncate">{l.notes}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי']; // אין לימודים בימי שישי כרגע
const SCHEDULE_POLL_MS = 15 * 60_000; // מערכת השעות מגיעה מ-Airtable — רבע שעה מספיק ומקל על מכסת הבקשות המשותפת
const ANNOUNCEMENT_POLL_MS = 60_000;
const ANNOUNCEMENT_ROTATE_MS = 60_000; // כל דקה מתחלפת הודעת הטקסט שמוצגת למטה
const SLIDE_ROTATE_MS = 60_000; // כל דקה מתחלף בין היום / השבוע / קבצים שהועלו
const PAGE_RELOAD_MS = 5 * 60_000; // רענון מלא של הדף כל 5 דקות, כדי שעדכונים ייכנסו לתוקף גם בלי גישה פיזית למסך

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
    // המסך הפיזי בכיתה נשאר פתוח ללא גישה — רענון מלא מעת לעת מבטיח שהוא תמיד טוען את
    // הגרסה העדכנית ביותר של הדף (כולל אחרי דיפלוי), בלי שצריך לגשת אליו ידנית.
    const interval = setInterval(() => window.location.reload(), PAGE_RELOAD_MS);
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
    const daySlots = getTimeSlotsForDay(todayDow || '');
    const known = new Set(daySlots.map((s) => s.time));
    const extraTimes = new Set(todayLessons.map((l) => l.time).filter((t) => t && !known.has(t)));
    const all = [...daySlots, ...Array.from(extraTimes).map((time) => ({ time, label: '' }))];
    return all.sort((a, b) => startMinutes(a.time) - startMinutes(b.time));
  }, [todayLessons, todayDow]);
  // ציר שעות משותף למסך השבוע — כמו במסך הניהול, כי ימים שונים (שלישי) יכולים לרוץ על מבנה
  // שעות שונה, וטור שעות אחד באמצע נותן נקודת ייחוס ברורה במקום שכל יום "יזוז" לבד.
  const weekRows = useMemo(() => {
    const known = new Set(ALL_TIME_SLOTS.map((s) => s.time));
    const extraTimes = new Set(lessons.map((l) => l.time).filter((t) => t && !known.has(t)));
    const all = [...ALL_TIME_SLOTS, ...Array.from(extraTimes).map((time) => ({ time, label: '' }))];
    return all.sort((a, b) => startMinutes(a.time) - startMinutes(b.time));
  }, [lessons]);

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
      className="relative h-screen text-navy flex flex-col overflow-hidden"
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

      <header className="relative z-10 flex items-center justify-between px-6 py-1.5 bg-white/70 backdrop-blur-sm shadow-sm">
        <div className="flex items-center gap-2">
          {hasLogo ? (
            <img src="/api/display/logo" alt={siteName} className="h-7 w-7 rounded-lg object-contain bg-white shadow border border-amber-100" />
          ) : (
            <div className="h-7 w-7 rounded-lg bg-gold text-navy flex items-center justify-center text-sm font-black shadow">
              {siteName.trim().charAt(0) || 'נ'}
            </div>
          )}
          <div>
            <h1 className="text-xs font-bold text-navy leading-tight">{siteName}</h1>
            <p className="text-navy-light/70 truncate max-w-md text-[10px] leading-tight">{headerSubtitle}</p>
          </div>
        </div>
        <div className="text-left">
          <div className="text-lg font-black tabular-nums text-navy leading-tight">{timeStr}</div>
          <div className="text-navy-light/70 text-[10px] leading-tight">{dateStr}</div>
          {hebrewDateStr && <div className="text-navy-light/60 text-[10px] leading-tight">{hebrewDateStr}</div>}
        </div>
      </header>

      <main className="relative z-10 flex-1 p-3 overflow-hidden min-h-0">
        {slide.kind === 'today' && (
          <section className="h-full bg-white/80 rounded-2xl p-4 overflow-hidden shadow-md border border-amber-100 flex flex-col">
            <h2 className="text-base font-bold mb-1.5 flex items-center gap-1.5 text-gold-dark shrink-0">
              <CalendarClock size={18} /> היום — {todayDow}
            </h2>
            <FitScale className="flex-1 min-h-0">
              <div className="flex flex-col gap-3">
                {todayRows.map((row) => {
                  const isBreak = row.label === 'הפסקה';
                  const cellLessons = todayLessons.filter((l) => l.time === row.time).sort(compareLessonDisplayOrder);
                  if (isBreak) {
                    return (
                      <div key={row.time} className="flex items-center gap-4 rounded-lg bg-slate-100 border border-slate-200 px-5 py-3">
                        <span className="font-bold text-slate-500 shrink-0 tabular-nums whitespace-nowrap w-48 text-4xl">
                          {row.time}
                        </span>
                        <span className="text-slate-400 text-3xl">הפסקה</span>
                      </div>
                    );
                  }
                  return (
                    <div key={row.time} className="flex items-stretch gap-4">
                      <div className="shrink-0 w-48 flex flex-col justify-center border-l-2 border-amber-100 pl-4">
                        <span className="font-black text-gold-dark tabular-nums whitespace-nowrap text-5xl">{row.time}</span>
                        {row.label && <span className="text-navy-light/50 truncate text-lg">{row.label}</span>}
                      </div>
                      <div className="flex-1 min-w-0 flex flex-wrap items-stretch gap-3">
                        {cellLessons.map((l) => (
                          <div
                            key={l.id}
                            className={`relative rounded-lg border overflow-hidden flex-1 min-w-[12rem] px-5 py-3 ${lessonColor(l, trackIds)}`}
                          >
                            {l.notes && (
                              <span className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-red-500 text-white flex items-center justify-center text-lg font-black shadow ring-2 ring-white animate-pulse">
                                !
                              </span>
                            )}
                            <div className="font-bold truncate text-4xl">{l.subject || l.className}</div>
                            <div className="opacity-80 truncate text-2xl">
                              {l.subject && `כיתה ${l.className} · `}
                              {trackName(l.track) && `${trackName(l.track)} · `}
                              {teacherName(l.teacher)} {l.room ? `· חדר ${l.room}` : ''}
                            </div>
                            {l.notes && (
                              <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-amber-200 border border-amber-400 text-amber-900 px-3 py-1 text-lg font-bold max-w-full">
                                <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                                <span className="truncate">{l.notes}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </FitScale>
            {todayLessons.length === 0 && <p className="text-navy-light/50 text-xl py-16 text-center">אין שיעורים היום</p>}
          </section>
        )}

        {slide.kind === 'week' && (
          <section className="h-full bg-white/80 rounded-2xl p-4 overflow-hidden shadow-md border border-amber-100 flex flex-col">
            <h2 className="text-xl font-bold mb-3 flex items-center gap-2 text-gold-dark shrink-0">
              <CalendarDays size={22} /> השבוע
            </h2>
            {/* טור שעות משותף באמצע (בין שני לשלישי) כנקודת ייחוס — כי יום שלישי רץ על מבנה שעות
                שונה משאר הימים, וכל השורות מיושרות לפי אותו ציר שעות אחד. */}
            <FitScale className="flex-1 min-h-0">
              <div className="flex flex-col gap-1">
                <div className="grid gap-1.5" style={{ gridTemplateColumns: '1fr 1fr 4.5rem 1fr 1fr 1fr' }}>
                  {['ראשון', 'שני'].map((day) => (
                    <div key={day} className={`text-center text-sm font-bold ${day === todayDow ? 'text-gold-dark' : 'text-navy'}`}>
                      {day}
                      {day === todayDow && <span className="block text-[10px] font-normal">(היום)</span>}
                    </div>
                  ))}
                  <div />
                  {['שלישי', 'רביעי', 'חמישי'].map((day) => (
                    <div key={day} className={`text-center text-sm font-bold ${day === todayDow ? 'text-gold-dark' : 'text-navy'}`}>
                      {day}
                      {day === todayDow && <span className="block text-[10px] font-normal">(היום)</span>}
                    </div>
                  ))}
                </div>
                {weekRows.map((row) => {
                  const isBreak = row.label === 'הפסקה';
                  if (isBreak) {
                    return (
                      <div key={row.time} className="flex items-center justify-center gap-2 rounded bg-slate-100 border border-slate-200 py-0.5">
                        <span className="font-bold text-slate-500 text-xs">{row.time}</span>
                        <span className="text-slate-400 text-xs">הפסקה</span>
                      </div>
                    );
                  }
                  return (
                    <div key={row.time} className="grid gap-1.5" style={{ gridTemplateColumns: '1fr 1fr 4.5rem 1fr 1fr 1fr' }}>
                      {['ראשון', 'שני'].map((day) => (
                        <WeekDayCell key={day} day={day} row={row} lessons={lessons} teachers={teachers} trackIds={trackIds} />
                      ))}
                      <div className="flex flex-col items-center justify-center text-center px-0.5">
                        <span className="font-bold text-navy text-[11px] leading-tight">{row.time}</span>
                        {row.label && <span className="text-navy-light/50 text-[9px] leading-tight">{row.label}</span>}
                      </div>
                      {['שלישי', 'רביעי', 'חמישי'].map((day) => (
                        <WeekDayCell key={day} day={day} row={row} lessons={lessons} teachers={teachers} trackIds={trackIds} />
                      ))}
                    </div>
                  );
                })}
              </div>
            </FitScale>
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
