import nodemailer from 'nodemailer';

/**
 * שליחת מיילים דרך Outlook/Microsoft 365 (SMTP AUTH רגיל, smtp.office365.com:587).
 * דורש שני משתני סביבה: EMAIL_USER (כתובת ה-Outlook) ו-EMAIL_PASSWORD (סיסמה או
 * app password, תלוי בהגדרות האבטחה של החשבון). בלי אלה, השליחה נכשלת בבירור
 * במקום להיכשל בשקט — כדי שקל יהיה להבין שחסרה הגדרה, לא שיש באג.
 */
let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    throw new Error('שליחת מייל לא מוגדרת — חסרים משתני הסביבה EMAIL_USER/EMAIL_PASSWORD');
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.office365.com',
      port: Number(process.env.EMAIL_PORT) || 587,
      secure: false,
      requireTLS: true,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD },
    });
  }
  return transporter;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const t = getTransporter();
  await t.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject,
    html,
  });
}
