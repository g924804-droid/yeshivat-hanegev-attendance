import { Router, Request } from 'express';
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
import { lessonsForDate } from '../lib/scheduleRules';
import { getHebrewDateLabel } from '../lib/holidays';
import { getTeacherTrackIds, findTeacherIds, canSeeAllStudentTracks } from '../lib/teacherScope';
import { getMissingAttendanceSlots } from '../lib/teacherAttendanceCheck';
import { requireAuth, requirePermission } from '../middleware/auth';
import { buildAttendanceSummary, buildAttendanceExcel } from '../lib/studentAttendanceReport';
import { getAttendanceIssues, assignRecordsToLesson, deleteAttendanceRecords } from '../lib/studentAttendanceIssues';

const router = Router();
router.use(requireAuth);

/**
 * שדה "תאריך" ב-Airtable הוא מסוג date אמיתי (לא טקסט) — Airtable שומר אותו עם רכיב זמן/אזור
 * פנימי, אז השוואת formula רגילה `{תאריך} = "2026-09-02"` נכשלת בשקט ומחזירה תמיד אפס תוצאות,
 * גם כשיש בדיוק רשומה כזו (נבדק ישירות מול Airtable). IS_SAME עם יחידת "day" היא הדרך התקינה
 * להשוות שדה date לתאריך ISO. באג הזה הוא שגרם לכל "סימון נוכחות" להיראות כאילו לא נשמר —
 * הכתיבה עצמה כן הצליחה, אבל הקריאה החוזרת כדי להציג את הסטטוס תמיד חזרה ריקה.
 */
function dateEqualsFormula(fieldName: string, dateStr: string): string {
  return `IS_SAME({${fieldName}}, "${dateStr}", "day")`;
}

/** "9:00-9:45" → 540 (דקות מתחילת היום), למיון שיעורי היום לפי סדר כרונולוגי אמיתי. */
function parseStartMinutes(time?: string | null): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(time || '');
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * מוצא את שיעורי המסלול ליום הנתון, ממקור האמת המשותף עם מסך הניהול ומסך התצוגה
 * (getFullSchedule) — לא formula ישירה מול Airtable שמשווה טקסט לשדה מקושר ונכשלת בשקט.
 * קודם מחשבים את המערכת בפועל לתאריך (שינוי זמני כמו כנס מחליף את השיעורים הקבועים), ורק אז
 * מסננים למסלול.
 */
async function getTrackLessonsForDate(trackId: string, date: string) {
  const { lessons, teachers } = await getFullSchedule();
  const teacherNameById = new Map(teachers.map((t) => [t.id, t.name]));
  return lessonsForDate(lessons, date)
    .filter((l) => (l.track || []).includes(trackId))
    .map((l) => ({ ...l, teacherName: teacherNameById.get(l.teacher?.[0] || '') || '' }))
    .sort((a, b) => parseStartMinutes(a.time) - parseStartMinutes(b.time));
}

/**
 * שדה "תלמידות" בטבלת המסלולים הוא טקסט מחושב (שמות מופרדים בפסיקים), לא שדה מקושר אמיתי —
 * וחלק מהמסלולים אפילו חסרים אותו לגמרי. מקור האמת האמין הוא ההפך: כל תלמידה מחזיקה בעצמה
 * את רשימת המסלולים שלה (שדה "מסלולים", מערך מזהים) — משם שואבים תמיד.
 */
function getStudentIdsByTrack(trackId: string, allStudents: Awaited<ReturnType<typeof airtableFetch>>): string[] {
  return allStudents.filter((s) => (s.fields[FIELDS.students.track] || []).includes(trackId)).map((s) => s.id);
}

/**
 * תאריכים/שעות שהמורה עדיין לא סימנה נוכחות תלמידות במסלול הזה — כדי שברגע שהיא נכנסת
 * למסלול היא תראה מיד לאן לקפוץ, בלי לחפש בלוח שנה. אם המשתמשת היא מנהלת/מזכירת נוכחות
 * (לא מורה בפועל) הרשימה פשוט תצא ריקה — זה בסדר, זה מיועד למורה שממלאת לעצמה.
 */
router.get('/getMissingAttendanceForTrack', requirePermission('studentAttendance'), async (req, res) => {
  try {
    const trackId = req.query.trackId as string;
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    if (!trackId) return res.status(400).json({ error: 'חסר מזהה מסלול' });

    const slots = await getMissingAttendanceSlots(req.user!.name, month);
    const missing = slots
      .filter((s) => s.trackId === trackId)
      .map((s) => ({ date: s.date, time: s.time, lessonId: s.lessonId }));

    res.json({ missing });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בבדיקת נוכחות חסרה' });
  }
});

router.get('/getTracks', requirePermission('studentAttendance'), async (req, res) => {
  try {
    const tracks = await airtableFetch(TABLES.tracks);
    let visible = tracks;
    if (!canSeeAllStudentTracks(req.user!)) {
      const trackIds = await getTeacherTrackIds(req.user!.name);
      visible = tracks.filter((t) => trackIds.has(t.id));
    }

    const allStudents = await airtableFetch(TABLES.students);
    const today = new Date().toISOString().slice(0, 10);
    const todaysAttendance = await airtableFetch(TABLES.attendance, {
      filterByFormula: dateEqualsFormula(FIELDS.attendance.date, today),
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
    if (!canSeeAllStudentTracks(req.user!)) {
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
      filterByFormula: dateEqualsFormula(FIELDS.attendance.date, date),
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
      filterByFormula: dateEqualsFormula(FIELDS.attendance.date, date),
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

/** פרמטרים משותפים לדוח הנוכחות ולייצוא — רק למי שרואה את כל המסלולים (מנהלת/מזכירה). */
function reportParams(req: Request) {
  if (!canSeeAllStudentTracks(req.user!)) throw Object.assign(new Error('אין הרשאה לדוחות נוכחות'), { status: 403 });
  const { from, to, trackId, lateCounts } = req.query as Record<string, string | undefined>;
  const isDate = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!isDate(from) || !isDate(to)) throw Object.assign(new Error('יש לבחור מתאריך ועד תאריך'), { status: 400 });
  if (from! > to!) throw Object.assign(new Error('תאריך ההתחלה אחרי תאריך הסיום'), { status: 400 });
  return { from: from!, to: to!, trackId: trackId || undefined, lateCounts: lateCounts !== '0' };
}

router.get('/attendanceSummary', requirePermission('studentAttendance'), async (req, res) => {
  try {
    const summary = await buildAttendanceSummary(reportParams(req));
    res.json({ ...summary, records: undefined });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'שגיאה בהפקת דוח נוכחות' });
  }
});

router.get('/exportAttendanceExcel', requirePermission('studentAttendance'), async (req, res) => {
  try {
    const summary = await buildAttendanceSummary(reportParams(req));
    const buffer = await buildAttendanceExcel(summary);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`נוכחות תלמידות ${summary.fromHeb} עד ${summary.toHeb}.xlsx`)}`);
    res.send(buffer);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'שגיאה בייצוא לאקסל' });
  }
});

/** מה צריך תיקון: סימונים בלי שיעור, ושיעורים בלי נוכחות. */
router.get('/attendanceIssues', requirePermission('studentAttendance'), async (req, res) => {
  try {
    const { from, to } = reportParams(req);
    res.json(await getAttendanceIssues(from, to));
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'שגיאה בבדיקת נתוני הנוכחות' });
  }
});

function recordIdsFrom(body: any): string[] {
  const ids = body?.recordIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || !ids.every((id) => typeof id === 'string' && /^rec\w+$/.test(id))) {
    throw Object.assign(new Error('רשימת רישומים לא תקינה'), { status: 400 });
  }
  return ids;
}

router.post('/assignAttendanceLesson', requirePermission('studentAttendance'), async (req, res) => {
  try {
    if (!canSeeAllStudentTracks(req.user!)) return res.status(403).json({ error: 'אין הרשאה' });
    const { lessonId } = req.body as { lessonId?: string };
    if (!lessonId || !/^rec\w+$/.test(lessonId)) return res.status(400).json({ error: 'יש לבחור שיעור' });
    const ids = recordIdsFrom(req.body);
    await assignRecordsToLesson(ids, lessonId);
    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'שגיאה בשיוך לשיעור' });
  }
});

router.post('/deleteAttendanceRecords', requirePermission('studentAttendance'), async (req, res) => {
  try {
    if (!canSeeAllStudentTracks(req.user!)) return res.status(403).json({ error: 'אין הרשאה' });
    const ids = recordIdsFrom(req.body);
    await deleteAttendanceRecords(ids);
    res.json({ success: true, deleted: ids.length });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'שגיאה במחיקה' });
  }
});

/** מערכת שעות אישית לכל תלמידה — כל התלמידות עם המסלולים שלהן + מערכת השעות המלאה (הסינון לשבוע נעשה בדפדפן). */
router.get('/studentSchedules', requirePermission('studentAttendance'), async (req, res) => {
  try {
    if (!canSeeAllStudentTracks(req.user!)) return res.status(403).json({ error: 'אין הרשאה' });
    const [studentsRaw, schedule] = await Promise.all([airtableFetch(TABLES.students), getFullSchedule()]);
    const students = studentsRaw
      .map((s) => ({
        id: s.id,
        name: String(s.fields[FIELDS.students.name] || '').trim(),
        trackIds: (s.fields[FIELDS.students.track] || []) as string[],
      }))
      .filter((s) => s.name);
    res.json({ students, ...schedule });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת מערכות השעות' });
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
