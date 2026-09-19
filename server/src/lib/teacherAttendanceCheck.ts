import { airtableFetch, TABLES } from './airtable';
import { FIELDS } from './airtableFields';

const DOW_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

type RequiredSlot = { date: string; trackId: string };

/** שיעורים ישנים בלי מתאריך/עד-תאריך נחשבים תקפים תמיד — התאריכים נוספו רק בהמשך (כמו ב-students.ts). */
function lessonAppliesOnDate(l: { fromDate?: string | null; toDate?: string | null }, date: string): boolean {
  if (l.fromDate && date < l.fromDate) return false;
  if (l.toDate && date > l.toDate) return false;
  return true;
}

/** לפי מערכת השעות: לכל יום בחודש שהמורה לימדה בו (יום בשבוע תואם), את/ה המסלול שלימדה בו. */
async function getRequiredAttendanceSlots(teacherName: string, month: string): Promise<RequiredSlot[]> {
  const teacherRecords = await airtableFetch(TABLES.teachers, {
    filterByFormula: `{${FIELDS.teachers.name}} = "${teacherName}"`,
  });
  const teacherId = teacherRecords[0]?.id;
  if (!teacherId) return [];

  const lessons = await airtableFetch(TABLES.lessons);
  const myLessons = lessons.filter((l) => (l.fields[FIELDS.lessons.teacher] || []).includes(teacherId));
  if (myLessons.length === 0) return [];

  const [year, monthNum] = month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);

  const slots: RequiredSlot[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    if (date > today) continue; // לא דורשים נוכחות לימים עתידיים
    const dow = DOW_HE[new Date(`${date}T00:00:00`).getDay()];
    for (const lesson of myLessons) {
      if (lesson.fields[FIELDS.lessons.dayOfWeek] !== dow) continue;
      if (
        !lessonAppliesOnDate(
          { fromDate: lesson.fields[FIELDS.lessons.fromDate], toDate: lesson.fields[FIELDS.lessons.toDate] },
          date
        )
      ) {
        continue;
      }
      const trackIds: string[] = lesson.fields[FIELDS.lessons.track] || [];
      trackIds.forEach((trackId) => slots.push({ date, trackId }));
    }
  }

  const seen = new Set<string>();
  return slots.filter((s) => {
    const key = `${s.date}|${s.trackId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** תאריכים בחודש שבהם המורה לימדה (לפי מערכת השעות) אך עדיין לא סומנה נוכחות לתלמידות המסלול שלה. */
export async function getMissingStudentAttendanceDates(teacherName: string, month: string): Promise<string[]> {
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

  const missingDates = new Set<string>();
  for (const slot of slots) {
    if (!covered.has(`${slot.date}|${slot.trackId}`)) missingDates.add(slot.date);
  }
  return Array.from(missingDates).sort();
}
