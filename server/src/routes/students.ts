import { Router } from 'express';
import {
  airtableFetch,
  airtableCreate,
  airtableUpdate,
  airtableGetRecord,
  TABLES,
  STUDENT_STATUS_HE_TO_EN,
  STUDENT_STATUS_EN_TO_HE,
} from '../lib/airtable';
import { FIELDS } from '../lib/airtableFields';
import { getTeacherTrackIds, findTeacherIds } from '../lib/teacherScope';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const DOW_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

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
    if (!trackId) return res.status(400).json({ error: 'חסר מזהה מסלול' });

    const track = await airtableGetRecord(TABLES.tracks, trackId);
    if (!track) return res.status(404).json({ error: 'מסלול לא נמצא' });

    const allStudentsRaw = await airtableFetch(TABLES.students);
    const studentIds = getStudentIdsByTrack(trackId, allStudentsRaw);
    const allStudents = allStudentsRaw.filter((s) => studentIds.includes(s.id));

    const dayAttendance = await airtableFetch(TABLES.attendance, {
      filterByFormula: `{${FIELDS.attendance.date}} = "${date}"`,
    });

    const allGrades = await airtableFetch(TABLES.grades);

    const students = allStudents.map((s) => {
      const attendanceRecord = dayAttendance.find((a) =>
        (a.fields[FIELDS.attendance.student] || []).includes(s.id)
      );
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

    const dayOfWeek = DOW_HE[new Date(`${date}T00:00:00`).getDay()];
    const allLessons = await airtableFetch(TABLES.lessons, {
      filterByFormula: `AND({${FIELDS.lessons.track}} = "${track.fields[FIELDS.tracks.name]}", {${FIELDS.lessons.dayOfWeek}} = "${dayOfWeek}")`,
    }).catch(() => [] as typeof allGrades);

    let lessons = allLessons;
    if (req.user!.role !== 'מנהל' && !req.user!.isAttendanceManager) {
      const teacherIds = await findTeacherIds(req.user!.name);
      lessons = allLessons.filter((l) => (l.fields[FIELDS.lessons.teacher] || []).some((id: string) => teacherIds.includes(id)));
    }

    res.json({
      track: { id: track.id, name: track.fields[FIELDS.tracks.name] },
      students,
      schedule: lessons.map((l) => ({
        id: l.id,
        className: l.fields[FIELDS.lessons.className],
        time: l.fields[FIELDS.lessons.time],
        room: l.fields[FIELDS.lessons.room],
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת תלמידות' });
  }
});

router.post('/markStudentAttendance', requirePermission('studentAttendance'), async (req, res) => {
  try {
    const { studentId, status, notes, date, existingAttendanceId } = req.body as {
      studentId: string;
      status: string;
      notes?: string;
      date?: string;
      existingAttendanceId?: string;
    };
    if (!studentId || !status) return res.status(400).json({ error: 'חסר מזהה תלמידה או סטטוס' });

    const fields = {
      [FIELDS.attendance.date]: date || new Date().toISOString().slice(0, 10),
      [FIELDS.attendance.student]: [studentId],
      [FIELDS.attendance.status]: STUDENT_STATUS_HE_TO_EN[status] || status,
      [FIELDS.attendance.notes]: notes || '',
    };

    const record = existingAttendanceId
      ? await airtableUpdate(TABLES.attendance, existingAttendanceId, fields)
      : await airtableCreate(TABLES.attendance, fields);

    res.json({ success: true, recordId: record.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בסימון נוכחות' });
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
