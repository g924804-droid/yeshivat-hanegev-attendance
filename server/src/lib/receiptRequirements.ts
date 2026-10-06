import { User } from '@prisma/client';
import { prisma } from './prisma';
import { getMissingStudentAttendanceDates, getTeachingDates } from './teacherAttendanceCheck';

function shortDates(dates: string[]): string {
  return dates.map((d) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`).join(', ');
}

/**
 * מורה "נגד קבלה" שמסומנת "מעקב שיעורים" מקבלת תשלום לפי הקבלה — לכן לפני שהיא מגישה קבלה
 * לחודש, הנוכחות שלה וגם נוכחות התלמידות בשיעורים שלה חייבות להיות מלאות לאותו חודש, כדי שלא
 * תשולם קבלה על שיעורים שלא דווחו.
 *
 * "נוכחות שלה מלאה" = לכל יום (עד היום) שבו יש לה שיעור במערכת השעות, יש רשומת נוכחות כלשהי
 * (כניסה/יציאה, מחלה, חופשה). לא לפי שעות נדרשות ליום — למורות נגד קבלה הן לרוב לא מוגדרות.
 *
 * מחזיר הודעת שגיאה למשתמשת, או null אם אפשר להגיש.
 */
export async function getReceiptBlocker(employee: User, month: string): Promise<string | null> {
  if (employee.employmentType !== 'נגד קבלה' || !employee.trackLessons) return null;

  let teachingDates: string[];
  let missingStudentDates: string[];
  try {
    [teachingDates, missingStudentDates] = await Promise.all([
      getTeachingDates(employee.name, month),
      getMissingStudentAttendanceDates(employee.name, month),
    ]);
  } catch {
    // אם Airtable לא זמין — לא חוסמים, כדי לא לנעול משתמשות כשהאינטגרציה לא זמינה (כמו בשאר הבדיקות).
    return null;
  }

  const records = await prisma.attendanceRecord.findMany({
    where: { employeeId: employee.id, date: { startsWith: month } },
    select: { date: true },
  });
  const recordedDates = new Set(records.map((r) => r.date));
  const missingOwnDates = teachingDates.filter((d) => !recordedDates.has(d));

  const problems: string[] = [];
  if (missingOwnDates.length) problems.push(`נוכחות שלך לתאריכים: ${shortDates(missingOwnDates)}`);
  if (missingStudentDates.length) problems.push(`נוכחות תלמידות לתאריכים: ${shortDates(missingStudentDates)}`);
  return problems.length ? `לפני הגשת קבלה לחודש ${month} יש להשלים — ${problems.join('; ')}` : null;
}
