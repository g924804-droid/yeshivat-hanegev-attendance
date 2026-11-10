import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma';
import { monthLockError } from '../lib/monthLock';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { getReceiptBlocker } from '../lib/receiptRequirements';

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
  docType: true,
  paidAt: true,
  receiptForId: true,
} as const;

/** חשבוניות של העובדת ששולמו (סומנו "שולם") ועוד לא הועלתה עליהן קבלה */
async function paidInvoicesWithoutReceipt(employeeId: string) {
  const [invoices, receiptsFor] = await Promise.all([
    prisma.receipt.findMany({ where: { employeeId, docType: 'חשבונית', status: 'אושר' }, select: { id: true, month: true, amount: true } }),
    prisma.receipt.findMany({ where: { employeeId, receiptForId: { not: null } }, select: { receiptForId: true } }),
  ]);
  const closed = new Set(receiptsFor.map((r) => r.receiptForId));
  return invoices.filter((i) => !closed.has(i.id));
}

const BANK_SELECT = { bankAccountHolder: true, bankName: true, bankBranch: true, bankAccountNumber: true } as const;
const BANK_FIELDS = Object.keys(BANK_SELECT) as (keyof typeof BANK_SELECT)[];
const BANK_LABELS: Record<(typeof BANK_FIELDS)[number], string> = {
  bankAccountHolder: 'שם בעל/ת החשבון',
  bankName: 'בנק',
  bankBranch: 'סניף',
  bankAccountNumber: 'מספר חשבון',
};

/** פרטי חשבון מהבקשה — רק שדות שנשלחו (מחרוזת), חתוכים ובלי רווחים מיותרים */
function bankFromBody(body: any): Partial<Record<(typeof BANK_FIELDS)[number], string>> {
  const out: Partial<Record<(typeof BANK_FIELDS)[number], string>> = {};
  for (const f of BANK_FIELDS) if (typeof body?.[f] === 'string') out[f] = body[f].trim().slice(0, 100);
  return out;
}

/** מה חסר בפרטי החשבון (שמות בעברית) — ריק = הכל מלא */
function missingBank(bank: Partial<Record<(typeof BANK_FIELDS)[number], string | null>>): string[] {
  return BANK_FIELDS.filter((f) => !bank[f]?.trim()).map((f) => BANK_LABELS[f]);
}

// פרטי החשבון של המשתמשת — מוצגים לה תמיד מעל הקבלות, וממולאים מראש בהגשת קבלה
router.get('/bankDetails', async (req, res) => {
  try {
    const bank = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: BANK_SELECT });
    res.json({ bank });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת פרטי החשבון' });
  }
});

router.put('/bankDetails', async (req, res) => {
  try {
    const data = bankFromBody(req.body);
    const missing = missingBank(data);
    if (missing.length) return res.status(400).json({ error: `חסר: ${missing.join(', ')}` });
    const bank = await prisma.user.update({ where: { id: req.user!.id }, data, select: BANK_SELECT });
    res.json({ success: true, bank });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בשמירת פרטי החשבון' });
  }
});

router.post('/submitReceipt', upload.single('receiptFile'), async (req, res) => {
  try {
    const { description, receiptDate, amount } = req.body;
    if (!description || !amount) return res.status(400).json({ error: 'חסר תיאור או סכום' });
    const docType = req.body.docType === 'חשבונית' ? 'חשבונית' : 'קבלה';
    const receiptForId: string | null = req.body.receiptForId || null;
    let month: string = req.body.month;
    if (!/^\d{4}-\d{2}$/.test(month || '')) return res.status(400).json({ error: 'יש לבחור לאיזה חודש הקבלה' });

    const employee = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    const openInvoices = await paidInvoicesWithoutReceipt(employee.id);

    if (receiptForId) {
      // קבלה על חשבונית ששולמה — סוגרת אותה. החודש הוא של החשבונית, בלי בדיקות נעילה/נוכחות
      const inv = openInvoices.find((i) => i.id === receiptForId);
      if (!inv) return res.status(400).json({ error: 'החשבונית לא נמצאה, או שכבר הועלתה עליה קבלה' });
      month = inv.month;
    } else {
      // חשבונית ששולמה ועוד לא הועלתה עליה קבלה — חוסמת הגשה חדשה עד שתועלה הקבלה
      if (openInvoices.length) {
        const i = openInvoices[0];
        return res.status(400).json({
          error: `הועבר לך תשלום על החשבונית של חודש ${i.month} (${i.amount} ₪) — יש להעלות קודם קבלה על התשלום (בכפתור "העלאת קבלה" ליד החשבונית), ורק אז להגיש חדשה`,
        });
      }
      const lockErr = await monthLockError(req.user, employee.id, month);
      if (lockErr) return res.status(403).json({ error: lockErr });

      const blocker = await getReceiptBlocker(employee, month);
      if (blocker) return res.status(400).json({ error: blocker });
    }

    // חובה פרטי חשבון להעברה — מה שנשלח עכשיו, ואם לא נשלח: מה שכבר שמור מהפעם הקודמת
    const bankUpdate = bankFromBody(req.body);
    const missing = missingBank({ ...employee, ...bankUpdate });
    if (missing.length) return res.status(400).json({ error: `יש למלא פרטי חשבון להעברה — חסר: ${missing.join(', ')}` });
    if (Object.keys(bankUpdate).length) await prisma.user.update({ where: { id: employee.id }, data: bankUpdate });

    const receipt = await prisma.receipt.create({
      data: {
        description,
        employeeId: req.user!.id,
        month,
        receiptDate: receiptDate || new Date().toISOString().slice(0, 10),
        amount: Number(amount),
        docType: receiptForId ? 'קבלה' : docType,
        receiptForId,
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
      select: { ...LIST_SELECT, employee: { select: { name: true, ...BANK_SELECT } } },
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
    // "אושר" = שולם (הועבר תשלום) — נשמר מתי
    const receipt = await prisma.receipt.update({
      where: { id },
      data: { status, adminNotes, paidAt: status === 'אושר' ? new Date() : null },
      select: LIST_SELECT,
    });
    res.json({ success: true, receipt });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בעדכון קבלה' });
  }
});

export default router;
