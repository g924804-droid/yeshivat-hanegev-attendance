import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { canSeeAllStudentTracks, teacherStudentResolver } from '../lib/teacherScope';
import { getEvaluationMonth, teacherStudents } from '../lib/evaluations';

/** הערכה כללית לתלמידות — ראו lib/evaluations.ts */
const router = Router();
router.use(requireAuth);

const MONTH_RE = /^\d{4}-\d{2}$/;
const MAX_TEXT = 3000;

/** החודש שבו נדרשת הערכה (לכפתור בדף הבית) */
router.get('/status', async (_req, res) => {
  try {
    res.json({ month: await getEvaluationMonth() });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה' });
  }
});

/** התלמידות של המורה המחוברת + מה שכבר כתבה בחודש הנדרש */
router.get('/mine', async (req, res) => {
  try {
    const month = await getEvaluationMonth();
    if (!month) return res.json({ month: null, students: [] });
    const students = await teacherStudents(req.user!.name);
    const saved = await prisma.studentEvaluation.findMany({
      where: { month, teacherId: req.user!.id },
      select: { studentId: true, text: true, updatedAt: true },
    });
    const byId = new Map(saved.map((e) => [e.studentId, e]));
    res.json({
      month,
      students: students.map((s) => ({ ...s, text: byId.get(s.id)?.text || '', updatedAt: byId.get(s.id)?.updatedAt || null })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת התלמידות' });
  }
});

/** שמירת הערכה לתלמידה אחת (טקסט ריק = מחיקה) — רק לתלמידה של המורה, ורק בחודש הנדרש */
router.put('/mine', async (req, res) => {
  try {
    const month = await getEvaluationMonth();
    if (!month) return res.status(400).json({ error: 'כרגע לא נדרשת הערכה כללית' });
    const studentId = String(req.body.studentId || '');
    const text = String(req.body.text ?? '').trim().slice(0, MAX_TEXT);
    const student = (await teacherStudents(req.user!.name)).find((s) => s.id === studentId);
    if (!student) return res.status(403).json({ error: 'התלמידה לא נמצאת ברשימת התלמידות שלך' });
    const key = { month_teacherId_studentId: { month, teacherId: req.user!.id, studentId } };
    if (!text) {
      await prisma.studentEvaluation.deleteMany({ where: { month, teacherId: req.user!.id, studentId } });
      return res.json({ success: true, deleted: true });
    }
    const saved = await prisma.studentEvaluation.upsert({
      where: key,
      create: { month, teacherId: req.user!.id, teacherName: req.user!.name, studentId, studentName: student.name, text },
      update: { text, studentName: student.name, teacherName: req.user!.name },
    });
    res.json({ success: true, updatedAt: saved.updatedAt });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בשמירה' });
  }
});

/** ניהול: מי מילאה וכמה, וכל ההערכות של החודש */
router.get('/admin', async (req, res) => {
  try {
    if (!canSeeAllStudentTracks(req.user!)) return res.status(403).json({ error: 'אין הרשאה' });
    const current = await getEvaluationMonth();
    const month = MONTH_RE.test(String(req.query.month || '')) ? String(req.query.month) : current;
    if (!month) return res.json({ month: null, current, teachers: [], evaluations: [] });
    const [teachers, evaluations, resolve] = await Promise.all([
      prisma.user.findMany({ where: { isActive: true, role: 'מורה' }, select: { id: true, name: true, department: true }, orderBy: { name: 'asc' } }),
      prisma.studentEvaluation.findMany({ where: { month }, orderBy: [{ studentName: 'asc' }] }),
      teacherStudentResolver(),
    ]);
    const rows = teachers
      .map((t) => {
        const ids = resolve(t.name);
        const done = evaluations.filter((e) => e.teacherId === t.id && ids.has(e.studentId)).length;
        return { id: t.id, name: t.name, department: t.department, total: ids.size, done };
      })
      .filter((t) => t.total > 0);
    res.json({
      month,
      current,
      teachers: rows,
      evaluations: evaluations.map((e) => ({
        id: e.id,
        teacherName: e.teacherName,
        studentName: e.studentName,
        text: e.text,
        updatedAt: e.updatedAt,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינה' });
  }
});

/** ניהול: קביעת החודש שבו ההערכה חובה (ריק = ביטול) */
router.put('/month', async (req, res) => {
  try {
    if (!canSeeAllStudentTracks(req.user!)) return res.status(403).json({ error: 'אין הרשאה' });
    const month = req.body.month ? String(req.body.month) : null;
    if (month && !MONTH_RE.test(month)) return res.status(400).json({ error: 'חודש לא תקין' });
    await prisma.siteSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', evaluationMonth: month },
      update: { evaluationMonth: month },
    });
    res.json({ success: true, month });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בשמירה' });
  }
});

export default router;
