import { airtableFetch, TABLES } from './airtable';
import { FIELDS } from './airtableFields';

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

  const teacherList = teachers.map((t) => ({ id: t.id, name: t.fields[FIELDS.teachers.name] }));
  const trackList = tracks.map((t) => ({ id: t.id, name: t.fields[FIELDS.tracks.name] }));

  return {
    lessons: lessons.map((l) => ({
      id: l.id,
      className: l.fields[FIELDS.lessons.className],
      subject: l.fields[FIELDS.lessons.subject],
      dayOfWeek: l.fields[FIELDS.lessons.dayOfWeek],
      time: l.fields[FIELDS.lessons.time],
      track: l.fields[FIELDS.lessons.track] as string[] | undefined,
      teacher: l.fields[FIELDS.lessons.teacher] as string[] | undefined,
      room: l.fields[FIELDS.lessons.room],
      year: l.fields[FIELDS.lessons.year],
      notes: l.fields[FIELDS.lessons.notes],
      fromDate: l.fields[FIELDS.lessons.fromDate],
      toDate: l.fields[FIELDS.lessons.toDate],
    })),
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
