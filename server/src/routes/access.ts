import { Router } from 'express';
import crypto from 'crypto';
import { airtableFetch, airtableCreate, airtableUpdate, TABLES } from '../lib/airtable';
import { prisma } from '../lib/prisma';
import { requireAuth, requireAdmin } from '../middleware/auth';

/**
 * לשונית "סיסמאות והרשאות" בניהול — ניהול טבלת הסיסמאות וההרשאות שב-Airtable מתוך המערכת.
 * רק מנהלות, ורק אחרי הקלדת קוד נפרד (נשמר כ-hash). פתיחה בקוד תקפה 15 דקות (מתחדשת בכל פעולה).
 */
const router = Router();
router.use(requireAuth, requireAdmin);

const T = TABLES.passwords;
const NAME = 'שם המשתמש';
const PASSWORD = 'סיסמה מאוחדת';
const APPROVED = 'מאושר';
const NOT_APPROVED = 'לא מאושר';
/** ההרשאות — מפתח לממשק ← שם העמודה ב-Airtable */
const PERMS: { key: string; field: string; label: string }[] = [
  { key: 'system', field: 'גישה למערכת', label: 'מערכת (ניהול)' },
  { key: 'teacherAttendance', field: 'גישה לנוכחות מורה', label: 'נוכחות מורה' },
  { key: 'studentAttendance', field: 'גישה לנוכחות תלמידה', label: 'נוכחות תלמידות' },
  { key: 'grades', field: 'גישה לציונים', label: 'ציונים' },
  { key: 'payments', field: 'גישה לתשלומים', label: 'תשלומים' },
  { key: 'expenses', field: 'גישה הוצאות', label: 'הוצאות' },
];

// ---------- קוד הפתיחה ----------
const hash = (code: string, salt: string) => crypto.scryptSync(code, salt, 32).toString('hex');

async function storedCode() {
  return (await prisma.siteSettings.findUnique({ where: { id: 'singleton' }, select: { accessAdminCode: true } }))?.accessAdminCode || null;
}
async function verifyCode(code: unknown) {
  const s = await storedCode();
  if (!s || !code) return false;
  const [salt, h] = s.split(':');
  const a = Buffer.from(hash(String(code), salt), 'hex');
  const b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// פתיחות פעילות: token ← { userId, expires }. בזיכרון — הפעלה מחדש של השרת נועלת שוב (זה בסדר).
const unlocks = new Map<string, { userId: string; expires: number }>();
const TTL = 15 * 60 * 1000;

function requireUnlock(req: any, res: any, next: any) {
  const token = String(req.headers['x-access-token'] || '');
  const u = unlocks.get(token);
  if (!u || u.userId !== req.user.id || u.expires < Date.now()) {
    unlocks.delete(token);
    return res.status(423).json({ error: 'הלשונית נעולה — יש להקליד את הקוד', locked: true });
  }
  u.expires = Date.now() + TTL; // מתחדש בכל פעולה
  next();
}

router.get('/status', async (_req, res) => {
  res.json({ hasCode: !!(await storedCode()) });
});

/** קביעת / החלפת הקוד (החלפה דורשת את הקוד הנוכחי) */
router.post('/setCode', async (req, res) => {
  try {
    const { currentCode, newCode } = req.body as { currentCode?: string; newCode?: string };
    const code = String(newCode || '').trim();
    if (code.length < 4) return res.status(400).json({ error: 'הקוד צריך להיות לפחות 4 תווים' });
    if ((await storedCode()) && !(await verifyCode(currentCode))) return res.status(403).json({ error: 'הקוד הנוכחי שגוי' });
    const salt = crypto.randomBytes(16).toString('hex');
    const value = `${salt}:${hash(code, salt)}`;
    await prisma.siteSettings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', accessAdminCode: value }, update: { accessAdminCode: value } });
    unlocks.clear();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה' });
  }
});

router.post('/unlock', async (req, res) => {
  try {
    if (!(await verifyCode(req.body?.code))) return res.status(403).json({ error: 'קוד שגוי' });
    const token = crypto.randomBytes(24).toString('hex');
    unlocks.set(token, { userId: req.user!.id, expires: Date.now() + TTL });
    res.json({ token, minutes: TTL / 60000 });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה' });
  }
});

// ---------- הטבלה ----------
const mapRow = (r: { id: string; fields: Record<string, any> }) => ({
  id: r.id,
  name: String(r.fields[NAME] || '').trim(),
  password: String(r.fields[PASSWORD] || ''),
  perms: Object.fromEntries(PERMS.map((p) => [p.key, r.fields[p.field] === APPROVED])),
});

router.get('/list', requireUnlock, async (_req, res) => {
  try {
    const rows = (await airtableFetch(T)).map(mapRow).filter((r) => r.name || r.password);
    rows.sort((a, b) => a.name.localeCompare(b.name, 'he'));
    res.json({ rows, perms: PERMS.map(({ key, label }) => ({ key, label })) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינה' });
  }
});

/** הכניסה למערכת היא לפי הסיסמה בלבד — שתי עובדות עם אותה סיסמה לא יכולות להיכנס נכון */
async function passwordTaken(password: string, exceptId?: string) {
  const rows = await airtableFetch(T, { fields: [PASSWORD] });
  return rows.some((r) => r.id !== exceptId && String(r.fields[PASSWORD] || '').trim() === password);
}

function fieldsFrom(body: any): Record<string, any> {
  const fields: Record<string, any> = {};
  if (typeof body?.name === 'string') fields[NAME] = body.name.trim().slice(0, 100);
  if (typeof body?.password === 'string') fields[PASSWORD] = body.password.trim().slice(0, 100);
  for (const p of PERMS) if (typeof body?.perms?.[p.key] === 'boolean') fields[p.field] = body.perms[p.key] ? APPROVED : NOT_APPROVED;
  return fields;
}

router.post('/update', requireUnlock, async (req, res) => {
  try {
    const { id } = req.body as { id?: string };
    if (!id) return res.status(400).json({ error: 'חסר מזהה' });
    const fields = fieldsFrom(req.body);
    if (PASSWORD in fields) {
      if (fields[PASSWORD].length < 3) return res.status(400).json({ error: 'סיסמה קצרה מדי' });
      if (await passwordTaken(fields[PASSWORD], id)) return res.status(400).json({ error: 'הסיסמה הזו כבר בשימוש אצל עובד/ת אחר/ת' });
    }
    const r = await airtableUpdate(T, id, fields);
    res.json({ success: true, row: mapRow(r) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בשמירה' });
  }
});

router.post('/create', requireUnlock, async (req, res) => {
  try {
    const fields = fieldsFrom(req.body);
    if (!fields[NAME]) return res.status(400).json({ error: 'חסר שם' });
    if (!fields[PASSWORD] || fields[PASSWORD].length < 3) return res.status(400).json({ error: 'חסרה סיסמה' });
    if (await passwordTaken(fields[PASSWORD])) return res.status(400).json({ error: 'הסיסמה הזו כבר בשימוש אצל עובד/ת אחר/ת' });
    for (const p of PERMS) if (!(p.field in fields)) fields[p.field] = NOT_APPROVED;
    const r = await airtableCreate(T, fields);
    res.json({ success: true, row: mapRow(r) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה ביצירה' });
  }
});

export default router;
