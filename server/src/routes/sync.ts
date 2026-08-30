import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { airtableFetch, airtableCreate, airtableUpdate, syncAttendanceToAirtable, TABLES } from '../lib/airtable';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();
router.use(requireAuth, requireAdmin);

// שמות שדות עבור טבלאות הסנכרון (reports/receipts/employees) אינם מפורטים בספק המקורי כמו attendance —
// יש לוודא/להתאים מול העמודות בפועל ב-Airtable לאחר חיבור ה-API key.
async function upsertBySystemId(tableId: string, systemId: string, fields: Record<string, any>) {
  const existing = await airtableFetch(tableId, {
    filterByFormula: `{מזהה מערכת} = "${systemId}"`,
    maxRecords: 1,
  });
  if (existing[0]) {
    await airtableUpdate(tableId, existing[0].id, fields);
  } else {
    await airtableCreate(tableId, fields);
  }
}

async function syncAttendance(month?: string) {
  const records = await prisma.attendanceRecord.findMany({
    where: month ? { date: { startsWith: month } } : {},
    include: { employee: true },
  });
  let synced = 0;
  const errors: string[] = [];
  for (const r of records) {
    try {
      await syncAttendanceToAirtable({
        systemId: r.id,
        employeeName: r.employee.name,
        employeeEmail: r.employee.email || undefined,
        date: r.date,
        clockIn: r.clockIn,
        clockOut: r.clockOut,
        clockIn2: r.clockIn2,
        clockOut2: r.clockOut2,
        totalHours: r.totalHours,
        overtimeHours: r.overtimeHours,
        lessonsCount: r.lessonsCount,
        type: r.type,
        notes: r.notes,
        sickNoteUrl: r.sickNoteUrl,
      });
      synced += 1;
    } catch (e: any) {
      errors.push(`נוכחות ${r.employee.name} ${r.date}: ${e.message}`);
    }
  }
  return { synced, errors };
}

async function syncReports(month?: string) {
  const reports = await prisma.monthlyReport.findMany({
    where: month ? { month } : {},
    include: { employee: true },
  });
  let synced = 0;
  const errors: string[] = [];
  for (const r of reports) {
    try {
      await upsertBySystemId(TABLES.monthlyReports, r.id, {
        'שם עובד': r.employee.name,
        חודש: r.month,
        'ימי עבודה': r.totalWorkDays,
        'סה"כ שעות': r.totalHours,
        'שעות עודפות': r.totalOvertime,
        'ימי מחלה': r.sickDays,
        'ימי חופשה': r.vacationDays,
        סטטוס: r.status,
        'מזהה מערכת': r.id,
      });
      synced += 1;
    } catch (e: any) {
      errors.push(`דוח ${r.employee.name} ${r.month}: ${e.message}`);
    }
  }
  return { synced, errors };
}

async function syncReceipts() {
  const receipts = await prisma.receipt.findMany({ include: { employee: true } });
  let synced = 0;
  const errors: string[] = [];
  for (const r of receipts) {
    try {
      await upsertBySystemId(TABLES.receiptsSync, r.id, {
        תיאור: r.description,
        'שם עובד': r.employee.name,
        חודש: r.month,
        סכום: r.amount,
        סטטוס: r.status,
        'מזהה מערכת': r.id,
      });
      synced += 1;
    } catch (e: any) {
      errors.push(`קבלה ${r.employee.name}: ${e.message}`);
    }
  }
  return { synced, errors };
}

async function syncEmployees() {
  const employees = await prisma.user.findMany();
  let synced = 0;
  const errors: string[] = [];
  for (const e of employees) {
    try {
      await upsertBySystemId(TABLES.employeesSync, e.id, {
        שם: e.name,
        תפקיד: e.role,
        מחלקה: e.department || '',
        פעיל: e.isActive,
        'מזהה מערכת': e.id,
      });
      synced += 1;
    } catch (err: any) {
      errors.push(`עובד ${e.name}: ${err.message}`);
    }
  }
  return { synced, errors };
}

router.post('/syncAttendanceToAirtable', async (req, res) => {
  try {
    const { month, syncType = 'all' } = req.body as { month?: string; syncType?: string };
    const details: Record<string, { synced: number; errors: string[] }> = {};
    let totalSynced = 0;
    const allErrors: string[] = [];

    const run = async (key: string, fn: () => Promise<{ synced: number; errors: string[] }>) => {
      const result = await fn();
      details[key] = result;
      totalSynced += result.synced;
      allErrors.push(...result.errors);
    };

    if (syncType === 'all' || syncType === 'attendance') await run('attendance', () => syncAttendance(month));
    if (syncType === 'all' || syncType === 'reports') await run('reports', () => syncReports(month));
    if (syncType === 'all' || syncType === 'receipts') await run('receipts', () => syncReceipts());
    if (syncType === 'all' || syncType === 'employees') await run('employees', () => syncEmployees());

    res.json({
      success: allErrors.length === 0,
      synced: totalSynced,
      errors: allErrors,
      message: `סונכרנו ${totalSynced} רשומות${allErrors.length ? `, ${allErrors.length} שגיאות` : ''}`,
      details,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בסנכרון' });
  }
});

export default router;
