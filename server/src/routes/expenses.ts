import { Router, Request } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { prisma } from '../lib/prisma';
import { requireAuth, requireExpensesAccess } from '../middleware/auth';
import { hebrewDate } from '../lib/hebrewDate';

/**
 * פנקס הוצאות — מחליף את קובץ האקסל "הוצאות תשפ"ז": כל גיליון (הרצאות וכו') הוא קטגוריה עם
 * תקציב שנתי, וכל שורה היא הוצאה עם קובצי חשבונית/קבלה. הגישה רק למי שסומנה "מאושר" בעמודה
 * "גישה הוצאות" בטבלת הסיסמאות ב-Airtable.
 */
const router = Router();
router.use(requireAuth, requireExpensesAccess);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const expenseFiles = upload.fields([
  { name: 'invoice', maxCount: 5 },
  { name: 'receipt', maxCount: 5 },
]);

const FILE_META = { id: true, kind: true, fileName: true, fileMime: true, createdAt: true } as const;

/** שנת הלימודים הנוכחית בעברית ("תשפ״ז") — מחודש לפני ראש השנה כבר נחשבת השנה הבאה. */
function currentSchoolYear(): string {
  const d = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  return hebrewDate(d).split(' ').pop()!.replace(/^ה׳/, '');
}

const str = (v: unknown, max = 300) => {
  const s = String(v ?? '').trim().slice(0, max);
  return s || null;
};

function parseAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[₪,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "20/08/2026", "20.8.26", "2026-08-20" או Date → "2026-08-20". */
function parseDate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!m) return '';
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

const isTransfer = (method: string | null) => !!method && method.includes('העברה');

const url = (v: unknown) => {
  const s = str(v, 1000);
  return s && (s.toLowerCase().startsWith('http://') || s.toLowerCase().startsWith('https://')) ? s : null;
};

/**
 * strict = שמירה מהטופס: חובה תאריך ושם/פרוט, ובהעברה בנקאית חובה פרטי חשבון. בייבוא מהאקסל
 * הישן לא חוסמים — שורה בלי פרטי חשבון תסומן במסך כחסרה.
 */
function expenseData(body: any, strict = true) {
  const date = parseDate(body.date);
  const payee = str(body.payee, 200) || '';
  const details = str(body.details);
  if (strict && !date && !str(body.hebrewDate) && !str(body.topic)) throw new Error('חסר תאריך');
  if (strict && !payee && !details) throw new Error('חסר שם בקבלה או פרוט');
  const paymentMethod = str(body.paymentMethod, 100);
  const accountDetails = str(body.accountDetails);
  if (strict && isTransfer(paymentMethod) && !accountDetails) throw new Error('בתשלום בהעברה חובה למלא פרטי חשבון');
  return {
    date,
    hebrewDate: date ? null : str(body.hebrewDate, 60),
    topic: str(body.topic, 150),
    payee,
    details,
    invoiceText: str(body.invoiceText),
    invoiceUrl: url(body.invoiceUrl),
    receiptText: str(body.receiptText),
    receiptUrl: url(body.receiptUrl),
    paymentMethod,
    amount: parseAmount(body.amount),
    accountDetails,
    paymentDate: parseDate(body.paymentDate) || null,
    notes: str(body.notes, 1000),
  };
}

async function saveFiles(req: Request, expenseId: string) {
  const files = (req.files || {}) as Record<string, Express.Multer.File[]>;
  for (const kind of ['invoice', 'receipt'] as const) {
    for (const f of files[kind] || []) {
      await prisma.expenseFile.create({
        data: {
          expenseId,
          kind,
          fileData: f.buffer,
          fileMime: f.mimetype,
          // multer מפענח את שם הקובץ כ-latin1 — מחזירים לעברית תקינה
          fileName: Buffer.from(f.originalname, 'latin1').toString('utf8'),
        },
      });
    }
  }
}

const loadExpense = (id: string) =>
  prisma.expense.findUnique({ where: { id }, include: { files: { select: FILE_META, orderBy: { createdAt: 'asc' } } } });

router.get('/overview', async (req, res) => {
  try {
    const year = String(req.query.year || '') || currentSchoolYear();
    const [yearsRows, categories] = await Promise.all([
      prisma.expenseCategory.findMany({ distinct: ['year'], select: { year: true } }),
      prisma.expenseCategory.findMany({
        where: { year },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: { expenses: { select: { amount: true } } },
      }),
    ]);
    const years = Array.from(new Set([currentSchoolYear(), year, ...yearsRows.map((y) => y.year)])).sort();
    res.json({
      year,
      years,
      categories: categories.map(({ expenses, ...c }) => ({
        ...c,
        used: expenses.reduce((s, e) => s + (e.amount || 0), 0),
        count: expenses.length,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת הפנקס' });
  }
});

router.post('/categories', async (req, res) => {
  try {
    const name = str(req.body.name, 100);
    const year = str(req.body.year, 20);
    if (!name || !year) return res.status(400).json({ error: 'חסר שם קטגוריה' });
    const exists = await prisma.expenseCategory.findUnique({ where: { year_name: { year, name } } });
    if (exists) return res.status(400).json({ error: `כבר יש קטגוריה "${name}" בשנה הזו` });
    const count = await prisma.expenseCategory.count({ where: { year } });
    const category = await prisma.expenseCategory.create({
      data: { name, year, budget: parseAmount(req.body.budget) || 0, sortOrder: count },
    });
    res.json({ success: true, category });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה ביצירת קטגוריה' });
  }
});

router.put('/categories/:id', async (req, res) => {
  try {
    const name = str(req.body.name, 100);
    if (!name) return res.status(400).json({ error: 'חסר שם קטגוריה' });
    const category = await prisma.expenseCategory.update({
      where: { id: req.params.id },
      data: { name, budget: parseAmount(req.body.budget) || 0 },
    });
    res.json({ success: true, category });
  } catch (err: any) {
    res.status(500).json({ error: err.code === 'P2002' ? 'כבר יש קטגוריה בשם הזה' : err.message || 'שגיאה בעדכון קטגוריה' });
  }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    const count = await prisma.expense.count({ where: { categoryId: req.params.id } });
    if (count) return res.status(400).json({ error: 'אי אפשר למחוק קטגוריה שיש בה הוצאות — יש למחוק קודם את ההוצאות' });
    await prisma.expenseCategory.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה במחיקת קטגוריה' });
  }
});

router.get('/list', async (req, res) => {
  try {
    const expenses = await prisma.expense.findMany({
      where: { categoryId: String(req.query.categoryId || '') },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { files: { select: FILE_META, orderBy: { createdAt: 'asc' } } },
    });
    res.json({ expenses });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת ההוצאות' });
  }
});

router.post('/expenses', expenseFiles, async (req, res) => {
  try {
    const category = await prisma.expenseCategory.findUnique({ where: { id: String(req.body.categoryId || '') } });
    if (!category) return res.status(400).json({ error: 'לא נבחרה קטגוריה' });
    const data = expenseData(req.body);
    // שורה חדשה נכנסת בסוף הקבוצה של אותו נושא פעילות (כמו באקסל), אחרת בסוף הרשימה
    const last = await prisma.expense.findFirst({
      where: { categoryId: category.id, ...(data.topic ? { topic: data.topic } : {}) },
      orderBy: { sortOrder: 'desc' },
    });
    const sortOrder = last ? last.sortOrder + (data.topic ? 0.001 : 1) : 0;
    const created = await prisma.expense.create({
      data: { ...data, sortOrder, categoryId: category.id, createdBy: req.user!.name },
    });
    await saveFiles(req, created.id);
    res.json({ success: true, expense: await loadExpense(created.id) });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'שגיאה בשמירת ההוצאה' });
  }
});

router.put('/expenses/:id', expenseFiles, async (req, res) => {
  try {
    await prisma.expense.update({ where: { id: req.params.id }, data: expenseData(req.body) });
    await saveFiles(req, req.params.id);
    res.json({ success: true, expense: await loadExpense(req.params.id) });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'שגיאה בשמירת ההוצאה' });
  }
});

router.delete('/expenses/:id', async (req, res) => {
  try {
    await prisma.expense.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה במחיקת ההוצאה' });
  }
});

router.get('/files/:id', async (req, res) => {
  try {
    const file = await prisma.expenseFile.findUnique({ where: { id: req.params.id } });
    if (!file) return res.status(404).json({ error: 'קובץ לא נמצא' });
    res.set('Content-Type', file.fileMime || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    res.send(file.fileData);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת הקובץ' });
  }
});

router.delete('/files/:id', async (req, res) => {
  try {
    await prisma.expenseFile.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה במחיקת הקובץ' });
  }
});

// ---------- ייבוא מהאקסל / CSV הקיים ----------

type Link = { text: string; url: string };
type Cell = string | number | Date | Link | null;
type ParsedRow = ReturnType<typeof expenseData> & { sortOrder: number };

const isLink = (c: Cell): c is Link => !!c && typeof c === 'object' && !(c instanceof Date) && 'url' in c;
const cellText = (c: Cell) => (c instanceof Date ? c.toISOString().slice(0, 10) : isLink(c) ? c.text : String(c ?? '').trim());
const cellDate = (c: Cell) => parseDate(isLink(c) ? c.text : c);

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as any;
    if ('hyperlink' in o) {
      const text = o.text && typeof o.text === 'object' && o.text.richText ? o.text.richText.map((t: any) => t.text).join('') : String(o.text ?? '');
      return { text: text.trim(), url: String(o.hyperlink) };
    }
    if ('result' in o) return cellValue(o.result);
    if ('richText' in o) return o.richText.map((t: any) => t.text).join('');
    if ('text' in o) return String(o.text);
    if ('formula' in o) return null; // נוסחה בלי תוצאה שמורה
  }
  return String(v);
}

/** קורא גיליון אקסל (ExcelJS) לטבלת תאים. */
export function sheetRows(ws: ExcelJS.Worksheet): Cell[][] {
  const rows: Cell[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => rows.push((row.values as ExcelJS.CellValue[]).slice(1).map(cellValue)));
  return rows;
}

/**
 * גיליון בפורמט של קובץ ההוצאות: שורת "תקציב שנתי" (לא חובה), שורת כותרות, ואז השורות. לכל
 * גיליון סדר עמודות אחר, אז העמודות מזוהות לפי שם הכותרת. בגיליון עם "נושא הפעילות" כמה שורות
 * שייכות לאותה פעילות (הנושא כתוב רק בשורה הראשונה), והתאריך כתוב פעם אחת לכל הקבוצה — לפעמים
 * עברי בשורה אחת ולועזי בשורה שאחריה.
 */
export function parseSheet(rows: Cell[][]): { budget: number | null; hasHeader: boolean; rows: ParsedRow[] } {
  let budget: number | null = null;
  for (const r of rows.slice(0, 3)) {
    const i = r.findIndex((c) => cellText(c).includes('תקציב'));
    // הראשון בלבד — בשורה 3 יש לפעמים טבלת "תקציב פעילויות" בצד
    if (i !== -1 && budget === null) budget = r.slice(i + 1).map((c) => (isLink(c) ? null : parseAmount(c))).find((n) => n !== null) ?? null;
  }
  const headerIdx = rows.findIndex((r) => r.some((c) => cellText(c) === 'תאריך') && r.filter((c) => cellText(c)).length >= 3);
  if (headerIdx === -1) return { budget, hasHeader: false, rows: [] };
  const header = rows[headerIdx].map(cellText);
  const col = (test: (h: string) => boolean) => header.findIndex(test);
  const cols = {
    topic: col((h) => h.includes('נושא')),
    date: col((h) => h === 'תאריך'),
    hebrew: col((h) => h.includes('תאריך עברי')),
    payee: col((h) => h.includes('שם')),
    details: col((h) => h.includes('פרוט') || h.includes('פירוט')),
    method: col((h) => h.includes('אופן')),
    amount: col((h) => h.includes('סכום')),
    invoice: col((h) => h.includes('חשבונית')),
    account: col((h) => h.includes('פרטי חשבון') || h.includes('פרטי בנק')),
    payment: col((h) => h === 'תשלום' || h.includes('תאריך תשלום') || h.includes('בוצעה העברה')),
    receipt: col((h) => h === 'קבלה'), // לא "שם בקבלה"
  };
  // תאים מחוץ לטבלה (למשל טבלת "תקציב פעילויות" בצד) לא נקראים
  const get = (r: Cell[], i: number): Cell => (i === -1 || i >= header.length ? null : r[i] ?? null);
  const linkOf = (c: Cell) => (isLink(c) ? c.url : null);

  const raws: { r: Cell[]; group: number; topic: string | null }[] = [];
  let topic: string | null = null;
  let group = 0;
  for (const r of rows.slice(headerIdx + 1)) {
    const t = cellText(get(r, cols.topic));
    if (t) {
      topic = t;
      group++;
    }
    raws.push({ r, group, topic });
  }
  // תאריך לקבוצה: הלועזי הראשון שמופיע בה, והעברי הראשון שנכתב בה
  const groupDate = new Map<number, { date: string; hebrew: string }>();
  if (cols.topic !== -1) {
    for (const { r, group: g } of raws) {
      const cur = groupDate.get(g) || { date: '', hebrew: '' };
      const d = get(r, cols.date);
      const iso = cellDate(d);
      if (iso && !cur.date) cur.date = iso;
      else if (!iso && cellText(d) && !cur.hebrew) cur.hebrew = cellText(d);
      groupDate.set(g, cur);
    }
  }

  const out: ParsedRow[] = [];
  raws.forEach(({ r, group: g, topic: rowTopic }, idx) => {
    const payee = cellText(get(r, cols.payee));
    const details = cellText(get(r, cols.details));
    const amountCell = get(r, cols.amount);
    const amount = isLink(amountCell) ? null : parseAmount(amountCell);
    if (!payee && !details && amount === null) return;
    const dCell = get(r, cols.date);
    let date = cellDate(dCell);
    let hebrew = cellText(get(r, cols.hebrew)) || (date ? '' : cellText(dCell));
    if (cols.topic !== -1) {
      const gd = groupDate.get(g)!;
      date = date || gd.date;
      hebrew = hebrew || gd.hebrew;
    }
    // עמודת התשלום: אם יש בה תאריך — זה תאריך התשלום, אחרת נשמרת כהערה ("לברר האם שילמו")
    const payment = get(r, cols.payment);
    const paymentDate = cellDate(payment);
    const invoice = get(r, cols.invoice);
    const receipt = get(r, cols.receipt);
    out.push({
      ...expenseData(
        {
          date,
          hebrewDate: hebrew,
          topic: rowTopic,
          payee,
          details,
          paymentMethod: cellText(get(r, cols.method)),
          amount,
          accountDetails: cellText(get(r, cols.account)),
          paymentDate,
          invoiceText: cellText(invoice),
          invoiceUrl: linkOf(invoice),
          receiptText: cellText(receipt),
          receiptUrl: linkOf(receipt),
          notes: cellText(payment) && !paymentDate ? `תשלום: ${cellText(payment)}` : '',
        },
        false
      ),
      sortOrder: idx,
    });
  });
  return { budget, hasHeader: true, rows: out };
}

/** מכניס גיליון אחד לקטגוריה (יוצר אותה אם צריך). ייבוא חוזר של אותו קובץ לא מכפיל שורות. */
export async function importSheet(year: string, name: string, rows: Cell[][], createdBy: string) {
  const parsed = parseSheet(rows);
  if (!parsed.hasHeader && parsed.budget === null) return null;
  let category = await prisma.expenseCategory.findUnique({ where: { year_name: { year, name } } });
  if (!category) {
    const count = await prisma.expenseCategory.count({ where: { year } });
    category = await prisma.expenseCategory.create({ data: { year, name, budget: parsed.budget || 0, sortOrder: count } });
  } else if (!category.budget && parsed.budget) {
    category = await prisma.expenseCategory.update({ where: { id: category.id }, data: { budget: parsed.budget } });
  }
  const existing = await prisma.expense.findMany({ where: { categoryId: category.id } });
  const key = (e: { topic: string | null; date: string; payee: string; amount: number | null; details: string | null }) =>
    [e.topic ?? '', e.date, e.payee, e.amount ?? '', e.details ?? ''].join('|');
  const seen = new Set(existing.map(key));
  const base = existing.reduce((m, e) => Math.max(m, e.sortOrder + 1), 0);
  let imported = 0;
  let skipped = 0;
  for (const row of parsed.rows) {
    if (seen.has(key(row))) {
      skipped++;
      continue;
    }
    seen.add(key(row));
    await prisma.expense.create({ data: { ...row, sortOrder: base + row.sortOrder, categoryId: category.id, createdBy } });
    imported++;
  }
  return { category: category.name, imported, skipped };
}

router.post('/import', upload.single('file'), async (req, res) => {
  try {
    const year = str(req.body.year, 20);
    if (!req.file || !year) return res.status(400).json({ error: 'חסר קובץ או שנה' });
    const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const sheets: { name: string; rows: Cell[][] }[] = [];

    if (/\.xlsx$/i.test(fileName)) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(req.file.buffer as any);
      wb.eachSheet((ws) => sheets.push({ name: ws.name.trim(), rows: sheetRows(ws) }));
    } else if (/\.csv$/i.test(fileName)) {
      // שם הקטגוריה: מה שנבחר בטופס, אחרת מה שבסוגריים בשם הקובץ ("הוצאות תשפ_ז(הרצאות).csv")
      const name = str(req.body.categoryName, 100) || fileName.match(/\(([^)]+)\)/)?.[1]?.trim() || 'כללי';
      sheets.push({ name, rows: parseCsv(req.file.buffer.toString('utf8')) });
    } else {
      return res.status(400).json({ error: 'אפשר לייבא רק קובץ Excel (xlsx) או CSV' });
    }

    const summary = [];
    for (const sheet of sheets) {
      const r = await importSheet(year, sheet.name, sheet.rows, req.user!.name);
      if (r) summary.push(r);
    }
    if (!summary.length) return res.status(400).json({ error: 'לא נמצאה בקובץ שורת כותרות (תאריך, שם, סכום...)' });
    res.json({ success: true, summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בייבוא' });
  }
});

// ---------- ייצוא לאקסל — גיליון לכל קטגוריה, באותו מבנה כמו הקובץ המקורי ----------

router.get('/exportExcel', async (req, res) => {
  try {
    const year = String(req.query.year || '') || currentSchoolYear();
    const categories = await prisma.expenseCategory.findMany({
      where: { year },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        expenses: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: { files: { select: { id: true, kind: true, fileName: true } } },
        },
      },
    });
    const base = process.env.APP_URL || `https://${req.get('host')}`;
    const wb = new ExcelJS.Workbook();
    const used = (c: (typeof categories)[number]) => c.expenses.reduce((s, e) => s + (e.amount || 0), 0);

    const summary = wb.addWorksheet('סיכום');
    summary.views = [{ rightToLeft: true }];
    summary.columns = [
      { header: 'קטגוריה', key: 'name', width: 24 },
      { header: 'תקציב שנתי', key: 'budget', width: 14 },
      { header: 'נוצל', key: 'used', width: 14 },
      { header: 'יתרה', key: 'left', width: 14 },
    ];
    for (const c of categories) summary.addRow({ name: c.name, budget: c.budget, used: used(c), left: c.budget - used(c) });
    summary.addRow({
      name: 'סה"כ',
      budget: categories.reduce((s, c) => s + c.budget, 0),
      used: categories.reduce((s, c) => s + used(c), 0),
      left: categories.reduce((s, c) => s + c.budget - used(c), 0),
    }).font = { bold: true };
    summary.getRow(1).font = { bold: true };
    ['budget', 'used', 'left'].forEach((k) => (summary.getColumn(k).numFmt = '₪#,##0.00'));

    for (const c of categories) {
      const ws = wb.addWorksheet(c.name.replace(/[*?:\\/[\]]/g, ' ').slice(0, 31));
      ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 2 }];
      ws.addRow(['תקציב שנתי:', c.budget, 'עד כה נוצל', used(c), '', 'יתרה לניצול', c.budget - used(c)]).font = { bold: true };
      [2, 4, 7].forEach((i) => (ws.getRow(1).getCell(i).numFmt = '₪#,##0.00'));
      const withTopic = c.expenses.some((e) => e.topic);
      const columns: { title: string; width: number }[] = [
        ...(withTopic ? [{ title: 'נושא הפעילות', width: 18 }] : []),
        { title: 'תאריך', width: 12 },
        { title: 'תאריך עברי', width: 20 },
        { title: 'שם בקבלה / שם הרב', width: 22 },
        { title: 'פרוט', width: 22 },
        { title: 'אופן תשלום', width: 12 },
        { title: 'סכום לתשלום', width: 14 },
        { title: 'חשבונית', width: 24 },
        { title: 'פרטי חשבון', width: 22 },
        { title: 'תאריך תשלום', width: 14 },
        { title: 'קבלה', width: 24 },
        { title: 'הערות', width: 30 },
      ];
      const header = ws.addRow(columns.map((x) => x.title));
      header.font = { bold: true, color: { argb: 'FFF1C40F' } };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      columns.forEach((x, i) => (ws.getColumn(i + 1).width = x.width));
      const at = (title: string) => columns.findIndex((x) => x.title === title) + 1;

      let prevTopic: string | null = null;
      for (const e of c.expenses) {
        const values: Record<string, any> = {
          'נושא הפעילות': e.topic && e.topic !== prevTopic ? e.topic : '',
          'תאריך': e.date ? new Date(`${e.date}T00:00:00Z`) : '',
          'תאריך עברי': e.date ? hebrewDate(e.date) : e.hebrewDate || '',
          'שם בקבלה / שם הרב': e.payee,
          'פרוט': e.details || '',
          'אופן תשלום': e.paymentMethod || '',
          'סכום לתשלום': e.amount ?? '',
          'פרטי חשבון': e.accountDetails || '',
          'תאריך תשלום': e.paymentDate ? new Date(`${e.paymentDate}T00:00:00Z`) : '',
          'הערות': e.notes || '',
        };
        prevTopic = e.topic;
        const row = ws.addRow(columns.map((x) => values[x.title] ?? ''));
        row.getCell(at('תאריך')).numFmt = 'dd/mm/yyyy';
        row.getCell(at('תאריך תשלום')).numFmt = 'dd/mm/yyyy';
        row.getCell(at('סכום לתשלום')).numFmt = '₪#,##0.00';
        if (values['נושא הפעילות']) row.getCell(1).font = { bold: true };
        // חשבונית/קבלה: קבצים שהועלו (נפתחים באתר) או הקישור מהאקסל המקורי
        const fileCells = [
          ['חשבונית', 'invoice', e.invoiceText, e.invoiceUrl],
          ['קבלה', 'receipt', e.receiptText, e.receiptUrl],
        ] as const;
        for (const [title, kind, text, link] of fileCells) {
          const files = e.files.filter((f) => f.kind === kind);
          const label = [text, ...files.map((f) => f.fileName)].filter(Boolean).join(', ');
          const href = files[0] ? `${base}/api/expenses/files/${files[0].id}` : link;
          const cell = row.getCell(at(title));
          if (href) {
            cell.value = { text: label || 'קובץ', hyperlink: href };
            cell.font = { color: { argb: 'FF2563EB' }, underline: true };
          } else cell.value = label;
        }
      }
    }

    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`הוצאות ${year}.xlsx`)}`);
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בייצוא' });
  }
});

export default router;
