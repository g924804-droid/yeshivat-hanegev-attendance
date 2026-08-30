import { airtableFetch, TABLES } from './airtable';
import { FIELDS } from './airtableFields';

/** נתוני מערכת השעות המלאה — משמש גם את מסך הניהול (מאובטח) וגם את מסך התצוגה הציבורי. */
export async function getFullSchedule() {
  const [lessons, teachers, tracks] = await Promise.all([
    airtableFetch(TABLES.lessons),
    airtableFetch(TABLES.teachers),
    airtableFetch(TABLES.tracks),
  ]);

  const teacherList = teachers.map((t) => ({ id: t.id, name: t.fields[FIELDS.teachers.name] }));
  const trackList = tracks.map((t) => ({ id: t.id, name: t.fields[FIELDS.tracks.name] }));

  return {
    lessons: lessons.map((l) => ({
      id: l.id,
      className: l.fields[FIELDS.lessons.className],
      dayOfWeek: l.fields[FIELDS.lessons.dayOfWeek],
      time: l.fields[FIELDS.lessons.time],
      track: l.fields[FIELDS.lessons.track] as string[] | undefined,
      teacher: l.fields[FIELDS.lessons.teacher] as string[] | undefined,
      room: l.fields[FIELDS.lessons.room],
      year: l.fields[FIELDS.lessons.year],
      notes: l.fields[FIELDS.lessons.notes],
    })),
    teachers: teacherList,
    tracks: trackList,
  };
}
