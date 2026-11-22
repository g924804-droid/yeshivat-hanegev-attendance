import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requireAdminOrAttendanceManager } from '../middleware/auth';
import { currentMonthIL, isMonthLockedFor, LOCK_FROM_MONTH } from '../lib/monthLock';
import { calcTotalHours } from '../lib/hours';
import { getHolidaysForYear } from '../lib/holidays';
import { buildMonthDetail } from '../lib/monthlyReport';
import { LateDay, LATE_STATUS, lateDays, monthLabelHe } from '../lib/lateCompletion';

/** השלמת חודש קודם שננעל — ראו lib/lateCompletion.ts */
const router = Router();
router.use(requireAuth);

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const time = (v: unknown) => {
  const s = String(v ?? '').trim();
  return TIME.test(s) ? s : '';
};

function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** חודשים נעולים לעובדת (עד חצי שנה אחורה) שעוד אין להם השלמה פעילה */
async function allowedMonths(employeeId: string): Promise<string[]> {
  const out: string[] = [];
  let m = prevMonth(currentMonthIL());
  for (let i = 0; i < 6 && m >= LOCK_FROM_MONTH; i++, m = prevMonth(m)) {
    if (await isMonthLockedFor(employeeId, m)) out.push(m);
  }
  return out;
}

const summary = (c: { days: unknown }) => {
  const days = (Array.isArray(c.days) ? c.days : []) as LateDay[];
  return { workDays: days.length, hours: Math.round(days.reduce((s, d) => s + d.hours, 0) * 100) / 100, lessons: days.reduce((s, d) => s + d.lessons, 0) };
};

/** הטופס: החודשים שאפשר להשלים, וימי החודש שנבחר (מה כבר רשום, שבתות וחגים) */
router.get('/form', async (req, res) => {
  try {
    const employeeId = req.user!.id;
    const months = await allowedMonths(employeeId);
    const mine = await prisma.lateCompletion.findMany({ where: { employeeId }, orderBy: { createdAt: 'desc' }, take: 20 });
    const month = String(req.query.month || '') || months[0] || '';
    let days: any[] = [];
    if (month && months.includes(month)) {
      const [y, mo] = month.split('-').map(Number);
      const holidays = (await getHolidaysForYear(y)).filter((h) => h.date.startsWith(month));
      const records = await prisma.attendanceRecord.findMany({ where: { employeeId, date: { startsWith: month } } });
      const last = new Date(y, mo, 0).getDate();
      for (let d = 1; d <= last; d++) {
        const date = `${month}-${String(d).padStart(2, '0')}`;
        const dow = new Date(`${date}T00:00:00`).getDay();
        const h = holidays.find((x) => x.date === date);
        const r = records.find((x) => x.date === date);
        days.push({
          date,
          dow,
          holiday: h ? { name: h.name, type: h.type } : null,
          existing: r ? { type: r.type, clockIn: r.clockIn, clockOut: r.clockOut, totalHours: r.totalHours } : null,
        });
      }
    }
    res.json({
      months: months.map((m) => ({ month: m, label: monthLabelHe(m), active: mine.find((c) => c.forMonth === m && c.status !== LATE_STATUS.rejected)?.status || null })),
      month,
      days,
      mine: mine.map(({ signature, days: d, ...c }) => ({ ...c, ...summary({ days: d }), forLabel: monthLabelHe(c.forMonth), inLabel: monthLabelHe(c.inMonth) })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת הטופס' });
  }
});

router.post('/', async (req, res) => {
  try {
    const employeeId = req.user!.id;
    const { forMonth, note, signature } = req.body as { forMonth: string; note?: string; signature?: string };
    if (!(await allowedMonths(employeeId)).includes(forMonth)) {
      return res.status(400).json({ error: 'אי אפשר לשלוח השלמה לחודש הזה (הוא לא נעול, או שעבר יותר מחצי שנה)' });
    }
    if (!signature || !String(signature).startsWith('data:image/')) return res.status(400).json({ error: 'חובה לחתום' });
    const active = await prisma.lateCompletion.findFirst({ where: { employeeId, forMonth, status: { not: LATE_STATUS.rejected } } });
    if (active) return res.status(400).json({ error: `כבר נשלחה השלמה ל${monthLabelHe(forMonth)} (${active.status === LATE_STATUS.approved ? 'אושרה' : 'ממתינה לאישור'})` });

    const existing = new Set(
      (await prisma.attendanceRecord.findMany({ where: { employeeId, date: { startsWith: forMonth } }, select: { date: true } })).map((r) => r.date)
    );
    const days: LateDay[] = [];
    for (const raw of (Array.isArray(req.body.days) ? req.body.days : []) as any[]) {
      const date = String(raw?.date || '');
      if (!date.startsWith(forMonth + '-') || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const day = {
        date,
        clockIn: time(raw.clockIn),
        clockOut: time(raw.clockOut),
        clockIn2: time(raw.clockIn2),
        clockOut2: time(raw.clockOut2),
        lessons: Math.max(0, Math.min(30, Math.floor(Number(raw.lessons) || 0))),
        notes: String(raw.notes || '').trim().slice(0, 300),
        hours: 0,
      };
      if (!day.clockIn && !day.clockOut && !day.clockIn2 && !day.clockOut2 && !day.lessons && !day.notes) continue;
      if (existing.has(date)) return res.status(400).json({ error: `ליום ${date} כבר רשומה נוכחות בחודש` });
      if ((day.clockIn && !day.clockOut) || (!day.clockIn && day.clockOut)) return res.status(400).json({ error: `ביום ${date} חסרה שעת כניסה או יציאה` });
      if ((day.clockIn2 && !day.clockOut2) || (!day.clockIn2 && day.clockOut2)) return res.status(400).json({ error: `ביום ${date} חסרה שעת כניסה או יציאה במשמרת 2` });
      day.hours = calcTotalHours(day.clockIn, day.clockOut, day.clockIn2, day.clockOut2);
      if (day.clockIn && day.hours <= 0) return res.status(400).json({ error: `ביום ${date} שעת היציאה לפני שעת הכניסה` });
      days.push(day);
    }
    if (!days.length) return res.status(400).json({ error: 'לא מולא אף יום' });
    days.sort((a, b) => a.date.localeCompare(b.date));

    const inMonth = currentMonthIL();
    const created = await prisma.lateCompletion.create({
      data: {
        employeeId,
        forMonth,
        inMonth,
        days: days as any,
        employeeNote: String(note || '').trim().slice(0, 1000) || null,
        signature,
        status: LATE_STATUS.pending,
      },
    });
    // שהעובדת תופיע בדוחות של החודש הנוכחי גם אם עוד לא התחילה בו
    const report = await prisma.monthlyReport.findUnique({ where: { employeeId_month: { employeeId, month: inMonth } } });
    if (!report) {
      const employee = await prisma.user.findUniqueOrThrow({ where: { id: employeeId } });
      const { totals } = await buildMonthDetail(employee, inMonth);
      await prisma.monthlyReport.create({ data: { employeeId, month: inMonth, ...totals, status: 'טיוטה' } }).catch(() => {});
    }
    res.json({ success: true, id: created.id, inLabel: monthLabelHe(inMonth) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בשליחת ההשלמה' });
  }
});

/** ההנהלה: ההשלמות שצורפו לחודש מסוים, וכמה ממתינות בסך הכל */
router.get('/month', requireAdminOrAttendanceManager, async (req, res) => {
  try {
    const month = String(req.query.month || '') || currentMonthIL();
    const [list, pending] = await Promise.all([
      prisma.lateCompletion.findMany({ where: { inMonth: month }, include: { employee: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } }),
      prisma.lateCompletion.findMany({ where: { status: LATE_STATUS.pending }, select: { inMonth: true } }),
    ]);
    res.json({
      completions: list.map((c) => ({ ...c, ...summary(c), forLabel: monthLabelHe(c.forMonth), days: lateDays(c) })),
      pendingOtherMonths: [...new Set(pending.map((p) => p.inMonth).filter((m) => m !== month))].map((m) => ({ month: m, label: monthLabelHe(m) })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת ההשלמות' });
  }
});

router.post('/:id/review', requireAdminOrAttendanceManager, async (req, res) => {
  try {
    const approve = !!req.body.approve;
    const note = String(req.body.note || '').trim().slice(0, 1000) || null;
    if (!approve && !note) return res.status(400).json({ error: 'בדחייה יש לכתוב למורה מה הסיבה' });
    await prisma.lateCompletion.update({
      where: { id: req.params.id },
      data: { status: approve ? LATE_STATUS.approved : LATE_STATUS.rejected, reviewNote: note, reviewedBy: req.user!.name, reviewedAt: new Date() },
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בשמירה' });
  }
});

/** ביטול: המורה — רק השלמה שעוד ממתינה; ההנהלה — כל השלמה */
router.delete('/:id', async (req, res) => {
  try {
    const c = await prisma.lateCompletion.findUnique({ where: { id: req.params.id } });
    if (!c) return res.status(404).json({ error: 'ההשלמה לא נמצאה' });
    const manager = req.user!.role === 'מנהל' || !!req.user!.isAttendanceManager;
    if (!manager && (c.employeeId !== req.user!.id || c.status !== LATE_STATUS.pending)) {
      return res.status(403).json({ error: 'אפשר לבטל רק השלמה שעוד ממתינה לאישור' });
    }
    await prisma.lateCompletion.delete({ where: { id: c.id } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בביטול' });
  }
});

export default router;
