import { Router } from 'express';
import {
  airtableFetch,
  airtableCreate,
  airtableUpdate,
  airtableGetRecord,
  airtableBatchCreate,
  TABLES,
  STUDENT_STATUS_HE_TO_EN,
  STUDENT_STATUS_EN_TO_HE,
} from '../lib/airtable';
import { FIELDS } from '../lib/airtableFields';
import { getFullSchedule } from '../lib/scheduleData';
import { getHebrewDateLabel } from '../lib/holidays';
import { getTeacherTrackIds, findTeacherIds } from '../lib/teacherScope';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const DOW_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** "9:00-9:45" → 540 (דקות מתחילת היום), למיון שיעורי היום לפי סדר כרונולוגי אמיתי. */
function parseStartMinutes(time?: string | null): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(time || '');
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** שיעורים ישנים בלי מתאריך/עד-תאריך נחשבים תקפים תמיד — התאריכים נוספו רק בהמשך. */
function lessonAppliesOnDate(l: { fromDate?: string | null; toDate?: string | null }, date: string): boolean {
  if (l.fromDate && date < l.fromDate) return false;
  if (l.toDate && date > l.toDate) return false;
  return true;
}

/**
 * מוצא את שיעורי המסלול ליום הנתון, ממקור האמת המשותף עם מסך הניהול ומסך התצוגה
 * (getFullSchedule) — לא formula ישירה מול Airtable שמשווה טקסט לשדה מקושר ונכשלת בשקט.
 */
async function getTrackLessonsForDate(trackId: string, date: string) {
  const dayOfWeek = DOW_HE[new Date(`${date}T00:00:00`).getDay()];
  const { lessons, teachers } = await getFullSchedule();
  const teacherNameById = new Map(teachers.map((t) => [t.id, t.name]));
  return lessons
    .filter((l) => (l.track || []).includes(trackId) && l.dayOfWeek === dayOfWeek && lessonAppliesOnDate(l, date))
    .map((l) => ({ ...l, teacherName: teacherNameById.get(l.teacher?.[0] || '') || '' }))
    .sort((a, b) => parseStartMinutes(a.time) - parseStartMinutes(b.time));
}

/**
 * שדה "תלמידות" בטבלת המסלולים הוא טקסט מחושב (שמות מופרדים בפסיקים), לא שדה מקושר אמיתי —
 * וחלק מהמסלולים אפילו חסרים אותו לגמרי. מקור האמת האמין הוא ההפך: כל תלמידה מחזיקה בעצמה
 * את רשימת המסلولים שלה (שדה "מסלולים", מערך מזהים) — משם שואבים תמיד.
 */
function getStudentIdsByTrack(trackId: string, allStudents: Awaited<ReturnType<typeof airtableFetch>>): string[] {
  return allStudents.filter((s) => (s.fields[FIELDS.students.track] || []).includes(trackId)).map((s) => s.id);
}

router.get('/getTracks', requirePermission('studentAttendance'), async (req, res) => {
  try {
    const tracks = await airtableFetch(TABLES.tracks);
    let visible = tracks;
    if (req.user!.role !== 'מנהל' && !req.user!.isAttendanceManager) {
      const trackIds = await getTeacherTrackIds(req.user!.name);
      visible = tracks.filter((t) => trackIds.has(t.id));
    }

    const allStudents = await airtableFetch(TABLES.students);
    const today = new Date().toISOString().slice(0, 10);
    const todaysAttendance = await airtableFetch(TABLES.attendance, {
      filterByFormula: `{${FIELDS.attendance.date}} = "${today}"`,
    });

    const result = visible.map((t) => {
      const studentIds = getStudentIdsByTrack(t.id, allStudents);
      const presentToday = todaysAttendance.filter((a) => {
        const linked: string[] = a.fields[FIELDS.attendance.student] || [];
        return linked.some((id) => studentIds.includes(id));
      }).length;
      return {
        id: t.id,
        name: t.fields[FIELDS.tracks.name],
        description: t.fields[FIELDS.tracks.description] || '',
        studentCount: studentIds.length,
        presentToday,
      };
    });

    res.json({ tracks: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת מסלולים' });
  }
});

router.get('/getStudentsByTrack', requirePermission('studentAttendance'), async (req, res) => {
  try {
    const trackId = req.query.trackId as string;
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const requestedLessonId = (req.query.lessonId as string) || undefined;
    if (!trackId) return res.status(400).json({ error: 'חסר מזהה מסלול' });

    const track = await airtableGetRecord(TABLES.tracks, trackId);
    if (!track) return res.status(404).json({ error: 'מסלול לא נמצא' });

    const allStudentsRaw = await airtableFetch(TABLES.students);
    const studentIds = getStudentIdsByTrack(trackId, allStudentsRaw);
    const allStudents = allStudentsRaw.filter((s) => studentIds.includes(s.id));

    let todaysLessons = await getTrackLessonsForDate(trackId, date);
    if (req.user!.role !== 'מנהל' && !req.user!.isAttendanceManager) {
      const teacherIds = await findTeacherIds(req.user!.name);
      todaysLessons = todaysLessons.filter((l) => (l.teacher || []).some((id) => teacherIds.includes(id)));
    }

    // אם יש כמה שיעורים באותו יום (למשל קודש שני שיעורים, או חשבות שכר שלושה) — ברירת
    // המחדל היא הראשון כרונולוגית; המורה יכולה לעבור לשיעורים הבאים דרך התגיות למעלה.
    const activeLessonId =
      requestedLessonId && todaysLessons.some((l) => l.id === requestedLessonId)
        ? requestedLessonId
        : todaysLessons[0]?.id || null;

    const dayAttendance = await airtableFetch(TABLES.attendance, {
      filterByFormula: `{${FIELDS.attendance.date}} = "${date}"`,
    });

    const allGrades = await airtableFetch(TABLES.grades);

    const students = allStudents.map((s) => {
      const attendanceRecord = dayAttendance.find((a) => {
        if (!(a.fields[FIELDS.attendance.student] || []).includes(s.id)) return false;
        if (!activeLessonId) return true; // אין שיעור מוגדר ליום הזה — נוכחות כללית לפי תאריך בלבד
        return (a.fields[FIELDS.attendance.lesson] || []).includes(activeLessonId);
      });
      const statusEn = attendanceRecord?.fields[FIELDS.attendance.status];
      const studentGrades = allGrades.filter((g) =>
        (g.fields[FIELDS.grades.studentLinked] || []).includes(s.id)
      );
      const avgGrade = studentGrades.length
        ? Math.round(
            (studentGrades.reduce((sum, g) => sum + (Number(g.fields[FIELDS.grades.score]) || 0), 0) /
              studentGrades.length) *
              10
          ) / 10
        : null;

      return {
        id: s.id,
        name: s.fields[FIELDS.students.name],
        className: s.fields[FIELDS.students.className],
        phone: s.fields[FIELDS.students.phone],
        attendanceId: attendanceRecord?.id || null,
        status: statusEn ? STUDENT_STATUS_EN_TO_HE[statusEn] || statusEn : null,
        avgGrade,
      };
    });

    const hebrewDate = await getHebrewDateLabel(date).catch(() => '');

    res.json({
      track: { id: track.id, name: track.fields[FIELDS.tracks.name] },
      students,
      schedule: todaysLessons.map((l) => ({
        id: l.id,
        className: l.className,
        time: l.time,
        room: l.room,
        teacherName: l.teacherName,
      })),
      activeLessonId,
      hebrewDate,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת תלמידות' });
  }
});

router.post('/markStudentAttendance', requirePermission('studentAttendance'), async (req, res) => {
  try {
    const { studentId, status, notes, date, existingAttendanceId, lessonId } = req.body as {
      studentId: string;
      status: string;
      notes?: string;
      date?: string;
      existingAttendanceId?: string;
      lessonId?: string;
    };
    if (!studentId || !status) return res.status(400).json({ error: 'חסר מזהה תלמידה או סטטוס' });

    const fields: Record<string, any> = {
      [FIELDS.attendance.date]: date || new Date().toISOString().slice(0, 10),
      [FIELDS.attendance.student]: [studentId],
      [FIELDS.attendance.status]: STUDENT_STATUS_HE_TO_EN[status] || status,
      [FIELDS.attendance.notes]: notes || '',
    };
    if (lessonId) fields[FIELDS.attendance.lesson] = [lessonId];
    if (req.user!.role === 'מורה') {
      const teacherIds = await findTeacherIds(req.user!.name);
      if (teacherIds[0]) fields[FIELDS.attendance.teacher] = [teacherIds[0]];
    }

    const record = existingAttendanceId
      ? await airtableUpdate(TABLES.attendance, existingAttendanceId, fields)
      : await airtableCreate(TABLES.attendance, fields);

    res.json({ success: true, recordId: record.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בסימון נוכחות' });
  }
});

/**
 * "סמן הכל נוכחות" — ממלאת נוכחת לכל תלמידה שעדיין אין לה רשומה ליום/שיעור הזה, בלי
 * לגעת במי שכבר סומנה (כדי לא לדרוס בטעות סימון ידני של חסרה/איחור שכבר נעשה).
 */
router.post('/bulkMarkAttendance', requirePermission('studentAttendance'), async (req, res) => {
  try {
    const { trackId, date, lessonId, status } = req.body as {
      trackId: string;
      date: string;
      lessonId?: string;
      status?: string;
    };
    if (!trackId || !date) return res.status(400).json({ error: 'חסר מסלול או תאריך' });
    const markStatus = status || 'נוכחת';

    const allStudentsRaw = await airtableFetch(TABLES.students);
    const studentIds = getStudentIdsByTrack(trackId, allStudentsRaw);
    if (!studentIds.length) return res.json({ success: true, marked: 0 });

    const dayAttendance = await airtableFetch(TABLES.attendance, {
      filterByFormula: `{${FIELDS.attendance.date}} = "${date}"`,
    });

    let teacherLink: string[] | undefined;
    if (req.user!.role === 'מורה') {
      const teacherIds = await findTeacherIds(req.user!.name);
      if (teacherIds[0]) teacherLink = [teacherIds[0]];
    }

    const toCreate: Record<string, any>[] = [];
    for (const studentId of studentIds) {
      const alreadyMarked = dayAttendance.some((a) => {
        if (!(a.fields[FIELDS.attendance.student] || []).includes(studentId)) return false;
        if (!lessonId) return true;
        return (a.fields[FIELDS.attendance.lesson] || []).includes(lessonId);
      });
      if (alreadyMarked) continue;

      const fields: Record<string, any> = {
        [FIELDS.attendance.date]: date,
        [FIELDS.attendance.student]: [studentId],
        [FIELDS.attendance.status]: STUDENT_STATUS_HE_TO_EN[markStatus] || markStatus,
      };
      if (lessonId) fields[FIELDS.attendance.lesson] = [lessonId];
      if (teacherLink) fields[FIELDS.attendance.teacher] = teacherLink;
      toCreate.push(fields);
    }

    if (toCreate.length) await airtableBatchCreate(TABLES.attendance, toCreate);
    res.json({ success: true, marked: toCreate.length, skipped: studentIds.length - toCreate.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בסימון נוכחות מרוכז' });
  }
});

router.post('/addTeacher', requirePermission('studentAttendance'), async (req, res) => {
  try {
    const { name } = req.body as { name: string };
    if (!name) return res.status(400).json({ error: 'חסר שם מורה' });
    const record = await airtableCreate(TABLES.teachers, { [FIELDS.teachers.name]: name });
    res.json({ success: true, recordId: record.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בהוספת מורה' });
  }
});

export default router;
