import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requireAdmin, requireAdminOrAttendanceManager } from '../middleware/auth';
import { buildMonthDetail } from '../lib/monthlyReport';
import { hasPendingContracts } from '../lib/contracts';
import { getMissingStudentAttendanceDates } from '../lib/teacherAttendanceCheck';
import { renderHtmlToPdf, htmlToPdfBuffer, mergePdfs, savePdf } from '../lib/pdf';
import { reportPdfHtml, reportsPdfHtml, summaryPdfHtml, SpecialRateDetail } from '../lib/pdfTemplates';
import { loadSickNotes } from '../lib/sickNotes';
import { DayDetail } from '../lib/monthlyReport';
import { MonthlyReport, User } from '@prisma/client';
import { sendMonthlyReminders } from '../lib/monthlyReminder';

const router = Router();
router.use(requireAuth);

/** שליחה ידנית (בדיקה, או תזכורת חד-פעמית מחוץ ללוח הזמנים האוטומטי). */
router.post('/sendMonthlyReminders', requireAdmin, async (req, res) => {
  try {
    const result = await sendMonthlyReminders();
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בשליחת תזכורות' });
  }
});

/**
 * מי מהעובדים הפעילים היא "עובדת חדשה" (נוצרה החודש הזה) או שיש לה "חוזה חדש" (הועלה או
 * נחתם החודש הזה) — בשביל לסמן לחשבת השכר שיש כאן משהו שכדאי לבדוק, בדוח על-המסך וב-PDF.
 */
async function getNewEmployeeContractFlags(
  month: string
): Promise<Map<string, { isNewEmployee: boolean; hasNewContract: boolean }>> {
  const inMonth = (d: Date | null) => !!d && d.toISOString().slice(0, 7) === month;

  const [employees, contracts] = await Promise.all([
    prisma.user.findMany({ select: { id: true, createdAt: true } }),
    prisma.contract.findMany({ select: { employeeId: true, uploadedAt: true, signedAt: true } }),
  ]);

  const newContractByEmployee = new Set<string>();
  for (const c of contracts) {
    if (inMonth(c.uploadedAt) || inMonth(c.signedAt)) newContractByEmployee.add(c.employeeId);
  }

  const flags = new Map<string, { isNewEmployee: boolean; hasNewContract: boolean }>();
  for (const e of employees) {
    flags.set(e.id, {
      isNewEmployee: inMonth(e.createdAt),
      hasNewContract: newContractByEmployee.has(e.id),
    });
  }
  return flags;
}

/**
 * דוח PDF של עובד/ת אחת, כולל אישורי המחלה שהעלתה: תמונות מוטמעות בדוח עצמו, ואישורים
 * שהועלו כ-PDF מצורפים כעמודים נוספים מיד אחרי הדוח.
 */
async function buildReportPdf(
  employee: User,
  report: MonthlyReport,
  days: DayDetail[],
  signatureDataUrl?: string
): Promise<Buffer> {
  const sickNotes = await loadSickNotes(days);
  const reportPdf = await htmlToPdfBuffer(reportPdfHtml(employee, report, days, signatureDataUrl, sickNotes));
  const attachedPdfs = sickNotes.flatMap((n) => (n.kind === 'pdf' ? [n.data] : []));
  return attachedPdfs.length ? mergePdfs([reportPdf, ...attachedPdfs]) : reportPdf;
}

/**
 * כמה דוחות לקובץ אחד, כל דוח עם אישורי המחלה שלו מיד אחריו. רינדור לכל דוח בנפרד איטי מדי
 * כשיש עשרות מורות (הבקשה נחתכת לפני שהקובץ מוכן), אז מרנדרים רצף דוחות כמסמך אחד, ומפצלים
 * רק אחרי דוח שיש לו אישור מחלה בקובץ PDF — כדי לצרף את עמודי האישור מיד אחריו.
 */
async function buildCombinedReportsPdf(
  sections: { employee: User; report: MonthlyReport; days: DayDetail[] }[]
): Promise<Buffer> {
  const buffers: Buffer[] = [];
  let pending: Parameters<typeof reportsPdfHtml>[0] = [];
  const flush = async () => {
    if (!pending.length) return;
    buffers.push(await htmlToPdfBuffer(reportsPdfHtml(pending)));
    pending = [];
  };

  for (const { employee, report, days } of sections) {
    const sickNotes = await loadSickNotes(days);
    pending.push({ employee, report, days, signatureDataUrl: report.employeeSignature || undefined, sickNotes });
    const attachedPdfs = sickNotes.flatMap((n) => (n.kind === 'pdf' ? [n.data] : []));
    if (attachedPdfs.length) {
      await flush();
      buffers.push(...attachedPdfs);
    }
  }
  await flush();
  return mergePdfs(buffers);
}

/**
 * לכל עובד/ת — הימים בחודש שסומנו "שכר שונה", עם השעות והפירוט שנרשם (למשל "5 שעות ב-120 ש״ח"),
 * כדי שחשבת השכר תראה בסיכום מה בדיוק התעריף ולא רק כמה שעות. אותם סוגי ימים שנספרים בסיכום.
 */
async function getSpecialRateDetails(month: string): Promise<Map<string, SpecialRateDetail[]>> {
  const records = await prisma.attendanceRecord.findMany({
    where: { date: { startsWith: month }, hasSpecialRate: true, type: { in: ['רגיל', 'חצי יום'] } },
    select: { employeeId: true, date: true, totalHours: true, notes: true },
    orderBy: { date: 'asc' },
  });
  const byEmployee = new Map<string, SpecialRateDetail[]>();
  for (const r of records) {
    if (!byEmployee.has(r.employeeId)) byEmployee.set(r.employeeId, []);
    byEmployee.get(r.employeeId)!.push({ date: r.date, hours: r.totalHours, notes: r.notes });
  }
  return byEmployee;
}

function targetUserId(req: any): string {
  const canManage = req.user.role === 'מנהל' || !!req.user.isAttendanceManager;
  return canManage && (req.body?.userId || req.query?.userId) ? req.body?.userId || req.query?.userId : req.user.id;
}

/**
 * דוח שהוגש/אושר "קפוא" — הסכומים לא מתעדכנים מעצמם, כדי שיתאימו למה שהעובדת חתמה עליו.
 * force = ההנהלה ערכה ימים בתוך הדוח, ואז מחשבים מחדש את הסכומים (הסטטוס והחתימה נשארים).
 */
async function calculateAndUpsert(employeeId: string, month: string, force = false) {
  const employee = await prisma.user.findUniqueOrThrow({ where: { id: employeeId } });
  const existing = await prisma.monthlyReport.findUnique({ where: { employeeId_month: { employeeId, month } } });
  if (existing && existing.status !== 'טיוטה' && !force) {
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
    const canManage = req.user!.role === 'מנהל' || !!req.user!.isAttendanceManager;
    const { report, days } = await calculateAndUpsert(employeeId, month, canManage && req.query.recalc === '1');
    const employee = await prisma.user.findUniqueOrThrow({ where: { id: employeeId } });

    let missingReceipt = false;
    if (employee.employmentType === 'נגד קבלה') {
      const hasReceipt = await prisma.receipt.findFirst({ where: { employeeId, month } });
      missingReceipt = !hasReceipt;
    }

    res.json({ report, days, employeeName: employee.name, missingReceipt });
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

    const employee = await prisma.user.findUniqueOrThrow({ where: { id: report.employeeId } });

    // עובדת "נגד קבלה" (לא שכירה רגילה) — לא ניתן להגיש דוח חודשי בלי שהעלתה קבלה לחודש הזה,
    // אחרת חשבת השכר לא יכולה לשלם לה כלל.
    if (employee.employmentType === 'נגד קבלה') {
      const hasReceipt = await prisma.receipt.findFirst({
        where: { employeeId: employee.id, month: report.month },
      });
      if (!hasReceipt) {
        return res.status(400).json({ error: 'עובדת נגד קבלה — יש להעלות קבלה לחודש הזה לפני הגשת הדוח' });
      }
    }

    if (employee.role === 'מורה' && employee.trackLessons) {
      try {
        const missingDates = await getMissingStudentAttendanceDates(employee.name, report.month);
        if (missingDates.length > 0) {
          return res.status(400).json({
            error: `יש להשלים נוכחות תלמידות לפני הגשת הדוח, לתאריכים: ${missingDates.join(', ')}`,
          });
        }
      } catch {
        /* אם Airtable לא מוגדר/נכשל — לא חוסמים, כדי לא לנעול משתמשים כשהאינטגרציה לא זמינה */
      }
    }

    const updated = await prisma.monthlyReport.update({
      where: { id: reportId },
      data: { status: 'הוגש', employeeSignature: signatureDataUrl },
    });

    res.json({ success: true, report: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בהגשת הדוח' });
  }
});

router.post('/approveReport', requireAdminOrAttendanceManager, async (req, res) => {
  try {
    const { reportId } = req.body as { reportId: string };
    const updated = await prisma.monthlyReport.update({ where: { id: reportId }, data: { status: 'אושר' } });
    res.json({ success: true, report: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה באישור הדוח' });
  }
});

/** ביטול הגשה/אישור — מחזיר דוח לטיוטה, כדי שאפשר יהיה לתקן ולהגיש מחדש (או פשוט לבטל הגשת בדיקה). */
router.post('/revertReportToDraft', requireAdminOrAttendanceManager, async (req, res) => {
  try {
    const { reportId } = req.body as { reportId: string };
    const updated = await prisma.monthlyReport.update({
      where: { id: reportId },
      data: { status: 'טיוטה', employeeSignature: null },
    });
    res.json({ success: true, report: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בביטול ההגשה' });
  }
});

router.get('/getAllReports', requireAdminOrAttendanceManager, async (req, res) => {
  try {
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    // עובדת "חודשי" (משכורת גלובלית) לא צריכה להגיש דוח שעות בכלל — השכר שלה לא תלוי בשעות.
    // לא נספרת כ"חסרה" ולא בסך העובדים הנדרשים, כדי שהתצוגה תשקף רק מי שבאמת צריכה להגיש.
    const employees = await prisma.user.findMany({ where: { isActive: true, employmentType: { not: 'חודשי' } } });
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

    const flags = await getNewEmployeeContractFlags(month);

    // קבלות שהוגשו וממתינות לאישור — כדי שהנהלת החשבונות תראה בסיכום הדוחות אצל איזו מורה מחכות קבלות.
    // כל הקבלות הממתינות של העובד/ת (לא רק של החודש המוצג), כי קבלה ישנה שנשכחה חשובה לא פחות.
    const pendingGroups = await prisma.receipt.groupBy({
      by: ['employeeId'],
      where: { status: 'ממתין' },
      _count: { _all: true },
    });
    const pendingByEmployee = new Map(pendingGroups.map((g) => [g.employeeId, g._count._all]));
    const pendingEmployees = await prisma.user.findMany({
      where: { id: { in: [...pendingByEmployee.keys()] } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const pendingReceipts = pendingEmployees.map((e) => ({ id: e.id, name: e.name, count: pendingByEmployee.get(e.id)! }));

    const specialRateDetails = await getSpecialRateDetails(month);
    const reportsWithFlags = reports.map((r) => ({
      ...r,
      ...(flags.get(r.employeeId) || { isNewEmployee: false, hasNewContract: false }),
      pendingReceipts: pendingByEmployee.get(r.employeeId) || 0,
      specialRateDetails: specialRateDetails.get(r.employeeId) || [],
    }));

    res.json({
      reports: reportsWithFlags,
      missingEmployees,
      pendingReceipts,
      summary: { ...summary, pendingReceipts: pendingReceipts.reduce((s, p) => s + p.count, 0) },
    });
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

    const pdf = await buildReportPdf(employee, report, days, signatureDataUrl || report.employeeSignature || undefined);
    const { url, filename } = savePdf(pdf, {
      subdir: 'reports',
      filename: `דוח-${employee.name}-${report.month}.pdf`,
    });
    await prisma.monthlyReport.update({ where: { id: reportId }, data: { pdfUrl: url } });
    res.json({ url, filename });
  } catch (err: any) {
    res.status(500).json({ error: pdfErrorMessage(err) });
  }
});

router.get('/exportSummaryPdf', requireAdminOrAttendanceManager, async (req, res) => {
  try {
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    const reports = await prisma.monthlyReport.findMany({ where: { month }, include: { employee: true } });
    const flags = await getNewEmployeeContractFlags(month);
    const html = summaryPdfHtml(month, reports, flags, await getSpecialRateDetails(month));
    const { url, filename } = await renderHtmlToPdf(html, {
      subdir: 'summaries',
      filename: `סיכום-${month}.pdf`,
      landscape: true,
    });
    res.json({ url, filename });
  } catch (err: any) {
    res.status(500).json({ error: pdfErrorMessage(err) });
  }
});

/**
 * דוח מלא (פירוט יומי) של כל המורות הפעילות ביחד, בקובץ אחד — כדי שלא יהיה צורך להוציא את
 * הדוח המלא של כל מורה בנפרד אחת-אחת. מורה בלי דוח מחושב לחודש הזה — מחושב ונוצר כטיוטה כאן.
 */
router.get('/exportAllTeacherReportsPdf', requireAdminOrAttendanceManager, async (req, res) => {
  try {
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    const teachers = await prisma.user.findMany({
      where: { role: 'מורה', isActive: true },
      orderBy: { name: 'asc' },
    });
    const sections = await Promise.all(
      teachers.map(async (employee) => {
        const { report, days } = await calculateAndUpsert(employee.id, month);
        return { employee, report, days };
      })
    );
    const { url, filename } = savePdf(await buildCombinedReportsPdf(sections), {
      subdir: 'summaries',
      filename: `דוחות-מורות-${month}.pdf`,
    });
    res.json({ url, filename });
  } catch (err: any) {
    res.status(500).json({ error: pdfErrorMessage(err) });
  }
});

/**
 * כל הדוחות המלאים של מי שהגישה (הוגש/אושר) לחודש מסוים, בקובץ PDF אחד — כל דוח בעמוד חדש,
 * עם החתימה שלה. טיוטות וחסרות לא נכללות.
 */
router.get('/exportSubmittedReportsPdf', requireAdminOrAttendanceManager, async (req, res) => {
  try {
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    const reports = await prisma.monthlyReport.findMany({
      where: { month, status: { in: ['הוגש', 'אושר'] } },
      include: { employee: true },
      orderBy: { employee: { name: 'asc' } },
    });
    if (reports.length === 0) {
      return res.status(400).json({ error: 'אין דוחות שהוגשו לחודש הזה' });
    }
    const sections = await Promise.all(
      reports.map(async ({ employee, ...report }) => {
        const { days } = await buildMonthDetail(employee, month);
        return { employee, report, days };
      })
    );
    const { url, filename } = savePdf(await buildCombinedReportsPdf(sections), {
      subdir: 'summaries',
      filename: `דוחות-שהוגשו-${month}.pdf`,
    });
    res.json({ url, filename });
  } catch (err: any) {
    res.status(500).json({ error: pdfErrorMessage(err) });
  }
});

/** רגע ראשון אחרי עליית שרת, לפני שהדפדפן להדפסה סיים להתחמם, יכול עדיין להיכשל ב-timeout — הודעה ברורה עם הנחיה לנסות שוב, במקום טקסט שגיאה טכני. */
function pdfErrorMessage(err: any): string {
  if (String(err?.message || '').includes('Navigation timeout')) {
    return 'ההדפסה עדיין מתחממת אחרי עליית השרת — נסי שוב בעוד כמה שניות';
  }
  return err?.message || 'שגיאה בייצוא PDF';
}

export default router;
