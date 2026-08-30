import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { prisma } from '../lib/prisma';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'receipts');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.post('/submitReceipt', upload.single('receiptFile'), async (req, res) => {
  try {
    const { description, month, receiptDate, amount } = req.body;
    if (!description || !amount) return res.status(400).json({ error: 'חסר תיאור או סכום' });

    const receipt = await prisma.receipt.create({
      data: {
        description,
        employeeId: req.user!.id,
        month: month || new Date().toISOString().slice(0, 7),
        receiptDate: receiptDate || new Date().toISOString().slice(0, 10),
        amount: Number(amount),
        receiptFile: req.file ? `/uploads/receipts/${req.file.filename}` : null,
      },
    });
    res.json({ success: true, receipt });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בהגשת קבלה' });
  }
});

router.get('/getMyReceipts', async (req, res) => {
  try {
    const receipts = await prisma.receipt.findMany({
      where: { employeeId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ receipts });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת קבלות' });
  }
});

router.get('/getAllReceipts', requireAdmin, async (req, res) => {
  try {
    const receipts = await prisma.receipt.findMany({
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ receipts });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת קבלות' });
  }
});

router.put('/updateReceiptStatus', requireAdmin, async (req, res) => {
  try {
    const { id, status, adminNotes } = req.body;
    const receipt = await prisma.receipt.update({ where: { id }, data: { status, adminNotes } });
    res.json({ success: true, receipt });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בעדכון קבלה' });
  }
});

export default router;
