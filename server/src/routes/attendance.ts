import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { hasPendingContracts } from '../lib/contracts';
import { calcOvertime, calcTotalHours, getRequiredHoursForDate } from '../lib/hours';
import { syncAttendanceToAirtable, deleteAttendanceFromAirtable } from '../lib/airtable';
import { getHoliday } from '../lib/holidays';
import { getMissingStudentAttendanceDates } from '../lib/teacherAttendanceCheck';

const router = Router();
router.use(requireAuth);

/** מנהל, או "מזכירת נוכחות" (isAttendanceManager) — יכולים למלא/לערוך נוכחות של עובדות אחרות (למשל מורות מחליפות/מבוגרות שלא ממלאות בעצמן). */
function isAttendanceManagerOrAdmin(req: any): boolean {
  return req.user.role === 'מנהל' || !!req.user.isAttendanceManager;
}

function targetUserId(req: any): string {
  return isAttendanceManagerOrAdmin(req) && req.body?.userId ? req.body.userId : req.user.id;
}

async function syncRecord(employee: { id: string; name: string; email: string | null }, record: any) {
  await syncAttendanceToAirtable({
    systemId: record.id,
    employeeName: employee.name,
    employeeEmail: employee.email || undefined,
    date: record.date,
    clockIn: record.clockIn,
    clockOut: record.clockOut,
    clockIn2: record.clockIn2,
    clockOut2: record.clockOut2,
    totalHours: record.totalHours,
    overtimeHours: record.overtimeHours,
    lessonsCount: record.lessonsCount,
    type: record.type,
    notes: record.notes,
    sickNoteUrl: record.sickNoteUrl,
  }).catch((e) => console.error('Airtable sync failed:', e.message));
}

router.post('/clockIn', async (req, res) => {
  try {
    const employeeId = targetUserId(req);
    const { date, clockIn } = req.body as { date: string; clockIn: string };
    if (!date || !clockIn) return res.status(400).json({ error: 'חסר תאריך או שעת כניסה' });

    if (await hasPendingContracts(employeeId)) {
      return res.status(403).json({ error: 'יש חוזים ממתינים לחתימה — יש לחתום לפני המשך' });
    }

    const employee = await prisma.user.findUniqueOrThrow({ where: { id: employeeId } });

    if (employee.role === 'מורה' && employee.trackLessons) {
      try {
        const missingDates = await getMissingStudentAttendanceDates(employee.name, date.slice(0, 7));
        if (missingDates.includes(date)) {
          return res.status(403).json({ error: 'יש להשלים נוכחות תלמידות להיום לפני הכניסה' });
        }
      } catch {
        /* אם Airtable לא זמין/מוגדר — לא חוסמים, כדי לא לנעול משתמשים כשהאינטגרציה לא זמינה */
      }
    }

    const existing = await prisma.attendanceRecord.findFirst({ where: { employeeId, date } });

    let record;
    let shift: 1 | 2;
    if (existing && existing.clockIn && existing.clockOut && !existing.clockIn2) {
      shift = 2;
      record = await prisma.attendanceRecord.update({
        where: { id: existing.id },
        data: { clockIn2: clockIn },
      });
    } else if (existing) {
      return res.status(400).json({ error: 'כבר קיימת כניסה פתוחה ליום זה' });
    } else {
      shift = 1;
      record = await prisma.attendanceRecord.create({
        data: { employeeId, date, clockIn, type: 'רגיל' },
      });
    }

    await syncRecord(employee, record);
    res.json({ success: true, recordId: record.id, shift });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בכניסה' });
  }
});

router.post('/clockOut', async (req, res) => {
  try {
    const { recordId, clockOut, lessonsCount } = req.body as { recordId: string; clockOut: string; lessonsCount?: number };
    if (!recordId || !clockOut) return res.status(400).json({ error: 'חסר מזהה רשומה או שעת יציאה' });

    const record = await prisma.attendanceRecord.findUnique({ where: { id: recordId } });
    if (!record) return res.status(404).json({ error: 'רשומה לא נמצאה' });
    if (record.employeeId !== req.user!.id && !isAttendanceManagerOrAdmin(req)) {
      return res.status(403).json({ error: 'אין הרשאה' });
    }

    const employee = await prisma.user.findUniqueOrThrow({ where: { id: record.employeeId } });
    // מורה שמסומנת "מעקב שיעורים" — חובה למלא כמות שיעורים בכל יציאה, לא ניתן לדלג.
    if (employee.trackLessons && (lessonsCount === undefined || lessonsCount === null || Number.isNaN(lessonsCount))) {
      return res.status(400).json({ error: 'יש להזין כמות שיעורים לפני היציאה' });
    }

    const shift: 1 | 2 = record.clockIn2 && !record.clockOut2 ? 2 : 1;

    const data: Record<string, any> = shift === 2 ? { clockOut2: clockOut } : { clockOut };
    if (lessonsCount !== undefined && lessonsCount !== null && !Number.isNaN(lessonsCount)) {
      data.lessonsCount = lessonsCount;
    }
    const totalHours = calcTotalHours(
      record.clockIn,
      shift === 1 ? clockOut : record.clockOut,
      record.clockIn2,
      shift === 2 ? clockOut : record.clockOut2
    );
    const requiredHours = getRequiredHoursForDate(employee, record.date);
    const overtimeHours = calcOvertime(totalHours, requiredHours);

    const updated = await prisma.attendanceRecord.update({
      where: { id: recordId },
      data: { ...data, totalHours, overtimeHours },
    });

    await syncRecord(employee, updated);
    res.json({ success: true, totalHours: updated.totalHours, shift });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה ביציאה' });
  }
});

router.post('/addSickDay', async (req, res) => {
  try {
    const employeeId = targetUserId(req);
    const { date, type, notes, sickNoteUrl } = req.body as {
      date: string;
      type: 'מחלה' | 'חופשה שנתית' | 'חופשה אישית';
      notes?: string;
      sickNoteUrl?: string;
    };
    if (!date || !type) return res.status(400).json({ error: 'חסר תאריך או סוג' });
    if (type === 'מחלה' && !sickNoteUrl) {
      return res.status(400).json({ error: 'יום מחלה מחייב צירוף אישור מחלה' });
    }
    if (await hasPendingContracts(employeeId)) {
      return res.status(403).json({ error: 'יש חוזים ממתינים לחתימה — יש לחתום לפני המשך' });
    }

    const employee = await prisma.user.findUniqueOrThrow({ where: { id: employeeId } });
    const existing = await prisma.attendanceRecord.findFirst({ where: { employeeId, date } });

    const data = { employeeId, date, type, notes, sickNoteUrl, totalHours: 0, overtimeHours: 0 };
    const record = existing
      ? await prisma.attendanceRecord.update({ where: { id: existing.id }, data })
      : await prisma.attendanceRecord.create({ data });

    await syncRecord(employee, record);
    res.json({ success: true, recordId: record.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בהוספת יום היעדרות' });
  }
});

router.get('/getMyAttendance', async (req, res) => {
  try {
    const employeeId = (isAttendanceManagerOrAdmin(req) && (req.query.userId as string)) || req.user!.id;
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);

    const employee = await prisma.user.findUniqueOrThrow({ where: { id: employeeId } });
    const records = await prisma.attendanceRecord.findMany({
      where: { employeeId, date: { startsWith: month } },
      orderBy: { date: 'asc' },
    });

    const year = Number(month.slice(0, 4));
    const monthNum = Number(month.slice(5, 7));
    const holidays: { date: string; name: string; type: string }[] = [];
    const daysInMonth = new Date(year, monthNum, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${month}-${String(d).padStart(2, '0')}`;
      const h = await getHoliday(dateStr);
      if (h) holidays.push(h);
    }

    const weeklySchedule = {
      sundayHours: employee.sundayHours,
      mondayHours: employee.mondayHours,
      tuesdayHours: employee.tuesdayHours,
      wednesdayHours: employee.wednesdayHours,
      thursdayHours: employee.thursdayHours,
      fridayHours: employee.fridayHours,
      dailyRequiredHours: employee.dailyRequiredHours,
    };

    res.json({ records, holidays, weeklySchedule });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת נוכחות' });
  }
});

router.put('/updateAttendance', async (req, res) => {
  try {
    const { recordId, date, clockIn, clockOut, clockIn2, clockOut2, lessonsCount, type, notes, sickNoteUrl, hasSpecialRate } =
      req.body;

    // אין recordId — זה יום בלי רשומה קיימת (למשל נלחץ העט על יום ריק בטבלה החודשית) — יוצרים חדשה במקום לעדכן.
    if (!recordId) {
      if (!date) return res.status(400).json({ error: 'חסר תאריך' });
      const employeeId = targetUserId(req);
      const existing = await prisma.attendanceRecord.findFirst({ where: { employeeId, date } });
      if (existing) {
        return res.status(400).json({ error: 'כבר קיימת רשומה לתאריך הזה, יש לרענן את הדף' });
      }
      const employee = await prisma.user.findUniqueOrThrow({ where: { id: employeeId } });
      const totalHours = calcTotalHours(clockIn, clockOut, clockIn2, clockOut2);
      const requiredHours = getRequiredHoursForDate(employee, date);
      const overtimeHours = calcOvertime(totalHours, requiredHours);
      const created = await prisma.attendanceRecord.create({
        data: {
          employeeId,
          date,
          clockIn: clockIn || null,
          clockOut: clockOut || null,
          clockIn2: clockIn2 || null,
          clockOut2: clockOut2 || null,
          lessonsCount: lessonsCount || 0,
          type: type || 'רגיל',
          notes: notes || null,
          sickNoteUrl: sickNoteUrl || null,
          hasSpecialRate: !!hasSpecialRate,
          totalHours,
          overtimeHours,
        },
      });
      await syncRecord(employee, created);
      return res.json({ success: true, record: created });
    }

    const record = await prisma.attendanceRecord.findUnique({ where: { id: recordId } });
    if (!record) return res.status(404).json({ error: 'רשומה לא נמצאה' });
    if (record.employeeId !== req.user!.id && !isAttendanceManagerOrAdmin(req)) {
      return res.status(403).json({ error: 'אין הרשאה' });
    }
    const employee = await prisma.user.findUniqueOrThrow({ where: { id: record.employeeId } });

    const merged = {
      clockIn: clockIn ?? record.clockIn,
      clockOut: clockOut ?? record.clockOut,
      clockIn2: clockIn2 ?? record.clockIn2,
      clockOut2: clockOut2 ?? record.clockOut2,
      lessonsCount: lessonsCount ?? record.lessonsCount,
      type: type ?? record.type,
      notes: notes ?? record.notes,
      sickNoteUrl: sickNoteUrl ?? record.sickNoteUrl,
      hasSpecialRate: hasSpecialRate ?? record.hasSpecialRate,
    };
    const totalHours = calcTotalHours(merged.clockIn, merged.clockOut, merged.clockIn2, merged.clockOut2);
    const requiredHours = getRequiredHoursForDate(employee, record.date);
    const overtimeHours = calcOvertime(totalHours, requiredHours);

    const updated = await prisma.attendanceRecord.update({
      where: { id: recordId },
      data: { ...merged, totalHours, overtimeHours },
    });

    await syncRecord(employee, updated);
    res.json({ success: true, record: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בעדכון רשומה' });
  }
});

router.delete('/deleteAttendance', async (req, res) => {
  try {
    const recordId = (req.query.recordId as string) || req.body.recordId;
    const record = await prisma.attendanceRecord.findUnique({ where: { id: recordId } });
    if (!record) return res.status(404).json({ error: 'רשומה לא נמצאה' });
    if (record.employeeId !== req.user!.id && !isAttendanceManagerOrAdmin(req)) {
      return res.status(403).json({ error: 'אין הרשאה' });
    }
    await prisma.attendanceRecord.delete({ where: { id: recordId } });
    await deleteAttendanceFromAirtable(recordId).catch((e) => console.error('Airtable delete failed:', e.message));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה במחיקת רשומה' });
  }
});

export default router;
