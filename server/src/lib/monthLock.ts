import { prisma } from './prisma';

/**
 * נעילת חודש: ב-1 לחודש החודש הקודם ננעל — עובדת לא יכולה עוד להוסיף/לשנות/למחוק ימי נוכחות,
 * להגיש דוח או להעלות קבלה עבורו. רק מנהלת (פנינה רוזנברג / עדינה דראי) יכולה לפתוח את החודש
 * לעובדת מסוימת (MonthUnlock), ומנהלת עצמה לא ננעלת.
 *
 * הנעילה חלה מנובמבר 2026 (ננעל ב-1.12.2026) — חודשים קודמים נשארים פתוחים כמו שהיו.
 */
export const LOCK_FROM_MONTH = '2026-11';

export const LOCK_MESSAGE_CONTACT = 'לפתיחה יש לפנות לפנינה רוזנברג או לעדינה דראי';

/** החודש הנוכחי לפי שעון ישראל — YYYY-MM */
export function currentMonthIL(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }).slice(0, 7);
}

/** האם החודש עבר וננעל (בלי להתחשב בפתיחה לעובדת מסוימת) */
export function isMonthClosed(month: string): boolean {
  return /^\d{4}-\d{2}$/.test(month) && month >= LOCK_FROM_MONTH && month < currentMonthIL();
}

/** רק מנהלות יכולות לפתוח נעילה — ולכן גם לא ננעלות בעצמן */
export function canUnlockMonths(user: { role?: string | null } | undefined): boolean {
  return user?.role === 'מנהל';
}

/** האם החודש נעול לעובדת הזו (נעול ולא נפתח לה) */
export async function isMonthLockedFor(employeeId: string, month: string): Promise<boolean> {
  if (!isMonthClosed(month)) return false;
  const unlock = await prisma.monthUnlock.findUnique({ where: { employeeId_month: { employeeId, month } } });
  return !unlock;
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
}

/** הודעת שגיאה אם הפעולה חסומה בגלל נעילה, אחרת null */
export async function monthLockError(user: { role?: string | null } | undefined, employeeId: string, monthOrDate: string): Promise<string | null> {
  if (canUnlockMonths(user)) return null;
  const month = String(monthOrDate || '').slice(0, 7);
  if (!(await isMonthLockedFor(employeeId, month))) return null;
  return `חודש ${monthLabel(month)} ננעל ב-1 לחודש — לא ניתן עוד לשלוח נוכחות וקבלות עבורו. ${LOCK_MESSAGE_CONTACT}.`;
}
