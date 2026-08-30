import { Router } from 'express';
import { airtableFetch, airtableUpdate, TABLES } from '../lib/airtable';
import { FIELDS } from '../lib/airtableFields';
import { getTeacherStudentIds } from '../lib/teacherScope';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get('/getGrades', requirePermission('grades'), async (req, res) => {
  try {
    const trackId = req.query.trackId as string | undefined;
    let grades = await airtableFetch(TABLES.grades);

    if (req.user!.role !== 'מנהל') {
      const allowedStudentIds = await getTeacherStudentIds(req.user!.name);
      grades = grades.filter((g) =>
        (g.fields[FIELDS.grades.studentLinked] || []).some((id: string) => allowedStudentIds.has(id))
      );
    }

    if (trackId) {
      const students = await airtableFetch(TABLES.students);
      const trackStudentIds = new Set(
        students
          .filter((s) => (s.fields[FIELDS.students.track] || []).includes(trackId))
          .map((s) => s.id)
      );
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

export default router;
