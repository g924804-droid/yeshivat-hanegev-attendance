import { airtableFetch, airtableBatchUpdate, airtableBatchDelete, TABLES, AirtableRecord } from './airtable';
import { FIELDS } from './airtableFields';
import { getFullSchedule } from './scheduleData';
import { lessonsForDate } from './scheduleRules';
import { getHoliday } from './holidays';
import { hebrewDate } from './hebrewDate';
import { makeLessonNamer } from './studentAttendanceReport';

const DOW_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** הרישומים שנוצרו ברצף אחד (עד 2 דקות בין רישום לרישום) — כך מסמנים שיעור אחד של מסלול. */
const BATCH_GAP_MS = 2 * 60 * 1000;

export type UnassignedBatch = {
  key: string;
  date: string;
  hebDate: string;
  dayOfWeek: string;
  markedAt: string; // שעת הסימון (שעון ישראל)
  trackName: string;
  recordIds: string[];
  present: number;
  absentNames: string[];
  lateNames: string[];
  /** אותו יום ואותו מסלול כבר סומן בסימון אחר — כנראה סימון חוזר */
  duplicateOfEarlier: boolean;
  lessonOptions: { id: string; name: string; time: string }[];
};

export type MissingLesson = {
  date: string;
  hebDate: string;
  dayOfWeek: string;
  trackId: string;
  trackName: string;
  lessonId: string;
  lessonName: string;
  time: string;
  teacher: string;
};

function israelTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * מה צריך תיקון בנוכחות התלמידות בטווח:
 *
 * 1. סימונים בלי שיוך לשיעור (בעיקר מתחילת השנה) — מקובצים לפי "רצף סימון": רישומים שנוצרו
 *    ברצף, באותו תאריך ובאותו חשבון. רצף כזה הוא סימון של שיעור אחד במסלול אחד (המסלול
 *    המשותף לכל הבנות ברצף). את כל הרצף אפשר לשייך לשיעור, או למחוק אם הוא סימון כפול.
 * 2. שיעורים שהתקיימו לפי המערכת ולא נרשמה בהם נוכחות בכלל.
 */
export async function getAttendanceIssues(from: string, to: string) {
  const [studentsRaw, attendanceRaw, schedule] = await Promise.all([
    airtableFetch(TABLES.students),
    airtableFetch(TABLES.attendance, {
      filterByFormula: `AND({${FIELDS.attendance.date}}, NOT(IS_BEFORE({${FIELDS.attendance.date}}, "${from}")), NOT(IS_AFTER({${FIELDS.attendance.date}}, "${to}")))`,
    }),
    getFullSchedule(),
  ]);
  const { lessonName, teacherNames } = makeLessonNamer(schedule);
  const trackNameById = new Map(schedule.tracks.map((t) => [t.id, String(t.name || '').trim()]));
  const lessonIds = new Set(schedule.lessons.map((l) => l.id));
  const studentById = new Map(studentsRaw.map((s) => [s.id, s]));
  const studentOf = (r: AirtableRecord): string => (r.fields[FIELDS.attendance.student] || [])[0];
  const studentName = (id: string) => String(studentById.get(id)?.fields[FIELDS.students.name] || '').trim();
  const studentTracks = (id: string): string[] => studentById.get(id)?.fields[FIELDS.students.track] || [];
  const teacherKey = (r: AirtableRecord) => [...(r.fields[FIELDS.attendance.teacher] || [])].sort().join(',');
  const linkedLesson = (r: AirtableRecord): string | undefined => {
    const id = (r.fields[FIELDS.attendance.lesson] || [])[0];
    return id && lessonIds.has(id) ? id : undefined;
  };

  // --- 1. סימונים בלי שיעור ---
  const unlinked = attendanceRaw
    .filter((r) => studentOf(r) && r.fields[FIELDS.attendance.status] && !linkedLesson(r))
    .sort((a, b) => (a.createdTime || '').localeCompare(b.createdTime || ''));
  const groups: AirtableRecord[][] = [];
  let cur: AirtableRecord[] = [];
  for (const r of unlinked) {
    const prev = cur[cur.length - 1];
    if (
      prev &&
      (prev.fields[FIELDS.attendance.date] !== r.fields[FIELDS.attendance.date] ||
        teacherKey(prev) !== teacherKey(r) ||
        Date.parse(r.createdTime || '') - Date.parse(prev.createdTime || '') > BATCH_GAP_MS ||
        cur.some((x) => studentOf(x) === studentOf(r)))
    ) {
      groups.push(cur);
      cur = [];
    }
    cur.push(r);
  }
  if (cur.length) groups.push(cur);

  const seenDayTrack = new Set<string>();
  const batches: UnassignedBatch[] = groups.map((g) => {
    const date: string = g[0].fields[FIELDS.attendance.date];
    const dayOfWeek = DOW_HE[new Date(`${date}T12:00:00`).getDay()];
    const common = g.reduce<string[]>((acc, r, i) => {
      const t = studentTracks(studentOf(r));
      return i === 0 ? [...t] : acc.filter((x) => t.includes(x));
    }, []);
    const trackId = common.length === 1 ? common[0] : null;
    const candidateTracks = trackId ? [trackId] : Array.from(new Set(g.flatMap((r) => studentTracks(studentOf(r)))));
    // השיעורים של המסלול באותו יום בשבוע. בלי לסנן לפי "מתאריך" — מערכת השעות של תחילת השנה
    // הוחלפה, והשיעורים הקבועים נשארו באותן משבצות.
    const lessonOptions = schedule.lessons
      .filter((l) => !l.toDate && l.dayOfWeek === dayOfWeek && (l.track || []).some((t) => candidateTracks.includes(t)))
      .sort((a, b) => (a.time || '').localeCompare(b.time || '', undefined, { numeric: true }))
      .map((l) => ({
        id: l.id,
        name: `${lessonName(l)}${trackId ? '' : ` (${(l.track || []).map((t) => trackNameById.get(t)).join(', ')})`}`,
        time: l.time || '',
      }));
    const dayTrackKey = `${date}|${trackId || g.map(studentOf).sort().join(',')}`;
    const duplicateOfEarlier = seenDayTrack.has(dayTrackKey);
    seenDayTrack.add(dayTrackKey);
    const names = (status: string) =>
      g.filter((r) => r.fields[FIELDS.attendance.status] === status).map((r) => studentName(studentOf(r))).sort((a, b) => a.localeCompare(b, 'he'));
    return {
      key: g[0].id,
      date,
      hebDate: hebrewDate(date),
      dayOfWeek,
      markedAt: israelTime(g[0].createdTime || ''),
      trackName: trackId ? trackNameById.get(trackId) || '' : 'מסלול לא ברור',
      recordIds: g.map((r) => r.id),
      present: g.filter((r) => r.fields[FIELDS.attendance.status] === 'Present').length,
      absentNames: names('Absent'),
      lateNames: names('Late'),
      duplicateOfEarlier,
      lessonOptions,
    };
  });

  // --- 2. שיעורים בלי נוכחות ---
  const covered = new Set<string>(); // `${date}|${lessonId}`
  for (const r of attendanceRaw) {
    const lessonId = linkedLesson(r);
    if (lessonId) covered.add(`${r.fields[FIELDS.attendance.date]}|${lessonId}`);
  }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const missing: MissingLesson[] = [];
  for (const date of datesBetween(from, to < today ? to : today)) {
    const holiday = await getHoliday(date).catch(() => undefined);
    if (holiday?.type === 'full') continue;
    for (const l of lessonsForDate(schedule.lessons, date)) {
      if (covered.has(`${date}|${l.id}`)) continue;
      for (const trackId of l.track || []) {
        missing.push({
          date,
          hebDate: hebrewDate(date),
          dayOfWeek: DOW_HE[new Date(`${date}T12:00:00`).getDay()],
          trackId,
          trackName: trackNameById.get(trackId) || '',
          lessonId: l.id,
          lessonName: lessonName(l),
          time: l.time || '',
          teacher: teacherNames(l),
        });
      }
    }
  }
  missing.sort(
    (a, b) => b.date.localeCompare(a.date) || a.time.localeCompare(b.time, undefined, { numeric: true }) || a.trackName.localeCompare(b.trackName, 'he')
  );

  return { batches, missing };
}

/** שיוך רצף סימונים לשיעור. */
export async function assignRecordsToLesson(recordIds: string[], lessonId: string): Promise<void> {
  await airtableBatchUpdate(
    TABLES.attendance,
    recordIds.map((id) => ({ id, fields: { [FIELDS.attendance.lesson]: [lessonId] } }))
  );
}

/** מחיקת רצף סימונים (סימון כפול). */
export async function deleteAttendanceRecords(recordIds: string[]): Promise<void> {
  await airtableBatchDelete(TABLES.attendance, recordIds);
}
