import nodemailer from 'nodemailer';

/**
 * שליחת מיילים ב-SMTP. דורש שני משתני סביבה: EMAIL_USER (כתובת המייל השולחת) ו-EMAIL_PASSWORD.
 * - Gmail: הסיסמה היא "סיסמת אפליקציה" (16 תווים) שנוצרת בחשבון Google — לא הסיסמה הרגילה.
 * - Outlook/Microsoft 365: smtp.office365.com, ודורש ש-SMTP AUTH מופעל לתיבה.
 * השרת נבחר לפי הכתובת (אפשר לעקוף עם EMAIL_HOST/EMAIL_PORT). בלי המשתנים השליחה נכשלת
 * בבירור במקום בשקט — כדי שקל יהיה להבין שחסרה הגדרה, לא שיש באג.
 */
let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

export function isEmailConfigured(): boolean {
  return !!(process.env.EMAIL_USER && process.env.EMAIL_PASSWORD);
}

function defaultHost(user: string): string {
  return /@(gmail|googlemail)\.com$/i.test(user) ? 'smtp.gmail.com' : 'smtp.office365.com';
}

function getTransporter() {
  const user = process.env.EMAIL_USER?.trim();
  // גוגל מציגה את סיסמת האפליקציה עם רווחים ("abcd efgh ...") — מנקים אם הודבקה כך
  const pass = process.env.EMAIL_PASSWORD?.replace(/\s+/g, '');
  if (!user || !pass) {
    throw new Error('שליחת מייל לא מוגדרת — חסרים משתני הסביבה EMAIL_USER/EMAIL_PASSWORD');
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || defaultHost(user),
      port: Number(process.env.EMAIL_PORT) || 587,
      secure: false,
      requireTLS: true,
      auth: { user, pass },
    });
  }
  return transporter;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const t = getTransporter();
  try {
    await t.sendMail({
      from: { name: 'ישיבת הנגב', address: process.env.EMAIL_USER!.trim() },
      to,
      subject,
      html,
    });
  } catch (err: any) {
    // שגיאת התחברות — הסבר ברור במקום הודעה טכנית באנגלית
    if (err.code === 'EAUTH' || err.responseCode === 535) {
      throw new Error('ההתחברות לחשבון המייל נכשלה — יש לבדוק את EMAIL_PASSWORD (ב-Gmail: סיסמת אפליקציה, לא הסיסמה הרגילה)');
    }
    throw err;
  }
}
