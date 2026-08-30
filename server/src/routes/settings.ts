import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth, requirePermission('system'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/', async (req, res) => {
  try {
    const settings = await prisma.siteSettings.findUnique({ where: { id: 'singleton' } });
    res.json({ siteName: settings?.siteName || null, hasLogo: !!settings?.logoData });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת הגדרות' });
  }
});

router.put('/', upload.single('logo'), async (req, res) => {
  try {
    const { siteName } = req.body as { siteName?: string };
    const data: Record<string, any> = {};
    if (siteName !== undefined) data.siteName = siteName.trim() || null;
    if (req.file) {
      data.logoData = req.file.buffer;
      data.logoMime = req.file.mimetype;
    }

    const settings = await prisma.siteSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...data },
      update: data,
    });
    res.json({ success: true, siteName: settings.siteName, hasLogo: !!settings.logoData });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בשמירת הגדרות' });
  }
});

export default router;
