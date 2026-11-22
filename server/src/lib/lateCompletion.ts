import { LateCompletion } from '@prisma/client';
import { prisma } from './prisma';

/**
 * השלמת חודש קודם: מורה ששכחה למלא חודש שכבר ננעל (למשל אוקטובר) ממלאת את הימים בטופס בתוך
 * החודש הנוכחי. החודש הנעול לא נפתח ולא משתנה — ההשלמה נשמרת כאן, "מצורפת" לדוח של החודש שבו
 * נשלחה (inMonth), ומופיעה בדוח ובסיכום של אותו חודש. היא לא נכללת בסה"כ של החודש — משולמת כהפרשים.
 */
export type LateDay = {
  date: string;
  clockIn: string;
  clockOut: string;
  clockIn2: string;
  clockOut2: string;
  hours: number;
  lessons: number;
  notes: string;
};

export const LATE_STATUS = { pending: 'ממתין', approved: 'אושר', rejected: 'נדחה' } as const;

export function monthLabelHe(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
}

export const lateDays = (c: LateCompletion): LateDay[] => (Array.isArray(c.days) ? (c.days as unknown as LateDay[]) : []);

/** ההשלמות שצורפו לדוח של העובדת בחודש הזה (בלי שנדחו) */
export function completionsForReport(employeeId: string, month: string) {
  return prisma.lateCompletion.findMany({
    where: { employeeId, inMonth: month, status: { not: LATE_STATUS.rejected } },
    orderBy: { forMonth: 'asc' },
  });
}

/** לכל העובדות — ההשלמות שצורפו לחודש (בלי שנדחו), לסיכום */
export async function completionsByEmployee(month: string): Promise<Map<string, LateCompletion[]>> {
  const list = await prisma.lateCompletion.findMany({
    where: { inMonth: month, status: { not: LATE_STATUS.rejected } },
    orderBy: { forMonth: 'asc' },
  });
  const m = new Map<string, LateCompletion[]>();
  for (const c of list) m.set(c.employeeId, [...(m.get(c.employeeId) || []), c]);
  return m;
}
