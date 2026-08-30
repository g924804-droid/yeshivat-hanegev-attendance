import { airtableFetch, TABLES } from './airtable';
import { FIELDS } from './airtableFields';

/** מזהי המסלולים שמורה אחראית עליהם, לפי lessons→tracks (Airtable). */
export async function getTeacherTrackIds(teacherName: string): Promise<Set<string>> {
  const teacherRecords = await airtableFetch(TABLES.teachers, {
    filterByFormula: `{${FIELDS.teachers.name}} = "${teacherName}"`,
  });
  const teacherId = teacherRecords[0]?.id;
  const trackIds = new Set<string>();
  if (!teacherId) return trackIds;

  const lessons = await airtableFetch(TABLES.lessons);
  for (const lesson of lessons) {
    const teacherLinks: string[] = lesson.fields[FIELDS.lessons.teacher] || [];
    if (teacherLinks.includes(teacherId)) {
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
