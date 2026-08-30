import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

// קבצים נשמרים ב-DB (לא בדיסק) — בפרודקשן (Render וכו') מערכת הקבצים לא קבועה בין פריסות.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const LIST_SELECT = {
  id: true,
  description: true,
  employeeId: true,
  month: true,
  receiptDate: true,
  amount: true,
  fileName: true,
  status: true,
  adminNotes: true,
  createdAt: true,
} as const;

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
        fileData: req.file?.buffer,
        fileMime: req.file?.mimetype,
        fileName: req.file?.originalname,
      },
      select: LIST_SELECT,
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
      select: LIST_SELECT,
    });
    res.json({ receipts });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת קבלות' });
  }
});

router.get('/getAllReceipts', requireAdmin, async (req, res) => {
  try {
    const receipts = await prisma.receipt.findMany({
      orderBy: { createdAt: 'desc' },
      select: { ...LIST_SELECT, employee: { select: { name: true } } },
    });
    res.json({ receipts });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת קבלות' });
  }
});

router.get('/:id/file', async (req, res) => {
  try {
    const receipt = await prisma.receipt.findUnique({ where: { id: req.params.id } });
    if (!receipt || !receipt.fileData) return res.status(404).json({ error: 'קובץ לא נמצא' });
    if (receipt.employeeId !== req.user!.id && req.user!.role !== 'מנהל') {
      return res.status(403).json({ error: 'אין הרשאה' });
    }
    res.set('Content-Type', receipt.fileMime || 'application/octet-stream');
    res.send(receipt.fileData);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת קובץ' });
  }
});

router.put('/updateReceiptStatus', requireAdmin, async (req, res) => {
  try {
    const { id, status, adminNotes } = req.body;
    const receipt = await prisma.receipt.update({ where: { id }, data: { status, adminNotes }, select: LIST_SELECT });
    res.json({ success: true, receipt });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בעדכון קבלה' });
  }
});

export default router;
