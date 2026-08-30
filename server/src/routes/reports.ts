import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { buildMonthDetail } from '../lib/monthlyReport';
import { hasPendingContracts } from '../lib/contracts';
import { airtableFetch, TABLES } from '../lib/airtable';
import { renderHtmlToPdf } from '../lib/pdf';
import { reportPdfHtml, summaryPdfHtml } from '../lib/pdfTemplates';

const router = Router();
router.use(requireAuth);

function targetUserId(req: any): string {
  const isAdmin = req.user.role === 'מנהל';
  return isAdmin && (req.body?.userId || req.query?.userId) ? req.body?.userId || req.query?.userId : req.user.id;
}

async function calculateAndUpsert(employeeId: string, month: string) {
  const employee = await prisma.user.findUniqueOrThrow({ where: { id: employeeId } });
  const existing = await prisma.monthlyReport.findUnique({ where: { employeeId_month: { employeeId, month } } });
  if (existing && existing.status !== 'טיוטה') {
    return { report: existing, days: (await buildMonthDetail(employee, month)).days };
  }

  const { days, totals } = await buildMonthDetail(employee, month);
  const report = await prisma.monthlyReport.upsert({
    where: { employeeId_month: { employeeId, month } },
    create: { employeeId, month, ...totals, status: 'טיוטה' },
    update: { ...totals },
  });
  return { report, days };
}

router.post('/calculateMonthlyReport', async (req, res) => {
  try {
    const employeeId = targetUserId(req);
    const { month } = req.body as { month: string };
    if (!month) return res.status(400).json({ error: 'חסר חודש' });
    const { report } = await calculateAndUpsert(employeeId, month);
    res.json({ success: true, reportId: report.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בחישוב הדוח' });
  }
});

router.get('/getMonthlyReport', async (req, res) => {
  try {
    const employeeId = targetUserId(req);
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    const { report, days } = await calculateAndUpsert(employeeId, month);
    res.json({ report, days });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת הדוח' });
  }
});

router.post('/submitMonthlyReport', async (req, res) => {
  try {
    const { reportId, signatureDataUrl } = req.body as { reportId: string; signatureDataUrl: string };
    if (!signatureDataUrl) return res.status(400).json({ error: 'חובה לצרף חתימה' });

    const report = await prisma.monthlyReport.findUnique({ where: { id: reportId } });
    if (!report) return res.status(404).json({ error: 'דוח לא נמצא' });
    if (report.employeeId !== req.user!.id && req.user!.role !== 'מנהל') {
      return res.status(403).json({ error: 'אין הרשאה' });
    }

    if (await hasPendingContracts(report.employeeId)) {
      return res.status(403).json({ error: 'יש חוזים ממתינים לחתימה — יש לחתום לפני הגשה' });
    }

    const sickRecordsMissingNote = await prisma.attendanceRecord.findFirst({
      where: { employeeId: report.employeeId, date: { startsWith: report.month }, type: 'מחלה', sickNoteUrl: null },
    });
    if (sickRecordsMissingNote) {
      return res.status(400).json({ error: `חסר אישור מחלה לתאריך ${sickRecordsMissingNote.date}` });
    }

    let warning: string | undefined;
    const employee = await prisma.user.findUniqueOrThrow({ where: { id: report.employeeId } });
    if (employee.role === 'מורה' && employee.trackLessons) {
      try {
        const monthAttendance = await airtableFetch(TABLES.attendance, {
          filterByFormula: `FIND("${report.month}", {תאריך})`,
        });
        if (monthAttendance.length === 0) warning = 'לא נמצאה נוכחות תלמידות מתועדת לחודש זה';
      } catch {
        /* אם Airtable לא מוגדר — לא חוסמים */
      }
    }

    const updated = await prisma.monthlyReport.update({
      where: { id: reportId },
      data: { status: 'הוגש', employeeSignature: signatureDataUrl },
    });

    res.json({ success: true, report: updated, warning });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בהגשת הדוח' });
  }
});

router.post('/approveReport', requireAdmin, async (req, res) => {
  try {
    const { reportId } = req.body as { reportId: string };
    const updated = await prisma.monthlyReport.update({ where: { id: reportId }, data: { status: 'אושר' } });
    res.json({ success: true, report: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה באישור הדוח' });
  }
});

router.get('/getAllReports', requireAdmin, async (req, res) => {
  try {
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    const employees = await prisma.user.findMany({ where: { isActive: true } });
    const reports = await prisma.monthlyReport.findMany({
      where: { month },
      include: { employee: true },
    });

    const reportedIds = new Set(reports.map((r) => r.employeeId));
    const missingEmployees = employees.filter((e) => !reportedIds.has(e.id)).map((e) => ({ id: e.id, name: e.name }));

    const summary = {
      totalEmployees: employees.length,
      submitted: reports.filter((r) => r.status === 'הוגש').length,
      approved: reports.filter((r) => r.status === 'אושר').length,
      draft: reports.filter((r) => r.status === 'טיוטה').length,
      missing: missingEmployees.length,
    };

    res.json({ reports, missingEmployees, summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת הדוחות' });
  }
});

router.post('/exportReportPdf', async (req, res) => {
  try {
    const { reportId, signatureDataUrl } = req.body as { reportId: string; signatureDataUrl?: string };
    const report = await prisma.monthlyReport.findUnique({ where: { id: reportId } });
    if (!report) return res.status(404).json({ error: 'דוח לא נמצא' });
    if (report.employeeId !== req.user!.id && req.user!.role !== 'מנהל') {
      return res.status(403).json({ error: 'אין הרשאה' });
    }
    const employee = await prisma.user.findUniqueOrThrow({ where: { id: report.employeeId } });
    const { days } = await buildMonthDetail(employee, report.month);

    const html = reportPdfHtml(employee, report, days, signatureDataUrl || report.employeeSignature || undefined);
    const { url, filename } = await renderHtmlToPdf(html, {
      subdir: 'reports',
      filename: `דוח-${employee.name}-${report.month}.pdf`,
    });
    await prisma.monthlyReport.update({ where: { id: reportId }, data: { pdfUrl: url } });
    res.json({ url, filename });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בייצוא PDF' });
  }
});

router.get('/exportSummaryPdf', requireAdmin, async (req, res) => {
  try {
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    const reports = await prisma.monthlyReport.findMany({ where: { month }, include: { employee: true } });
    const html = summaryPdfHtml(month, reports);
    const { url, filename } = await renderHtmlToPdf(html, {
      subdir: 'summaries',
      filename: `סיכום-${month}.pdf`,
      landscape: true,
    });
    res.json({ url, filename });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בייצוא סיכום' });
  }
});

export default router;
