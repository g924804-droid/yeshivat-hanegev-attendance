import { airtableFetch, TABLES } from './airtable';
import { FIELDS } from './airtableFields';
import { prisma } from './prisma';

/**
 * מנהל, מי שיש לה הרשאת ניהול נוכחות עובדים (isAttendanceManager), או מי שקיבלה במפורש
 * הרשאה נפרדת לראות את כל המסלולים (canManageAllStudentTracks) — למשל מזכירה שממלאת
 * נוכחות תלמידות/ציונים אבל לא אמורה לקבל גישה לניהול דוחות נוכחות של מורות/עובדים.
 * משותף בין נוכחות תלמידות וציונים — שתי המסכים צריכים בדיוק את אותו כלל "מי רואה הכל".
 */
export function canSeeAllStudentTracks(user: {
  role: string;
  isAttendanceManager: boolean;
  canManageAllStudentTracks: boolean;
}): boolean {
  return user.role === 'מנהל' || user.isAttendanceManager || user.canManageAllStudentTracks;
}

/**
 * שמות מורות ב-Airtable כתובים לא אחיד — לפעמים עם תואר ("המורה"/"הרבנית"/"הרב"), לפעמים עם
 * רווחים מיותרים בהתחלה/בסוף. השוואה מדויקת (===) נכשלת על כל זה, ומורה יכולה "להיעלם" ולא
 * לראות אף מסלול שלה בלי סיבה נראית לעין. מנקים לפני ההשוואה, ומתאימים גם התאמה חלקית.
 */
function normalizeTeacherName(s: string): string {
  return (s || '')
    .trim()
    .replace(/^(המורה|הרבנית|הרב)\s+/, '')
    .trim();
}

/**
 * מילים של שם, בלי הבדלי כתיב מלא/חסר: יו"ד ווי"ו לא נספרות בהשוואה — "זגדון" = "זיגדון",
 * "טוייטו" = "טויטו". (ההתאמה דורשת לפחות 2 מילים, כך שזה לא מבלבל בין מורות שונות.)
 */
function nameWords(s: string): string[] {
  return s
    .replace(/[-–־'"׳״]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/[יו]/g, ''))
    .filter(Boolean);
}

/**
 * כל המילים של השם הקצר מופיעות בשם הארוך — למשל במערכת השעות "אפרת דיין" ובמערכת
 * "אפרת טויטו דיין" (שם נעורים + שם נישואין). לפחות 2 מילים, כדי ששם פרטי לבד לא יתאים.
 */
function wordsSubset(a: string, b: string): boolean {
  const [short, long] = [nameWords(a), nameWords(b)].sort((x, y) => x.length - y.length);
  return short.length >= 2 && short.every((w) => long.includes(w));
}

/** מזהי המורות (ברשומת Airtable) שהשם שלהן תואם, במדויק או חלקית אחרי ניקוי תארים/רווחים. */
export async function findTeacherIds(teacherName: string): Promise<string[]> {
  const target = normalizeTeacherName(teacherName);
  if (!target) return [];
  const [allTeachers, linked] = await Promise.all([airtableFetch(TABLES.teachers), linkedTeacherIds(teacherName)]);
  const byName = allTeachers
    .filter((t) => {
      const raw = normalizeTeacherName(t.fields[FIELDS.teachers.name] || '');
      // רשומת מורה עם שם של אות או שתיים (יש אחת כזו: "ה") הייתה "מתאימה" לכל שם שמכיל אותה
      if (raw.length < 3) return false;
      return raw === target || raw.includes(target) || target.includes(raw) || wordsSubset(raw, target);
    })
    .map((t) => t.id);
  // קישורים ידניים (מסך "קישור מורות") — כשהשם במערכת השעות שונה מהשם של העובדת
  return [...new Set([...byName, ...linked])];
}

/** רשומות מורה שקושרו ידנית לעובדת עם השם הזה (TeacherLink) */
async function linkedTeacherIds(userName: string): Promise<string[]> {
  try {
    const users = await prisma.user.findMany({ where: { name: userName }, select: { id: true } });
    if (!users.length) return [];
    const links = await prisma.teacherLink.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { teacherId: true } });
    return links.map((l) => l.teacherId);
  } catch {
    return []; // תקלה ב-DB לא מפילה את התאמת השמות הרגילה
  }
}

/** מזהי המסלולים שמורה אחראית עליהם, לפי lessons→tracks (Airtable). */
export async function getTeacherTrackIds(teacherName: string): Promise<Set<string>> {
  const teacherIds = await findTeacherIds(teacherName);
  const trackIds = new Set<string>();
  if (teacherIds.length === 0) return trackIds;

  const lessons = await airtableFetch(TABLES.lessons);
  for (const lesson of lessons) {
    const teacherLinks: string[] = lesson.fields[FIELDS.lessons.teacher] || [];
    if (teacherLinks.some((id) => teacherIds.includes(id))) {
      const trackLinks: string[] = lesson.fields[FIELDS.lessons.track] || [];
      trackLinks.forEach((t) => trackIds.add(t));
    }
  }
  return trackIds;
}

/**
 * מזהי התלמידות ששייכות למסלולים של מורה נתונה. שדה "תלמידות" בטבלת המסלולים הוא טקסט
 * מחושב, לא שדה מקושר אמיתי (ולפעמים חסר לגמרי) — מקור האמת האמין הוא ההפך: כל תלמידה
 * מחזיקה בעצמה את רשימת המסלולים שלה. אותו תיקון שכבר נעשה ב-students.ts.
 */
export async function getTeacherStudentIds(teacherName: string): Promise<Set<string>> {
  const trackIds = await getTeacherTrackIds(teacherName);
  if (trackIds.size === 0) return new Set();

  const allStudents = await airtableFetch(TABLES.students);
  const studentIds = new Set<string>();
  for (const s of allStudents) {
    const studentTracks: string[] = s.fields[FIELDS.students.track] || [];
    if (studentTracks.some((t) => trackIds.has(t))) studentIds.add(s.id);
  }
  return studentIds;
}
