import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();
router.use(requireAuth, requireAdmin);

// קבצים (פוסטרים/PDF) נשמרים ב-DB, לא בדיסק — עקבי עם קבלות/חוזים, שורד פריסות מחדש.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const LIST_SELECT = {
  id: true,
  text: true,
  fileName: true,
  fileMime: true,
  isActive: true,
  order: true,
} as const;

router.get('/', async (req, res) => {
  try {
    const announcements = await prisma.announcement.findMany({ orderBy: { order: 'asc' }, select: LIST_SELECT });
    res.json({ announcements });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת הודעות' });
  }
});

router.post('/', upload.single('file'), async (req, res) => {
  try {
    const { text } = req.body as { text?: string };
    if (!text?.trim() && !req.file) return res.status(400).json({ error: 'יש להזין טקסט או לצרף קובץ' });

    const last = await prisma.announcement.findFirst({ orderBy: { order: 'desc' } });
    const announcement = await prisma.announcement.create({
      data: {
        text: text?.trim() || null,
        fileData: req.file?.buffer,
        fileMime: req.file?.mimetype,
        fileName: req.file?.originalname,
        order: (last?.order ?? -1) + 1,
      },
      select: LIST_SELECT,
    });
    res.json({ success: true, announcement });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה ביצירת הודעה' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { text, isActive } = req.body as { text?: string; isActive?: boolean };
    const announcement = await prisma.announcement.update({
      where: { id: req.params.id },
      data: { ...(text !== undefined ? { text } : {}), ...(isActive !== undefined ? { isActive } : {}) },
      select: LIST_SELECT,
    });
    res.json({ success: true, announcement });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בעדכון הודעה' });
  }
});

router.get('/:id/file', async (req, res) => {
  try {
    const announcement = await prisma.announcement.findUnique({ where: { id: req.params.id } });
    if (!announcement?.fileData) return res.status(404).json({ error: 'קובץ לא נמצא' });
    res.set('Content-Type', announcement.fileMime || 'application/octet-stream');
    res.send(announcement.fileData);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת קובץ' });
  }
});

router.post('/:id/move', async (req, res) => {
  try {
    const { direction } = req.body as { direction: 'up' | 'down' };
    const all = await prisma.announcement.findMany({ orderBy: { order: 'asc' } });
    const idx = all.findIndex((a) => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'הודעה לא נמצאה' });
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= all.length) return res.json({ success: true });

    await prisma.$transaction([
      prisma.announcement.update({ where: { id: all[idx].id }, data: { order: all[swapWith].order } }),
      prisma.announcement.update({ where: { id: all[swapWith].id }, data: { order: all[idx].order } }),
    ]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בשינוי סדר' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await prisma.announcement.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה במחיקת הודעה' });
  }
});

export default router;
