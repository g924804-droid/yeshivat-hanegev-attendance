import { Router } from 'express';
import ExcelJS from 'exceljs';
import { airtableFetch, airtableCreate, airtableUpdate, airtableBatchCreate, airtableBatchUpdate, TABLES } from '../lib/airtable';
import { FIELDS } from '../lib/airtableFields';
import { prisma } from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('payments'));

const F = FIELDS.payments;

/** סדר שנת הלימודים: ספטמבר עד אוגוסט. */
const SCHOOL_MONTHS = ['ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר', 'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט'];
const MONTH_INDEX: Record<string, number> = {
  ינואר: 1, פברואר: 2, מרץ: 3, אפריל: 4, מאי: 5, יוני: 6, יולי: 7, אוגוסט: 8, ספטמבר: 9, אוקטובר: 10, נובמבר: 11, דצמבר: 12,
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};
const MONTH_HE = ['', 'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// ב-Airtable יש גם ערכים באנגלית וגם בעברית (מרשומות שהוזנו ידנית) — מאחדים לשלושה מצבים.
const STATUS_NORMAL: Record<string, 'Paid' | 'Partial' | 'Unpaid'> = {
  Paid: 'Paid', שולם: 'Paid', Partial: 'Partial', חלקי: 'Partial', Unpaid: 'Unpaid', חוב: 'Unpaid',
};
const METHOD_HE: Record<string, string> = {
  Cash: 'מזומן', 'Credit Card': 'אשראי', 'Bank Transfer': 'העברה', Check: 'צ׳ק', Other: 'אחר', ציק: 'צ׳ק', הוק: 'הוראת קבע',
};
// הערך שנכתב לשדה הבחירה "אמצעי תשלום" ב-Airtable (חייב להיות אחת האפשרויות שכבר קיימות שם)
const METHOD_TO_AIRTABLE: Record<string, string> = {
  מזומן: 'מזומן', אשראי: 'אשראי', העברה: 'העברה', 'צ׳ק': 'ציק', 'הוראת קבע': 'הוק', אחר: 'Other',
};
const PAYMENT_METHODS = Object.keys(METHOD_TO_AIRTABLE);

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : Number(v) || 0);

/** מספר לסידור כרונולוגי: ספטמבר 2026 → 202609 */
function monthKey(month: string, year: string | number): number {
  return Number(year) * 100 + (MONTH_INDEX[month] || 0);
}

function computeStatus(owed: number, paid: number): 'Paid' | 'Partial' | 'Unpaid' {
  if (paid >= owed - 0.01) return 'Paid';
  return paid > 0 ? 'Partial' : 'Unpaid';
}

function mapPayment(p: { id: string; fields: Record<string, any> }) {
  const amountDue = num(p.fields[F.amountDue]);
  const extra = num(p.fields[F.extra]);
  const scholarship = num(p.fields[F.scholarship]);
  // החיוב בפועל: הסכום הקבוע + תוספת − מלגה
  const owed = Math.max(0, amountDue + extra - scholarship);
  // רשומה שסומנה "שולם" ידנית ב-Airtable בלי למלא סכום — נחשבת כשולמה במלואה
  const markedPaid = STATUS_NORMAL[p.fields[F.status]] === 'Paid';
  const amountPaid = num(p.fields[F.amountPaid]) || (markedPaid ? owed : 0);
  const month = norm(p.fields[F.month]);
  const year = norm(p.fields[F.year]);
  const rawMethod = p.fields[F.paymentMethod];
  return {
    id: p.id,
    fullName: norm(p.fields[F.fullName]),
    month: MONTH_INDEX[month] ? MONTH_HE[MONTH_INDEX[month]] : month,
    year,
    monthKey: monthKey(month, year),
    amountDue,
    extra,
    scholarship,
    owed,
    amountPaid,
    balance: Math.max(0, owed - amountPaid),
    // הסטטוס מחושב מהסכומים (ולא נלקח מ-Airtable) — כך מלגה נלקחת בחשבון ואין סתירה בין סכום לסטטוס
    status: amountDue || extra ? computeStatus(owed, amountPaid) : STATUS_NORMAL[p.fields[F.status]] || 'Unpaid',
    paymentDate: (p.fields[F.paymentDate] as string | undefined) || null,
    paymentMethod: rawMethod ? METHOD_HE[rawMethod] || rawMethod : null,
  };
}

async function fetchPayment(paymentId: string) {
  const [record] = await airtableFetch(TABLES.payments, { filterByFormula: `RECORD_ID()="${paymentId}"`, maxRecords: 1 });
  return record ? mapPayment(record) : null;
}

/** פרטי התלמידות מטבלת התלמידות, לפי שם (לסינון לפי מסלול ולמכתבים להורים). */
async function loadStudentsByName() {
  const [students, tracks] = await Promise.all([airtableFetch(TABLES.students), airtableFetch(TABLES.tracks)]);
  const trackName = new Map(tracks.map((t) => [t.id, norm(t.fields[FIELDS.tracks.name])]));
  type Info = { trackIds: string[]; tracks: string[]; motherName: string; fatherName: string; address: string; city: string };
  const byName = new Map<string, Info>();
  // בטבלת התלמידות יש לפעמים שתי רשומות לאותה תלמידה — אחת ריקה (רק שם) ואחת מלאה עם פרטי הורים
  // ומסלול. עוברים קודם על המלאות, כדי שהן ינצחו בהתאמה לפי שם.
  const richest = [...students].sort((a, b) => Object.keys(b.fields).length - Object.keys(a.fields).length);
  for (const s of richest) {
    const trackIds = (s.fields[FIELDS.students.track] as string[] | undefined) || [];
    const info: Info = {
      trackIds,
      tracks: trackIds.map((id) => trackName.get(id) || '').filter(Boolean),
      motherName: norm(s.fields['שם אמא']),
      fatherName: norm(s.fields['שם אבא']),
      address: norm(s.fields['כתובת']),
      city: norm(s.fields['עיר']),
    };
    // בטבלת התשלומים השם הוא טקסט חופשי — מתאימים גם ל"שם התלמידה" (פרטי + משפחה) וגם ל"שם מלא"
    for (const key of [norm(s.fields[FIELDS.students.name]), norm(s.fields['שם מלא'])]) {
      if (key && !byName.has(key)) byName.set(key, info);
    }
  }
  // התלמידות הנוכחיות — מי ששייכת למסלול כלשהו
  const tracked = new Map<string, string[]>();
  for (const s of richest) {
    const name = norm(s.fields[FIELDS.students.name]);
    const trackIds = (s.fields[FIELDS.students.track] as string[] | undefined) || [];
    if (name && trackIds.length && !tracked.has(name)) tracked.set(name, trackIds);
  }
  return {
    byName,
    tracked,
    tracks: tracks.map((t) => ({ id: t.id, name: norm(t.fields[FIELDS.tracks.name]) })),
    allStudentNames: [...new Set(students.map((s) => norm(s.fields[FIELDS.students.name])).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'he')
    ),
  };
}

// המחירים הראשונים שנקבעו לכל מגמה (לפי חלק משם המסלול ב-Airtable). נשמרים פעם אחת, ומשם
// משנים אותם במסך "מחירים לפי מגמה".
const INITIAL_TRACK_PRICES: [string, number][] = [
  ['סולם', 1950],
  ['אדריכלות', 1850],
  ['עיצוב מדיה', 1950],
  ['חשבות שכר', 1950],
];

async function getTrackPrices(tracks: { id: string; name: string }[]) {
  if ((await prisma.trackPrice.count()) === 0) {
    const initial = tracks
      .map((t) => ({ t, price: INITIAL_TRACK_PRICES.find(([key]) => t.name.includes(key))?.[1] }))
      .filter((x) => x.price)
      .map(({ t, price }) => ({ trackId: t.id, trackName: t.name, monthlyAmount: price! }));
    if (initial.length) await prisma.trackPrice.createMany({ data: initial, skipDuplicates: true });
  }
  const saved = await prisma.trackPrice.findMany();
  return new Map(saved.map((p) => [p.trackId, p.monthlyAmount]));
}

/** הסכום לפי המגמה — אם תלמידה בכמה מסלולים עם מחיר, הגבוה מביניהם (קודש בלי מחיר לא משפיע). */
function trackAmount(trackIds: string[], prices: Map<string, number>): number {
  return Math.max(0, ...trackIds.map((id) => prices.get(id) || 0));
}

/**
 * כמה לחייב תלמידה בכל חודש: סכום אישי אם הוגדר, אחרת לפי המגמה שלה. תלמידה בלי מגמה ובלי
 * סכום אישי (למשל מהשנה שעברה) לא מחויבת אוטומטית.
 */
function chargeFor(
  name: string,
  billing: { studentName: string; monthlyAmount: number; monthlyScholarship: number; active: boolean }[],
  tracked: Map<string, string[]>,
  prices: Map<string, number>
) {
  const b = billing.find((x) => x.studentName === name);
  const fromTrack = trackAmount(tracked.get(name) || [], prices);
  const personal = b?.monthlyAmount || 0;
  const amount = personal || fromTrack;
  return {
    amount,
    personal,
    trackAmount: fromTrack,
    scholarship: b?.monthlyScholarship || 0,
    active: (b ? b.active : true) && amount > 0,
  };
}

/** כל מה שמסך התשלומים צריך — בקריאה אחת. */
router.get('/overview', async (req, res) => {
  try {
    const [records, studentsData, entries, billing] = await Promise.all([
      airtableFetch(TABLES.payments),
      loadStudentsByName(),
      prisma.paymentEntry.findMany({ orderBy: { date: 'asc' } }),
      prisma.studentBilling.findMany(),
    ]);
    const prices = await getTrackPrices(studentsData.tracks);
    // רשומות בלי שם/חודש/שנה (שורות ריקות ב-Airtable) לא נכנסות לטבלה
    const payments = records.map(mapPayment).filter((p) => p.fullName && p.monthKey % 100 > 0 && Number(p.year) > 2000);
    const entriesByPayment = new Map<string, typeof entries>();
    for (const e of entries) {
      if (!entriesByPayment.has(e.paymentId)) entriesByPayment.set(e.paymentId, []);
      entriesByPayment.get(e.paymentId)!.push(e);
    }
    // תלמידות במגמה עם מחיר נכנסות לטבלה גם לפני שנפתח להן חיוב ראשון
    const pricedStudents = [...studentsData.tracked.entries()].filter(([, ids]) => trackAmount(ids, prices) > 0).map(([n]) => n);
    const names = [...new Set([...payments.map((p) => p.fullName), ...billing.map((b) => b.studentName), ...pricedStudents])];
    res.json({
      payments: payments.map((p) => ({ ...p, entries: entriesByPayment.get(p.id) || [] })),
      students: names.map((name) => {
        const info = studentsData.byName.get(name);
        const charge = chargeFor(name, billing, studentsData.tracked, prices);
        return {
          name,
          tracks: info?.tracks || [],
          trackIds: info?.trackIds || [],
          motherName: info?.motherName || '',
          fatherName: info?.fatherName || '',
          address: info?.address || '',
          city: info?.city || '',
          matched: !!info,
          monthlyAmount: charge.amount,
          personalAmount: charge.personal,
          trackAmount: charge.trackAmount,
          monthlyScholarship: charge.scholarship,
          active: charge.active,
          billingNotes: billing.find((x) => x.studentName === name)?.notes || '',
        };
      }),
      trackPrices: studentsData.tracks.map((t) => ({ trackId: t.id, trackName: t.name, monthlyAmount: prices.get(t.id) || 0 })),
      tracks: studentsData.tracks,
      allStudentNames: studentsData.allStudentNames,
      methods: PAYMENT_METHODS,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת תשלומים' });
  }
});

/** מעדכן ב-Airtable את הסכום ששולם, המלגה, הסטטוס, התאריך והאמצעי. */
async function writePaymentTotals(paymentId: string, paidDelta: number, scholarship?: number) {
  const p = await fetchPayment(paymentId);
  if (!p) throw new Error('רשומת התשלום לא נמצאה');
  const newScholarship = scholarship ?? p.scholarship;
  const owed = Math.max(0, p.amountDue + p.extra - newScholarship);
  const paid = Math.max(0, Math.round((p.amountPaid + paidDelta) * 100) / 100);

  const entries = await prisma.paymentEntry.findMany({ where: { paymentId }, orderBy: { date: 'desc' } });
  // שדה "אמצעי תשלום" ב-Airtable מקבל ערך אחד — האמצעי שדרכו שולם הכי הרבה
  const byMethod = new Map<string, number>();
  for (const e of entries) byMethod.set(e.method, (byMethod.get(e.method) || 0) + e.amount);
  const mainMethod = [...byMethod.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const fields: Record<string, any> = {
    [F.amountPaid]: paid,
    [F.status]: computeStatus(owed, paid),
    [F.scholarship]: newScholarship,
  };
  if (entries[0]) fields[F.paymentDate] = entries[0].date;
  if (mainMethod && METHOD_TO_AIRTABLE[mainMethod]) fields[F.paymentMethod] = METHOD_TO_AIRTABLE[mainMethod];
  await airtableUpdate(TABLES.payments, paymentId, fields);
}

/**
 * רישום תשלום לחודש — אפשר כמה אמצעים יחד (למשל חצי מזומן וחצי צ'ק), וגם לעדכן את המלגה של החודש.
 * body: { paymentId, scholarship?, entries: [{ method, amount, date, notes? }] }
 */
router.post('/addPayment', async (req, res) => {
  try {
    const { paymentId, scholarship, entries } = req.body as {
      paymentId: string;
      scholarship?: number;
      entries?: { method: string; amount: number; date: string; notes?: string }[];
    };
    const valid = (entries || []).filter((e) => num(e.amount) > 0);
    if (!paymentId) return res.status(400).json({ error: 'חסרה רשומת תשלום' });
    if (valid.some((e) => !PAYMENT_METHODS.includes(e.method))) return res.status(400).json({ error: 'יש לבחור אמצעי תשלום' });
    if (!valid.length && scholarship === undefined) return res.status(400).json({ error: 'יש לרשום סכום' });

    const p = await fetchPayment(paymentId);
    if (!p) return res.status(404).json({ error: 'רשומת התשלום לא נמצאה' });

    await prisma.paymentEntry.createMany({
      data: valid.map((e) => ({
        paymentId,
        studentName: p.fullName,
        month: p.month,
        year: p.year,
        method: e.method,
        amount: num(e.amount),
        date: e.date || new Date().toISOString().slice(0, 10),
        notes: e.notes || null,
        createdBy: req.user!.name,
      })),
    });
    const total = valid.reduce((s, e) => s + num(e.amount), 0);
    await writePaymentTotals(paymentId, total, scholarship === undefined ? undefined : Math.max(0, num(scholarship)));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה ברישום תשלום' });
  }
});

/** ביטול תשלום שנרשם בטעות. */
router.delete('/entry/:id', async (req, res) => {
  try {
    const entry = await prisma.paymentEntry.findUnique({ where: { id: req.params.id } });
    if (!entry) return res.status(404).json({ error: 'התשלום לא נמצא' });
    await prisma.paymentEntry.delete({ where: { id: entry.id } });
    await writePaymentTotals(entry.paymentId, -entry.amount);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בביטול התשלום' });
  }
});

/** תיקון החיוב של חודש מסוים (סכום קבוע, תוספת). */
router.put('/updatePayment', async (req, res) => {
  try {
    const { id, amountDue, extra } = req.body as { id: string; amountDue?: number; extra?: number };
    const fields: Record<string, any> = {};
    if (amountDue !== undefined) fields[F.amountDue] = num(amountDue);
    if (extra !== undefined) fields[F.extra] = num(extra);
    await airtableUpdate(TABLES.payments, id, fields);
    await writePaymentTotals(id, 0);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בעדכון תשלום' });
  }
});

/** הגדרות קבועות לתלמידה: סכום חודשי, מלגה חודשית, והאם עדיין לחייב אותה. */
router.post('/saveBilling', async (req, res) => {
  try {
    const { studentName, monthlyAmount, monthlyScholarship, active, notes } = req.body as {
      studentName: string; monthlyAmount: number; monthlyScholarship: number; active: boolean; notes?: string;
    };
    const name = norm(studentName);
    if (!name) return res.status(400).json({ error: 'חסר שם תלמידה' });
    const data = {
      monthlyAmount: Math.max(0, num(monthlyAmount)),
      monthlyScholarship: Math.max(0, num(monthlyScholarship)),
      active: active !== false,
      notes: notes || null,
    };
    await prisma.studentBilling.upsert({ where: { studentName: name }, create: { studentName: name, ...data }, update: data });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בשמירת ההגדרות' });
  }
});

/** שמירת המחירים לפי מגמה. */
router.post('/saveTrackPrices', async (req, res) => {
  try {
    const { prices } = req.body as { prices: { trackId: string; trackName: string; monthlyAmount: number }[] };
    for (const p of prices || []) {
      const data = { trackName: norm(p.trackName), monthlyAmount: Math.max(0, num(p.monthlyAmount)) };
      await prisma.trackPrice.upsert({ where: { trackId: p.trackId }, create: { trackId: p.trackId, ...data }, update: data });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בשמירת המחירים' });
  }
});

/**
 * פתיחת חודש: חיוב לכל תלמידה פעילה שעוד אין לה חיוב לחודש הזה — לפי הסכום האישי שלה, או
 * לפי המגמה שלה, פחות המלגה הקבועה.
 */
router.post('/generateMonthlyPayments', async (req, res) => {
  try {
    const { month, year } = req.body as { month: string; year: string | number };
    if (!MONTH_INDEX[month] || !Number(year)) return res.status(400).json({ error: 'יש לבחור חודש ושנה' });
    const [records, billing, studentsData] = await Promise.all([
      airtableFetch(TABLES.payments),
      prisma.studentBilling.findMany(),
      loadStudentsByName(),
    ]);
    const prices = await getTrackPrices(studentsData.tracks);
    const payments = records.map(mapPayment).filter((p) => p.fullName);

    const names = [...new Set([...studentsData.tracked.keys(), ...billing.map((b) => b.studentName)])];
    const toCreate: Record<string, any>[] = [];
    for (const name of names) {
      const charge = chargeFor(name, billing, studentsData.tracked, prices);
      if (!charge.active) continue;
      if (payments.some((p) => p.fullName === name && p.month === month && p.year === String(year))) continue;
      toCreate.push({
        [F.fullName]: name,
        [F.month]: month,
        [F.year]: String(year),
        [F.amountDue]: charge.amount,
        [F.scholarship]: charge.scholarship,
        [F.amountPaid]: 0,
        [F.status]: computeStatus(Math.max(0, charge.amount - charge.scholarship), 0),
      });
    }
    await airtableBatchCreate(TABLES.payments, toCreate);
    res.json({ success: true, created: toCreate.length, skipped: [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה ביצירת תשלומים חודשיים' });
  }
});

/**
 * סימון כל החודש כשולם: לכל חיוב של החודש שעוד לא שולם במלואו — נרשם תשלום על היתרה. אחר כך
 * מסמנים ידנית את הבודדות שלא שילמו ("איפוס החודש" בחלון התשלום).
 */
router.post('/markMonthPaid', async (req, res) => {
  try {
    const { month, year, method } = req.body as { month: string; year: string; method: string };
    if (!MONTH_INDEX[month] || !Number(year)) return res.status(400).json({ error: 'יש לבחור חודש ושנה' });
    if (!PAYMENT_METHODS.includes(method)) return res.status(400).json({ error: 'יש לבחור אמצעי תשלום' });
    const records = await airtableFetch(TABLES.payments);
    const open = records.map(mapPayment).filter((p) => p.month === month && p.year === String(year) && p.balance > 0);
    const date = new Date().toISOString().slice(0, 10);

    await prisma.paymentEntry.createMany({
      data: open.map((p) => ({
        paymentId: p.id,
        studentName: p.fullName,
        month: p.month,
        year: p.year,
        method,
        amount: p.balance,
        date,
        notes: 'סימון כל החודש כשולם',
        createdBy: req.user!.name,
      })),
    });
    await airtableBatchUpdate(
      TABLES.payments,
      open.map((p) => ({
        id: p.id,
        fields: {
          [F.amountPaid]: p.owed,
          [F.status]: 'Paid',
          [F.paymentDate]: date,
          [F.paymentMethod]: METHOD_TO_AIRTABLE[method],
        },
      }))
    );
    res.json({ success: true, marked: open.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בסימון החודש' });
  }
});

/** איפוס חודש של תלמידה ל"לא שולם" — מוחק את התשלומים שנרשמו לו. */
router.post('/clearPayment', async (req, res) => {
  try {
    const { paymentId } = req.body as { paymentId: string };
    const p = await fetchPayment(paymentId);
    if (!p) return res.status(404).json({ error: 'רשומת התשלום לא נמצאה' });
    await prisma.paymentEntry.deleteMany({ where: { paymentId } });
    await airtableUpdate(TABLES.payments, paymentId, {
      [F.amountPaid]: 0,
      [F.status]: computeStatus(p.owed, 0),
      [F.paymentDate]: null,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה באיפוס' });
  }
});

/** חיוב בודד — למשל תלמידה חדשה באמצע השנה. */
router.post('/recordPayment', async (req, res) => {
  try {
    const { fullName, month, year, amountDue, scholarship } = req.body;
    if (!norm(fullName) || !MONTH_INDEX[month] || !Number(year)) return res.status(400).json({ error: 'חסרים פרטים' });
    const due = num(amountDue);
    const sch = num(scholarship);
    const record = await airtableCreate(TABLES.payments, {
      [F.fullName]: norm(fullName),
      [F.month]: month,
      [F.year]: String(year),
      [F.amountDue]: due,
      [F.scholarship]: sch,
      [F.amountPaid]: 0,
      [F.status]: computeStatus(Math.max(0, due - sch), 0),
    });
    res.json({ success: true, recordId: record.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה ביצירת חיוב' });
  }
});

/** אקסל להנהלת החשבונות: טבלה שנתית (תלמידה × חודש), כל החיובים, וכל התשלומים שהתקבלו. schoolYear = שנת ספטמבר. */
router.get('/exportExcel', async (req, res) => {
  try {
    const startYear = Number(req.query.schoolYear) || new Date().getFullYear();
    const [records, entries] = await Promise.all([
      airtableFetch(TABLES.payments),
      prisma.paymentEntry.findMany({ orderBy: { date: 'asc' } }),
    ]);
    const columns = SCHOOL_MONTHS.map((m, i) => ({ month: m, year: String(i < 4 ? startYear : startYear + 1) }));
    const inYear = (month: string, year: string) => columns.some((c) => c.month === month && c.year === year);
    const payments = records.map(mapPayment).filter((p) => p.fullName && inYear(p.month, p.year));
    const names = [...new Set(payments.map((p) => p.fullName))].sort((a, b) => a.localeCompare(b, 'he'));

    const wb = new ExcelJS.Workbook();
    const styleHeader = (ws: ExcelJS.Worksheet) => {
      ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1, xSplit: 1 }];
      const row = ws.getRow(1);
      row.font = { bold: true, color: { argb: 'FFF1C40F' } };
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      row.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      row.height = 30;
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
    };
    const FILL = { Paid: 'FFDCFCE7', Partial: 'FFFFEDD5', Unpaid: 'FFFEE2E2' } as const;
    const STATUS_HE = { Paid: 'שולם', Partial: 'חלקי', Unpaid: 'חוב' } as const;
    const sum = (list: typeof payments, key: 'owed' | 'amountPaid' | 'scholarship' | 'balance') =>
      list.reduce((s, p) => s + p[key], 0);

    // גיליון 1: לכל תלמידה ולכל חודש — "שולם" או היתרה. ירוק שולם, כתום חלקי, אדום חוב.
    const grid = wb.addWorksheet(`שנה ${startYear}-${startYear + 1}`);
    grid.columns = [
      { header: 'תלמידה', key: 'name', width: 22 },
      ...columns.map((c) => ({ header: `${c.month} ${c.year}`, key: `${c.month}-${c.year}`, width: 11 })),
      { header: 'סה"כ לתשלום', key: 'owed', width: 13 },
      { header: 'סה"כ שולם', key: 'paid', width: 12 },
      { header: 'מלגות', key: 'scholarship', width: 10 },
      { header: 'יתרת חוב', key: 'balance', width: 12 },
    ];
    for (const name of names) {
      const mine = payments.filter((p) => p.fullName === name);
      const values: Record<string, any> = {
        name,
        owed: sum(mine, 'owed'),
        paid: sum(mine, 'amountPaid'),
        scholarship: sum(mine, 'scholarship'),
        balance: sum(mine, 'balance'),
      };
      for (const c of columns) {
        const p = mine.find((x) => x.month === c.month && x.year === c.year);
        values[`${c.month}-${c.year}`] = p ? (p.status === 'Paid' ? 'שולם' : p.balance) : '';
      }
      const row = grid.addRow(values);
      columns.forEach((c, i) => {
        const p = mine.find((x) => x.month === c.month && x.year === c.year);
        const cell = row.getCell(i + 2);
        cell.alignment = { horizontal: 'center' };
        if (p) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[p.status] } };
      });
      if (values.balance > 0) row.getCell('balance').font = { bold: true, color: { argb: 'FFB91C1C' } };
    }
    grid.addRow({
      name: 'סה"כ',
      owed: sum(payments, 'owed'),
      paid: sum(payments, 'amountPaid'),
      scholarship: sum(payments, 'scholarship'),
      balance: sum(payments, 'balance'),
    }).font = { bold: true };
    styleHeader(grid);

    // גיליון 2: כל החיובים בשנה — שורה לכל חודש של כל תלמידה
    const list = wb.addWorksheet('חיובים');
    list.columns = [
      { header: 'תלמידה', key: 'name', width: 22 },
      { header: 'חודש', key: 'month', width: 14 },
      { header: 'סכום קבוע', key: 'due', width: 11 },
      { header: 'תוספת', key: 'extra', width: 9 },
      { header: 'מלגה', key: 'scholarship', width: 9 },
      { header: 'לתשלום', key: 'owed', width: 10 },
      { header: 'שולם', key: 'paid', width: 10 },
      { header: 'יתרה', key: 'balance', width: 10 },
      { header: 'סטטוס', key: 'status', width: 9 },
      { header: 'אמצעי תשלום', key: 'method', width: 20 },
    ];
    const sorted = [...payments].sort((a, b) => a.fullName.localeCompare(b.fullName, 'he') || a.monthKey - b.monthKey);
    for (const p of sorted) {
      const methods = [...new Set(entries.filter((e) => e.paymentId === p.id).map((e) => e.method))].join(' + ') || p.paymentMethod || '';
      const row = list.addRow({
        name: p.fullName,
        month: `${p.month} ${p.year}`,
        due: p.amountDue,
        extra: p.extra || '',
        scholarship: p.scholarship || '',
        owed: p.owed,
        paid: p.amountPaid,
        balance: p.balance,
        status: STATUS_HE[p.status],
        method: methods,
      });
      row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[p.status] } };
    }
    styleHeader(list);

    // גיליון 3: כל תשלום שנרשם, כולל פיצול בין אמצעים
    const ledger = wb.addWorksheet('תשלומים שהתקבלו');
    ledger.columns = [
      { header: 'תאריך', key: 'date', width: 12 },
      { header: 'תלמידה', key: 'name', width: 22 },
      { header: 'על חודש', key: 'month', width: 14 },
      { header: 'אמצעי', key: 'method', width: 12 },
      { header: 'סכום', key: 'amount', width: 10 },
      { header: 'הערות', key: 'notes', width: 30 },
      { header: 'נרשם ע"י', key: 'by', width: 16 },
    ];
    for (const e of entries.filter((x) => inYear(x.month, x.year))) {
      ledger.addRow({
        date: e.date.split('-').reverse().join('/'),
        name: e.studentName,
        month: `${e.month} ${e.year}`,
        method: e.method,
        amount: e.amount,
        notes: e.notes || '',
        by: e.createdBy || '',
      });
    }
    styleHeader(ledger);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`תשלומים ${startYear}-${startYear + 1}.xlsx`)}`);
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בייצוא לאקסל' });
  }
});

export default router;
