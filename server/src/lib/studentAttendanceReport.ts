import ExcelJS from 'exceljs';
import { airtableFetch, TABLES, AirtableRecord } from './airtable';
import { FIELDS } from './airtableFields';
import { getFullSchedule } from './scheduleData';

/** אחוז ההיעדרויות המקסימלי המותר בשנה (חיסורים, ואיחורים אם נספרים). */
export const ABSENCE_LIMIT_PCT = 20;

const UNKNOWN_CATEGORY = 'לא ידוע';

type Counts = { total: number; present: number; absent: number; late: number; missed: number; pct: number };

/** קטגוריה = המסלול שבו התקיים השיעור: קודש (י"ג/י"ד) או המסלול המקצועי של התלמידה. */
export type CategoryRow = Counts & { category: string };
export type AbsenceEvent = { date: string; category: string; subject: string; status: 'חסרה' | 'איחור'; notes: string };
export type StudentSummary = Counts & {
  id: string;
  name: string;
  className: string;
  tracks: string[];
  overLimit: boolean;
  categories: CategoryRow[];
  events: AbsenceEvent[];
};

export type AttendanceSummary = {
  from: string;
  to: string;
  trackName: string | null;
  lateCounts: boolean;
  limitPct: number;
  students: StudentSummary[];
  records: { date: string; student: string; category: string; subject: string; teacher: string; status: string; notes: string }[];
};

function count(statuses: string[], lateCounts: boolean): Counts {
  const present = statuses.filter((s) => s === 'Present').length;
  const absent = statuses.filter((s) => s === 'Absent').length;
  const late = statuses.filter((s) => s === 'Late').length;
  const total = present + absent + late;
  const missed = absent + (lateCounts ? late : 0);
  return { total, present, absent, late, missed, pct: total ? Math.round((missed / total) * 1000) / 10 : 0 };
}

/** הרישומים שנוצרו ברצף אחד (עד 2 דקות בין רישום לרישום) — כך מסמנים מסלול שלם. */
const BATCH_GAP_MS = 2 * 60 * 1000;

/**
 * לכל רישום נוכחות — באיזה מסלול (קטגוריה) הוא היה.
 *
 * רישום שמקושר לשיעור: המסלול של השיעור.
 *
 * רישומים ישנים (בעיקר מספטמבר) נשמרו בלי קישור לשיעור, ומערכת השעות של אז כבר הוחלפה. אבל
 * נוכחות תמיד מסומנת מתוך מסך של מסלול אחד, תלמידה אחרי תלמידה (או "סמן הכל") — אז רישומים
 * שנוצרו ברצף באותו תאריך שייכים לאותו מסלול: המסלול היחיד שמשותף לכל התלמידות ברצף. למשל
 * רצף של בנות מסולם, אדריכלות ועיצוב שכולן ב"קודש י"ד" — שייך לקודש י"ד.
 * רצף קצר שלא מכריע (תלמידה בודדת) — לפי סוג המסלול (קודש/מקצועי) שאותה מורה סימנה באותו יום.
 */
function resolveCategories(
  records: AirtableRecord[],
  studentTracks: (id: string) => string[],
  lessonTracks: Map<string, string[]>,
  isKodesh: (trackId: string) => boolean
): Map<string, string | null> {
  const result = new Map<string, string | null>();
  const studentOf = (r: AirtableRecord): string => (r.fields[FIELDS.attendance.student] || [])[0];
  const teacherKey = (r: AirtableRecord) => [...(r.fields[FIELDS.attendance.teacher] || [])].sort().join(',');

  const unlinked: AirtableRecord[] = [];
  for (const r of records) {
    const lessonId = (r.fields[FIELDS.attendance.lesson] || [])[0];
    const tracks = lessonId ? lessonTracks.get(lessonId) || [] : [];
    if (!tracks.length) {
      unlinked.push(r);
      continue;
    }
    const mine = studentTracks(studentOf(r));
    result.set(r.id, tracks.find((t) => mine.includes(t)) || tracks[0]);
  }

  // רצפים: אותו תאריך, אותה מורה, פער קטן בזמן היצירה, ובלי אותה תלמידה פעמיים
  unlinked.sort((a, b) => (a.createdTime || '').localeCompare(b.createdTime || ''));
  const batches: AirtableRecord[][] = [];
  let batch: AirtableRecord[] = [];
  for (const r of unlinked) {
    const prev = batch[batch.length - 1];
    const breaks =
      prev &&
      (prev.fields[FIELDS.attendance.date] !== r.fields[FIELDS.attendance.date] ||
        teacherKey(prev) !== teacherKey(r) ||
        Date.parse(r.createdTime || '') - Date.parse(prev.createdTime || '') > BATCH_GAP_MS ||
        batch.some((x) => studentOf(x) === studentOf(r)));
    if (breaks) {
      batches.push(batch);
      batch = [];
    }
    batch.push(r);
  }
  if (batch.length) batches.push(batch);

  // סוג המסלול (קודש/מקצועי) שהוכרע לכל מורה בכל יום — לרצפים שלא הוכרעו
  const kindByTeacherDay = new Map<string, Set<boolean>>();
  const undecided: AirtableRecord[][] = [];
  for (const b of batches) {
    const common = b.reduce<string[]>((acc, r, i) => {
      const tracks = studentTracks(studentOf(r));
      return i === 0 ? tracks : acc.filter((t) => tracks.includes(t));
    }, []);
    if (common.length === 1) {
      b.forEach((r) => result.set(r.id, common[0]));
      const key = `${b[0].fields[FIELDS.attendance.date]}|${teacherKey(b[0])}`;
      kindByTeacherDay.set(key, (kindByTeacherDay.get(key) || new Set()).add(isKodesh(common[0])));
    } else {
      undecided.push(b);
    }
  }
  for (const b of undecided) {
    const kinds = kindByTeacherDay.get(`${b[0].fields[FIELDS.attendance.date]}|${teacherKey(b[0])}`);
    for (const r of b) {
      const tracks = studentTracks(studentOf(r));
      const match = kinds?.size === 1 ? tracks.filter((t) => isKodesh(t) === [...kinds][0]) : [];
      result.set(r.id, match.length === 1 ? match[0] : null);
    }
  }
  return result;
}

/**
 * סיכום נוכחות לכל תלמידה בטווח תאריכים, כולל חלוקה לקודש ולמסלול המקצועי.
 *
 * הבסיס הוא השיעורים שבהם נרשמה נוכחות בפועל (לא מה שהיה אמור להתקיים לפי המערכת) — כך שיעור
 * שבוטל או שהמורה לא סימנה בו לא נספר כחיסור של התלמידה.
 */
export async function buildAttendanceSummary(opts: {
  from: string;
  to: string;
  trackId?: string;
  lateCounts: boolean;
}): Promise<AttendanceSummary> {
  const { from, to, trackId, lateCounts } = opts;
  const [studentsRaw, attendanceRaw, schedule] = await Promise.all([
    airtableFetch(TABLES.students),
    airtableFetch(TABLES.attendance, {
      filterByFormula: `AND({${FIELDS.attendance.date}}, NOT(IS_BEFORE({${FIELDS.attendance.date}}, "${from}")), NOT(IS_AFTER({${FIELDS.attendance.date}}, "${to}")))`,
    }),
    getFullSchedule(),
  ]);

  const trackNameById = new Map(schedule.tracks.map((t) => [t.id, String(t.name || '').trim()]));
  const teacherNameById = new Map(schedule.teachers.map((t) => [t.id, String(t.name || '').trim()]));
  const lessonById = new Map(schedule.lessons.map((l) => [l.id, l]));
  const studentById = new Map(studentsRaw.map((s) => [s.id, s]));
  const studentTracks = (id: string): string[] => studentById.get(id)?.fields[FIELDS.students.track] || [];
  const isKodesh = (id: string) => (trackNameById.get(id) || '').startsWith('קודש');

  const valid = attendanceRaw.filter(
    (r) => (r.fields[FIELDS.attendance.student] || [])[0] && r.fields[FIELDS.attendance.status]
  );
  const categoryOf = resolveCategories(
    valid,
    studentTracks,
    new Map(schedule.lessons.map((l) => [l.id, l.track || []])),
    isKodesh
  );

  type Rec = {
    date: string;
    studentId: string;
    categoryId: string | null;
    subject: string;
    teacher: string;
    status: string;
    notes: string;
  };
  const records: Rec[] = [];
  for (const rec of valid) {
    const categoryId = categoryOf.get(rec.id) || null;
    if (trackId && categoryId !== trackId) continue;
    const lesson = lessonById.get((rec.fields[FIELDS.attendance.lesson] || [])[0]);
    const teacherIds: string[] = lesson?.teacher?.length ? lesson.teacher : rec.fields[FIELDS.attendance.teacher] || [];
    records.push({
      date: rec.fields[FIELDS.attendance.date],
      studentId: rec.fields[FIELDS.attendance.student][0],
      categoryId,
      subject: lesson ? lesson.subject?.trim() || '' : '',
      // "ה"/"דוגמא" הם חשבונות כלליים ולא שמות מורות — לא מציגים אותם
      teacher: teacherIds
        .map((id) => teacherNameById.get(id) || '')
        .filter((n) => n.length > 1 && n !== 'דוגמא')
        .join(', '),
      status: rec.fields[FIELDS.attendance.status],
      notes: [rec.fields[FIELDS.attendance.notes], rec.fields['סיבת העדרות']].filter(Boolean).join(' · '),
    });
  }
  records.sort((a, b) => a.date.localeCompare(b.date));

  const categoryName = (id: string | null) => (id ? trackNameById.get(id) || UNKNOWN_CATEGORY : UNKNOWN_CATEGORY);
  // קודש קודם, אחריו המסלול המקצועי, ו"לא ידוע" בסוף
  const categoryRank = (id: string | null) => (!id ? 2 : isKodesh(id) ? 0 : 1);

  // התלמידות בדוח: מי שיש לה רישומים בטווח, וגם תלמידות המסלול שנבחר (כדי שגם בלי רישומים יופיעו)
  const ids = new Set(records.map((r) => r.studentId));
  if (trackId) studentsRaw.filter((s) => studentTracks(s.id).includes(trackId)).forEach((s) => ids.add(s.id));

  const students: StudentSummary[] = Array.from(ids).map((id) => {
    const s = studentById.get(id);
    const mine = records.filter((r) => r.studentId === id);
    const byCategory = new Map<string | null, Rec[]>();
    for (const r of mine) byCategory.set(r.categoryId, [...(byCategory.get(r.categoryId) || []), r]);
    const categories = Array.from(byCategory.entries())
      .sort(([a], [b]) => categoryRank(a) - categoryRank(b))
      .map(([cid, rs]) => ({ category: categoryName(cid), ...count(rs.map((r) => r.status), lateCounts) }));
    const totals = count(mine.map((r) => r.status), lateCounts);
    return {
      id,
      name: String(s?.fields[FIELDS.students.name] || 'תלמידה לא ידועה').trim(),
      className: String(s?.fields[FIELDS.students.className] || ''),
      tracks: [...studentTracks(id)]
        .sort((a, b) => categoryRank(a) - categoryRank(b))
        .map((t) => trackNameById.get(t) || '')
        .filter(Boolean),
      ...totals,
      overLimit: totals.pct > ABSENCE_LIMIT_PCT,
      categories,
      events: mine
        .filter((r) => r.status === 'Absent' || r.status === 'Late')
        .map((r) => ({
          date: r.date,
          category: categoryName(r.categoryId),
          subject: r.subject,
          status: r.status === 'Absent' ? 'חסרה' : 'איחור',
          notes: r.notes,
        })),
    };
  });
  students.sort((a, b) => a.name.localeCompare(b.name, 'he'));

  const nameById = new Map(students.map((s) => [s.id, s.name]));
  const statusHe: Record<string, string> = { Present: 'נוכחת', Absent: 'חסרה', Late: 'איחור' };
  return {
    from,
    to,
    trackName: trackId ? trackNameById.get(trackId) || null : null,
    lateCounts,
    limitPct: ABSENCE_LIMIT_PCT,
    students,
    records: records.map((r) => ({
      date: r.date,
      student: nameById.get(r.studentId) || '',
      category: categoryName(r.categoryId),
      subject: r.subject,
      teacher: r.teacher,
      status: statusHe[r.status] || r.status,
      notes: r.notes,
    })),
  };
}

function heDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function styleSheet(ws: ExcelJS.Worksheet) {
  ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFF1C40F' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.height = 30;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

const RED_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };

/** אקסל: סיכום לכל תלמידה, פירוט לפי קודש/מסלול, וכל הרישומים בטווח. */
export async function buildAttendanceExcel(summary: AttendanceSummary): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const missedHeader = summary.lateCounts ? 'סה"כ היעדרויות (חיסור+איחור)' : 'סה"כ היעדרויות (חיסורים)';
  const countColumns = [
    { header: 'שיעורים שנרשמו', key: 'total', width: 12 },
    { header: 'נוכחת', key: 'present', width: 9 },
    { header: 'חסרה', key: 'absent', width: 9 },
    { header: 'איחור', key: 'late', width: 9 },
    { header: missedHeader, key: 'missed', width: 16 },
    { header: 'אחוז היעדרות', key: 'pct', width: 12 },
  ];

  const ws = wb.addWorksheet('סיכום לפי תלמידה');
  ws.columns = [
    { header: 'שם התלמידה', key: 'name', width: 22 },
    { header: 'מסלולים', key: 'tracks', width: 34 },
    ...countColumns,
    { header: `מעל ${summary.limitPct}%`, key: 'over', width: 10 },
  ];
  for (const s of summary.students) {
    const row = ws.addRow({ ...s, tracks: s.tracks.join(', '), pct: s.pct / 100, over: s.overLimit ? 'כן' : '' });
    row.getCell('pct').numFmt = '0.0%';
    if (s.overLimit) {
      row.fill = RED_FILL;
      row.getCell('over').font = { bold: true, color: { argb: 'FFB91C1C' } };
    }
  }
  styleSheet(ws);

  const cs = wb.addWorksheet('קודש ומסלול');
  cs.columns = [
    { header: 'שם התלמידה', key: 'name', width: 22 },
    { header: 'קטגוריה', key: 'category', width: 26 },
    ...countColumns,
  ];
  for (const s of summary.students) {
    for (const c of s.categories) {
      const row = cs.addRow({ name: s.name, ...c, pct: c.pct / 100 });
      row.getCell('pct').numFmt = '0.0%';
      if (c.pct > summary.limitPct) row.fill = RED_FILL;
    }
  }
  styleSheet(cs);

  const rs = wb.addWorksheet('כל הרישומים');
  rs.columns = [
    { header: 'תאריך', key: 'date', width: 12 },
    { header: 'שם התלמידה', key: 'student', width: 22 },
    { header: 'קטגוריה', key: 'category', width: 24 },
    { header: 'מקצוע', key: 'subject', width: 24 },
    { header: 'מורה', key: 'teacher', width: 20 },
    { header: 'סטטוס', key: 'status', width: 10 },
    { header: 'הערות', key: 'notes', width: 30 },
  ];
  for (const r of summary.records) {
    const row = rs.addRow({ ...r, date: heDate(r.date) });
    if (r.status === 'חסרה') row.getCell('status').font = { bold: true, color: { argb: 'FFB91C1C' } };
    if (r.status === 'איחור') row.getCell('status').font = { bold: true, color: { argb: 'FFB45309' } };
  }
  styleSheet(rs);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
