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

/** מזהי התלמידות ששייכות למסלולים של מורה נתונה. */
export async function getTeacherStudentIds(teacherName: string): Promise<Set<string>> {
  const trackIds = await getTeacherTrackIds(teacherName);
  if (trackIds.size === 0) return new Set();

  const tracks = await airtableFetch(TABLES.tracks, {
    filterByFormula: `OR(${Array.from(trackIds).map((id) => `RECORD_ID()="${id}"`).join(',')})`,
  });
  const studentIds = new Set<string>();
  for (const t of tracks) {
    const ids: string[] = t.fields[FIELDS.tracks.students] || [];
    ids.forEach((id) => studentIds.add(id));
  }
  return studentIds;
}
