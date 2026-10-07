import { airtableFetch, TABLES } from './airtable';
import { FIELDS } from './airtableFields';

/** שדות שיעור גולמיים מ-Airtable → אובייקט שיעור. משמש גם לגרסאות ישנות שנשמרו בהיסטוריה (previousData). */
export function parseLessonFields(id: string, f: Record<string, any>) {
  return {
    id,
    className: f[FIELDS.lessons.className] as string | undefined,
    subject: f[FIELDS.lessons.subject] as string | undefined,
    dayOfWeek: f[FIELDS.lessons.dayOfWeek] as string,
    time: f[FIELDS.lessons.time] as string,
    track: f[FIELDS.lessons.track] as string[] | undefined,
    teacher: f[FIELDS.lessons.teacher] as string[] | undefined,
    room: f[FIELDS.lessons.room] as string | undefined,
    year: f[FIELDS.lessons.year] as string | undefined,
    notes: f[FIELDS.lessons.notes] as string | undefined,
    fromDate: f[FIELDS.lessons.fromDate] as string | undefined,
    toDate: f[FIELDS.lessons.toDate] as string | undefined,
  };
}
export type ParsedLesson = ReturnType<typeof parseLessonFields>;

type ScheduleData = Awaited<ReturnType<typeof fetchFullSchedule>>;

/**
 * מסך התצוגה בישיבה דולק כל הזמן ומרענן את מערכת השעות שוב ושוב — בלי קאש, כל
 * רענון כזה שולח 3 בקשות ל-Airtable, ובמקביל לכניסת עובד/ת למערכת זה יכול לחצות
 * את מכסת ה-5 בקשות/שנייה של Airtable ולגרום ל-429. שומרים את התוצאה לזמן קצר
 * כדי שריבוי בקשות (ממסך התצוגה, מסך הניהול, כמה משתמשים בו-זמנית) ישתמשו
 * באותה תוצאה במקום לפנות ל-Airtable בכל פעם מחדש.
 */
const CACHE_TTL_MS = 30_000;
let cache: { data: ScheduleData; expiresAt: number } | null = null;
let inFlight: Promise<ScheduleData> | null = null;

async function fetchFullSchedule() {
  const [lessons, teachers, tracks] = await Promise.all([
    airtableFetch(TABLES.lessons),
    airtableFetch(TABLES.teachers),
    airtableFetch(TABLES.tracks),
  ]);

  // סדר א'-ב' — ברשימת Airtable הגולמית המורות מופיעות בסדר הוספה, מה שמקשה למצוא מורה
  // ברשימת הצ'קבוקסים הארוכה בטופס השיעור. כמעט כל השמות מתחילים ב"המורה" — ממיינים לפי מה
  // שאחריו, אחרת כולן נדחסות יחד תחת ה' והסדר לא עוזר למצוא.
  const sortKey = (name: unknown) => String(name || '').replace(/^\s*ה?מורה\s*[:\-]?\s*/, '');
  const teacherList = teachers
    .map((t) => ({ id: t.id, name: t.fields[FIELDS.teachers.name] }))
    .sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name), 'he'));
  const trackList = tracks.map((t) => ({ id: t.id, name: t.fields[FIELDS.tracks.name] }));

  return {
    lessons: lessons.map((l) => parseLessonFields(l.id, l.fields)),
    teachers: teacherList,
    tracks: trackList,
  };
}

/** נתוני מערכת השעות המלאה — משמש גם את מסך הניהול (מאובטח) וגם את מסך התצוגה הציבורי. */
export async function getFullSchedule(): Promise<ScheduleData> {
  if (cache && cache.expiresAt > Date.now()) return cache.data;
  if (inFlight) return inFlight;

  inFlight = fetchFullSchedule();
  try {
    const data = await inFlight;
    cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    return data;
  } finally {
    inFlight = null;
  }
}

/** לקרוא אחרי עדכון/יצירת שיעור, כדי שמסך הניהול יראה מיד את השינוי ולא יחכה לתפוגת הקאש. */
export function invalidateScheduleCache() {
  cache = null;
}
