import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

// קבצים נשמרים ב-DB (לא בדיסק) — בפרודקשן (Render וכו') מערכת הקבצים לא קבועה בין פריסות.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const LIST_SELECT = {
  id: true,
  title: true,
  employeeId: true,
  status: true,
  fileName: true,
  employeeSignature: true,
  signedAt: true,
  uploadedAt: true,
  notes: true,
} as const;

router.get('/getContracts', async (req, res) => {
  try {
    const isAdmin = req.user!.role === 'מנהל';
    const contracts = await prisma.contract.findMany({
      where: isAdmin ? {} : { employeeId: req.user!.id },
      select: { ...LIST_SELECT, employee: { select: { id: true, name: true } } },
      orderBy: { uploadedAt: 'desc' },
    });
    res.json({ contracts });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת חוזים' });
  }
});

router.post('/uploadContract', requireAdmin, upload.single('contractFile'), async (req, res) => {
  try {
    const { title, employeeId, notes } = req.body;
    if (!title || !employeeId) return res.status(400).json({ error: 'חסר כותרת או עובד' });

    const contract = await prisma.contract.create({
      data: {
        title,
        employeeId,
        notes,
        status: 'ממתין לחתימה',
        fileData: req.file?.buffer,
        fileMime: req.file?.mimetype,
        fileName: req.file?.originalname,
      },
      select: LIST_SELECT,
    });
    res.json({ success: true, contract });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בהעלאת חוזה' });
  }
});

router.get('/:id/file', async (req, res) => {
  try {
    const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
    if (!contract || !contract.fileData) return res.status(404).json({ error: 'קובץ לא נמצא' });
    if (contract.employeeId !== req.user!.id && req.user!.role !== 'מנהל') {
      return res.status(403).json({ error: 'אין הרשאה' });
    }
    res.set('Content-Type', contract.fileMime || 'application/octet-stream');
    res.send(contract.fileData);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת קובץ' });
  }
});

router.post('/signContract', async (req, res) => {
  try {
    const { contractId, signatureDataUrl } = req.body;
    const contract = await prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract) return res.status(404).json({ error: 'חוזה לא נמצא' });
    if (contract.employeeId !== req.user!.id) return res.status(403).json({ error: 'אין הרשאה' });

    const updated = await prisma.contract.update({
      where: { id: contractId },
      data: { status: 'נחתם', employeeSignature: signatureDataUrl, signedAt: new Date() },
      select: LIST_SELECT,
    });
    res.json({ success: true, contract: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בחתימת חוזה' });
  }
});

export default router;
