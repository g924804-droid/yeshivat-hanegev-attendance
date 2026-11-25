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

/** מורות שהוצאו מרשימת המייל — פטורות מההערכה */
export async function getEvaluationExempt(): Promise<Set<string>> {
  const s = await prisma.siteSettings.findUnique({ where: { id: 'singleton' }, select: { evaluationExempt: true } });
  try {
    const ids = JSON.parse(s?.evaluationExempt || '[]');
    return new Set(Array.isArray(ids) ? ids.map(String) : []);
  } catch {
    return new Set();
  }
}

/** מי שנבחרו ברשימת המייל (כולל עובדות שמלמדות) — רק הן חייבות. null = עוד לא נשלח מייל */
export async function getEvaluationRequired(): Promise<Set<string> | null> {
  const s = await prisma.siteSettings.findUnique({ where: { id: 'singleton' }, select: { evaluationRequired: true } });
  if (!s?.evaluationRequired) return null;
  try {
    const ids = JSON.parse(s.evaluationRequired);
    return Array.isArray(ids) ? new Set(ids.map(String)) : null;
  } catch {
    return null;
  }
}

/** האם העובדת חייבת בהערכה: לפי רשימת המייל, ובלעדיה — כל מי שתפקידה "מורה" ולא הוצאה */
export async function isEvaluationRequired(employee: { id: string; role: string }): Promise<boolean> {
  const required = await getEvaluationRequired();
  if (required) return required.has(employee.id);
  return employee.role === 'מורה' && !(await getEvaluationExempt()).has(employee.id);
}

/**
 * מי מנהלת את ההערכה (הפעלה, מייל, מעקב, קריאת ההערכות) — רק מיכל פיינהנדלר, רכזת לימודי התמחות
 * (בקשת המשתמשת: "רק אני רוצה לראות את זה"). לא לפי הרשאות כלליות — יש מנהלות ומורות עם
 * "כל המסלולים" שלא אמורות לראות את זה.
 */
const EVALUATION_ADMIN_IDS = ['cmtg9k8ep00038fuyud5kc70v'];
export const isEvaluationAdmin = (user: { id: string }) => EVALUATION_ADMIN_IDS.includes(user.id);

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
export async function missingEvaluationsCount(employee: { id: string; name: string; role: string }, month: string): Promise<number> {
  if ((await getEvaluationMonth()) !== month) return 0;
  if (!(await isEvaluationRequired(employee))) return 0;
  const ids = await getTeacherStudentIds(employee.name);
  if (!ids.size) return 0;
  const done = await prisma.studentEvaluation.findMany({
    where: { month, teacherId: employee.id, studentId: { in: [...ids] } },
    select: { studentId: true },
  });
  return ids.size - new Set(done.map((d) => d.studentId)).size;
}
