import { airtableFetch, TABLES } from './airtable';
import { FIELDS } from './airtableFields';
import { getFullSchedule } from './scheduleData';
import { lessonsForDate } from './scheduleRules';
import { getCancelledKeys } from './lessonCancellations';
import { requiredPeriods, lessonPeriodTimes, recordPeriod } from './lessonPeriods';
import { findTeacherIds } from './teacherScope';
import { prisma } from './prisma';

/**
 * תמונת מצב: לכל מורה (עם "מעקב שיעורים") — כמה שיבוצים היו בטווח התאריכים לפי מערכת השעות בפועל,
 * כמה מהם כבר יש עליהם נוכחות תלמידות, ואילו חסרים. אותו חישוב כמו בבדיקה שלפני הגשת הדוח
 * (teacherAttendanceCheck), אבל לכל המורות בבת אחת — שליפה אחת של הנוכחות לכל הטווח.
 */

export type SnapshotSlot = { date: string; time: string; track: string; period: number; periods: number };
/**
 * kind: user = עובדת במערכת; unlinked = שם במערכת השעות שלא מקושר לאף עובדת; none = שיעורים בלי מורה.
 * asked = האם המערכת מבקשת ממנה למלא נוכחות (מורה עם "מעקב שיעורים").
 */
export type TeacherSnapshot = {
  id: string;
  name: string;
  kind: 'user' | 'unlinked' | 'none';
  asked: boolean;
  required: number;
  filled: number;
  missing: SnapshotSlot[];
};

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end && out.length < 400) {
    if (d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const israelToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

export async function getAttendanceSnapshot(from: string, rawTo: string): Promise<{ from: string; to: string; teachers: TeacherSnapshot[] }> {
  // לא דורשים נוכחות לימים עתידיים
  const today = israelToday();
  const to = rawTo > today ? today : rawTo;
  if (to < from) return { from, to, teachers: [] };

  const [{ lessons, tracks, teachers: scheduleTeachers }, cancelled, employees, allStudents, attendance] = await Promise.all([
    getFullSchedule(),
    getCancelledKeys(from, to),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, role: true, trackLessons: true }, orderBy: { name: 'asc' } }),
    airtableFetch(TABLES.students),
    airtableFetch(TABLES.attendance, {
      filterByFormula: `AND(NOT(IS_BEFORE({${FIELDS.attendance.date}}, '${from}')), NOT(IS_AFTER({${FIELDS.attendance.date}}, '${to}')))`,
      fields: [FIELDS.attendance.date, FIELDS.attendance.student, FIELDS.attendance.lesson, FIELDS.attendance.period],
    }),
  ]);
  const trackName = new Map(tracks.map((t: any) => [t.id, String(t.name || '')]));
  const dates = datesBetween(from, to);
  const lessonsByDate = new Map(dates.map((d) => [d, lessonsForDate(lessons, d)]));

  // תלמידות בכל מסלול (מקור האמת: שדה "מסלולים" של כל תלמידה)
  const trackStudents = new Map<string, Set<string>>();
  for (const s of allStudents) {
    for (const trackId of (s.fields[FIELDS.students.track] as string[] | undefined) || []) {
      if (!trackStudents.has(trackId)) trackStudents.set(trackId, new Set());
      trackStudents.get(trackId)!.add(s.id);
    }
  }
  // מה כבר מכוסה: חלק 1 / שיעור רגיל — לפי תאריך+מסלול; חלקים 2+ של שיעור כפול — לפי תאריך+שיעור+חלק
  const covered = new Set<string>();
  const coveredPeriod = new Set<string>();
  for (const rec of attendance) {
    const date = rec.fields[FIELDS.attendance.date];
    const studentIds: string[] = rec.fields[FIELDS.attendance.student] || [];
    const period = recordPeriod(rec.fields[FIELDS.attendance.period]);
    const lessonIds: string[] = rec.fields[FIELDS.attendance.lesson] || [];
    for (const lessonId of lessonIds) coveredPeriod.add(`${date}|${lessonId}|${period}`);
    // רישום בלי שיעור (ישן) — נחשב לכל המסלול באותו יום
    if (period > 1 || lessonIds.length) continue;
    for (const sid of studentIds) for (const [trackId, set] of trackStudents) if (set.has(sid)) covered.add(`${date}|${trackId}`);
  }

  // לכל רשומת מורה במערכת השעות — אילו עובדות היא (לפי השם, וקישורים ידניים)
  const usersOfTeacher = new Map<string, typeof employees>();
  for (const emp of employees) for (const tid of await findTeacherIds(emp.name)) usersOfTeacher.set(tid, [...(usersOfTeacher.get(tid) || []), emp]);
  const scheduleName = new Map((scheduleTeachers as any[]).map((t) => [t.id, String(t.name || '').trim()]));

  // כל שיעור שהתקיים נספר אצל כל מי שמלמדת בו — עובדת, שם לא מקושר, או "בלי מורה"
  type Group = TeacherSnapshot & { seen: Set<string> };
  const groups = new Map<string, Group>();
  const group = (id: string, name: string, kind: Group['kind'], asked: boolean) => {
    if (!groups.has(id)) groups.set(id, { id, name, kind, asked, required: 0, filled: 0, missing: [], seen: new Set() });
    return groups.get(id)!;
  };
  // שלב 1: לכל שיעור שהתקיים — מי מלמדת בו
  const occurrences: { date: string; lesson: any; targets: Group[] }[] = [];
  for (const date of dates) {
    for (const lesson of (lessonsByDate.get(date) || []) as any[]) {
      if (cancelled.has(`${date}|${lesson.id}`)) continue;
      const targets: Group[] = [];
      for (const tid of (lesson.teacher || []).filter((id: string) => scheduleName.has(id) && scheduleName.get(id))) {
        const us = usersOfTeacher.get(tid) || [];
        if (us.length) us.forEach((u) => targets.push(group(`u:${u.id}`, u.name.trim(), 'user', u.role === 'מורה' && u.trackLessons)));
        else targets.push(group(`t:${tid}`, scheduleName.get(tid)!, 'unlinked', false));
      }
      if (!targets.length) targets.push(group('none', 'שיעורים בלי מורה', 'none', false));
      occurrences.push({ date, lesson, targets: [...new Set(targets)] });
    }
  }
  // נוכחות שהמורה רשמה באחד השיעורים שלה באותו יום לאותו מסלול — נחשבת גם לשיעורים האחרים שלה
  // באותו יום ומסלול (מורה שסימנה פעם אחת ליום, או בשיעור הסמוך). נוכחות של מורה אחרת — לא נחשבת.
  const groupDayTrack = new Set<string>();
  for (const { date, lesson, targets } of occurrences) {
    if (!coveredPeriod.has(`${date}|${lesson.id}|1`)) continue;
    for (const g of targets) for (const trackId of lesson.track || []) groupDayTrack.add(`${g.id}|${date}|${trackId}`);
  }

  // שלב 2: ספירה
  for (const { date, lesson, targets } of occurrences) {
    {
      const periods = requiredPeriods(lesson.time, date);
      const times = periods > 1 ? lessonPeriodTimes(lesson.time) : [lesson.time || ''];
      for (let period = 1; period <= periods; period++) {
        for (const trackId of lesson.track || []) {
          for (const g of targets) {
            const ok =
              coveredPeriod.has(`${date}|${lesson.id}|${period}`) ||
              (period === 1 && (covered.has(`${date}|${trackId}`) || groupDayTrack.has(`${g.id}|${date}|${trackId}`)));
            const key = `${date}|${trackId}|${lesson.id}|${period}`;
            if (g.seen.has(key)) continue;
            g.seen.add(key);
            g.required++;
            if (ok) g.filled++;
            else g.missing.push({ date, time: times[period - 1] || lesson.time || '', track: trackName.get(trackId) || '', period, periods });
          }
        }
      }
    }
  }
  const teachers: TeacherSnapshot[] = [...groups.values()].map(({ seen, ...g }) => {
    void seen;
    g.missing.sort((x, y) => (x.date === y.date ? x.time.localeCompare(y.time) : x.date.localeCompare(y.date)));
    return g;
  });
  // הכי הרבה חסרים — למעלה
  teachers.sort((a, b) => b.missing.length - a.missing.length || a.name.localeCompare(b.name, 'he'));
  return { from, to, teachers };
}
