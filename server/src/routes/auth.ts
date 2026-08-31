import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { airtableFetch, TABLES } from '../lib/airtable';
import { signSession, SESSION_COOKIE, cookieOptions } from '../lib/auth';
import { enrichCurrentUser } from '../middleware/auth';

const router = Router();

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
  const { id, name, role, department, permissions, idNumber, dailyTravelCost, monthlyBusPass, isAttendanceManager } =
    req.user;
  res.json({ id, name, role, department, permissions, idNumber, dailyTravelCost, monthlyBusPass, isAttendanceManager });
});

export default router;
