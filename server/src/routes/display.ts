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
      select: { id: true, text: true, fileName: true, fileMime: true },
    });
    res.json({ announcements });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת הודעות' });
  }
});

router.get('/announcements/:id/file', async (req, res) => {
  try {
    const announcement = await prisma.announcement.findUnique({ where: { id: req.params.id } });
    if (!announcement?.fileData || !announcement.isActive) return res.status(404).json({ error: 'קובץ לא נמצא' });
    res.set('Content-Type', announcement.fileMime || 'application/octet-stream');
    res.send(announcement.fileData);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת קובץ' });
  }
});

router.get('/settings', async (req, res) => {
  try {
    const settings = await prisma.siteSettings.findUnique({ where: { id: 'singleton' } });
    res.json({ siteName: settings?.siteName || null, hasLogo: !!settings?.logoData });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת הגדרות' });
  }
});

router.get('/logo', async (req, res) => {
  try {
    const settings = await prisma.siteSettings.findUnique({ where: { id: 'singleton' } });
    if (!settings?.logoData) return res.status(404).json({ error: 'לוגו לא נמצא' });
    res.set('Content-Type', settings.logoMime || 'image/png');
    res.send(settings.logoData);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת לוגו' });
  }
});

export default router;
