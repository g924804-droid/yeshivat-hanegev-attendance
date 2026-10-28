/**
 * שיעור ארוך (למשל שעה וחצי) = כמה שיעורים של 45 דקות, והמורה מסמנת נוכחות לכל אחד בנפרד.
 * מספר החלקים = משך השיעור חלקי 45, מעוגל (שעה = 1, שעה ורבע/שעה וחצי = 2, 4 שעות = 5).
 * הסימון נשמר בעמודה "שעה בשיעור" בטבלת הנוכחות; רשומה בלי ערך נחשבת חלק 1 — כך כל
 * הנוכחות הישנה (מלפני החלוקה) ממשיכה להיספר כרגיל.
 */
export const PERIOD_MINUTES = 45;

/**
 * מאיזה תאריך דורשים סימון לכל חלק — מתחילת אוקטובר 2026, לבקשת ההנהלה, כדי שהמורות ישלימו
 * את החלק השני של השיעורים הכפולים מתחילת החודש. לפני התאריך הזה שיעור כפול סומן פעם אחת בלבד.
 */
export const PERIODS_REQUIRED_FROM = '2026-10-01';

function parseRange(time?: string | null): { start: number; end: number } | null {
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/.exec((time || '').trim());
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  return end > start ? { start, end } : null;
}

export function lessonPeriodCount(time?: string | null): number {
  const r = parseRange(time);
  if (!r) return 1;
  return Math.max(1, Math.round((r.end - r.start) / PERIOD_MINUTES));
}

const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;

/** שעות כל חלק, בחלוקה שווה של זמן השיעור: "9:00-10:30" ← ["9:00-9:45", "9:45-10:30"] */
export function lessonPeriodTimes(time?: string | null): string[] {
  const r = parseRange(time);
  const n = lessonPeriodCount(time);
  if (!r || n === 1) return [time || ''];
  const len = (r.end - r.start) / n;
  return Array.from({ length: n }, (_, i) => `${hhmm(r.start + i * len)}-${hhmm(r.start + (i + 1) * len)}`);
}

/** מספר החלק של רשומת נוכחות (ריק / לא תקין = 1) */
export function recordPeriod(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** כמה חלקים צריך לסמן בתאריך הזה (לפני תאריך ההתחלה — רק אחד, כמו פעם) */
export function requiredPeriods(time: string | null | undefined, date: string): number {
  return date >= PERIODS_REQUIRED_FROM ? lessonPeriodCount(time) : 1;
}
