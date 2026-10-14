import ExcelJS from 'exceljs';
import { airtableFetch, TABLES } from './airtable';
import { FIELDS } from './airtableFields';
import { getFullSchedule } from './scheduleData';
import { hebrewDate } from './hebrewDate';
import { makeLessonNamer, styleSheet } from './studentAttendanceReport';

/** ציון עובר כברירת מחדל — ציון נמוך ממנו מסומן באדום. */
export const DEFAULT_PASS_SCORE = 55;

export type GradeEntry = { date: string; hebDate: string; testName: string; score: number; notes: string };
/** מקצוע = קטגוריה (קודש י"ג / סולם שנה ב וכו') + שם השיעור, עם כל הציונים בו. */
export type SubjectRow = { category: string; subject: string; teacher: string; grades: GradeEntry[]; average: number };
export type StudentGrades = {
  id: string;
  name: string;
  tracks: string[];
  subjects: SubjectRow[];
  count: number;
  average: number | null;
  failing: number;
};
export type GradesSummary = {
  from: string;
  to: string;
  fromHeb: string;
  toHeb: string;
  trackName: string | null;
  passScore: number;
  students: StudentGrades[];
  /** כל המקצועות שיש בהם ציונים — לעמודות גליון הציונים באקסל */
  subjectKeys: { category: string; subject: string }[];
};

const avg = (nums: number[]) => (nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : 0);

/**
 * גליון ציונים לכל תלמידה בטווח תאריכים, לפי מקצוע.
 * ציון בלי תאריך נכלל תמיד (אי אפשר לדעת אם הוא בטווח), ורשומה בלי ציון מספרי לא נכללת.
 */
export async function buildGradesSummary(opts: { from: string; to: string; trackId?: string; passScore: number }): Promise<GradesSummary> {
  const { from, to, trackId, passScore } = opts;
  const [studentsRaw, gradesRaw, schedule] = await Promise.all([
    airtableFetch(TABLES.students),
    airtableFetch(TABLES.grades),
    getFullSchedule(),
  ]);

  const trackNameById = new Map(schedule.tracks.map((t) => [t.id, String(t.name || '').trim()]));
  const lessonById = new Map(schedule.lessons.map((l) => [l.id, l]));
  const studentById = new Map(studentsRaw.map((s) => [s.id, s]));
  const studentTracks = (id: string): string[] => studentById.get(id)?.fields[FIELDS.students.track] || [];
  const isKodesh = (id: string) => (trackNameById.get(id) || '').startsWith('קודש');
  const categoryRank = (id: string) => (isKodesh(id) ? 0 : id ? 1 : 2);
  const { lessonName, teacherNames } = makeLessonNamer(schedule);

  type Rec = GradeEntry & { studentId: string; categoryId: string; subject: string; teacher: string };
  const records: Rec[] = [];
  for (const g of gradesRaw) {
    const studentId: string | undefined = (g.fields[FIELDS.grades.studentLinked] || [])[0];
    const raw = g.fields[FIELDS.grades.score];
    const score = Number(raw);
    if (!studentId || raw === undefined || raw === null || raw === '' || !Number.isFinite(score)) continue;
    const date: string = g.fields[FIELDS.grades.date] || '';
    if (date && (date < from || date > to)) continue;
    if (trackId && !studentTracks(studentId).includes(trackId)) continue;

    const lesson = lessonById.get((g.fields[FIELDS.grades.classLinked] || [])[0]);
    const lessonTracks = lesson?.track || [];
    const mine = studentTracks(studentId);
    records.push({
      studentId,
      categoryId: lessonTracks.find((t) => mine.includes(t)) || lessonTracks[0] || '',
      subject: lesson ? lessonName(lesson) : 'ללא מקצוע',
      teacher: lesson ? teacherNames(lesson) : '',
      date,
      hebDate: date ? hebrewDate(date) : 'ללא תאריך',
      testName: String(g.fields[FIELDS.grades.testName] || '').trim(),
      score,
      notes: String(g.fields[FIELDS.grades.notes] || '').trim(),
    });
  }
  records.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));

  const categoryName = (id: string) => trackNameById.get(id) || 'כללי';
  const sortSubjects = <T extends { categoryId: string; category: string; subject: string }>(rows: T[]) =>
    rows.sort(
      (a, b) =>
        categoryRank(a.categoryId) - categoryRank(b.categoryId) ||
        a.category.localeCompare(b.category, 'he') ||
        a.subject.localeCompare(b.subject, 'he')
    );

  // התלמידות בדוח: מי שיש לה ציונים, וגם כל תלמידות המסלול שנבחר (כדי שגם בלי ציונים יופיעו)
  const ids = new Set(records.map((r) => r.studentId));
  if (trackId) studentsRaw.filter((s) => studentTracks(s.id).includes(trackId)).forEach((s) => ids.add(s.id));

  const students: StudentGrades[] = Array.from(ids).map((id) => {
    const mine = records.filter((r) => r.studentId === id);
    const bySubject = new Map<string, Rec[]>();
    for (const r of mine) {
      const key = `${r.categoryId}|${r.subject}`;
      bySubject.set(key, [...(bySubject.get(key) || []), r]);
    }
    const subjects = sortSubjects(
      Array.from(bySubject.values()).map((rs) => ({
        categoryId: rs[0].categoryId,
        category: categoryName(rs[0].categoryId),
        subject: rs[0].subject,
        teacher: Array.from(new Set(rs.map((r) => r.teacher).filter(Boolean))).join(', '),
        grades: rs.map(({ date, hebDate, testName, score, notes }) => ({ date, hebDate, testName, score, notes })),
        average: avg(rs.map((r) => r.score)),
      }))
    ).map(({ categoryId, ...row }) => row);
    return {
      id,
      name: String(studentById.get(id)?.fields[FIELDS.students.name] || 'תלמידה לא ידועה').trim(),
      tracks: [...studentTracks(id)]
        .sort((a, b) => categoryRank(a) - categoryRank(b))
        .map((t) => trackNameById.get(t) || '')
        .filter(Boolean),
      subjects,
      count: mine.length,
      // ממוצע כללי = ממוצע הממוצעים של המקצועות, כדי שמקצוע עם הרבה מבחנים לא ישקול יותר
      average: subjects.length ? avg(subjects.map((s) => s.average)) : null,
      failing: mine.filter((r) => r.score < passScore).length,
    };
  });
  students.sort((a, b) => a.name.localeCompare(b.name, 'he'));

  const keyMap = new Map<string, { categoryId: string; category: string; subject: string }>();
  for (const r of records) keyMap.set(`${r.categoryId}|${r.subject}`, { categoryId: r.categoryId, category: categoryName(r.categoryId), subject: r.subject });

  return {
    from,
    to,
    fromHeb: hebrewDate(from),
    toHeb: hebrewDate(to),
    trackName: trackId ? trackNameById.get(trackId) || null : null,
    passScore,
    students,
    subjectKeys: sortSubjects(Array.from(keyMap.values())).map(({ category, subject }) => ({ category, subject })),
  };
}

const RED_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFB91C1C' } };

/** אקסל: גליון ציונים (תלמידה × מקצוע, ממוצעים), וכל הציונים בפירוט. */
export async function buildGradesExcel(summary: GradesSummary): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const keyOf = (category: string, subject: string) => `${category}|${subject}`;
  const multiCategory = new Set(summary.subjectKeys.map((k) => k.category)).size > 1;

  const ws = wb.addWorksheet('גליון ציונים');
  ws.columns = [
    { header: 'שם התלמידה', key: 'name', width: 22 },
    { header: 'מסלולים', key: 'tracks', width: 30 },
    ...summary.subjectKeys.map((k, i) => ({
      header: multiCategory ? `${k.subject}\n(${k.category})` : k.subject,
      key: `s${i}`,
      width: 14,
    })),
    { header: 'ממוצע כללי', key: 'average', width: 11 },
    { header: 'מספר ציונים', key: 'count', width: 10 },
  ];
  for (const s of summary.students) {
    const bySubject = new Map(s.subjects.map((sub) => [keyOf(sub.category, sub.subject), sub.average]));
    const values: Record<string, unknown> = { name: s.name, tracks: s.tracks.join(', '), average: s.average ?? '', count: s.count };
    summary.subjectKeys.forEach((k, i) => (values[`s${i}`] = bySubject.get(keyOf(k.category, k.subject)) ?? ''));
    const row = ws.addRow(values);
    summary.subjectKeys.forEach((_, i) => {
      const cell = row.getCell(`s${i}`);
      if (typeof cell.value === 'number' && cell.value < summary.passScore) cell.font = RED_FONT;
      cell.alignment = { horizontal: 'center' };
    });
    row.getCell('average').font = { bold: true, ...(s.average != null && s.average < summary.passScore ? { color: { argb: 'FFB91C1C' } } : {}) };
    row.getCell('average').alignment = { horizontal: 'center' };
    row.getCell('count').alignment = { horizontal: 'center' };
  }
  styleSheet(ws);
  ws.getRow(1).height = multiCategory ? 45 : 30;

  const ds = wb.addWorksheet('כל הציונים');
  ds.columns = [
    { header: 'שם התלמידה', key: 'student', width: 22 },
    { header: 'קטגוריה', key: 'category', width: 20 },
    { header: 'מקצוע', key: 'subject', width: 26 },
    { header: 'מורה', key: 'teacher', width: 18 },
    { header: 'מבחן/מטלה', key: 'testName', width: 24 },
    { header: 'תאריך', key: 'hebDate', width: 18 },
    { header: 'ציון', key: 'score', width: 8 },
    { header: 'הערות', key: 'notes', width: 30 },
  ];
  for (const s of summary.students)
    for (const sub of s.subjects)
      for (const g of sub.grades) {
        const row = ds.addRow({ student: s.name, category: sub.category, subject: sub.subject, teacher: sub.teacher, ...g });
        row.getCell('score').alignment = { horizontal: 'center' };
        if (g.score < summary.passScore) row.getCell('score').font = RED_FONT;
      }
  styleSheet(ds);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
