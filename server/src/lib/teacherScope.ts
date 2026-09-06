import { airtableFetch, TABLES } from './airtable';
import { FIELDS } from './airtableFields';

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

/** מזהי המורות (ברשומת Airtable) שהשם שלהן תואם, במדויק או חלקית אחרי ניקוי תארים/רווחים. */
export async function findTeacherIds(teacherName: string): Promise<string[]> {
  const target = normalizeTeacherName(teacherName);
  if (!target) return [];
  const allTeachers = await airtableFetch(TABLES.teachers);
  return allTeachers
    .filter((t) => {
      const raw = normalizeTeacherName(t.fields[FIELDS.teachers.name] || '');
      return raw && (raw === target || raw.includes(target) || target.includes(raw));
    })
    .map((t) => t.id);
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
 * מזהי התלמידות ששייכות למסלולים של מורה נתונה. שדה "תלמידות" בטבלת המסلولים הוא טקסט
 * מחושב, לא שדה מקושר אמיתי (ולפעמים חסר לגמרי) — מקור האמת האמין הוא ההפך: כל תלמידה
 * מחזיקה בעצמה את רשימת המסلولים שלה. אותו תיקון שכבר נעשה ב-students.ts.
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
