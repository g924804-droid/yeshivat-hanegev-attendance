import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { airtableFetch, TABLES } from '../lib/airtable';
import { requireAuth, requireAdmin, requireAdminOrAttendanceManager } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get('/getEmployees', requireAdmin, async (req, res) => {
  try {
    const employees = await prisma.user.findMany({ orderBy: { name: 'asc' } });
    res.json({ employees });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת עובדים' });
  }
});

/** רשימה מצומצמת (שם בלבד) לבחירת עובדת בעת מילוי נוכחות עבורה — נגישה גם ל"מזכירת נוכחות", לא רק מנהל מלא. */
router.get('/getEmployeeNames', requireAdminOrAttendanceManager, async (req, res) => {
  try {
    const employees = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    res.json({ employees });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת רשימת עובדים' });
  }
});

router.post('/addEmployee', requireAdmin, async (req, res) => {
  try {
    const employee = await prisma.user.create({ data: req.body });
    res.json({ success: true, employee });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בהוספת עובד' });
  }
});

router.put('/updateEmployee', requireAdmin, async (req, res) => {
  try {
    const { id, ...data } = req.body;
    const employee = await prisma.user.update({ where: { id }, data });
    res.json({ success: true, employee });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בעדכון עובד' });
  }
});

router.delete('/deleteEmployee', requireAdmin, async (req, res) => {
  try {
    const id = (req.query.id as string) || req.body.id;
    await prisma.user.delete({ where: { id } }); // onDelete: Cascade מוחק גם נוכחות/דוחות/קבלות/חוזים
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה במחיקת עובד' });
  }
});

/** מייבא עובדים/מורות מ-Airtable (טבלת סיסמאות + היסטוריית נוכחות) לרשימת העובדים המקומית, כדי שיוכלו להתחבר ולהופיע בנוכחות צוות. */
router.post('/importFromAirtable', requireAdmin, async (req, res) => {
  try {
    const [passwordRecords, attendanceRecords] = await Promise.all([
      airtableFetch(TABLES.passwords),
      airtableFetch(TABLES.employeeAttendance),
    ]);

    const found = new Map<string, { name: string; email?: string }>();

    for (const p of passwordRecords) {
      const name = String(p.fields['שם המשתמש'] || '').trim();
      if (name) found.set(name, { name, ...found.get(name) });
    }
    for (const a of attendanceRecords) {
      const name = String(a.fields['שם עובד'] || '').trim();
      if (!name) continue;
      const email = a.fields['אימייל עובד'] ? String(a.fields['אימייל עובד']).trim() : undefined;
      const existing = found.get(name) || { name };
      found.set(name, { ...existing, email: existing.email || email });
    }

    const existingUsers = await prisma.user.findMany({ select: { name: true } });
    const existingNames = new Set(existingUsers.map((u) => u.name.trim()));

    const createdNames: string[] = [];
    for (const { name, email } of found.values()) {
      if (existingNames.has(name)) continue;
      await prisma.user.create({
        data: { name, email, role: 'מורה', isActive: true, dailyRequiredHours: 8 },
      });
      createdNames.push(name);
    }

    res.json({ success: true, created: createdNames.length, createdNames, totalFoundInAirtable: found.size });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בייבוא עובדים' });
  }
});

router.put('/updateMyProfile', async (req, res) => {
  try {
    const { idNumber, dailyTravelCost, monthlyBusPass } = req.body;
    const employee = await prisma.user.update({
      where: { id: req.user!.id },
      data: { idNumber, dailyTravelCost, monthlyBusPass },
    });
    res.json({ success: true, employee });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בעדכון פרופיל' });
  }
});

export default router;
