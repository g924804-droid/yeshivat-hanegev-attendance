import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import {
  airtableFetch,
  airtableGetRecord,
  airtableUpdate,
  airtableBatchCreate,
  airtableBatchUpdate,
  TABLES,
  AirtableRecord,
  STUDENT_STATUS_EN_TO_HE,
} from '../lib/airtable';
import { FIELDS } from '../lib/airtableFields';
import { prisma } from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { sheetRows, parseCsv } from './expenses';

/**
 * תיק תלמידה — חיפוש לפי ת.ז. או שם, וכל הנתונים במקום אחד: פרטים אישיים, שנים שלמדה, כספים,
 * חובות לימודיים, ציונים ונוכחות. כולל בוגרות משנים קודמות (באותה טבלת תלמידות ב-Airtable,
 * מסומנות "בוגרת" ב-StudentProfile) וייבוא מאקסל. פרטים כספיים — לכן רק בהרשאת תשלומים.
 */
const router = Router();
router.use(requireAuth);
router.use(requirePermission('payments'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const str = (v: unknown, max = 300) => norm(v).slice(0, max);
const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[₪,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
/** ת.ז. להשוואה: רק ספרות, בלי אפסים מובילים */
const idKey = (v: unknown) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');

// השדות האישיים בטבלת התלמידות שאפשר לראות ולערוך מהתיק
const PERSONAL_FIELDS = [
  'שם פרטי',
  'שם מלא', // בפועל: שם משפחה ("שם התלמידה" = שם פרטי + שם מלא)
  'תעודת זהות',
  'פרטי קשר',
  'כתובת',
  'עיר',
  'תיכון',
  'קופת חולים',
  'התמחות',
  'שם אמא',
  'ת.ז אמא',
  'טלפון אמא',
  'שם אבא',
  'ת.ז אבא',
  'טלפון אבא',
] as const;

// ---------- שנה עברית ----------

const LETTERS: [number, string][] = [
  [400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'], [50, 'נ'],
  [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'],
  [3, 'ג'], [2, 'ב'], [1, 'א'],
];

/** שנת הלימודים שמתחילה בספטמבר של השנה הלועזית הזו — 2026 ← תשפ"ז */
export function schoolYearLabel(startYear: number): string {
  let n = (startYear + 3761) % 1000;
  let s = '';
  while (n > 0) {
    if (n === 15 || n === 16) {
      s += n === 15 ? 'טו' : 'טז';
      break;
    }
    const [v, l] = LETTERS.find(([v]) => v <= n)!;
    s += l;
    n -= v;
  }
  return s.length > 1 ? `${s.slice(0, -1)}"${s.slice(-1)}` : `${s}'`;
}

/** השנה הלועזית שבה מתחילה שנת הלימודים: תשפ"ז ← 2026 (null אם לא זוהתה) */
function schoolYearStart(label: string): number | null {
  for (let y = 1990; y <= 2090; y++) if (schoolYearLabel(y) === label) return y;
  return null;
}

/** האם מחזור כבר סיים — שנת הסיום שלו הסתיימה (שנת הלימודים הנוכחית מאוחרת ממנה) */
function cohortFinished(gradYear: string): boolean | null {
  const start = schoolYearStart(gradYear);
  if (start === null) return null;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const [y, m] = today.split('-').map(Number);
  const currentStart = m >= 9 ? y : y - 1;
  return start < currentStart;
}

/** שנת הלימודים של תאריך (ספטמבר–אוגוסט) */
function schoolYearOfDate(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return schoolYearLabel(m >= 9 ? y : y - 1);
}

const MONTH_INDEX: Record<string, number> = {
  ינואר: 1, פברואר: 2, מרץ: 3, אפריל: 4, מאי: 5, יוני: 6, יולי: 7, אוגוסט: 8, ספטמבר: 9, אוקטובר: 10, נובמבר: 11, דצמבר: 12,
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

/** שנה עברית שהוקלדה בכל צורה ("תשפה", "תשפ''ה", "2024") ← תשפ"ה */
function normalizeSchoolYear(v: unknown): string {
  const s = norm(v).replace(/["'״׳]/g, '');
  if (!s) return '';
  const g = Number(s.match(/\d{4}/)?.[0]);
  if (g > 1990 && g < 2100) return schoolYearLabel(g);
  const he = s.replace(/[^א-ת]/g, '');
  return he.length > 1 ? `${he.slice(0, -1)}"${he.slice(-1)}` : he;
}

// ---------- טעינה ----------

function studentName(s: AirtableRecord): string {
  return norm(s.fields[FIELDS.students.name]) || norm(`${norm(s.fields['שם פרטי'])} ${norm(s.fields['שם מלא'])}`);
}

/** רשומות לפי מזהים — בקבוצות, כדי שהנוסחה לא תהיה ארוכה מדי */
async function fetchByIds(tableId: string, ids: string[], fields?: string[]): Promise<AirtableRecord[]> {
  const out: AirtableRecord[] = [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 40) chunks.push(ids.slice(i, i + 40));
  const results = await Promise.all(
    chunks.map((c) =>
      airtableFetch(tableId, { filterByFormula: `OR(${c.map((id) => `RECORD_ID()="${id}"`).join(',')})`, ...(fields ? { fields } : {}) })
    )
  );
  for (const r of results) out.push(...r);
  return out;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// ---------- חיפוש ----------

router.get('/search', async (req, res) => {
  try {
    const q = norm(req.query.q);
    const status = norm(req.query.status); // '' | פעילה | בוגרת
    const [students, tracks, profiles] = await Promise.all([
      airtableFetch(TABLES.students),
      airtableFetch(TABLES.tracks),
      prisma.studentProfile.findMany(),
    ]);
    const trackName = new Map(tracks.map((t) => [t.id, norm(t.fields[FIELDS.tracks.name])]));
    const profileById = new Map(profiles.map((p) => [p.studentId, p]));
    const qId = idKey(q);
    const qWords = q.toLowerCase().split(' ').filter(Boolean);

    const results = students
      .map((s) => {
        const p = profileById.get(s.id);
        return {
          id: s.id,
          name: studentName(s),
          firstName: norm(s.fields['שם פרטי']),
          idNumber: norm(s.fields['תעודת זהות']),
          year: norm(s.fields['שנה']),
          tracks: ((s.fields[FIELDS.students.track] as string[] | undefined) || []).map((id) => trackName.get(id) || '').filter(Boolean),
          status: p?.status || 'פעילה',
          gradYear: p?.gradYear || '',
        };
      })
      .filter((s) => s.name)
      .filter((s) => !status || s.status === status)
      .filter((s) => {
        if (!q) return true;
        // מספר — לפי ת.ז. (גם חלק ממנה)
        if (/^\d[\d\s-]*$/.test(q)) return !!qId && idKey(s.idNumber).includes(qId);
        const hay = `${s.name} ${s.firstName}`.toLowerCase();
        return qWords.every((w) => hay.includes(w));
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'he'));
    res.json({ results: results.slice(0, 300), total: results.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בחיפוש' });
  }
});

// ---------- התיק המלא ----------

router.get('/student/:id', async (req, res) => {
  try {
    const s = await airtableGetRecord(TABLES.students, req.params.id);
    if (!s) return res.status(404).json({ error: 'התלמידה לא נמצאה' });
    const name = studentName(s);
    const nameKeys = [...new Set([name, norm(s.fields['שם מלא'])].filter((n) => n.split(' ').length > 1))];

    const [tracks, profile, years, yearMonths, debts, payments, grades, attendance] = await Promise.all([
      airtableFetch(TABLES.tracks),
      prisma.studentProfile.findUnique({ where: { studentId: s.id } }),
      prisma.studentYear.findMany({ where: { studentId: s.id }, orderBy: { schoolYear: 'asc' } }),
      prisma.studentYearMonth.findMany({ where: { studentId: s.id } }),
      prisma.studentAcademicDebt.findMany({ where: { studentId: s.id }, orderBy: [{ done: 'asc' }, { createdAt: 'asc' }] }),
      nameKeys.length
        ? airtableFetch(TABLES.payments, {
            filterByFormula: `OR(${nameKeys.map((n) => `TRIM({${FIELDS.payments.fullName}})="${esc(n)}"`).join(',')})`,
          })
        : Promise.resolve([]),
      fetchByIds(TABLES.grades, (s.fields['ציונים'] as string[] | undefined) || []),
      fetchByIds(TABLES.attendance, (s.fields['רישומי נוכחות'] as string[] | undefined) || [], [
        FIELDS.attendance.date,
        FIELDS.attendance.status,
      ]),
    ]);
    const trackName = new Map(tracks.map((t) => [t.id, norm(t.fields[FIELDS.tracks.name])]));

    // תשלומים שוטפים (מטבלת התשלומים) — מקובצים לפי שנת לימודים
    const P = FIELDS.payments;
    const livePayments = payments
      .map((p) => {
        const month = norm(p.fields[P.month]);
        const year = Number(norm(p.fields[P.year]));
        const m = MONTH_INDEX[month];
        if (!m || !year) return null;
        const due = num(p.fields[P.amountDue]) + num(p.fields[P.extra]);
        const scholarship = num(p.fields[P.scholarship]);
        const owed = Math.max(0, due - scholarship);
        const paid = num(p.fields[P.amountPaid]);
        return {
          schoolYear: schoolYearLabel(m >= 9 ? year : year - 1),
          sortKey: year * 100 + m,
          month,
          year,
          owed,
          scholarship,
          paid,
          balance: Math.max(0, owed - paid),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a!.sortKey - b!.sortKey) as { schoolYear: string; sortKey: number; month: string; year: number; owed: number; scholarship: number; paid: number; balance: number }[];

    const liveByYear = new Map<string, { owed: number; paid: number; balance: number; months: number }>();
    for (const p of livePayments) {
      const y = liveByYear.get(p.schoolYear) || { owed: 0, paid: 0, balance: 0, months: 0 };
      y.owed += p.owed;
      y.paid += p.paid;
      y.balance += p.balance;
      y.months++;
      liveByYear.set(p.schoolYear, y);
    }

    // נוכחות לפי שנת לימודים
    const attByYear = new Map<string, { present: number; absent: number; late: number }>();
    for (const a of attendance) {
      const date = norm(a.fields[FIELDS.attendance.date]);
      if (!date) continue;
      const y = schoolYearOfDate(date);
      const row = attByYear.get(y) || { present: 0, absent: 0, late: 0 };
      const st = STUDENT_STATUS_EN_TO_HE[norm(a.fields[FIELDS.attendance.status])] || norm(a.fields[FIELDS.attendance.status]);
      if (st === 'נוכחת') row.present++;
      else if (st === 'איחור') row.late++;
      else if (st === 'חסרה') row.absent++;
      attByYear.set(y, row);
    }

    const G = FIELDS.grades;
    const gradeRows = grades
      .map((g) => ({
        id: g.id,
        test: norm(g.fields[G.testName]),
        score: g.fields[G.score] ?? null,
        date: norm(g.fields[G.date]),
        notes: norm(g.fields[G.notes]),
      }))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // כל השנים שמופיעות במקום כלשהו — לטבלת "שנים שלמדה"
    const allYears = [...new Set([...years.map((y) => y.schoolYear), ...liveByYear.keys(), ...attByYear.keys()])].sort();

    const manualBalance = years.reduce((sum, y) => sum + Math.max(0, y.amountDue - y.amountPaid), 0);
    const liveBalance = [...liveByYear.values()].reduce((sum, y) => sum + y.balance, 0);

    res.json({
      student: {
        id: s.id,
        name,
        fields: Object.fromEntries(PERSONAL_FIELDS.map((f) => [f, norm(s.fields[f])])),
        year: norm(s.fields['שנה']),
        tracks: ((s.fields[FIELDS.students.track] as string[] | undefined) || []).map((id) => trackName.get(id) || '').filter(Boolean),
        needsCompletion: norm(s.fields['צריך השלמה']) === 'Yes',
      },
      profile: {
        status: profile?.status || 'פעילה',
        gradYear: profile?.gradYear || '',
        notes: profile?.notes || '',
        birthDateHe: profile?.birthDateHe || '',
        birthDate: profile?.birthDate || '',
        teachingStudies: profile?.teachingStudies || '',
        openingDebt: profile?.openingDebt || 0,
      },
      years,
      // פירוט חודשי לפי שנה — לפי סדר שנת הלימודים (ספטמבר עד אוגוסט)
      yearMonths: Object.fromEntries(
        [...new Set(yearMonths.map((m) => m.schoolYear))].map((y) => [
          y,
          yearMonths
            .filter((m) => m.schoolYear === y)
            .sort((a, b) => ((a.month + 3) % 12) - ((b.month + 3) % 12))
            .map(({ month, amount, amountText, method, debt, debtText }) => ({ month, amount, amountText, method, debt, debtText })),
        ])
      ),
      yearsSummary: allYears.map((y) => ({
        schoolYear: y,
        manual: years.find((r) => r.schoolYear === y) || null,
        live: liveByYear.get(y) || null,
        attendance: attByYear.get(y) || null,
      })),
      livePayments,
      debts,
      grades: gradeRows,
      totals: {
        balance: Math.round((manualBalance + liveBalance + (profile?.openingDebt || 0)) * 100) / 100,
        openDebts: debts.filter((d) => !d.done).length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת תיק התלמידה' });
  }
});

/** שמירת פרטים אישיים (ב-Airtable) + סטטוס/מחזור/הערות (אצלנו) */
router.put('/student/:id', async (req, res) => {
  try {
    const { fields, profile } = req.body as { fields?: Record<string, string>; profile?: ProfileInput };
    if (fields) {
      const update: Record<string, string> = {};
      for (const f of PERSONAL_FIELDS) if (f in fields) update[f] = str(fields[f], 200);
      if (Object.keys(update).length) await airtableUpdate(TABLES.students, req.params.id, update);
    }
    if (profile) await saveProfile(req.params.id, profile);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בשמירה' });
  }
});

type ProfileInput = {
  status?: string;
  gradYear?: string;
  notes?: string;
  birthDateHe?: string;
  birthDate?: string;
  teachingStudies?: string;
  openingDebt?: number | string;
};

async function saveProfile(studentId: string, profile: ProfileInput) {
  const data: Record<string, any> = {
    status: profile.status === 'בוגרת' ? 'בוגרת' : 'פעילה',
    gradYear: normalizeSchoolYear(profile.gradYear) || null,
    notes: str(profile.notes, 2000) || null,
  };
  // שדות שלא נשלחו — לא נוגעים בהם
  if (profile.birthDateHe !== undefined) data.birthDateHe = str(profile.birthDateHe, 60) || null;
  if (profile.birthDate !== undefined) data.birthDate = str(profile.birthDate, 30) || null;
  if (profile.teachingStudies !== undefined) data.teachingStudies = str(profile.teachingStudies, 100) || null;
  if (profile.openingDebt !== undefined) data.openingDebt = num(profile.openingDebt);
  await prisma.studentProfile.upsert({ where: { studentId }, create: { studentId, ...data }, update: data });
}

/** תלמידה / בוגרת חדשה — נוצרת בטבלת התלמידות ב-Airtable */
router.post('/student', async (req, res) => {
  try {
    const { fields, profile } = req.body as { fields?: Record<string, string>; profile?: ProfileInput };
    const create: Record<string, string> = {};
    for (const f of PERSONAL_FIELDS) if (fields?.[f]) create[f] = str(fields[f], 200);
    if (!create['שם פרטי'] || !create['שם מלא']) return res.status(400).json({ error: 'יש למלא שם פרטי ושם משפחה' });
    if (create['תעודת זהות']) {
      const dup = await findByIdNumber(create['תעודת זהות']);
      if (dup) return res.status(400).json({ error: `כבר קיימת תלמידה עם ת.ז. זו: ${studentName(dup)}` });
    }
    const [created] = await airtableBatchCreate(TABLES.students, [create]);
    await saveProfile(created.id, profile || {});
    res.json({ success: true, id: created.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה ביצירה' });
  }
});

async function findByIdNumber(idNumber: string) {
  const key = idKey(idNumber);
  if (!key) return null;
  const students = await airtableFetch(TABLES.students);
  return students.find((s) => idKey(s.fields['תעודת זהות']) === key) || null;
}

// ---------- שנים (סיכום כספי לשנה) ----------

router.post('/year', async (req, res) => {
  try {
    const b = req.body as { id?: string; studentId?: string; schoolYear?: string; track?: string; amountDue?: number; amountPaid?: number; notes?: string };
    const schoolYear = normalizeSchoolYear(b.schoolYear);
    if (!b.studentId || !schoolYear) return res.status(400).json({ error: 'יש לבחור שנת לימודים' });
    const data = { schoolYear, track: str(b.track, 100) || null, amountDue: num(b.amountDue), amountPaid: num(b.amountPaid), notes: str(b.notes, 500) || null };
    if (b.id) await prisma.studentYear.update({ where: { id: b.id }, data });
    else
      await prisma.studentYear.upsert({
        where: { studentId_schoolYear: { studentId: b.studentId, schoolYear } },
        create: { studentId: b.studentId, ...data },
        update: data,
      });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.code === 'P2002' ? 'השנה הזו כבר רשומה לתלמידה' : err.message || 'שגיאה בשמירה' });
  }
});

router.delete('/year/:id', async (req, res) => {
  try {
    const y = await prisma.studentYear.delete({ where: { id: req.params.id } });
    await prisma.studentYearMonth.deleteMany({ where: { studentId: y.studentId, schoolYear: y.schoolYear } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה במחיקה' });
  }
});

// ---------- חובות לימודיים ----------

router.post('/debt', async (req, res) => {
  try {
    const b = req.body as { id?: string; studentId?: string; schoolYear?: string; subject?: string; description?: string; done?: boolean };
    const subject = str(b.subject, 200);
    if (!b.studentId || !subject) return res.status(400).json({ error: 'יש לכתוב מה חסר' });
    const prev = b.id ? await prisma.studentAcademicDebt.findUnique({ where: { id: b.id } }) : null;
    const data = {
      schoolYear: normalizeSchoolYear(b.schoolYear) || null,
      subject,
      description: str(b.description, 1000) || null,
      done: !!b.done,
      doneAt: b.done ? prev?.doneAt || new Date() : null,
    };
    if (b.id) await prisma.studentAcademicDebt.update({ where: { id: b.id }, data });
    else await prisma.studentAcademicDebt.create({ data: { studentId: b.studentId, createdBy: req.user!.name, ...data } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בשמירה' });
  }
});

router.delete('/debt/:id', async (req, res) => {
  try {
    await prisma.studentAcademicDebt.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה במחיקה' });
  }
});

// ---------- ייבוא מאקסל ----------

// עמודות הקובץ — מזוהות לפי הכותרת (כמה כינויים לכל עמודה)
const IMPORT_COLUMNS: { key: string; title: string; aliases: string[]; example: string }[] = [
  { key: 'firstName', title: 'שם פרטי', aliases: ['שם פרטי', 'פרטי'], example: 'שרה' },
  { key: 'lastName', title: 'שם משפחה', aliases: ['שם משפחה', 'משפחה'], example: 'כהן' },
  { key: 'idNumber', title: 'תעודת זהות', aliases: ['תעודת זהות', 'ת.ז', 'תז', 'ת"ז', 'מספר זהות'], example: '123456789' },
  { key: 'gradYear', title: 'מחזור (שנת סיום)', aliases: ['מחזור', 'שנת סיום', 'מחזור (שנת סיום)'], example: 'תשפ"ג' },
  { key: 'schoolYear', title: 'שנת לימודים', aliases: ['שנת לימודים', 'שנה'], example: 'תשפ"ב' },
  { key: 'track', title: 'מסלול / כיתה', aliases: ['מסלול / כיתה', 'מסלול', 'כיתה', 'מגמה'], example: 'אדריכלות שנה א' },
  { key: 'amountDue', title: 'סכום לתשלום בשנה', aliases: ['סכום לתשלום בשנה', 'סכום לתשלום', 'לתשלום'], example: '18500' },
  { key: 'amountPaid', title: 'שולם', aliases: ['שולם', 'סכום ששולם'], example: '17000' },
  { key: 'academicDebt', title: 'חוב לימודי', aliases: ['חוב לימודי', 'חובות לימודיים', 'חובות לימודי', 'השלמות'], example: 'מבחן בתורת הבנייה' },
  { key: 'financialDebt', title: 'חוב כספי', aliases: ['חוב כספי', 'יתרת חוב'], example: '' },
  { key: 'financialNote', title: 'חובות כספיים (הערה)', aliases: ['חובות כספיים', 'חובות כספיים (הערה)'], example: '' },
  { key: 'contact', title: 'פלאפון אישי', aliases: ['פלאפון אישי', 'פלאפון', 'טלפון', 'פרטי קשר', 'נייד', 'טלפון נייד'], example: '050-0000000' },
  { key: 'birthDateHe', title: 'תאריך לידה עברי', aliases: ['תאריך לידה עברי'], example: '' },
  { key: 'birthDate', title: 'תאריך לידה לועזי', aliases: ['תאריך לידה לועזי', 'תאריך לידה'], example: '' },
  { key: 'address', title: 'כתובת', aliases: ['כתובת', 'רחוב'], example: 'הרצל 1' },
  { key: 'city', title: 'עיר', aliases: ['עיר', 'עיר מגורים', 'ישוב', 'יישוב'], example: 'באר שבע' },
  { key: 'highSchool', title: 'תיכון', aliases: ['תיכון'], example: '' },
  { key: 'specialization', title: 'התמחות', aliases: ['התמחות'], example: '' },
  { key: 'teachingStudies', title: 'לימודי הוראה', aliases: ['לימודי הוראה'], example: '' },
  { key: 'motherName', title: 'שם אמא', aliases: ['שם אמא', 'שם האם'], example: '' },
  { key: 'motherId', title: 'ת.ז. אמא', aliases: ['ת.ז אמא', 'תז אמא', 'ת"ז אמא'], example: '' },
  { key: 'motherPhone', title: 'פלאפון אמא', aliases: ['פלאפון אמא', 'טלפון אמא', 'טלפון האם'], example: '' },
  { key: 'fatherName', title: 'שם אבא', aliases: ['שם אבא', 'שם האב'], example: '' },
  { key: 'fatherId', title: 'ת.ז. אבא', aliases: ['ת.ז אבא', 'תז אבא', 'ת"ז אבא'], example: '' },
  { key: 'fatherPhone', title: 'פלאפון אבא', aliases: ['פלאפון אבא', 'טלפון אבא', 'טלפון האב'], example: '' },
  { key: 'hmo', title: 'קופת חולים', aliases: ['קופת חולים', 'קופ"ח'], example: '' },
  { key: 'notes', title: 'הערות', aliases: ['הערות', 'הערה'], example: '' },
];
// מפתח בקובץ ← שדה בטבלת התלמידות ב-Airtable
const IMPORT_TO_AIRTABLE: Record<string, string> = {
  firstName: 'שם פרטי',
  lastName: 'שם מלא',
  idNumber: 'תעודת זהות',
  contact: 'פרטי קשר',
  address: 'כתובת',
  city: 'עיר',
  motherName: 'שם אמא',
  motherId: 'ת.ז אמא',
  motherPhone: 'טלפון אמא',
  fatherName: 'שם אבא',
  fatherId: 'ת.ז אבא',
  fatherPhone: 'טלפון אבא',
  highSchool: 'תיכון',
  specialization: 'התמחות',
  hmo: 'קופת חולים',
};

router.get('/importTemplate', async (_req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('בוגרות');
    ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
    ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c.title, key: c.key, width: Math.max(12, c.title.length + 4) }));
    ws.getRow(1).font = { bold: true };
    ws.addRow(Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, c.example])));
    ws.addRow({ firstName: 'שרה', lastName: 'כהן', idNumber: '123456789', schoolYear: 'תשפ"ג', track: 'אדריכלות שנה ב', amountDue: '18500', amountPaid: '18500' });
    const help = wb.addWorksheet('הסבר');
    help.views = [{ rightToLeft: true }];
    [
      'שורה לכל שנה שהתלמידה למדה. תלמידה שלמדה שנתיים — שתי שורות עם אותה ת.ז.',
      'פרטים אישיים מספיק לכתוב בשורה אחת. שורות לדוגמה אפשר למחוק.',
      'תלמידה שכבר קיימת במערכת (לפי ת.ז., ואם אין — לפי שם) לא תיווצר שוב: רק יתווספו לה הנתונים, ושדות שכבר מלאים לא ישתנו.',
      'מי שיש לה "מחזור" תסומן כבוגרת.',
      'אפשר גם קובץ עם גיליון לכל מחזור: אם בשם הגיליון יש שנים (למשל "מחזור ב תשפ"א - תשפ"ב"), השנים והמחזור נלקחים ממנו.',
      'שנה אפשר לכתוב בעברית (תשפ"ב) או בלועזית לפי שנת ההתחלה (2021).',
    ].forEach((t) => help.addRow([t]));
    help.getColumn(1).width = 110;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('תבנית ייבוא בוגרות.xlsx')}`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה ביצירת התבנית' });
  }
});

const cellText = (c: any): string => {
  if (c === null || c === undefined) return '';
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  if (typeof c === 'object' && 'text' in c) return norm(c.text);
  return norm(c);
};
const headerKey = (h: string) => h.replace(/["'״׳.\s]/g, '');

type ImportRow = Record<string, string> & { _row: string };

/** השנים העבריות שבשם גיליון: 'מחזור ב תשפ"א - תשפ"ב' ← ['תשפ"א', 'תשפ"ב'] */
function yearsInSheetName(name: string): string[] {
  return (name.match(/תש[א-ת]?["״'׳]{0,2}[א-ת]/g) || []).map(normalizeSchoolYear).filter(Boolean);
}

function parseImport(rows: any[][]): { rows: ImportRow[]; missing: string[] } {
  const wanted = new Map<string, string>();
  for (const c of IMPORT_COLUMNS) for (const a of c.aliases) wanted.set(headerKey(a), c.key);
  const headerIdx = rows.findIndex((r) => r.filter((c) => wanted.has(headerKey(cellText(c)))).length >= 2);
  if (headerIdx < 0) return { rows: [], missing: ['שורת כותרות (שם פרטי, שם משפחה, תעודת זהות...)'] };
  const cols = rows[headerIdx].map((c) => wanted.get(headerKey(cellText(c))) || '');
  const out: ImportRow[] = [];
  rows.slice(headerIdx + 1).forEach((r, i) => {
    const row: ImportRow = { _row: String(headerIdx + i + 2) };
    cols.forEach((k, j) => {
      if (k && !row[k]) row[k] = cellText(r[j]);
    });
    if (Object.keys(row).some((k) => k !== '_row' && row[k])) out.push(row);
  });
  return { rows: out, missing: [] };
}

/**
 * ייבוא: קודם תצוגה מקדימה (commit=false) — מה ייווצר, מה יעודכן ומה לא תקין. רק אחרי אישור
 * (commit=true) נכתב משהו ל-Airtable ולמסד.
 */
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'חסר קובץ' });
    const commit = req.body.commit === 'true';
    // ייבוא של בוגרות (ברירת המחדל) — כולן מסומנות "בוגרת" גם בלי עמודת מחזור
    const markAlumni = req.body.markAlumni !== 'false';
    // יש מחזור — לפיו: מחזור שעוד לומד (למשל תשפ"ז / תשפ"ח) לא מסומן כבוגרות. אין מחזור — לפי הסימון בטופס.
    const isAlumni = (gradYear: string) => cohortFinished(gradYear) ?? markAlumni;
    const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    // כל הגיליונות בקובץ — למשל גיליון לכל מחזור. גיליון בלי שורת כותרות מוכרת מדולג.
    const sheets: { name: string; rows: any[][] }[] = [];
    if (/\.xlsx$/i.test(fileName)) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(req.file.buffer as any);
      wb.worksheets.forEach((ws) => sheets.push({ name: ws.name.trim(), rows: sheetRows(ws) }));
    } else if (/\.csv$/i.test(fileName)) {
      sheets.push({ name: '', rows: parseCsv(req.file.buffer.toString('utf8')) });
    } else {
      return res.status(400).json({ error: 'אפשר לייבא רק קובץ Excel (xlsx) או CSV' });
    }
    const parsed = { rows: [] as ImportRow[] };
    const sheetSummary: { name: string; rows: number; years: string[] }[] = [];
    for (const sh of sheets) {
      const p = parseImport(sh.rows);
      if (p.missing.length) continue;
      const years = yearsInSheetName(sh.name);
      for (const r of p.rows) {
        if (sh.name) r._row = `${sh.name}, שורה ${r._row}`;
        (r as any)._sheetYears = years;
      }
      parsed.rows.push(...p.rows);
      sheetSummary.push({ name: sh.name, rows: p.rows.length, years });
    }
    if (!sheetSummary.length) return res.status(400).json({ error: 'לא נמצאה בקובץ שורת כותרות (שם פרטי, שם משפחה, תעודת זהות...)' });

    const students = await airtableFetch(TABLES.students);
    const byId = new Map<string, AirtableRecord>();
    const byName = new Map<string, AirtableRecord[]>();
    for (const s of students) {
      const k = idKey(s.fields['תעודת זהות']);
      if (k && !byId.has(k)) byId.set(k, s);
      const n = studentName(s);
      if (n) byName.set(n, [...(byName.get(n) || []), s]);
    }
    // רשומה שכבר שויכה לשורה בקובץ — לא משייכים אותה שוב לתלמידה אחרת
    const claimed = new Set<string>();

    /**
     * ת.ז. קובעת, לא השם: שורה עם ת.ז. מתאימה רק לתלמידה עם אותה ת.ז. — או לתלמידה יחידה באותו
     * שם שאין לה ת.ז. בכלל (ואז הת.ז. נכתבת לה). שתי בנות עם אותו שם ות.ז. שונה = שתי תלמידות.
     */
    function findExisting(id: string, name: string): { record: AirtableRecord | null; problem?: string } {
      if (id) {
        const byIdRec = byId.get(id);
        if (byIdRec) return { record: byIdRec };
        const noId = (byName.get(name) || []).filter((s) => !idKey(s.fields['תעודת זהות']) && !claimed.has(s.id));
        return { record: noId.length === 1 ? noId[0] : null };
      }
      const same = (byName.get(name) || []).filter((s) => !claimed.has(s.id));
      if (same.length > 1) return { record: null, problem: `יש במערכת ${same.length} תלמידות בשם "${name}" — חובה לכתוב ת.ז.` };
      if (same.length === 1 && idKey(same[0].fields['תעודת זהות']))
        return { record: null, problem: `במערכת כבר יש "${name}" עם ת.ז. — יש לכתוב ת.ז. בשורה כדי לדעת אם זו אותה תלמידה` };
      return { record: same[0] || null };
    }

    // מקבצים שורות לפי תלמידה (ת.ז., ואם אין — שם)
    type Person = {
      key: string;
      name: string;
      rows: ImportRow[];
      existing: AirtableRecord | null;
      fields: Record<string, string>;
      gradYear: string;
      notes: string;
      extra: { birthDateHe?: string; birthDate?: string; teachingStudies?: string; openingDebt?: number };
      years: { schoolYear: string; track: string; amountDue: number; amountPaid: number; hasAmounts: boolean }[];
      debts: { schoolYear: string; subject: string }[];
    };
    const people = new Map<string, Person>();
    const problems: { row: string; message: string }[] = [];
    for (const r of parsed.rows) {
      const name = norm(`${r.firstName || ''} ${r.lastName || ''}`);
      const id = idKey(r.idNumber);
      if (!id && (!r.firstName || !r.lastName)) {
        problems.push({ row: r._row, message: 'חסרים שם פרטי ושם משפחה (או ת.ז.)' });
        continue;
      }
      if (r.idNumber && id.length > 9) {
        problems.push({ row: r._row, message: `ת.ז. לא תקינה: ${r.idNumber}` });
        continue;
      }
      const key = id ? `id:${id}` : `name:${name}`;
      let p = people.get(key);
      if (!p) {
        const found = findExisting(id, name);
        if (found.problem) {
          problems.push({ row: r._row, message: found.problem });
          continue;
        }
        const existing = found.record;
        if (existing) claimed.add(existing.id);
        p = { key, name: name || (existing ? studentName(existing) : ''), rows: [], existing, fields: {}, gradYear: '', notes: '', extra: {}, years: [], debts: [] };
        people.set(key, p);
      }
      p.rows.push(r);
      for (const [k, f] of Object.entries(IMPORT_TO_AIRTABLE)) if (r[k] && !p.fields[f]) p.fields[f] = str(r[k], 200);
      // ת.ז. שנשמרה באקסל כמספר מאבדת את האפס שבהתחלה — משלימים ל-9 ספרות
      if (id) p.fields['תעודת זהות'] = id.padStart(9, '0');
      if (!p.name && name) p.name = name;
      const sheetYears: string[] = (r as any)._sheetYears || [];
      // מחזור: מהעמודה, ואם אין — השנה האחרונה בשם הגיליון
      const grad = normalizeSchoolYear(r.gradYear) || sheetYears[sheetYears.length - 1] || '';
      if (grad) p.gradYear = grad;
      const addNote = (t: string) => {
        if (t && !p!.notes.includes(t)) p!.notes = p!.notes ? `${p!.notes}; ${t}` : t;
      };
      if (r.notes) addNote(r.notes);
      if (r.financialNote) addNote(`חובות כספיים: ${r.financialNote}`);
      if (r.birthDateHe) p.extra.birthDateHe = r.birthDateHe;
      if (r.birthDate) p.extra.birthDate = r.birthDate;
      if (r.teachingStudies) p.extra.teachingStudies = r.teachingStudies;
      if (r.financialDebt && num(r.financialDebt) > 0) p.extra.openingDebt = num(r.financialDebt);
      const hasAmounts = !!(r.amountDue || r.amountPaid);
      const schoolYear = normalizeSchoolYear(r.schoolYear);
      const addYear = (y: string, withAmounts: boolean) => {
        const prevYear = p!.years.find((x) => x.schoolYear === y);
        if (prevYear && !withAmounts) return; // לא דורסים שנה עם סכומים בשנה בלי
        p!.years = p!.years.filter((x) => x.schoolYear !== y);
        p!.years.push({
          schoolYear: y,
          track: str(r.track, 100) || prevYear?.track || '',
          amountDue: withAmounts ? num(r.amountDue) : 0,
          amountPaid: withAmounts ? num(r.amountPaid) : 0,
          hasAmounts: withAmounts,
        });
      };
      if (schoolYear) addYear(schoolYear, hasAmounts);
      else {
        // בלי עמודת שנה — השנים משם הגיליון (שנים שלמדה, בלי סכומים)
        for (const y of sheetYears) addYear(y, false);
        if (hasAmounts) problems.push({ row: r._row, message: 'יש סכומים בלי "שנת לימודים" — הסכומים לא ייובאו' });
      }
      if (r.academicDebt) {
        // בקובץ מסומן לפעמים רק V — אז כותבים חוב כללי, ומפרטים בתיק
        const subject = /^[vV✓✔xX]$/.test(r.academicDebt.trim()) ? 'חוב לימודי (מסומן בקובץ — לפרט)' : str(r.academicDebt, 200);
        p.debts.push({ schoolYear: schoolYear || sheetYears[sheetYears.length - 1] || '', subject });
      }
    }

    const list = [...people.values()];
    if (!commit) {
      return res.json({
        preview: true,
        newCount: list.filter((p) => !p.existing).length,
        existingCount: list.filter((p) => p.existing).length,
        yearsCount: list.reduce((s, p) => s + p.years.length, 0),
        debtsCount: list.reduce((s, p) => s + p.debts.length, 0),
        financialDebtCount: list.filter((p) => p.extra.openingDebt).length,
        sheets: sheetSummary,
        people: list.map((p) => ({
          name: p.name || (p.existing ? studentName(p.existing) : ''),
          idNumber: p.fields['תעודת זהות'] || '',
          existing: !!p.existing,
          gradYear: p.gradYear,
          alumni: isAlumni(p.gradYear),
          years: p.years.map((y) => y.schoolYear),
          debts: p.debts.length,
        })),
        problems,
      });
    }

    // כתיבה: יצירת החדשות בקבוצות, ולקיימות — רק שדות שעוד ריקים ב-Airtable
    const toCreate = list.filter((p) => !p.existing);
    const created = await airtableBatchCreate(
      TABLES.students,
      toCreate.map((p) => p.fields)
    );
    toCreate.forEach((p, i) => (p.existing = created[i]));
    const updates = list
      .filter((p) => !toCreate.includes(p))
      .map((p) => ({
        id: p.existing!.id,
        fields: Object.fromEntries(Object.entries(p.fields).filter(([f]) => !norm(p.existing!.fields[f]))),
      }))
      .filter((u) => Object.keys(u.fields).length);
    if (updates.length) await airtableBatchUpdate(TABLES.students, updates);

    let years = 0;
    let debts = 0;
    for (const p of list) {
      const studentId = p.existing!.id;
      const prev = await prisma.studentProfile.findUnique({ where: { studentId } });
      const notes = prev?.notes && p.notes && prev.notes.includes(p.notes) ? prev.notes : [prev?.notes, p.notes].filter(Boolean).join('; ');
      await saveProfile(studentId, {
        status: isAlumni(p.gradYear) ? 'בוגרת' : p.gradYear ? 'פעילה' : prev?.status,
        gradYear: p.gradYear || prev?.gradYear || '',
        notes,
        // רק מה שיש בקובץ — שדה שחסר בקובץ לא מוחק את מה שכבר נשמר
        ...(p.extra.birthDateHe ? { birthDateHe: p.extra.birthDateHe } : {}),
        ...(p.extra.birthDate ? { birthDate: p.extra.birthDate } : {}),
        ...(p.extra.teachingStudies ? { teachingStudies: p.extra.teachingStudies } : {}),
        ...(p.extra.openingDebt ? { openingDebt: p.extra.openingDebt } : {}),
      });
      for (const y of p.years) {
        const data = { track: y.track || null, amountDue: y.amountDue, amountPaid: y.amountPaid };
        // שנה בלי סכומים בקובץ — לא מאפסת סכומים שכבר נרשמו לשנה הזו
        const update = y.hasAmounts ? data : y.track ? { track: y.track } : {};
        await prisma.studentYear.upsert({
          where: { studentId_schoolYear: { studentId, schoolYear: y.schoolYear } },
          create: { studentId, schoolYear: y.schoolYear, ...data },
          update,
        });
        years++;
      }
      for (const d of p.debts) {
        const dup = await prisma.studentAcademicDebt.findFirst({ where: { studentId, subject: d.subject } });
        if (dup) continue;
        await prisma.studentAcademicDebt.create({ data: { studentId, schoolYear: d.schoolYear || null, subject: d.subject, createdBy: req.user!.name } });
        debts++;
      }
    }
    res.json({ success: true, created: created.length, updated: list.length - created.length, years, debts, problems });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בייבוא' });
  }
});

// ---------- ייבוא דוח תשלומים שנתי (גיליון לכל כיתה, עמודה לכל חודש) ----------

/** סכום מתא: "1650", "1,650", "1100+650" — אחרת null (הערה) */
function parseAmount(t: string): number | null {
  const s = t.replace(/[,₪\s]/g, '');
  if (!s) return null;
  if (/^\d+(\.\d+)?(\+\d+(\.\d+)?)*$/.test(s)) return s.split('+').reduce((a, b) => a + Number(b), 0);
  return null;
}

type PayMonth = { month: number; amount: number | null; amountText: string | null; method: string | null; debt: number; debtText: string | null };
type PayRow = { row: string; sheet: string; id: string; first: string; last: string; track: string; notes: string[]; months: PayMonth[] };

/** גיליון כיתה: שם משפחה, שם פרטי, ת"ז, התמחות, תשלום חודשי, ואז לכל חודש: "חודש 9", אופן תשלום, סה"כ חוב */
function parsePaymentSheet(sheet: string, rows: any[][]): PayRow[] | null {
  const headerIdx = rows.findIndex(
    (r) => r.some((c) => /^חודש\s*\d+$/.test(cellText(c))) && r.some((c) => headerKey(cellText(c)) === 'שםפרטי')
  );
  if (headerIdx < 0) return null;
  const h = rows[headerIdx].map((c) => cellText(c));
  const hk = h.map(headerKey);
  const firstCol = hk.indexOf('שםפרטי');
  // בגיליון אחד כותרת שם המשפחה נמחקה — אז זו העמודה שלפני השם הפרטי
  const lastCol = hk.indexOf('שםמשפחה') >= 0 ? hk.indexOf('שםמשפחה') : firstCol - 1;
  const idCol = hk.findIndex((x) => x === 'תז' || x === 'תעודתזהות');
  const specCol = hk.indexOf('התמחות');
  const feeCol = hk.indexOf('תשלוםחודשי');
  const notesCol = hk.indexOf('הערות');
  const discountCol = hk.findIndex((x) => x.startsWith('הנחה'));
  const monthCols = h
    .map((x, i) => {
      const m = x.match(/^חודש\s*(\d+)$/);
      return m ? { i, month: Number(m[1]) } : null;
    })
    .filter(Boolean) as { i: number; month: number }[];

  const out: PayRow[] = [];
  rows.slice(headerIdx + 1).forEach((r, k) => {
    const t = (i: number) => (i >= 0 ? cellText(r[i]) : '');
    const first = t(firstCol);
    const last = t(lastCol);
    if (!first || !last) return;
    const months: PayMonth[] = [];
    monthCols.forEach(({ i, month }, n) => {
      const next = monthCols[n + 1]?.i ?? h.length;
      let methodCol = -1;
      let debtCol = -1;
      for (let j = i + 1; j < next; j++) {
        if (hk[j].includes('אופן')) methodCol = j;
        else if (hk[j].includes('חוב')) debtCol = j;
      }
      const amountRaw = t(i);
      const amount = parseAmount(amountRaw);
      const debtRaw = t(debtCol);
      const debtNum = !debtRaw || debtRaw === 'ללא' ? 0 : parseAmount(debtRaw);
      const m: PayMonth = {
        month,
        amount,
        amountText: amountRaw && amount === null ? str(amountRaw, 200) : null,
        method: str(t(methodCol), 100) || null,
        debt: debtNum ?? 0,
        debtText: debtRaw && debtRaw !== 'ללא' && debtNum === null ? str(debtRaw, 200) : null,
      };
      if (m.amount !== null || m.amountText || m.method || m.debt || m.debtText) months.push(m);
    });
    const notes: string[] = [];
    if (t(feeCol)) notes.push(`תשלום חודשי: ${t(feeCol)}`);
    if (t(discountCol) && t(discountCol) !== '0') notes.push(`הנחה: ${t(discountCol)}%`);
    if (t(notesCol)) notes.push(t(notesCol));
    out.push({
      row: `${sheet}, שורה ${headerIdx + k + 2}`,
      sheet,
      id: idKey(t(idCol)),
      first,
      last,
      track: [sheet, t(specCol)].filter(Boolean).join(' · '),
      notes,
      months,
    });
  });
  return out;
}

/** גיליון "תשלומים נוספים": שורת תאריכים, שורת שמות האירועים (משפחה, שם, ...), ואז בת בכל שורה */
function parseExtraSheet(rows: any[][]): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  const hr = rows.findIndex((r) => r.some((c) => cellText(c) === 'משפחה') && r.some((c) => cellText(c) === 'שם'));
  if (hr < 0) return byName;
  const titles = rows[hr].map((c) => cellText(c));
  const dates = hr > 0 ? rows[hr - 1].map((c) => cellText(c)) : [];
  const lastCol = titles.indexOf('משפחה');
  const firstCol = titles.indexOf('שם');
  for (const r of rows.slice(hr + 1)) {
    const name = norm(`${cellText(r[firstCol])} ${cellText(r[lastCol])}`);
    if (!cellText(r[firstCol])) continue;
    const items = new Map<string, string[]>();
    titles.forEach((title, j) => {
      if (j === lastCol || j === firstCol || !title) return;
      const v = cellText(r[j]);
      if (!v) return;
      const label = /חודש/.test(dates[j] || '') ? `${title} (${dates[j].replace(/^חודש\s*/, '')})` : title;
      items.set(label, [...(items.get(label) || []), v]);
    });
    if (items.size) byName.set(name, [...items.entries()].map(([l, v]) => `${l}: ${v.join(' ')}`));
  }
  return byName;
}

/**
 * ייבוא דוח תשלומים של שנה: לכל בת (לפי ת.ז.) — סיכום השנה (שולם + חוב) ופירוט חודשי, ותשלומים
 * נוספים כהערה. בת שלא נמצאה במערכת לפי ת.ז. לא נוצרת — מופיעה ברשימת הבעיות.
 */
router.post('/importPayments', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'חסר קובץ' });
    const commit = req.body.commit === 'true';
    const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    // השנה משם הקובץ — מילה שלמה ("דוח תשלומים תשפה" ← תשפ"ה, ולא "תשלו" מתוך "תשלומים")
    const fromName = fileName.match(/(?:^|[^א-ת])(תש[א-ת]?["״'׳_]{0,2}[א-ת])(?=[^א-ת]|$)/)?.[1]?.replace(/_/g, '');
    const schoolYear = normalizeSchoolYear(req.body.schoolYear) || normalizeSchoolYear(fromName);
    if (!schoolYear) return res.status(400).json({ error: 'יש לבחור את שנת הלימודים של הקובץ' });
    if (!/\.xlsx$/i.test(fileName)) return res.status(400).json({ error: 'אפשר לייבא רק קובץ Excel (xlsx)' });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer as any);
    const rows: PayRow[] = [];
    const sheets: { name: string; rows: number }[] = [];
    let extras = new Map<string, string[]>();
    for (const ws of wb.worksheets) {
      const name = ws.name.trim();
      const data = sheetRows(ws);
      if (/נוספ/.test(name)) {
        extras = parseExtraSheet(data);
        sheets.push({ name, rows: extras.size });
        continue;
      }
      const parsed = parsePaymentSheet(name, data);
      if (!parsed) continue;
      rows.push(...parsed);
      sheets.push({ name, rows: parsed.length });
    }
    if (!rows.length) return res.status(400).json({ error: 'לא נמצא בקובץ גיליון עם עמודות "שם פרטי" ו"חודש 9"...' });

    const students = await airtableFetch(TABLES.students);
    const byId = new Map<string, AirtableRecord>();
    for (const s of students) {
      const k = idKey(s.fields['תעודת זהות']);
      if (k && !byId.has(k)) byId.set(k, s);
    }

    const problems: { row: string; message: string }[] = [];
    const matched: (PayRow & { student: AirtableRecord; paid: number; debt: number; extra: string[] })[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const name = `${r.first} ${r.last}`;
      if (!r.id) {
        problems.push({ row: r.row, message: `${name}: אין ת.ז. — יש להוסיף בקובץ` });
        continue;
      }
      const student = byId.get(r.id);
      if (!student) {
        problems.push({ row: r.row, message: `${name}: לא נמצאה במערכת תלמידה עם ת.ז. זו` });
        continue;
      }
      if (seen.has(r.id)) {
        problems.push({ row: r.row, message: `${name}: מופיעה פעמיים בקובץ — נלקחה השורה הראשונה` });
        continue;
      }
      seen.add(r.id);
      const paid = r.months.reduce((s, m) => s + (m.amount || 0), 0);
      const debt = r.months.reduce((s, m) => s + m.debt, 0);
      matched.push({ ...r, student, paid, debt, extra: extras.get(norm(name)) || [] });
    }
    const textCells = matched.reduce((s, r) => s + r.months.filter((m) => m.amountText || m.debtText).length, 0);

    if (!commit) {
      return res.json({
        preview: true,
        schoolYear,
        sheets,
        matchedCount: matched.length,
        totalPaid: Math.round(matched.reduce((s, r) => s + r.paid, 0)),
        totalDebt: Math.round(matched.reduce((s, r) => s + r.debt, 0)),
        withDebt: matched.filter((r) => r.debt > 0).length,
        textCells,
        extrasCount: matched.filter((r) => r.extra.length).length,
        people: matched.map((r) => ({
          name: studentName(r.student),
          sheet: r.sheet,
          paid: r.paid,
          debt: r.debt,
          months: r.months.length,
          notes: r.months.filter((m) => m.amountText || m.debtText).length,
        })),
        problems,
      });
    }

    for (const r of matched) {
      const studentId = r.student.id;
      const notes = [...r.notes, ...(r.extra.length ? [`תשלומים נוספים — ${r.extra.join('; ')}`] : [])].join(' | ').slice(0, 2000) || null;
      const data = { track: str(r.track, 100) || null, amountDue: r.paid + r.debt, amountPaid: r.paid, notes };
      await prisma.studentYear.upsert({
        where: { studentId_schoolYear: { studentId, schoolYear } },
        create: { studentId, schoolYear, ...data },
        update: data,
      });
      await prisma.studentYearMonth.deleteMany({ where: { studentId, schoolYear } });
      if (r.months.length) await prisma.studentYearMonth.createMany({ data: r.months.map((m) => ({ studentId, schoolYear, ...m })) });
    }
    res.json({ success: true, imported: matched.length, problems });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בייבוא' });
  }
});

export default router;
