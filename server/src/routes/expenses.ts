import { Router, Request } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import axios from 'axios';
import { PDFDocument } from 'pdf-lib';
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
    const own = new Map(categories.map((c) => [c.id, c.expenses.reduce((s, e) => s + (e.amount || 0), 0)]));
    res.json({
      year,
      years,
      categories: categories.map(({ expenses, ...c }) => {
        const children = categories.filter((ch) => ch.parentId === c.id);
        const childUsed = children.reduce((s, ch) => s + own.get(ch.id)!, 0);
        return {
          ...c,
          ownUsed: own.get(c.id)!,
          childUsed,
          childNames: children.map((ch) => ch.name),
          used: own.get(c.id)! + childUsed,
          count: expenses.length,
        };
      }),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת הפנקס' });
  }
});

// מחזיר parentId תקין (או null), או זורק שגיאה בעברית — רמה אחת בלבד, באותה שנה
async function validParent(raw: unknown, year: string, selfId?: string): Promise<string | null> {
  const parentId = str(raw, 50);
  if (!parentId) return null;
  if (parentId === selfId) throw new Error('קטגוריה לא יכולה לרדת מעצמה');
  const parent = await prisma.expenseCategory.findUnique({ where: { id: parentId } });
  if (!parent || parent.year !== year) throw new Error('קטגוריית האב לא נמצאה בשנה הזו');
  if (parent.parentId) throw new Error(`"${parent.name}" כבר יורדת מקטגוריה אחרת`);
  if (selfId && (await prisma.expenseCategory.count({ where: { parentId: selfId } })))
    throw new Error('יש קטגוריות שיורדות מהקטגוריה הזו, ולכן היא לא יכולה לרדת מקטגוריה אחרת');
  return parentId;
}

router.post('/categories', async (req, res) => {
  try {
    const name = str(req.body.name, 100);
    const year = str(req.body.year, 20);
    if (!name || !year) return res.status(400).json({ error: 'חסר שם קטגוריה' });
    const exists = await prisma.expenseCategory.findUnique({ where: { year_name: { year, name } } });
    if (exists) return res.status(400).json({ error: `כבר יש קטגוריה "${name}" בשנה הזו` });
    let parentId: string | null;
    try {
      parentId = await validParent(req.body.parentId, year);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    const count = await prisma.expenseCategory.count({ where: { year } });
    const category = await prisma.expenseCategory.create({
      data: { name, year, budget: parseAmount(req.body.budget) || 0, sortOrder: count, parentId },
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
    const current = await prisma.expenseCategory.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: 'הקטגוריה לא נמצאה' });
    let parentId: string | null;
    try {
      parentId = await validParent(req.body.parentId, current.year, current.id);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    const category = await prisma.expenseCategory.update({
      where: { id: req.params.id },
      data: { name, budget: parseAmount(req.body.budget) || 0, parentId },
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

// פרמטר רשימה מה-query: "a,b,c" ← ['a','b','c'] (ריק = לא סונן)
const listParam = (v: unknown) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// שם גיליון חוקי באקסל: בלי תווים אסורים, בלי גרש בהתחלה/בסוף (שנה ג' ← שנה ג׳), עד 31 תווים, ייחודי
function sheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[*?:\\/[\]]/g, ' ').replace(/'/g, '׳').trim().slice(0, 31) || 'גיליון';
  let n = base;
  for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
  used.add(n.toLowerCase());
  return n;
}

const EXPORT_COLUMNS = [
  { key: 'topic', title: 'נושא הפעילות', width: 18 },
  { key: 'date', title: 'תאריך', width: 12 },
  { key: 'hebrewDate', title: 'תאריך עברי', width: 20 },
  { key: 'payee', title: 'שם בקבלה / שם הרב', width: 22 },
  { key: 'details', title: 'פרוט', width: 22 },
  { key: 'method', title: 'אופן תשלום', width: 12 },
  { key: 'amount', title: 'סכום לתשלום', width: 14 },
  { key: 'invoice', title: 'חשבונית', width: 24 },
  { key: 'account', title: 'פרטי חשבון', width: 22 },
  { key: 'paymentDate', title: 'תאריך תשלום', width: 14 },
  { key: 'receipt', title: 'קבלה', width: 24 },
  { key: 'notes', title: 'הערות', width: 30 },
] as const;

/** קטגוריות השנה עם ההוצאות, מסוננות לפי categoryIds / expenseIds מה-query (ריק = הכל) */
async function loadForExport(query: any, withFileData = false) {
  const year = String(query.year || '') || currentSchoolYear();
  const categoryIds = listParam(query.categoryIds);
  const expenseIds = listParam(query.expenseIds);
  const all = await prisma.expenseCategory.findMany({
    where: { year },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: {
      expenses: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: {
          files: {
            select: { id: true, kind: true, fileName: true, fileMime: true, fileData: withFileData },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  });
  const selected = all
    .filter((c) => !categoryIds.length || categoryIds.includes(c.id))
    .map((c) => ({ ...c, expenses: expenseIds.length ? c.expenses.filter((e) => expenseIds.includes(e.id)) : c.expenses }))
    .filter((c) => !expenseIds.length || c.expenses.length);
  return { year, all, selected, filteredRows: expenseIds.length > 0 };
}

router.get('/exportExcel', async (req, res) => {
  try {
    const { year, all: categories, selected, filteredRows } = await loadForExport(req.query);
    const wanted = listParam(req.query.columns);
    const withSummary = req.query.summary !== '0';
    const base = process.env.APP_URL || `https://${req.get('host')}`;
    const wb = new ExcelJS.Workbook();
    const ownUsed = (c: (typeof categories)[number]) => c.expenses.reduce((s, e) => s + (e.amount || 0), 0);
    // ניצול של קטגוריית אב כולל את הקטגוריות שיורדות ממנה
    const used = (c: (typeof categories)[number]) =>
      ownUsed(c) + categories.filter((ch) => ch.parentId === c.id).reduce((s, ch) => s + ownUsed(ch), 0);
    const topLevel = categories.filter((c) => !c.parentId);
    const sheetNames = new Set<string>();

    if (withSummary) {
      const summary = wb.addWorksheet(sheetName('סיכום', sheetNames));
      summary.views = [{ rightToLeft: true }];
      summary.columns = [
        { header: 'קטגוריה', key: 'name', width: 28 },
        { header: 'תקציב שנתי', key: 'budget', width: 14 },
        { header: 'נוצל', key: 'used', width: 14 },
        { header: 'יתרה', key: 'left', width: 14 },
      ];
      for (const c of categories.filter((c) => selected.some((s) => s.id === c.id))) {
        const parent = c.parentId && categories.find((p) => p.id === c.parentId);
        summary.addRow({
          name: parent ? `${c.name} (יורד מ${parent.name})` : c.name,
          budget: c.budget,
          used: used(c),
          left: c.budget - used(c),
        });
      }
      summary.addRow({
        name: 'סה"כ כל הקטגוריות',
        budget: topLevel.reduce((s, c) => s + c.budget, 0),
        used: topLevel.reduce((s, c) => s + used(c), 0),
        left: topLevel.reduce((s, c) => s + c.budget - used(c), 0),
      }).font = { bold: true };
      summary.getRow(1).font = { bold: true };
      ['budget', 'used', 'left'].forEach((k) => (summary.getColumn(k).numFmt = '₪#,##0.00'));
    }

    for (const sel of selected) {
      const c = categories.find((x) => x.id === sel.id)!; // התקציב והניצול — תמיד לפי כל ההוצאות
      const ws = wb.addWorksheet(sheetName(c.name, sheetNames));
      ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 2 }];
      ws.addRow(['תקציב שנתי:', c.budget, 'עד כה נוצל', used(c), '', 'יתרה לניצול', c.budget - used(c)]).font = { bold: true };
      [2, 4, 7].forEach((i) => (ws.getRow(1).getCell(i).numFmt = '₪#,##0.00'));
      const withTopic = sel.expenses.some((e) => e.topic);
      const columns = EXPORT_COLUMNS.filter(
        (x) => (!wanted.length || wanted.includes(x.key)) && (x.key !== 'topic' || withTopic)
      );
      const header = ws.addRow(columns.map((x) => x.title));
      header.font = { bold: true, color: { argb: 'FFF1C40F' } };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      columns.forEach((x, i) => (ws.getColumn(i + 1).width = x.width));
      const at = (title: string) => columns.findIndex((x) => x.title === title) + 1;
      const fmt = (title: string, numFmt: string, row: ExcelJS.Row) => at(title) && (row.getCell(at(title)).numFmt = numFmt);

      let prevTopic: string | null = null;
      for (const e of sel.expenses) {
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
        fmt('תאריך', 'dd/mm/yyyy', row);
        fmt('תאריך תשלום', 'dd/mm/yyyy', row);
        fmt('סכום לתשלום', '₪#,##0.00', row);
        if (at('נושא הפעילות') && values['נושא הפעילות']) row.getCell(1).font = { bold: true };
        // חשבונית/קבלה: קבצים שהועלו (נפתחים באתר) או הקישור מהאקסל המקורי
        const fileCells = [
          ['חשבונית', 'invoice', e.invoiceText, e.invoiceUrl],
          ['קבלה', 'receipt', e.receiptText, e.receiptUrl],
        ] as const;
        for (const [title, kind, text, link] of fileCells) {
          if (!at(title)) continue;
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
      // שורת סה"כ של השורות שיוצאו
      if (at('סכום לתשלום')) {
        const totalRow = ws.addRow([]);
        totalRow.getCell(Math.max(1, at('סכום לתשלום') - 1)).value = filteredRows ? 'סה"כ השורות שנבחרו' : 'סה"כ';
        totalRow.getCell(at('סכום לתשלום')).value = sel.expenses.reduce((s, e) => s + (e.amount || 0), 0);
        totalRow.getCell(at('סכום לתשלום')).numFmt = '₪#,##0.00';
        totalRow.font = { bold: true };
      }
    }
    if (!wb.worksheets.length) return res.status(400).json({ error: 'לא נבחר שום דבר לייצוא' });

    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`הוצאות ${year}.xlsx`)}`);
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בייצוא' });
  }
});

// מזהה קובץ בגוגל דרייב מתוך קישור שיתוף (‎/file/d/ID/…‎ או ‎?id=ID‎)
function driveFileId(link: string): string | null {
  const m = link.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([\w-]{10,})/);
  return m ? m[1] : null;
}

/** מוריד קובץ מקישור דרייב (משותף לכל מי שיש לו קישור). רק דרייב — לא ניגשים לכתובות אחרות מהשרת. מחזיר null אם אין גישה / לא PDF או תמונה. */
async function fetchLinkedFile(link: string): Promise<{ data: Buffer; mime: string } | null> {
  const id = driveFileId(link);
  if (!id) return null;
  try {
    const r = await axios.get(`https://drive.google.com/uc?export=download&id=${id}`, { responseType: 'arraybuffer', timeout: 20000, maxContentLength: 25 * 1024 * 1024 });
    const data = Buffer.from(r.data);
    const mime = String(r.headers['content-type'] || '').split(';')[0].trim();
    if (data.subarray(0, 4).toString() === '%PDF') return { data, mime: 'application/pdf' };
    if (mime.startsWith('image/')) return { data, mime };
    return null; // דף התחברות של גוגל וכד' — הקובץ לא משותף
  } catch {
    return null;
  }
}

/** מוסיף קובץ (PDF או תמונה) כעמודים למסמך המאוחד. מחזיר false אם לא הצליח. */
async function appendToPdf(doc: PDFDocument, data: Buffer, mime: string): Promise<boolean> {
  try {
    if (mime === 'application/pdf' || data.subarray(0, 4).toString() === '%PDF') {
      const src = await PDFDocument.load(data, { ignoreEncryption: true });
      const pages = await doc.copyPages(src, src.getPageIndices());
      pages.forEach((p) => doc.addPage(p));
      return pages.length > 0;
    }
    const isPng = mime === 'image/png';
    const isJpg = mime === 'image/jpeg' || mime === 'image/jpg';
    if (!isPng && !isJpg) return false;
    const img = isPng ? await doc.embedPng(data) : await doc.embedJpg(data);
    const [W, H, M] = [595.28, 841.89, 28]; // A4 עם שוליים
    const scale = Math.min((W - 2 * M) / img.width, (H - 2 * M) / img.height, 1);
    const page = doc.addPage([W, H]);
    page.drawImage(img, {
      x: (W - img.width * scale) / 2,
      y: (H - img.height * scale) / 2,
      width: img.width * scale,
      height: img.height * scale,
    });
    return true;
  } catch {
    return false;
  }
}

// PDF אחד עם כל החשבוניות (ו/או הקבלות) של מה שנבחר — להדפסה בבת אחת
router.get('/printFiles', async (req, res) => {
  try {
    const { year, selected } = await loadForExport(req.query, true);
    const kinds = listParam(req.query.kinds).filter((k) => k === 'invoice' || k === 'receipt');
    if (!kinds.length) kinds.push('invoice');
    const doc = await PDFDocument.create();
    let included = 0;
    let missing = 0;
    for (const c of selected) {
      for (const e of c.expenses) {
        for (const kind of kinds) {
          const files = e.files.filter((f) => f.kind === kind);
          const link = kind === 'invoice' ? e.invoiceUrl : e.receiptUrl;
          let ok = false;
          for (const f of files) if (await appendToPdf(doc, Buffer.from(f.fileData as any), f.fileMime)) ok = true;
          if (!ok && link) {
            const fetched = await fetchLinkedFile(link);
            if (fetched && (await appendToPdf(doc, fetched.data, fetched.mime))) ok = true;
          }
          if (ok) included++;
          else if (files.length || link) missing++; // היה קובץ/קישור אבל לא הצלחנו לצרף
        }
      }
    }
    if (!doc.getPageCount()) {
      return res.status(404).json({
        error: missing
          ? `לא הצלחתי לצרף אף קובץ (${missing} קישורים לא נגישים — צריך לשתף אותם בדרייב "לכל מי שיש לו את הקישור" או להעלות את הקובץ להוצאה)`
          : 'אין חשבוניות מצורפות בשורות שנבחרו',
      });
    }
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`חשבוניות ${year}.pdf`)}`);
    res.set('X-Files-Included', String(included));
    res.set('X-Files-Missing', String(missing));
    res.set('Access-Control-Expose-Headers', 'X-Files-Included, X-Files-Missing');
    res.send(Buffer.from(await doc.save()));
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה ביצירת קובץ החשבוניות' });
  }
});

export default router;
