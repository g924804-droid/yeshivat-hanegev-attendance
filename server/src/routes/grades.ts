import { Router } from 'express';
import { airtableFetch, airtableCreate, airtableUpdate, TABLES } from '../lib/airtable';
import { FIELDS } from '../lib/airtableFields';
import { getFullSchedule } from '../lib/scheduleData';
import { getTeacherTrackIds, getTeacherStudentIds, findTeacherIds, canSeeAllStudentTracks } from '../lib/teacherScope';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

/** אותו מקור אמת כמו students.ts: לתלמידה יש שדה "מסلولים" משלה — לא סומכים על שדה מחושב בטבלת המסلولים. */
function getStudentIdsByTrack(trackId: string, allStudents: Awaited<ReturnType<typeof airtableFetch>>): string[] {
  return allStudents.filter((s) => (s.fields[FIELDS.students.track] || []).includes(trackId)).map((s) => s.id);
}

router.get('/getGrades', requirePermission('grades'), async (req, res) => {
  try {
    const trackId = req.query.trackId as string | undefined;
    let grades = await airtableFetch(TABLES.grades);

    if (!canSeeAllStudentTracks(req.user!)) {
      const allowedStudentIds = await getTeacherStudentIds(req.user!.name);
      grades = grades.filter((g) =>
        (g.fields[FIELDS.grades.studentLinked] || []).some((id: string) => allowedStudentIds.has(id))
      );
    }

    if (trackId) {
      const students = await airtableFetch(TABLES.students);
      const trackStudentIds = new Set(getStudentIdsByTrack(trackId, students));
      grades = grades.filter((g) =>
        (g.fields[FIELDS.grades.studentLinked] || []).some((id: string) => trackStudentIds.has(id))
      );
    }

    res.json({
      grades: grades.map((g) => ({
        id: g.id,
        studentName: g.fields[FIELDS.grades.studentName],
        testName: g.fields[FIELDS.grades.testName],
        score: g.fields[FIELDS.grades.score],
        date: g.fields[FIELDS.grades.date],
        notes: g.fields[FIELDS.grades.notes],
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת ציונים' });
  }
});

router.put('/updateGrade', requirePermission('grades'), async (req, res) => {
  try {
    const { id, score, testName, notes, date } = req.body;
    const fields: Record<string, any> = {};
    if (score !== undefined) fields[FIELDS.grades.score] = score;
    if (testName !== undefined) fields[FIELDS.grades.testName] = testName;
    if (notes !== undefined) fields[FIELDS.grades.notes] = notes;
    if (date !== undefined) fields[FIELDS.grades.date] = date;

    const record = await airtableUpdate(TABLES.grades, id, fields);
    res.json({ success: true, recordId: record.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בעדכון ציון' });
  }
});

/** מסלולים לבחירה — מנהל רואה הכל, מורה רק את המסלולים המקושרים לשיעורים שלה (כמו נוכחות תלמידות). */
router.get('/getTracks', requirePermission('grades'), async (req, res) => {
  try {
    const tracks = await airtableFetch(TABLES.tracks);
    let visible = tracks;
    if (!canSeeAllStudentTracks(req.user!)) {
      const trackIds = await getTeacherTrackIds(req.user!.name);
      visible = tracks.filter((t) => trackIds.has(t.id));
    }

    const allStudents = await airtableFetch(TABLES.students);
    const allGrades = await airtableFetch(TABLES.grades);

    const result = visible.map((t) => {
      const studentIds = getStudentIdsByTrack(t.id, allStudents);
      const trackGrades = allGrades.filter((g) =>
        (g.fields[FIELDS.grades.studentLinked] || []).some((id: string) => studentIds.includes(id))
      );
      return {
        id: t.id,
        name: t.fields[FIELDS.tracks.name],
        description: t.fields[FIELDS.tracks.description] || '',
        studentCount: studentIds.length,
        gradesCount: trackGrades.length,
      };
    });

    res.json({ tracks: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת מסלולים' });
  }
});

/** רשימת מקצועות (מדדופת) שמלמדים במסלול — נגזרת משיעורי מערכת השעות, לא שדה נפרד. */
router.get('/getTrackSubjects', requirePermission('grades'), async (req, res) => {
  try {
    const trackId = req.query.trackId as string;
    if (!trackId) return res.status(400).json({ error: 'חסר מזהה מסלול' });

    const { lessons } = await getFullSchedule();
    let trackLessons = lessons.filter((l) => (l.track || []).includes(trackId));
    if (!canSeeAllStudentTracks(req.user!)) {
      const teacherIds = await findTeacherIds(req.user!.name);
      trackLessons = trackLessons.filter((l) => (l.teacher || []).some((id) => teacherIds.includes(id)));
    }

    // דדופ לפי מקצוע — לא רוצים אפשרות נפרדת לכל שיבוץ שעה, רק פעם אחת לכל נושא ממשי.
    const bySubject = new Map<string, (typeof trackLessons)[number]>();
    for (const l of trackLessons) {
      const key = l.subject || l.className || '';
      if (key && !bySubject.has(key)) bySubject.set(key, l);
    }

    res.json({
      subjects: Array.from(bySubject.values()).map((l) => ({ lessonId: l.id, subject: l.subject || l.className })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת מקצועות' });
  }
});

/** תלמידות המסلول + הציון הקיים שלהן במקצוע הנבחר (אם יש), למילוי/עריכה — כמו נוכחות תלמידות. */
router.get('/getStudentsForGrading', requirePermission('grades'), async (req, res) => {
  try {
    const trackId = req.query.trackId as string;
    const lessonId = req.query.lessonId as string | undefined;
    if (!trackId) return res.status(400).json({ error: 'חסר מזהה מסלול' });

    const allStudentsRaw = await airtableFetch(TABLES.students);
    let studentIds = getStudentIdsByTrack(trackId, allStudentsRaw);
    if (!canSeeAllStudentTracks(req.user!)) {
      const allowed = await getTeacherStudentIds(req.user!.name);
      studentIds = studentIds.filter((id) => allowed.has(id));
    }
    const students = allStudentsRaw.filter((s) => studentIds.includes(s.id));

    const allGrades = lessonId ? await airtableFetch(TABLES.grades) : [];
    const relevantGrades = lessonId
      ? allGrades.filter((g) => (g.fields[FIELDS.grades.classLinked] || []).includes(lessonId))
      : [];

    res.json({
      students: students.map((s) => {
        const existing = relevantGrades.find((g) => (g.fields[FIELDS.grades.studentLinked] || []).includes(s.id));
        return {
          id: s.id,
          name: s.fields[FIELDS.students.name],
          gradeId: existing?.id || null,
          score: existing ? existing.fields[FIELDS.grades.score] ?? null : null,
          testName: existing ? existing.fields[FIELDS.grades.testName] || null : null,
          date: existing ? existing.fields[FIELDS.grades.date] || null : null,
        };
      }),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת תלמידות' });
  }
});

/** יצירה/עדכון ציון בודד — נקרא לכל תלמידה בנפרד, כמו סימון נוכחות תלמידה בודדת. */
router.post('/saveGrade', requirePermission('grades'), async (req, res) => {
  try {
    const { gradeId, studentId, lessonId, testName, score, date, notes } = req.body as {
      gradeId?: string;
      studentId: string;
      lessonId?: string;
      testName?: string;
      score: number;
      date?: string;
      notes?: string;
    };
    if (!studentId || score === undefined || score === null || Number.isNaN(Number(score))) {
      return res.status(400).json({ error: 'חסר תלמידה או ציון' });
    }

    const fields: Record<string, any> = {
      [FIELDS.grades.studentLinked]: [studentId],
      [FIELDS.grades.score]: Number(score),
    };
    if (testName !== undefined) fields[FIELDS.grades.testName] = testName;
    if (date !== undefined) fields[FIELDS.grades.date] = date;
    if (notes !== undefined) fields[FIELDS.grades.notes] = notes;
    if (lessonId) fields[FIELDS.grades.classLinked] = [lessonId];

    const record = gradeId
      ? await airtableUpdate(TABLES.grades, gradeId, fields)
      : await airtableCreate(TABLES.grades, fields);

    res.json({ success: true, recordId: record.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בשמירת ציון' });
  }
});

export default router;
