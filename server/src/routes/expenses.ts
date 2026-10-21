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

/** strict = שמירה מהטופס: בהעברה בנקאית חובה פרטי חשבון. בייבוא מהאקסל הישן לא חוסמים — השורה תסומן במסך כחסרה. */
function expenseData(body: any, strict = true) {
  const date = parseDate(body.date);
  const payee = str(body.payee, 200);
  if (!date) throw new Error('חסר תאריך');
  if (!payee) throw new Error('חסר שם (הרב / הספק)');
  const paymentMethod = str(body.paymentMethod, 100);
  const accountDetails = str(body.accountDetails);
  if (strict && isTransfer(paymentMethod) && !accountDetails) throw new Error('בתשלום בהעברה חובה למלא פרטי חשבון');
  return {
    date,
    payee,
    details: str(body.details),
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
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
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
    const created = await prisma.expense.create({
      data: { ...expenseData(req.body), categoryId: category.id, createdBy: req.user!.name },
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

type Cell = string | number | Date | null;
type ParsedRow = ReturnType<typeof expenseData>;

function parseCsv(text: string): string[][] {
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
    if ('result' in v) return cellValue((v as any).result);
    if ('richText' in v) return (v as any).richText.map((t: any) => t.text).join('');
    if ('text' in v) return String((v as any).text);
  }
  return String(v);
}

/** גיליון בפורמט של קובץ ההוצאות: שורת "תקציב שנתי" (לא חובה), שורת כותרות, ואז השורות. */
function parseSheet(rows: Cell[][]): { budget: number | null; rows: ParsedRow[] } {
  const text = (c: Cell) => (c instanceof Date ? c.toISOString() : String(c ?? '').trim());
  let budget: number | null = null;
  for (const r of rows.slice(0, 3)) {
    const i = r.findIndex((c) => text(c).includes('תקציב'));
    if (i !== -1) budget = r.slice(i + 1).map(parseAmount).find((n) => n !== null) ?? null;
  }
  const headerIdx = rows.findIndex((r) => r.some((c) => text(c) === 'תאריך') && r.filter((c) => text(c)).length >= 3);
  if (headerIdx === -1) return { budget, rows: [] };
  const header = rows[headerIdx].map(text);
  const col = (test: (h: string) => boolean) => header.findIndex(test);
  const cols = {
    date: col((h) => h === 'תאריך'),
    payee: col((h) => h.includes('שם')),
    details: col((h) => h.includes('פרוט') || h.includes('פירוט')),
    method: col((h) => h.includes('אופן')),
    amount: col((h) => h.includes('סכום')),
    invoice: col((h) => h.includes('חשבונית')),
    account: col((h) => h.includes('פרטי חשבון')),
    payment: col((h) => h === 'תשלום' || h === 'תאריך תשלום'),
    receipt: col((h) => h.includes('קבלה')),
  };
  const get = (r: Cell[], i: number) => (i === -1 ? null : r[i] ?? null);
  const out: ParsedRow[] = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const date = parseDate(get(r, cols.date));
    const payee = text(get(r, cols.payee));
    if (!date || !payee) continue;
    // עמודת "תשלום" באקסל: אם יש בה תאריך — זה תאריך התשלום, אחרת נשמרת כהערה
    const payment = get(r, cols.payment);
    const paymentDate = parseDate(payment);
    const notes = [
      text(payment) && !paymentDate && `תשלום: ${text(payment)}`,
      text(get(r, cols.invoice)) && `חשבונית: ${text(get(r, cols.invoice))}`,
      text(get(r, cols.receipt)) && `קבלה: ${text(get(r, cols.receipt))}`,
    ].filter(Boolean).join(' · ');
    out.push(
      expenseData({
        date,
        payee,
        details: get(r, cols.details),
        paymentMethod: get(r, cols.method),
        amount: get(r, cols.amount),
        accountDetails: get(r, cols.account),
        paymentDate,
        notes,
      }, false)
    );
  }
  return { budget, rows: out };
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
      wb.eachSheet((ws) => {
        const rows: Cell[][] = [];
        ws.eachRow({ includeEmpty: true }, (row) => {
          const values = row.values as ExcelJS.CellValue[];
          rows.push(values.slice(1).map(cellValue));
        });
        sheets.push({ name: ws.name.trim(), rows });
      });
    } else if (/\.csv$/i.test(fileName)) {
      // שם הקטגוריה: מה שנבחר בטופס, אחרת מה שבסוגריים בשם הקובץ ("הוצאות תשפ_ז(הרצאות).csv")
      const name = str(req.body.categoryName, 100) || fileName.match(/\(([^)]+)\)/)?.[1]?.trim() || 'כללי';
      sheets.push({ name, rows: parseCsv(req.file.buffer.toString('utf8')) });
    } else {
      return res.status(400).json({ error: 'אפשר לייבא רק קובץ Excel (xlsx) או CSV' });
    }

    const summary: { category: string; imported: number; skipped: number }[] = [];
    for (const sheet of sheets) {
      const parsed = parseSheet(sheet.rows);
      if (!parsed.rows.length && parsed.budget === null) continue;
      let category = await prisma.expenseCategory.findUnique({ where: { year_name: { year, name: sheet.name } } });
      if (!category) {
        const count = await prisma.expenseCategory.count({ where: { year } });
        category = await prisma.expenseCategory.create({
          data: { year, name: sheet.name, budget: parsed.budget || 0, sortOrder: count },
        });
      } else if (!category.budget && parsed.budget) {
        category = await prisma.expenseCategory.update({ where: { id: category.id }, data: { budget: parsed.budget } });
      }
      // ייבוא חוזר של אותו קובץ לא מכפיל שורות שכבר קיימות
      const existing = await prisma.expense.findMany({ where: { categoryId: category.id } });
      const key = (e: { date: string; payee: string; amount: number | null; details: string | null }) =>
        [e.date, e.payee, e.amount ?? '', e.details ?? ''].join('|');
      const seen = new Set(existing.map(key));
      let imported = 0;
      let skipped = 0;
      for (const row of parsed.rows) {
        if (seen.has(key(row))) { skipped++; continue; }
        seen.add(key(row));
        await prisma.expense.create({ data: { ...row, categoryId: category.id, createdBy: req.user!.name } });
        imported++;
      }
      summary.push({ category: category.name, imported, skipped });
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
          orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
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
      const header = ws.addRow(['תאריך', 'תאריך עברי', 'שם הרב', 'פרוט', 'אופן תשלום', 'סכום לתשלום', 'חשבונית', 'פרטי חשבון', 'תאריך תשלום', 'קבלה', 'הערות']);
      header.font = { bold: true, color: { argb: 'FFF1C40F' } };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      [12, 20, 22, 22, 12, 14, 24, 22, 16, 24, 30].forEach((w, i) => (ws.getColumn(i + 1).width = w));
      for (const e of c.expenses) {
        const filesOf = (kind: string) => e.files.filter((f) => f.kind === kind);
        const row = ws.addRow([
          e.date ? new Date(`${e.date}T00:00:00Z`) : '',
          e.date ? hebrewDate(e.date) : '',
          e.payee,
          e.details || '',
          e.paymentMethod || '',
          e.amount ?? '',
          filesOf('invoice').map((f) => f.fileName).join(', '),
          e.accountDetails || '',
          e.paymentDate ? new Date(`${e.paymentDate}T00:00:00Z`) : '',
          filesOf('receipt').map((f) => f.fileName).join(', '),
          e.notes || '',
        ]);
        row.getCell(1).numFmt = 'dd/mm/yyyy';
        row.getCell(9).numFmt = 'dd/mm/yyyy';
        row.getCell(6).numFmt = '₪#,##0.00';
        // קישור לקובץ הראשון — נפתח באתר (צריך להיות מחוברת)
        ([[7, 'invoice'], [10, 'receipt']] as const).forEach(([i, kind]) => {
          const f = filesOf(kind)[0];
          if (f) {
            row.getCell(i).value = { text: filesOf(kind).map((x) => x.fileName).join(', '), hyperlink: `${base}/api/expenses/files/${f.id}` };
            row.getCell(i).font = { color: { argb: 'FF2563EB' }, underline: true };
          }
        });
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
