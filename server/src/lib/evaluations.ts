import { prisma } from './prisma';
import { airtableFetch, TABLES } from './airtable';
import { FIELDS } from './airtableFields';
import { getTeacherStudentIds } from './teacherScope';

/**
 * הערכה כללית — המורה כותבת במילים הערכה לכל תלמידה שלה (התלמידות של המסלולים שהיא מלמדת בהם,
 * אותו כלל כמו במסך הציונים). בחודש שנקבע (SiteSettings.evaluationMonth) אי אפשר להגיש את דוח
 * הנוכחות של אותו חודש בלי הערכה לכל התלמידות.
 */
export async function getEvaluationMonth(): Promise<string | null> {
  const s = await prisma.siteSettings.findUnique({ where: { id: 'singleton' }, select: { evaluationMonth: true } });
  return s?.evaluationMonth || null;
}

export type EvalStudent = { id: string; name: string; tracks: string[] };

/** התלמידות של המורה, ממוינות לפי מסלול ושם */
export async function teacherStudents(teacherName: string): Promise<EvalStudent[]> {
  const ids = await getTeacherStudentIds(teacherName);
  if (!ids.size) return [];
  const [students, tracks] = await Promise.all([airtableFetch(TABLES.students), airtableFetch(TABLES.tracks)]);
  const trackName = new Map(tracks.map((t) => [t.id, String(t.fields[FIELDS.tracks.name] || '')]));
  return students
    .filter((s) => ids.has(s.id))
    .map((s) => ({
      id: s.id,
      name: String(s.fields[FIELDS.students.name] || '').trim(),
      tracks: ((s.fields[FIELDS.students.track] || []) as string[]).map((t) => trackName.get(t) || '').filter(Boolean),
    }))
    .sort((a, b) => (a.tracks[0] || '').localeCompare(b.tracks[0] || '', 'he') || a.name.localeCompare(b.name, 'he'));
}

/**
 * כמה תלמידות חסרה להן הערכה — לחסימת הגשת הדוח. 0 כשההערכה לא נדרשת בחודש הזה או שאין למורה תלמידות.
 */
export async function missingEvaluationsCount(employee: { id: string; name: string }, month: string): Promise<number> {
  if ((await getEvaluationMonth()) !== month) return 0;
  const ids = await getTeacherStudentIds(employee.name);
  if (!ids.size) return 0;
  const done = await prisma.studentEvaluation.findMany({
    where: { month, teacherId: employee.id, studentId: { in: [...ids] } },
    select: { studentId: true },
  });
  return ids.size - new Set(done.map((d) => d.studentId)).size;
}
