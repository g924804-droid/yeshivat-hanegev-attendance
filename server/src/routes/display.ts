import { Router } from 'express';
import { getFullSchedule } from '../lib/scheduleData';
import { prisma } from '../lib/prisma';

// ראוטר ציבורי (ללא requireAuth בכוונה) — מיועד למסך תצוגה גדול בישיבה
// (מערכת שעות + הודעות), ללא מידע רגיש, כדי שאפשר יהיה לפתוח אותו בלי התחברות.
const router = Router();

router.get('/schedule', async (req, res) => {
  try {
    res.json(await getFullSchedule());
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת מערכת השעות' });
  }
});

router.get('/announcements', async (req, res) => {
  try {
    const announcements = await prisma.announcement.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
    });
    res.json({ announcements });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת הודעות' });
  }
});

export default router;
