import { prisma } from './prisma';
import { getHoliday } from './holidays';
import { getRequiredHoursForDate } from './hours';
import { User } from '@prisma/client';

export type DayDetail = {
  date: string;
  dayOfWeek: number;
  isSaturday: boolean;
  isFuture: boolean;
  holiday?: { name: string; type: 'full' | 'half' };
  requiredHours: number;
  record: {
    type: string;
    totalHours: number;
    overtimeHours: number;
    lessonsCount: number;
    clockIn: string | null;
    clockOut: string | null;
    clockIn2: string | null;
    clockOut2: string | null;
    notes: string | null;
    sickNoteUrl: string | null;
  } | null;
  isAbsence: boolean;
};

export type MonthlyTotals = {
  totalWorkDays: number;
  totalHours: number;
  totalOvertime: number;
  sickDays: number;
  vacationDays: number;
  totalLessons: number;
  holidayDays: number;
  absenceHours: number;
  absenceDays: number;
};

/** עובר יום-יום על החודש (ליבת calculateMonthlyReport מהספק 4.3). */
export async function buildMonthDetail(employee: User, month: string): Promise<{ days: DayDetail[]; totals: MonthlyTotals }> {
  const [year, monthNum] = month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);

  const records = await prisma.attendanceRecord.findMany({
    where: { employeeId: employee.id, date: { startsWith: month } },
  });
  const recordByDate = new Map(records.map((r) => [r.date, r]));

  const totals: MonthlyTotals = {
    totalWorkDays: 0,
    totalHours: 0,
    totalOvertime: 0,
    sickDays: 0,
    vacationDays: 0,
    totalLessons: 0,
    holidayDays: 0,
    absenceHours: 0,
    absenceDays: 0,
  };
  const days: DayDetail[] = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
    const isSaturday = dayOfWeek === 6;
    const isFuture = date > today;
    const holiday = await getHoliday(date);
    const requiredHours = getRequiredHoursForDate(employee, date);
    const record = recordByDate.get(date) || null;

    let isAbsence = false;

    if (isSaturday || isFuture) {
      // דילוג
    } else if (holiday?.type === 'full') {
      totals.holidayDays += 1;
    } else if (record) {
      if (record.type === 'רגיל' || record.type === 'חצי יום') {
        totals.totalWorkDays += 1;
        totals.totalHours += record.totalHours;
        totals.totalOvertime += record.overtimeHours;
        totals.totalLessons += record.lessonsCount;
      } else if (record.type === 'מחלה') {
        totals.sickDays += 1;
      } else if (record.type === 'חופשה שנתית' || record.type === 'חופשה אישית') {
        totals.vacationDays += 1;
      } else if (record.type === 'חג') {
        totals.holidayDays += 1;
      }
    } else {
      const effectiveRequired = holiday?.type === 'half' ? requiredHours * 0.5 : requiredHours;
      if (effectiveRequired > 0) {
        isAbsence = true;
        totals.absenceDays += holiday?.type === 'half' ? 0.5 : 1;
        totals.absenceHours += effectiveRequired;
      }
    }

    days.push({
      date,
      dayOfWeek,
      isSaturday,
      isFuture,
      holiday: holiday ? { name: holiday.name, type: holiday.type } : undefined,
      requiredHours,
      record: record
        ? {
            type: record.type,
            totalHours: record.totalHours,
            overtimeHours: record.overtimeHours,
            lessonsCount: record.lessonsCount,
            clockIn: record.clockIn,
            clockOut: record.clockOut,
            clockIn2: record.clockIn2,
            clockOut2: record.clockOut2,
            notes: record.notes,
            sickNoteUrl: record.sickNoteUrl,
          }
        : null,
      isAbsence,
    });
  }

  totals.totalHours = Math.round(totals.totalHours * 100) / 100;
  totals.totalOvertime = Math.round(totals.totalOvertime * 100) / 100;
  totals.absenceHours = Math.round(totals.absenceHours * 100) / 100;

  return { days, totals };
}
