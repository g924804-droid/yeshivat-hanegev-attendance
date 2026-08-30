import { User } from '@prisma/client';

const DAY_FIELDS = [
  'sundayHours',
  'mondayHours',
  'tuesdayHours',
  'wednesdayHours',
  'thursdayHours',
  'fridayHours',
] as const;

/** שעות נדרשות ליום נתון: sundayHours..fridayHours; אם אף שדה לא מוגדר, fallback ל-dailyRequiredHours (ברירת מחדל 8). */
export function getRequiredHoursForDate(user: User, dateStr: string): number {
  const dayOfWeek = new Date(`${dateStr}T00:00:00`).getDay(); // 0=Sunday..6=Saturday
  if (dayOfWeek === 6) return 0; // שבת

  const anyDayFieldSet = DAY_FIELDS.some((f) => user[f] !== null && user[f] !== undefined);
  if (!anyDayFieldSet) return user.dailyRequiredHours ?? 8;

  const field = DAY_FIELDS[dayOfWeek];
  const value = user[field];
  return value !== null && value !== undefined ? value : user.dailyRequiredHours ?? 8;
}

function parseTime(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** מחשב שעות עבודה כוללות משתי משמרות (HH:MM), מעוגל ל-2 ספרות עשרוניות. */
export function calcTotalHours(
  clockIn?: string | null,
  clockOut?: string | null,
  clockIn2?: string | null,
  clockOut2?: string | null
): number {
  let minutes = 0;
  if (clockIn && clockOut) minutes += Math.max(0, parseTime(clockOut) - parseTime(clockIn));
  if (clockIn2 && clockOut2) minutes += Math.max(0, parseTime(clockOut2) - parseTime(clockIn2));
  return Math.round((minutes / 60) * 100) / 100;
}

export function calcOvertime(totalHours: number, requiredHours: number): number {
  return Math.round(Math.max(0, totalHours - requiredHours) * 100) / 100;
}
