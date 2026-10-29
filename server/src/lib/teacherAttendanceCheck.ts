import { airtableFetch, TABLES } from './airtable';
import { FIELDS } from './airtableFields';
import { getFullSchedule } from './scheduleData';
import { lessonsForDate } from './scheduleRules';
import { getCancelledKeys } from './lessonCancellations';
import { requiredPeriods, lessonPeriodTimes, recordPeriod } from './lessonPeriods';
import { findTeacherIds } from './teacherScope';

/** period/periods — בשיעור כפול (שעה וחצי וכו') כל 45 דק' הן שיבוץ נפרד שצריך סימון משלו */
type RequiredSlot = { date: string; time: string; trackId: string; lessonId: string; period: number; periods: number };

/**
 * לפי מערכת השעות: לכל יום בחודש שהמורה לימדה בו (יום בשבוע תואם), את/ה המסלול והשיעור שלימדה בו.
 * לפי המערכת בפועל באותו תאריך — שיעור קבוע שהוחלף זמנית (למשל בכנס) לא דורש נוכחות תלמידות.
 */
async function getRequiredAttendanceSlots(teacherName: string, month: string): Promise<RequiredSlot[]> {
  // אותה התאמת שמות כמו בשאר המערכת — במערכת השעות השמות כתובים "המורה X", ולכן השוואה
  // מדויקת (שהייתה כאן) תפסה רק 2 מורות מתוך 30, ולשאר הבדיקה פשוט לא רצה
  const teacherIds = await findTeacherIds(teacherName);
  if (!teacherIds.length) return [];
  const isMine = (lesson: { teacher?: string[] }) => (lesson.teacher || []).some((id) => teacherIds.includes(id));

  const { lessons } = await getFullSchedule();
  if (!lessons.some(isMine)) return [];

  const [year, monthNum] = month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);

  // שיעור שבוטל (המורה לא הגיעה וכו') — לא דורשים עליו נוכחות
  const cancelled = await getCancelledKeys(`${month}-01`, `${month}-31`);

  const slots: RequiredSlot[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    if (date > today) continue; // לא דורשים נוכחות לימים עתידיים
    for (const lesson of lessonsForDate(lessons, date)) {
      if (!isMine(lesson)) continue;
      if (cancelled.has(`${date}|${lesson.id}`)) continue;
      const trackIds = lesson.track || [];
      const periods = requiredPeriods(lesson.time, date);
      const times = periods > 1 ? lessonPeriodTimes(lesson.time) : [lesson.time || ''];
      for (let period = 1; period <= periods; period++) {
        trackIds.forEach((trackId) =>
          slots.push({ date, time: times[period - 1] || lesson.time || '', trackId, lessonId: lesson.id, period, periods })
        );
      }
    }
  }

  const seen = new Set<string>();
  return slots.filter((s) => {
    const key = `${s.date}|${s.trackId}|${s.lessonId}|${s.period}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** אותו חישוב, אבל מחזיר את הפרטים המלאים (תאריך+שעה+מסלול+שיעור) של כל שיבוץ חסר —
 * למסך "נוכחות תלמידות" שרוצה להראות למורה בדיוק לאן לקפוץ, לא רק אילו תאריכים. */
export async function getMissingAttendanceSlots(
  teacherName: string,
  month: string
): Promise<RequiredSlot[]> {
  const slots = await getRequiredAttendanceSlots(teacherName, month);
  if (slots.length === 0) return [];

  const trackIds = [...new Set(slots.map((s) => s.trackId))];
  // שדה "תלמידות" בטבלת המסלולים הוא טקסט מחושב, לא שדה מקושר אמיתי (ולפעמים חסר לגמרי) —
  // אותו תיקון שכבר נעשה ב-students.ts וב-teacherScope.ts: מקור האמת הוא שדה "מסלולים" של
  // כל תלמידה בעצמה, לא ההפך.
  const [allStudents, attendance] = await Promise.all([
    airtableFetch(TABLES.students),
    airtableFetch(TABLES.attendance, {
      filterByFormula: `FIND("${month}", {${FIELDS.attendance.date}})`,
      fields: [FIELDS.attendance.date, FIELDS.attendance.student, FIELDS.attendance.lesson, FIELDS.attendance.period],
    }),
  ]);
  const trackStudents = new Map<string, Set<string>>();
  for (const trackId of trackIds) {
    const ids = allStudents
      .filter((s) => (s.fields[FIELDS.students.track] || []).includes(trackId))
      .map((s) => s.id);
    trackStudents.set(trackId, new Set(ids));
  }


  const covered = new Set<string>(); // `${date}|${trackId}` — חלק 1 / שיעור רגיל, כמו תמיד
  const coveredPeriod = new Set<string>(); // `${date}|${lessonId}|${period}` — חלקים 2+ של שיעור כפול
  for (const rec of attendance) {
    const date = rec.fields[FIELDS.attendance.date];
    const studentIds: string[] = rec.fields[FIELDS.attendance.student] || [];
    const period = recordPeriod(rec.fields[FIELDS.attendance.period]);
    for (const lessonId of rec.fields[FIELDS.attendance.lesson] || []) coveredPeriod.add(`${date}|${lessonId}|${period}`);
    if (period > 1) continue;
    for (const [trackId, studentSet] of trackStudents) {
      if (studentIds.some((sid) => studentSet.has(sid))) covered.add(`${date}|${trackId}`);
    }
  }

  return slots
    .filter((slot) =>
      slot.period === 1
        ? !covered.has(`${slot.date}|${slot.trackId}`)
        : !coveredPeriod.has(`${slot.date}|${slot.lessonId}|${slot.period}`)
    )
    .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
}

/** תאריכים בחודש (עד היום) שבהם למורה יש שיעורים לפי מערכת השעות בפועל. */
export async function getTeachingDates(teacherName: string, month: string): Promise<string[]> {
  const slots = await getRequiredAttendanceSlots(teacherName, month);
  return Array.from(new Set(slots.map((s) => s.date))).sort();
}

/** תאריכים בחודש שבהם המורה לימדה (לפי מערכת השעות) אך עדיין לא סומנה נוכחות לתלמידות המסלול שלה. */
export async function getMissingStudentAttendanceDates(teacherName: string, month: string): Promise<string[]> {
  const missing = await getMissingAttendanceSlots(teacherName, month);
  return Array.from(new Set(missing.map((s) => s.date))).sort();
}
