import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requireAdmin } from '../middleware/auth';

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
