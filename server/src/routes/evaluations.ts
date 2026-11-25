import { Router } from 'express';
import { prisma } from '../lib/prisma';
import ExcelJS from 'exceljs';
import { requireAuth } from '../middleware/auth';
import { LessonGroup, teacherLessonGroupsResolver } from '../lib/teacherScope';
import {
  getEvaluationMonth,
  getEvaluationExempt,
  getEvaluationRequired,
  isEvaluationAdmin,
  isEvaluationRequired,
  teacherLessonGroups,
  uniqueStudents,
} from '../lib/evaluations';
import { sendEmail, isEmailConfigured } from '../lib/email';
import {
  ackUrl,
  buildEvaluationEmailHtml,
  EVALUATION_EMAIL_SUBJECT,
  evaluationEmailRecipients,
  israelMonth,
  sendEvaluationEmail,
} from '../lib/evaluationEmail';

/** הערכה כללית לתלמידות — ראו lib/evaluations.ts */
const router = Router();
router.use(requireAuth);

const MONTH_RE = /^\d{4}-\d{2}$/;
const MAX_TEXT = 3000;

/** החודש שבו נדרשת הערכה (לכפתור בדף הבית) */
router.get('/status', async (req, res) => {
  try {
    const month = await getEvaluationMonth();
    // required — האם המשתמשת המחוברת חייבת (גם עובדת שמלמדת ונבחרה במייל, לא רק תפקיד "מורה")
    const required = !!month && (await isEvaluationRequired(req.user!));
    // needsAck — עוד לא אישרה שקראה את ההודעה (נפתח לה חלון בדף הבית)
    const acked = required ? await prisma.evaluationAck.findUnique({ where: { month_userId: { month: month!, userId: req.user!.id } } }) : null;
    res.json({ month, required, needsAck: required && !acked, isAdmin: isEvaluationAdmin(req.user!) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה' });
  }
});

/** ההודעה (נוסח המייל) — לחלון אישור הקריאה */
router.get('/notice', async (_req, res) => {
  res.json({ subject: EVALUATION_EMAIL_SUBJECT, html: buildEvaluationEmailHtml() });
});

/** "קראתי ואני מאשרת" */
router.post('/ack', async (req, res) => {
  try {
    const month = await getEvaluationMonth();
    if (!month) return res.status(400).json({ error: 'כרגע לא נדרשת הערכה כללית' });
    await prisma.evaluationAck.upsert({
      where: { month_userId: { month, userId: req.user!.id } },
      create: { month, userId: req.user!.id, userName: req.user!.name },
      update: {},
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בשמירה' });
  }
});

/**
 * השיעורים של המורה המחוברת (מקצוע × מסלול) והתלמידות בכל שיעור, + ההערכות שכבר כתבה.
 * הערכה אחת לכל תלמידה — גם אם היא מופיעה בכמה שיעורים.
 */
router.get('/mine', async (req, res) => {
  try {
    const month = await getEvaluationMonth();
    if (!month) return res.json({ month: null, groups: [], evaluations: {} });
    const groups = await teacherLessonGroups(req.user!.name);
    const saved = await prisma.studentEvaluation.findMany({
      where: { month, teacherId: req.user!.id },
      select: { studentId: true, text: true },
    });
    res.json({
      month,
      groups: groups.map((g) => ({ key: g.key, subject: g.subject, trackName: g.trackName, students: g.students })),
      evaluations: Object.fromEntries(saved.map((e) => [e.studentId, e.text])),
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
    const studentName = uniqueStudents(await teacherLessonGroups(req.user!.name)).get(studentId);
    if (studentName === undefined) return res.status(403).json({ error: 'התלמידה לא נמצאת ברשימת התלמידות שלך' });
    const student = { name: studentName };
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

/** נתוני הניהול: מי חייבת, כמה מילאה, אישור קריאה, וכל ההערכות (עם השיעורים של כל תלמידה אצל המורה) */
async function adminData(month: string) {
  const [exempt, required] = await Promise.all([getEvaluationExempt(), getEvaluationRequired()]);
  const acks = await prisma.evaluationAck.findMany({ where: { month }, select: { userId: true, ackAt: true, via: true } });
  const ackAt = new Map(acks.map((a) => [a.userId, a.ackAt]));
  const ackVia = new Map(acks.map((a) => [a.userId, a.via]));
  const [teachers, evaluations, resolve] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, ...(required ? { id: { in: [...required] } } : { role: 'מורה' }) },
      select: { id: true, name: true, department: true },
      orderBy: { name: 'asc' },
    }),
    prisma.studentEvaluation.findMany({ where: { month }, orderBy: [{ teacherName: 'asc' }, { studentName: 'asc' }] }),
    teacherLessonGroupsResolver(),
  ]);
  const groupsOf = new Map<string, LessonGroup[]>();
  const rows = teachers
    .map((t) => {
      const groups = resolve(t.name);
      groupsOf.set(t.id, groups);
      const ids = uniqueStudents(groups);
      const done = evaluations.filter((e) => e.teacherId === t.id && ids.has(e.studentId)).length;
      return { id: t.id, name: t.name, department: t.department, total: ids.size, done, ackAt: ackAt.get(t.id) || null, ackVia: ackVia.get(t.id) || null };
    })
    .filter((t) => t.total > 0 && !exempt.has(t.id));
  // באילו שיעורים של המורה התלמידה נמצאת — לאקסל ולתצוגה
  const lessonsOf = (teacherId: string, studentId: string) => {
    const gs = groupsOf.get(teacherId) || [];
    return gs.filter((g) => g.students.some((s) => s.id === studentId));
  };
  return {
    rows,
    evaluations: evaluations.map((e) => {
      const ls = lessonsOf(e.teacherId, e.studentId);
      return {
        id: e.id,
        teacherName: e.teacherName,
        studentName: e.studentName,
        lessons: [...new Set(ls.map((g) => g.subject))].join(', '),
        tracks: [...new Set(ls.map((g) => g.trackName).filter(Boolean))].join(', '),
        text: e.text,
        updatedAt: e.updatedAt,
      };
    }),
  };
}

/** ניהול: מי מילאה וכמה, וכל ההערכות של החודש */
router.get('/admin', async (req, res) => {
  try {
    if (!isEvaluationAdmin(req.user!)) return res.status(403).json({ error: 'אין הרשאה' });
    const current = await getEvaluationMonth();
    const month = MONTH_RE.test(String(req.query.month || '')) ? String(req.query.month) : current;
    if (!month) return res.json({ month: null, current, teachers: [], evaluations: [] });
    const { rows, evaluations } = await adminData(month);
    res.json({
      month,
      current,
      teachers: rows,
      evaluations,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינה' });
  }
});

/** ניהול: אקסל עם כל הנתונים — גיליון הערכות וגיליון מעקב מורות */
router.get('/admin/excel', async (req, res) => {
  try {
    if (!isEvaluationAdmin(req.user!)) return res.status(403).json({ error: 'אין הרשאה' });
    const month = MONTH_RE.test(String(req.query.month || '')) ? String(req.query.month) : await getEvaluationMonth();
    if (!month) return res.status(400).json({ error: 'לא נבחר חודש' });
    const { rows, evaluations } = await adminData(month);
    const wb = new ExcelJS.Workbook();
    const header = (ws: ExcelJS.Worksheet) => {
      const h = ws.getRow(1);
      h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      h.alignment = { vertical: 'middle' };
      ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
    };

    const ev = wb.addWorksheet('הערכות');
    ev.columns = [
      { header: 'מורה', key: 'teacher', width: 22 },
      { header: 'שיעור', key: 'lessons', width: 22 },
      { header: 'מסלול', key: 'tracks', width: 20 },
      { header: 'תלמידה', key: 'student', width: 22 },
      { header: 'הערכה כללית', key: 'text', width: 80 },
      { header: 'עודכן', key: 'updated', width: 16 },
    ];
    for (const e of evaluations) {
      const r = ev.addRow({ teacher: e.teacherName, lessons: e.lessons, tracks: e.tracks, student: e.studentName, text: e.text, updated: e.updatedAt });
      r.getCell('text').alignment = { wrapText: true, vertical: 'top' };
      r.getCell('updated').numFmt = 'dd/mm/yyyy hh:mm';
      r.alignment = { vertical: 'top' };
    }
    header(ev);

    const st = wb.addWorksheet('מעקב מורות');
    st.columns = [
      { header: 'מורה', key: 'name', width: 22 },
      { header: 'מחלקה', key: 'department', width: 14 },
      { header: 'תלמידות', key: 'total', width: 10 },
      { header: 'מולאו', key: 'done', width: 10 },
      { header: 'חסרות', key: 'missing', width: 10 },
      { header: 'סטטוס', key: 'status', width: 14 },
      { header: 'אישרה קריאה', key: 'ack', width: 16 },
      { header: 'איפה אישרה', key: 'via', width: 12 },
    ];
    for (const t of rows) {
      const r = st.addRow({
        name: t.name,
        department: t.department || '',
        total: t.total,
        done: t.done,
        missing: t.total - t.done,
        status: t.done >= t.total ? 'הושלם' : t.done ? 'בתהליך' : 'לא התחילה',
        ack: t.ackAt || 'עוד לא',
        via: t.ackVia === 'email' ? 'במייל' : t.ackVia ? 'באתר' : '',
      });
      if (t.ackAt) r.getCell('ack').numFmt = 'dd/mm/yyyy hh:mm';
      r.getCell('status').font = { color: { argb: t.done >= t.total ? 'FF15803D' : t.done ? 'FFB45309' : 'FFDC2626' } };
    }
    header(st);

    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`הערכה כללית ${month}.xlsx`)}`);
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בייצוא' });
  }
});

/** ניהול: קביעת החודש שבו ההערכה חובה (ריק = ביטול) */
router.put('/month', async (req, res) => {
  try {
    if (!isEvaluationAdmin(req.user!)) return res.status(403).json({ error: 'אין הרשאה' });
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

/** ניהול: תצוגה מקדימה של המייל למורות + למי יישלח */
router.get('/email', async (req, res) => {
  try {
    if (!isEvaluationAdmin(req.user!)) return res.status(403).json({ error: 'אין הרשאה' });
    const [recipients, settings] = await Promise.all([
      evaluationEmailRecipients(),
      prisma.siteSettings.findUnique({ where: { id: 'singleton' }, select: { evaluationEmailMonth: true } }),
    ]);
    res.json({
      subject: EVALUATION_EMAIL_SUBJECT,
      html: buildEvaluationEmailHtml('#'),
      recipients: recipients.map((r) => ({ id: r.id, name: r.name, hasEmail: !!r.email, isTeacher: r.isTeacher })),
      sentThisMonth: settings?.evaluationEmailMonth === israelMonth(),
      month: israelMonth(),
      emailConfigured: isEmailConfigured(),
      myEmail: req.user!.email || '',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה' });
  }
});

/** ניהול: מייל בדיקה לכתובת אחת */
router.post('/email/test', async (req, res) => {
  try {
    if (!isEvaluationAdmin(req.user!)) return res.status(403).json({ error: 'אין הרשאה' });
    const to = String(req.body.to || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: 'כתובת מייל לא תקינה' });
    // בבדיקה הכפתור מאשר בשם מי ששלחה את הבדיקה — כדי לראות שהוא עובד
    await sendEmail(to, `[בדיקה] ${EVALUATION_EMAIL_SUBJECT}`, buildEvaluationEmailHtml(ackUrl(req.user!.id, israelMonth())));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בשליחה' });
  }
});

/** ניהול: שליחה לכל המורות + הפעלת חובת ההערכה לחודש הנוכחי */
router.post('/email/send', async (req, res) => {
  try {
    if (!isEvaluationAdmin(req.user!)) return res.status(403).json({ error: 'אין הרשאה' });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    res.json(await sendEvaluationEmail(ids));
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'שגיאה בשליחה' });
  }
});

export default router;
