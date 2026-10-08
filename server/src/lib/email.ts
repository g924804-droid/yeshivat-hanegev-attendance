import nodemailer from 'nodemailer';
import fetch from 'node-fetch';

/**
 * שליחת מיילים — שתי דרכים:
 *
 * 1. Google Apps Script (מומלץ, ובשימוש בפועל): EMAIL_SCRIPT_URL + EMAIL_SCRIPT_SECRET.
 *    Render בתוכנית החינמית חוסם יציאה לפורטים של SMTP (זה מה שגרם ל-"Connection timeout"),
 *    אז השרת שולח בקשת HTTPS לסקריפט קטן בחשבון ה-Google של הישיבה, והסקריפט שולח מה-Gmail.
 *    קוד הסקריפט נמצא ב-docs/email-apps-script.gs.
 *
 * 2. SMTP רגיל (Gmail עם סיסמת אפליקציה, או Outlook): EMAIL_USER + EMAIL_PASSWORD — עובד רק
 *    באחסון שלא חוסם SMTP.
 */
let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

const FROM_NAME = 'ישיבת הנגב';

export function isEmailConfigured(): boolean {
  return !!(process.env.EMAIL_SCRIPT_URL || (process.env.EMAIL_USER && process.env.EMAIL_PASSWORD));
}

async function sendViaScript(to: string, subject: string, html: string): Promise<void> {
  let res;
  try {
    // הסקריפט מחזיר הפניה (302) לכתובת התשובה — fetch עוקב אחריה אוטומטית
    res = await fetch(process.env.EMAIL_SCRIPT_URL!.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: process.env.EMAIL_SCRIPT_SECRET || '', to, subject, html, fromName: FROM_NAME }),
      timeout: 30_000,
    });
  } catch (err: any) {
    throw new Error(`לא ניתן להגיע לסקריפט השליחה של Google: ${err.message}`);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    // דף HTML במקום JSON = בדרך כלל הסקריפט לא פורסם עם גישה ל"כל אחד"
    throw new Error('סקריפט השליחה לא החזיר תשובה תקינה — יש לוודא שהוא פורסם כ-Web app עם גישה ל"כל אחד" (Anyone)');
  }
  if (!data.ok) {
    if (data.error === 'unauthorized') throw new Error('הקוד הסודי לא תואם — EMAIL_SCRIPT_SECRET ב-Render צריך להיות זהה ל-SECRET בסקריפט');
    throw new Error(`Google לא שלח את המייל: ${data.error}`);
  }
}

function defaultHost(user: string): string {
  return /@(gmail|googlemail)\.com$/i.test(user) ? 'smtp.gmail.com' : 'smtp.office365.com';
}

async function sendViaSmtp(to: string, subject: string, html: string): Promise<void> {
  const user = process.env.EMAIL_USER?.trim();
  // גוגל מציגה את סיסמת האפליקציה עם רווחים ("abcd efgh ...") — מנקים אם הודבקה כך
  const pass = process.env.EMAIL_PASSWORD?.replace(/\s+/g, '');
  if (!user || !pass) {
    throw new Error('שליחת מייל לא מוגדרת — חסרים משתני הסביבה EMAIL_SCRIPT_URL או EMAIL_USER/EMAIL_PASSWORD');
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || defaultHost(user),
      port: Number(process.env.EMAIL_PORT) || 587,
      secure: false,
      requireTLS: true,
      connectionTimeout: 15_000,
      auth: { user, pass },
    });
  }
  try {
    await transporter.sendMail({ from: { name: FROM_NAME, address: user }, to, subject, html });
  } catch (err: any) {
    if (err.code === 'EAUTH' || err.responseCode === 535) {
      throw new Error('ההתחברות לחשבון המייל נכשלה — יש לבדוק את EMAIL_PASSWORD (ב-Gmail: סיסמת אפליקציה, לא הסיסמה הרגילה)');
    }
    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNECTION' || /timeout/i.test(err.message)) {
      throw new Error('אין חיבור לשרת המייל (Render חוסם SMTP בתוכנית החינמית) — יש להגדיר שליחה דרך Google Apps Script');
    }
    throw err;
  }
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (process.env.EMAIL_SCRIPT_URL) return sendViaScript(to, subject, html);
  return sendViaSmtp(to, subject, html);
}
