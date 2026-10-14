import ExcelJS from 'exceljs';
import { airtableFetch, TABLES } from './airtable';
import { FIELDS } from './airtableFields';
import { getFullSchedule, ParsedLesson } from './scheduleData';
import { hebrewDate } from './hebrewDate';

/** אחוז ההיעדרויות המקסימלי המותר בכל שיעור (חיסורים, ואיחורים אם נספרים). */
export const ABSENCE_LIMIT_PCT = 20;

type Counts = { total: number; present: number; absent: number; late: number; missed: number; pct: number };

/**
 * שיעור = קטגוריה (קודש י"ג / סולם שנה ב וכו') + שם השיעור. שיעור שחוזר כל שבוע נספר כשורה
 * אחת לאורך כל התקופה, וה-20% נבדק לכל שיעור בנפרד.
 */
export type LessonRow = Counts & { category: string; lesson: string; teacher: string; over: boolean };
export type AbsenceEvent = { date: string; hebDate: string; category: string; lesson: string; status: 'חסרה' | 'איחור'; notes: string };
export type StudentSummary = Counts & {
  id: string;
  name: string;
  tracks: string[];
  lessons: LessonRow[];
  overLimit: boolean;
  /** ימים עם רישומים ישנים שלא שויכו לשיעור — לא נכללים בחישוב */
  unidentifiedDays: number;
  events: AbsenceEvent[];
};

export type AttendanceSummary = {
  from: string;
  to: string;
  fromHeb: string;
  toHeb: string;
  trackName: string | null;
  lateCounts: boolean;
  limitPct: number;
  students: StudentSummary[];
  records: { hebDate: string; date: string; student: string; category: string; lesson: string; teacher: string; status: string; notes: string }[];
};

function count(statuses: string[], lateCounts: boolean): Counts {
  const present = statuses.filter((s) => s === 'Present').length;
  const absent = statuses.filter((s) => s === 'Absent').length;
  const late = statuses.filter((s) => s === 'Late').length;
  const total = present + absent + late;
  const missed = absent + (lateCounts ? late : 0);
  return { total, present, absent, late, missed, pct: total ? Math.round((missed / total) * 1000) / 10 : 0 };
}

/** שמות שיעורים ומורות — משותף לדוח הנוכחות ולמסך תיקון הנתונים. */
export function makeLessonNamer(schedule: Awaited<ReturnType<typeof getFullSchedule>>) {
  const trackNameById = new Map(schedule.tracks.map((t) => [t.id, String(t.name || '').trim()]));
  const teacherNameById = new Map(schedule.teachers.map((t) => [t.id, String(t.name || '').trim()]));
  const teacherNames = (l: ParsedLesson) => (l.teacher || []).map((id) => teacherNameById.get(id) || '').filter(Boolean).join(', ');

  // בחלק מהשיעורים השם נמצא ב"נושא", ובחלק ב"שם הכיתה" (למשל "תפילה") — אבל לרוב "שם הכיתה"
  // הוא פשוט שם המסלול ("קודש י"ג"), שלא אומר לתלמידה על איזה שיעור מדובר.
  const trackNames = new Set(Array.from(trackNameById.values()));
  const ownName = (l: ParsedLesson): string => {
    if (l.subject?.trim()) return l.subject.trim();
    const cls = l.className?.trim() || '';
    return cls && !trackNames.has(cls) && !/^(קודש\s*)?י["״]?[גד]['׳]?$/.test(cls) ? cls : '';
  };
  // שם לפי משבצת (מסלול+יום+שעה) — לשיעורים בלי שם, כשבאותה משבצת יש שיעור אחר עם שם
  const nameBySlot = new Map<string, string>();
  for (const l of schedule.lessons) {
    const name = ownName(l);
    if (name) for (const t of l.track || []) nameBySlot.set(`${t}|${l.dayOfWeek}|${l.time}`, name);
  }

  /** שם השיעור: הנושא/שם הכיתה; אחרת השם של אותה משבצת, ואז לפי המורה, ואז יום ושעה. */
  const lessonName = (l: ParsedLesson) =>
    ownName(l) ||
    (l.track || []).map((t) => nameBySlot.get(`${t}|${l.dayOfWeek}|${l.time}`)).find(Boolean) ||
    (teacherNames(l) ? `שיעור של ${teacherNames(l)}` : l.dayOfWeek ? `יום ${l.dayOfWeek} ${l.time || ''}`.trim() : 'שיעור');
  return { lessonName, teacherNames };
}

/**
 * סיכום נוכחות לכל תלמידה בטווח תאריכים, לפי שיעור.
 *
 * - הבסיס הוא השיעורים שבהם נרשמה נוכחות בפועל, כך ששיעור שבוטל או לא סומן לא נספר כחיסור.
 * - רישום כפול לאותה תלמידה באותו שיעור באותו יום (סימון חוזר) נספר פעם אחת — האחרון קובע.
 * - רישומים ישנים בלי קישור לשיעור (בעיקר מתחילת ספטמבר, כשהסימון נשמר בלי שיעור ולעיתים
 *   כמה פעמים לאותו יום) לא נכללים — אי אפשר לדעת על איזה שיעור הם.
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
  const { lessonName, teacherNames } = makeLessonNamer(schedule);

  type Rec = {
    date: string;
    created: string;
    studentId: string;
    categoryId: string;
    lesson: string;
    teacher: string;
    status: string;
    notes: string;
  };
  const byKey = new Map<string, Rec>();
  const unidentified = new Map<string, Set<string>>(); // תלמידה → ימים
  for (const rec of attendanceRaw) {
    const studentId: string | undefined = (rec.fields[FIELDS.attendance.student] || [])[0];
    const status = rec.fields[FIELDS.attendance.status];
    if (!studentId || !status) continue;
    const date: string = rec.fields[FIELDS.attendance.date];
    const lesson = lessonById.get((rec.fields[FIELDS.attendance.lesson] || [])[0]);
    if (!lesson) {
      if (!trackId) unidentified.set(studentId, (unidentified.get(studentId) || new Set()).add(date));
      continue;
    }
    const lessonTracks = lesson.track || [];
    if (trackId && !lessonTracks.includes(trackId)) continue;
    const mine = studentTracks(studentId);
    const categoryId = lessonTracks.find((t) => mine.includes(t)) || lessonTracks[0] || '';
    const r: Rec = {
      date,
      created: rec.createdTime || '',
      studentId,
      categoryId,
      lesson: lessonName(lesson),
      teacher: teacherNames(lesson),
      status,
      notes: [rec.fields[FIELDS.attendance.notes], rec.fields['סיבת העדרות']].filter(Boolean).join(' · '),
    };
    const key = `${studentId}|${lesson.id}|${date}`;
    const prev = byKey.get(key);
    if (!prev || prev.created < r.created) byKey.set(key, r);
  }
  const records = Array.from(byKey.values()).sort((a, b) => a.date.localeCompare(b.date));

  const categoryName = (id: string) => trackNameById.get(id) || 'כללי';
  // קודש קודם, אחריו המסלול המקצועי
  const categoryRank = (id: string) => (isKodesh(id) ? 0 : 1);

  // התלמידות בדוח: מי שיש לה רישומים בטווח, וגם תלמידות המסלול שנבחר (כדי שגם בלי רישומים יופיעו)
  const ids = new Set([...records.map((r) => r.studentId), ...unidentified.keys()]);
  if (trackId) studentsRaw.filter((s) => studentTracks(s.id).includes(trackId)).forEach((s) => ids.add(s.id));

  const students: StudentSummary[] = Array.from(ids).map((id) => {
    const s = studentById.get(id);
    const mine = records.filter((r) => r.studentId === id);
    const byLesson = new Map<string, Rec[]>();
    for (const r of mine) {
      const key = `${r.categoryId}|${r.lesson}`;
      byLesson.set(key, [...(byLesson.get(key) || []), r]);
    }
    const lessons = Array.from(byLesson.values())
      .map((rs) => {
        const c = count(rs.map((r) => r.status), lateCounts);
        return {
          category: categoryName(rs[0].categoryId),
          lesson: rs[0].lesson,
          teacher: Array.from(new Set(rs.map((r) => r.teacher).filter(Boolean))).join(', '),
          ...c,
          over: c.pct > ABSENCE_LIMIT_PCT,
          rank: categoryRank(rs[0].categoryId),
        };
      })
      .sort((a, b) => a.rank - b.rank || a.category.localeCompare(b.category, 'he') || a.lesson.localeCompare(b.lesson, 'he'))
      .map(({ rank, ...row }) => row);
    return {
      id,
      name: String(s?.fields[FIELDS.students.name] || 'תלמידה לא ידועה').trim(),
      tracks: [...studentTracks(id)]
        .sort((a, b) => categoryRank(a) - categoryRank(b))
        .map((t) => trackNameById.get(t) || '')
        .filter(Boolean),
      ...count(mine.map((r) => r.status), lateCounts),
      lessons,
      overLimit: lessons.some((l) => l.over),
      unidentifiedDays: unidentified.get(id)?.size || 0,
      events: mine
        .filter((r) => r.status === 'Absent' || r.status === 'Late')
        .map((r) => ({
          date: r.date,
          hebDate: hebrewDate(r.date),
          category: categoryName(r.categoryId),
          lesson: r.lesson,
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
    fromHeb: hebrewDate(from),
    toHeb: hebrewDate(to),
    trackName: trackId ? trackNameById.get(trackId) || null : null,
    lateCounts,
    limitPct: ABSENCE_LIMIT_PCT,
    students,
    records: records.map((r) => ({
      hebDate: hebrewDate(r.date),
      date: r.date,
      student: nameById.get(r.studentId) || '',
      category: categoryName(r.categoryId),
      lesson: r.lesson,
      teacher: r.teacher,
      status: statusHe[r.status] || r.status,
      notes: r.notes,
    })),
  };
}

export function styleSheet(ws: ExcelJS.Worksheet) {
  ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFF1C40F' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.height = 30;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

const RED_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };

/** אקסל: סיכום לכל תלמידה, פירוט לפי שיעור, וכל הרישומים בטווח. */
export async function buildAttendanceExcel(summary: AttendanceSummary): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const missedHeader = summary.lateCounts ? 'היעדרויות (חיסור+איחור)' : 'היעדרויות (חיסורים)';
  const countColumns = [
    { header: 'שיעורים שנרשמו', key: 'total', width: 12 },
    { header: 'נוכחת', key: 'present', width: 9 },
    { header: 'חסרה', key: 'absent', width: 9 },
    { header: 'איחור', key: 'late', width: 9 },
    { header: missedHeader, key: 'missed', width: 14 },
  ];

  const ws = wb.addWorksheet('סיכום לפי תלמידה');
  ws.columns = [
    { header: 'שם התלמידה', key: 'name', width: 22 },
    { header: 'מסלולים', key: 'tracks', width: 34 },
    ...countColumns,
    { header: `שיעורים מעל ${summary.limitPct}%`, key: 'overLessons', width: 40 },
  ];
  for (const s of summary.students) {
    const overLessons = s.lessons.filter((l) => l.over).map((l) => `${l.lesson} (${l.pct}%)`).join(', ');
    const row = ws.addRow({ ...s, tracks: s.tracks.join(', '), overLessons });
    if (s.overLimit) {
      row.fill = RED_FILL;
      row.getCell('overLessons').font = { bold: true, color: { argb: 'FFB91C1C' } };
    }
  }
  styleSheet(ws);

  const ls = wb.addWorksheet('לפי שיעור');
  ls.columns = [
    { header: 'שם התלמידה', key: 'name', width: 22 },
    { header: 'קטגוריה', key: 'category', width: 22 },
    { header: 'שם השיעור', key: 'lesson', width: 28 },
    { header: 'מורה', key: 'teacher', width: 20 },
    ...countColumns,
    { header: 'אחוז היעדרות', key: 'pct', width: 12 },
  ];
  for (const s of summary.students) {
    for (const l of s.lessons) {
      const row = ls.addRow({ name: s.name, ...l, pct: l.pct / 100 });
      row.getCell('pct').numFmt = '0.0%';
      if (l.over) row.fill = RED_FILL;
    }
  }
  styleSheet(ls);

  const rs = wb.addWorksheet('כל הרישומים');
  rs.columns = [
    { header: 'תאריך', key: 'hebDate', width: 18 },
    { header: 'שם התלמידה', key: 'student', width: 22 },
    { header: 'קטגוריה', key: 'category', width: 22 },
    { header: 'שם השיעור', key: 'lesson', width: 28 },
    { header: 'מורה', key: 'teacher', width: 20 },
    { header: 'סטטוס', key: 'status', width: 10 },
    { header: 'הערות', key: 'notes', width: 30 },
  ];
  for (const r of summary.records) {
    const row = rs.addRow(r);
    if (r.status === 'חסרה') row.getCell('status').font = { bold: true, color: { argb: 'FFB91C1C' } };
    if (r.status === 'איחור') row.getCell('status').font = { bold: true, color: { argb: 'FFB45309' } };
  }
  styleSheet(rs);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
