import { prisma } from './prisma';
import { sendEmail, isEmailConfigured } from './email';
import { getAttendanceSnapshot, TeacherSnapshot } from './attendanceSnapshot';

/**
 * מייל שבועי (ביום שישי בבוקר) עם תמונת מצב של נוכחות התלמידות: השבוע, ומתחילת החודש. הנמענות
 * נבחרות במסך "תמונת מצב נוכחות" (SiteSettings.attendanceDigestRecipients — רשימת מזהי עובדות).
 */

const SITE_URL = process.env.APP_URL || 'https://yeshivaanegev.onrender.com';
const DIGEST_DAY = 5; // שישי (0 = ראשון)

const israelNow = () => {
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  return { date, dow: new Date(`${date}T12:00:00Z`).getUTCDay() };
};
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const he = (date: string) => date.split('-').reverse().map(Number).slice(0, 2).join('/');

export async function getDigestRecipients(): Promise<string[]> {
  const s = await prisma.siteSettings.findUnique({ where: { id: 'singleton' }, select: { attendanceDigestRecipients: true } });
  try {
    return JSON.parse(s?.attendanceDigestRecipients || '[]');
  } catch {
    return [];
  }
}

export async function setDigestRecipients(ids: string[]): Promise<void> {
  const value = JSON.stringify([...new Set(ids)].slice(0, 20));
  await prisma.siteSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', attendanceDigestRecipients: value },
    update: { attendanceDigestRecipients: value },
  });
}

function table(teachers: TeacherSnapshot[]): string {
  if (!teachers.length) return '<p>אין שיעורים בטווח הזה.</p>';
  const rows = teachers
    .map((t) => {
      const pct = Math.round((t.filled / t.required) * 100);
      const color = t.missing.length === 0 ? '#15803d' : pct < 50 ? '#b91c1c' : '#b45309';
      return `<tr>
        <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0">${t.name}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;text-align:center">${t.filled}/${t.required}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;text-align:center;color:${color};font-weight:bold">${t.missing.length ? t.missing.length : '✓'}</td>
      </tr>`;
    })
    .join('');
  return `<table style="border-collapse:collapse;font-size:14px;min-width:340px">
    <tr style="background:#0f172a;color:#f1c40f"><th style="padding:6px 8px;text-align:right">מורה</th><th style="padding:6px 8px">מולא / נדרש</th><th style="padding:6px 8px">חסרים</th></tr>
    ${rows}
  </table>`;
}

function totals(teachers: TeacherSnapshot[]) {
  const required = teachers.reduce((s, t) => s + t.required, 0);
  const missing = teachers.reduce((s, t) => s + t.missing.length, 0);
  return { required, missing, pct: required ? Math.round(((required - missing) / required) * 100) : 100 };
}

export async function buildDigest(): Promise<{ subject: string; html: string }> {
  const { date } = israelNow();
  const weekStart = addDays(date, -new Date(`${date}T12:00:00Z`).getUTCDay()); // יום ראשון של השבוע
  const monthStart = `${date.slice(0, 7)}-01`;
  const [week, month] = await Promise.all([getAttendanceSnapshot(weekStart, date), getAttendanceSnapshot(monthStart, date)]);
  const w = totals(week.teachers);
  const m = totals(month.teachers);
  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif; font-size: 15px; color: #1e293b; line-height: 1.6;">
      <h2 style="color:#0f172a;margin:0 0 8px">תמונת מצב — נוכחות תלמידות</h2>
      <p style="margin:0 0 16px">מולאה נוכחות ב-<b>${w.pct}%</b> מהשיעורים השבוע (${w.missing} חסרים), וב-<b>${m.pct}%</b> מתחילת החודש (${m.missing} חסרים).</p>
      <h3 style="margin:16px 0 6px">השבוע (${he(weekStart)}–${he(date)})</h3>
      ${table(week.teachers)}
      <h3 style="margin:20px 0 6px">מתחילת החודש (${he(monthStart)}–${he(date)})</h3>
      ${table(month.teachers)}
      <p style="margin:24px 0">
        <a href="${SITE_URL}/attendance-snapshot" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 24px;border-radius:8px;font-weight:bold;display:inline-block">לפירוט במערכת</a>
      </p>
      <p style="font-size:13px;color:#64748b">"שיבוץ" = שיעור של 45 דק' למסלול אחד לפי מערכת השעות. שיעורים שבוטלו לא נספרים.</p>
    </div>`;
  return { subject: `תמונת מצב נוכחות תלמידות — ${he(date)}`, html };
}

/** שליחה לנמענות שנבחרו (או לכתובת אחת — לבדיקה). מחזיר כמה נשלחו. */
export async function sendDigest(onlyTo?: string): Promise<number> {
  if (!isEmailConfigured()) throw new Error('שליחת מיילים לא מוגדרת בשרת');
  const { subject, html } = await buildDigest();
  if (onlyTo) {
    await sendEmail(onlyTo, `[בדיקה] ${subject}`, html);
    return 1;
  }
  const ids = await getDigestRecipients();
  const users = await prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { email: true } });
  let sent = 0;
  for (const u of users) {
    if (!u.email) continue;
    await sendEmail(u.email, subject, html);
    sent++;
  }
  return sent;
}

/** נקרא מה"דופק" היומי — שולח פעם אחת ביום שישי */
export async function checkAndSendAttendanceDigest(): Promise<string> {
  const { date, dow } = israelNow();
  if (dow !== DIGEST_DAY) return 'לא יום שליחה';
  const s = await prisma.siteSettings.findUnique({ where: { id: 'singleton' }, select: { lastAttendanceDigest: true } });
  if (s?.lastAttendanceDigest === date) return 'כבר נשלח היום';
  if (!(await getDigestRecipients()).length) return 'אין נמענות';
  // מסמנים לפני השליחה — כדי ששני "דופקים" באותו יום לא ישלחו פעמיים
  await prisma.siteSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', lastAttendanceDigest: date },
    update: { lastAttendanceDigest: date },
  });
  const sent = await sendDigest();
  return `נשלח ל-${sent}`;
}
