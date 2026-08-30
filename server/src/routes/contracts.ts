import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { prisma } from '../lib/prisma';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'contracts');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.get('/getContracts', async (req, res) => {
  try {
    const isAdmin = req.user!.role === 'מנהל';
    const contracts = await prisma.contract.findMany({
      where: isAdmin ? {} : { employeeId: req.user!.id },
      include: { employee: true },
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
        contractFileUrl: req.file ? `/uploads/contracts/${req.file.filename}` : null,
      },
    });
    res.json({ success: true, contract });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בהעלאת חוזה' });
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
    });
    res.json({ success: true, contract: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בחתימת חוזה' });
  }
});

export default router;
