import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { airtableFetch, TABLES } from '../lib/airtable';
import { signSession, SESSION_COOKIE, cookieOptions } from '../lib/auth';
import { enrichCurrentUser } from '../middleware/auth';

const router = Router();

/** משווה שמות בלי תלות בסדר המילים (למשל "סיגל רבקה" מול "רבקה סיגל"), כדי שהתאמה לא תיפול רק כי השם ב-Airtable כתוב הפוך. */
function sameNameIgnoringWordOrder(a: string, b: string): boolean {
  const normalize = (s: string) => s.trim().split(/\s+/).filter(Boolean).sort().join(' ');
  return normalize(a) === normalize(b);
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/**
 * מוצא של-Airtable ולעובד יש כתיב כמעט זהה (למשל "זגדון" מול "זיגדון" — אות אחת חסרה) —
 * מקרה אמיתי שקרה: היה לעובדת חשבון תקין, אבל ההתחברות נכשלה כי השם ב-Airtable לא היה
 * זהה אות-באות לשם במערכת. מקבלים התאמה רק אם היא חד-משמעית (בדיוק עובדת אחת קרובה מספיק),
 * כדי לא לנחש בטעות בין שתי עובדות בעלות שמות דומים.
 */
function findFuzzyNameMatch<T extends { name: string }>(userName: string, users: T[]): T | undefined {
  const candidates = users
    .map((u) => ({ user: u, distance: levenshtein(u.name.trim(), userName) }))
    .filter((c) => c.distance > 0 && c.distance <= 2)
    .sort((a, b) => a.distance - b.distance);
  if (candidates.length === 0) return undefined;
  if (candidates.length > 1 && candidates[0].distance === candidates[1].distance) return undefined;
  return candidates[0].user;
}

router.post('/login', async (req, res) => {
  try {
    const { password } = req.body as { password?: string };
    if (!password) return res.status(400).json({ error: 'חובה להזין סיסמה' });

    const passwordRecords = await airtableFetch(TABLES.passwords, {
      filterByFormula: `{סיסמה מאוחדת} = "${password.replace(/"/g, '\\"')}"`,
      maxRecords: 1,
    });
    const passwordRecord = passwordRecords[0];
    if (!passwordRecord) return res.status(401).json({ error: 'סיסמה שגויה' });

    const userName = String(passwordRecord.fields['שם המשתמש'] || '').trim();
    if (!userName) return res.status(401).json({ error: 'לא נמצא שם משתמש משויך לסיסמה' });

    const allUsers = await prisma.user.findMany({ where: { isActive: true } });
    let matched = allUsers.find((u) => u.name.trim() === userName);
    if (!matched) {
      matched = allUsers.find((u) => u.name.includes(userName) || userName.includes(u.name));
    }
    if (!matched) {
      matched = allUsers.find((u) => u.firstName && userName.includes(u.firstName));
    }
    if (!matched) {
      matched = allUsers.find((u) => sameNameIgnoringWordOrder(u.name, userName));
    }
    if (!matched) {
      matched = findFuzzyNameMatch(userName, allUsers);
    }
    if (!matched) return res.status(404).json({ error: `לא נמצא עובד תואם לשם "${userName}"` });

    const approved = (v: any) => v === 'מאושר' || v === true;
    const permissions = {
      system: approved(passwordRecord.fields['גישה למערכת']),
      grades: approved(passwordRecord.fields['גישה לציונים']),
      payments: approved(passwordRecord.fields['גישה לתשלומים']),
      teacherAttendance: approved(passwordRecord.fields['גישה לנוכחות מורה']),
      studentAttendance: approved(passwordRecord.fields['גישה לנוכחות תלמידה']),
      contracts: true,
    };

    const token = signSession({ userId: matched.id, permissions });
    res.cookie(SESSION_COOKIE, token, cookieOptions);

    res.json({ success: true, userName: matched.name, userId: matched.id, permissions });
  } catch (err: any) {
    const notConfigured = String(err.message || '').includes('AIRTABLE_API_KEY');
    const rateLimited = err.response?.status === 429;
    const message = rateLimited
      ? 'המערכת עמוסה כרגע, נסו שוב בעוד כמה שניות'
      : err.message || 'שגיאה בהתחברות';
    res.status(notConfigured ? 503 : rateLimited ? 429 : 500).json({ error: message });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined });
  res.json({ success: true });
});

router.get('/me', enrichCurrentUser, (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'לא מחובר' });
  const {
    id,
    name,
    role,
    department,
    permissions,
    idNumber,
    dailyTravelCost,
    monthlyBusPass,
    isAttendanceManager,
    trackLessons,
    canManageAllStudentTracks,
  } = req.user;
  res.json({
    id,
    name,
    role,
    department,
    permissions,
    idNumber,
    dailyTravelCost,
    monthlyBusPass,
    isAttendanceManager,
    trackLessons,
    canManageAllStudentTracks,
  });
});

export default router;
