import { prisma } from './prisma';
import { LessonGroup, teacherLessonGroupsResolver } from './teacherScope';

/**
 * הערכה כללית — המורה כותבת במילים הערכה אחת לכל תלמידה שלה. התלמידות מוצגות לפי השיעורים שהמורה
 * מלמדת (מקצוע × מסלול במערכת השעות, בלי שיעורים שנסגרו); תלמידה שנמצאת בכמה שיעורים של אותה מורה —
 * הערכה אחת (בקשת המשתמשת). בחודש שנקבע (SiteSettings.evaluationMonth) אי אפשר להגיש את דוח
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
 * מי מנהלת את ההערכה (הפעלה, מייל, מעקב, קריאת ההערכות, אקסל) — רק פנינה רוזנברג (בקשת המשתמשת:
 * "לא פתוח לכל אחד"; גם לא למנהלות אחרות ולא לרכזות עם הרשאת "כל המסלולים").
 */
const EVALUATION_ADMIN_IDS = ['cmtfg2j7k00003afrjbso3bgi'];
export const isEvaluationAdmin = (user: { id: string }) => EVALUATION_ADMIN_IDS.includes(user.id);

/** כל התלמידות (בלי כפילויות) מתוך השיעורים של המורה */
export function uniqueStudents(groups: LessonGroup[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const g of groups) for (const s of g.students) m.set(s.id, s.name);
  return m;
}

/** השיעורים של מורה אחת והתלמידות בהם */
export async function teacherLessonGroups(teacherName: string): Promise<LessonGroup[]> {
  return (await teacherLessonGroupsResolver())(teacherName);
}

/**
 * כמה תלמידות חסרה להן הערכה — לחסימת הגשת הדוח. 0 כשההערכה לא נדרשת בחודש הזה או שאין למורה תלמידות.
 */
export async function missingEvaluationsCount(employee: { id: string; name: string; role: string }, month: string): Promise<number> {
  if ((await getEvaluationMonth()) !== month) return 0;
  if (!(await isEvaluationRequired(employee))) return 0;
  const ids = uniqueStudents(await teacherLessonGroups(employee.name));
  if (!ids.size) return 0;
  const done = await prisma.studentEvaluation.findMany({
    where: { month, teacherId: employee.id, studentId: { in: [...ids.keys()] } },
    select: { studentId: true },
  });
  return ids.size - new Set(done.map((d) => d.studentId)).size;
}
