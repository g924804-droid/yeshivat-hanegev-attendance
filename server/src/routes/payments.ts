import { Router } from 'express';
import { airtableFetch, airtableCreate, airtableUpdate, TABLES } from '../lib/airtable';
import { FIELDS } from '../lib/airtableFields';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('payments'));

function mapPayment(p: { id: string; fields: Record<string, any> }) {
  return {
    id: p.id,
    fullName: p.fields[FIELDS.payments.fullName],
    month: p.fields[FIELDS.payments.month],
    year: p.fields[FIELDS.payments.year],
    amountDue: p.fields[FIELDS.payments.amountDue],
    amountPaid: p.fields[FIELDS.payments.amountPaid],
    balance: p.fields[FIELDS.payments.balance],
    status: p.fields[FIELDS.payments.status],
    paymentDate: p.fields[FIELDS.payments.paymentDate],
    paymentMethod: p.fields[FIELDS.payments.paymentMethod],
    student: p.fields[FIELDS.payments.student],
  };
}

router.get('/getPayments', async (req, res) => {
  try {
    const payments = await airtableFetch(TABLES.payments);
    res.json({ payments: payments.map(mapPayment) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת תשלומים' });
  }
});

router.post('/recordPayment', async (req, res) => {
  try {
    const { fullName, month, year, amountDue, amountPaid, status, paymentDate, paymentMethod, studentId } = req.body;
    const fields: Record<string, any> = {
      [FIELDS.payments.fullName]: fullName,
      [FIELDS.payments.month]: month,
      [FIELDS.payments.year]: year,
      [FIELDS.payments.amountDue]: amountDue,
      [FIELDS.payments.amountPaid]: amountPaid || 0,
      [FIELDS.payments.status]: status || 'Unpaid',
      [FIELDS.payments.paymentDate]: paymentDate || null,
      [FIELDS.payments.paymentMethod]: paymentMethod || '',
    };
    if (studentId) fields[FIELDS.payments.student] = [studentId];

    const record = await airtableCreate(TABLES.payments, fields);
    res.json({ success: true, recordId: record.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה ברישום תשלום' });
  }
});

router.put('/updatePayment', async (req, res) => {
  try {
    const { id, ...rest } = req.body;
    const fields: Record<string, any> = {};
    if (rest.amountPaid !== undefined) fields[FIELDS.payments.amountPaid] = rest.amountPaid;
    if (rest.status !== undefined) fields[FIELDS.payments.status] = rest.status;
    if (rest.paymentDate !== undefined) fields[FIELDS.payments.paymentDate] = rest.paymentDate;
    if (rest.paymentMethod !== undefined) fields[FIELDS.payments.paymentMethod] = rest.paymentMethod;
    if (rest.amountDue !== undefined) fields[FIELDS.payments.amountDue] = rest.amountDue;

    const record = await airtableUpdate(TABLES.payments, id, fields);
    res.json({ success: true, recordId: record.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בעדכון תשלום' });
  }
});

router.post('/generateMonthlyPayments', async (req, res) => {
  try {
    const { month, year } = req.body as { month: string; year: string | number };
    const students = await airtableFetch(TABLES.students);
    const existingPayments = await airtableFetch(TABLES.payments);

    let created = 0;
    for (const student of students) {
      const already = existingPayments.some(
        (p) =>
          (p.fields[FIELDS.payments.student] || []).includes(student.id) &&
          p.fields[FIELDS.payments.month] === month &&
          String(p.fields[FIELDS.payments.year]) === String(year)
      );
      if (already) continue;

      const lastPayment = existingPayments
        .filter((p) => (p.fields[FIELDS.payments.student] || []).includes(student.id))
        .sort((a, b) => String(b.fields[FIELDS.payments.year]).localeCompare(String(a.fields[FIELDS.payments.year])))[0];
      const amountDue = lastPayment?.fields[FIELDS.payments.amountDue] || 0;

      await airtableCreate(TABLES.payments, {
        [FIELDS.payments.fullName]: student.fields[FIELDS.students.name],
        [FIELDS.payments.student]: [student.id],
        [FIELDS.payments.month]: month,
        [FIELDS.payments.year]: year,
        [FIELDS.payments.amountDue]: amountDue,
        [FIELDS.payments.amountPaid]: 0,
        [FIELDS.payments.status]: 'Unpaid',
      });
      created += 1;
    }

    res.json({ success: true, created });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה ביצירת תשלומים חודשיים' });
  }
});

export default router;
