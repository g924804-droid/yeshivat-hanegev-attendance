import { airtableFetch, TABLES } from './airtable';
import { FIELDS } from './airtableFields';
import { getFullSchedule } from './scheduleData';
import { lessonsForDate } from './scheduleRules';
import { getCancelledKeys } from './lessonCancellations';
import { requiredPeriods, lessonPeriodTimes, recordPeriod } from './lessonPeriods';
import { findTeacherIds } from './teacherScope';
import { prisma } from './prisma';

/**
 * תמונת מצב: לכל מורה (עם "מעקב שיעורים") — כמה שיבוצים היו בטווח התאריכים לפי מערכת השעות בפועל,
 * כמה מהם כבר יש עליהם נוכחות תלמידות, ואילו חסרים. אותו חישוב כמו בבדיקה שלפני הגשת הדוח
 * (teacherAttendanceCheck), אבל לכל המורות בבת אחת — שליפה אחת של הנוכחות לכל הטווח.
 */

export type SnapshotSlot = { date: string; time: string; track: string; period: number; periods: number };
export type TeacherSnapshot = { id: string; name: string; required: number; filled: number; missing: SnapshotSlot[] };

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end && out.length < 400) {
    if (d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const israelToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

export async function getAttendanceSnapshot(from: string, rawTo: string): Promise<{ from: string; to: string; teachers: TeacherSnapshot[] }> {
  // לא דורשים נוכחות לימים עתידיים
  const today = israelToday();
  const to = rawTo > today ? today : rawTo;
  if (to < from) return { from, to, teachers: [] };

  const [{ lessons, tracks }, cancelled, employees, allStudents, attendance] = await Promise.all([
    getFullSchedule(),
    getCancelledKeys(from, to),
    prisma.user.findMany({ where: { isActive: true, role: 'מורה', trackLessons: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    airtableFetch(TABLES.students),
    airtableFetch(TABLES.attendance, {
      filterByFormula: `AND(NOT(IS_BEFORE({${FIELDS.attendance.date}}, '${from}')), NOT(IS_AFTER({${FIELDS.attendance.date}}, '${to}')))`,
      fields: [FIELDS.attendance.date, FIELDS.attendance.student, FIELDS.attendance.lesson, FIELDS.attendance.period],
    }),
  ]);
  const trackName = new Map(tracks.map((t: any) => [t.id, String(t.name || '')]));
  const dates = datesBetween(from, to);
  const lessonsByDate = new Map(dates.map((d) => [d, lessonsForDate(lessons, d)]));

  // תלמידות בכל מסלול (מקור האמת: שדה "מסלולים" של כל תלמידה)
  const trackStudents = new Map<string, Set<string>>();
  for (const s of allStudents) {
    for (const trackId of (s.fields[FIELDS.students.track] as string[] | undefined) || []) {
      if (!trackStudents.has(trackId)) trackStudents.set(trackId, new Set());
      trackStudents.get(trackId)!.add(s.id);
    }
  }
  // מה כבר מכוסה: חלק 1 / שיעור רגיל — לפי תאריך+מסלול; חלקים 2+ של שיעור כפול — לפי תאריך+שיעור+חלק
  const covered = new Set<string>();
  const coveredPeriod = new Set<string>();
  for (const rec of attendance) {
    const date = rec.fields[FIELDS.attendance.date];
    const studentIds: string[] = rec.fields[FIELDS.attendance.student] || [];
    const period = recordPeriod(rec.fields[FIELDS.attendance.period]);
    for (const lessonId of rec.fields[FIELDS.attendance.lesson] || []) coveredPeriod.add(`${date}|${lessonId}|${period}`);
    if (period > 1) continue;
    for (const sid of studentIds) for (const [trackId, set] of trackStudents) if (set.has(sid)) covered.add(`${date}|${trackId}`);
  }

  const teachers: TeacherSnapshot[] = [];
  for (const emp of employees) {
    const teacherIds = await findTeacherIds(emp.name);
    if (!teacherIds.length) continue;
    const isMine = (l: { teacher?: string[] }) => (l.teacher || []).some((id) => teacherIds.includes(id));
    const seen = new Set<string>();
    let required = 0;
    const missing: SnapshotSlot[] = [];
    for (const date of dates) {
      for (const lesson of lessonsByDate.get(date) || []) {
        if (!isMine(lesson) || cancelled.has(`${date}|${lesson.id}`)) continue;
        const periods = requiredPeriods(lesson.time, date);
        const times = periods > 1 ? lessonPeriodTimes(lesson.time) : [lesson.time || ''];
        for (let period = 1; period <= periods; period++) {
          for (const trackId of lesson.track || []) {
            const key = `${date}|${trackId}|${lesson.id}|${period}`;
            if (seen.has(key)) continue;
            seen.add(key);
            required++;
            const ok = period === 1 ? covered.has(`${date}|${trackId}`) : coveredPeriod.has(`${date}|${lesson.id}|${period}`);
            if (!ok) missing.push({ date, time: times[period - 1] || lesson.time || '', track: trackName.get(trackId) || '', period, periods });
          }
        }
      }
    }
    if (!required) continue;
    missing.sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
    teachers.push({ id: emp.id, name: emp.name.trim(), required, filled: required - missing.length, missing });
  }
  // הכי הרבה חסרים — למעלה
  teachers.sort((a, b) => b.missing.length - a.missing.length || a.name.localeCompare(b.name, 'he'));
  return { from, to, teachers };
}
