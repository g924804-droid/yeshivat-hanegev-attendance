import { airtableFetch, TABLES } from './airtable';
import { FIELDS } from './airtableFields';
import { getFullSchedule } from './scheduleData';
import { lessonsForDate } from './scheduleRules';

type RequiredSlot = { date: string; time: string; trackId: string; lessonId: string };

/**
 * לפי מערכת השעות: לכל יום בחודש שהמורה לימדה בו (יום בשבוע תואם), את/ה המסלול והשיעור שלימדה בו.
 * לפי המערכת בפועל באותו תאריך — שיעור קבוע שהוחלף זמנית (למשל בכנס) לא דורש נוכחות תלמידות.
 */
async function getRequiredAttendanceSlots(teacherName: string, month: string): Promise<RequiredSlot[]> {
  const teacherRecords = await airtableFetch(TABLES.teachers, {
    filterByFormula: `{${FIELDS.teachers.name}} = "${teacherName}"`,
  });
  const teacherId = teacherRecords[0]?.id;
  if (!teacherId) return [];

  const { lessons } = await getFullSchedule();
  if (!lessons.some((l) => (l.teacher || []).includes(teacherId))) return [];

  const [year, monthNum] = month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);

  const slots: RequiredSlot[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    if (date > today) continue; // לא דורשים נוכחות לימים עתידיים
    for (const lesson of lessonsForDate(lessons, date)) {
      if (!(lesson.teacher || []).includes(teacherId)) continue;
      const trackIds = lesson.track || [];
      const time = lesson.time || '';
      trackIds.forEach((trackId) => slots.push({ date, time, trackId, lessonId: lesson.id }));
    }
  }

  const seen = new Set<string>();
  return slots.filter((s) => {
    const key = `${s.date}|${s.trackId}|${s.lessonId}`;
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
  const allStudents = await airtableFetch(TABLES.students);
  const trackStudents = new Map<string, Set<string>>();
  for (const trackId of trackIds) {
    const ids = allStudents
      .filter((s) => (s.fields[FIELDS.students.track] || []).includes(trackId))
      .map((s) => s.id);
    trackStudents.set(trackId, new Set(ids));
  }

  const attendance = await airtableFetch(TABLES.attendance, {
    filterByFormula: `FIND("${month}", {${FIELDS.attendance.date}})`,
  });

  const covered = new Set<string>(); // `${date}|${trackId}`
  for (const rec of attendance) {
    const date = rec.fields[FIELDS.attendance.date];
    const studentIds: string[] = rec.fields[FIELDS.attendance.student] || [];
    for (const [trackId, studentSet] of trackStudents) {
      if (studentIds.some((sid) => studentSet.has(sid))) covered.add(`${date}|${trackId}`);
    }
  }

  return slots
    .filter((slot) => !covered.has(`${slot.date}|${slot.trackId}`))
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
