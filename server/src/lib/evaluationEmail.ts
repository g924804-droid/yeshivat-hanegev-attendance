import crypto from 'crypto';
import type { Request, Response } from 'express';
import { prisma } from './prisma';
import { sendEmail, isEmailConfigured } from './email';
import { evaluationGroupsResolver } from './evaluations';

/**
 * מייל "משוב לקראת חנוכה" למורות — הנוסח של המשתמשת (מיכל פיינהנדלר) מילה במילה, חוץ מתיקון
 * התאריך "(30/6)" ← "(30/11)" (יום שני כ' בכסלו תשפ"ז = 30/11/2026), ובתוספת הסבר איך ממלאים
 * וכפתור כניסה (כמו בתזכורת החודשית). לא לשנות בלי לתאם.
 */
const SITE_URL = process.env.APP_URL || 'https://yeshivaanegev.onrender.com';
export const EVALUATION_EMAIL_SUBJECT = 'משוב על התלמידות לקראת חנוכה — למילוי באתר עד יום שני כ\' בכסלו';
const DEPARTMENT = 'סמינר מאיר';

const p = (html: string) => `<p style="margin: 0 0 12px;">${html}</p>`;

/** קישור אישי "קראתי את המייל" — חתום (HMAC), כך שאי אפשר לאשר בשם מורה אחרת */
const ackSignature = (userId: string, month: string) =>
  crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'evaluation-ack')
    .update(`evaluation-ack|${userId}|${month}`)
    .digest('hex')
    .slice(0, 32);
export const ackUrl = (userId: string, month: string) =>
  `${SITE_URL}/api/evaluationConfirm?u=${encodeURIComponent(userId)}&m=${month}&t=${ackSignature(userId, month)}`;

const ackButton = (url: string) => `
      <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 10px; padding: 14px 16px; margin: 0 0 16px; text-align: center;">
        <p style="margin: 0 0 10px; font-weight: bold;">יש בהודעה עדכון חשוב על הלימודים בשבוע הבא — נא לאשר שקראת:</p>
        <a href="${url}" style="background: #16a34a; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">✓ קראתי את המייל</a>
      </div>`;

/** confirmUrl — הקישור האישי לאישור קריאה (במייל). בלי קישור (בחלון באתר) — בלי הכפתור. */
export function buildEvaluationEmailHtml(confirmUrl?: string): string {
  return `
    <div dir="rtl" style="font-family: Arial, sans-serif; font-size: 15px; color: #1e293b; line-height: 1.7;">
      ${p('שלום וברכה מורות יקרות,<br>לאחר תקופה של עשייה חיובית ועבודה עקבית שלכן במסירות ובאחריות,<br>רוצה קודם כל להודות לכל אחת באופן אישי על כך שהיא איתנו ונותנת לתלמידות את המירב והמיטב הן מבחינה מקצועית והן מבחינה אישית וחינוכית.')}
      ${p('לקראת חנוכה, אבקש מכל מורה לכתוב משוב קצר על כל תלמידה,<br>מבחינת הרמה התפקודית של התלמידה בשיעור, רמה לימודית והישגים כלליים.<br>חשוב לי מאוד לקבל מידע אמין המשקף את היחס הכללי של הבת למקצוע ברמת הרצינות בשיעור, נוכחות כללית מתחילת השיעור ועד סופו, האם יש הפרעות או יציאות תכופות באמצע שיעור, וכן כל דבר אחר הדורש התייחסות מיוחדת על אופן הלמידה. כמו כן, אם יש זיהוי של קושי מסוים - אבקש לקבל מידע.<br>הדיווח צריך להיות קצר וממוקד, אך חשוב מאוד שיביא תמונה כללית על התפקוד מתחילת שנה ועד עכשיו.')}
      ${p('בעז"ה לאחר קבלת המשוב, נשלח הן לתלמידות והן למורות רענון נהלים על מנת למקסם את הלמידה ולהביא את התלמידות למקצועיות הנדרשת.')}
      ${p('את הדוחות יש למלא באתר בתוך הציונים:<br><strong>עד יום שני כ\' בכסלו (30/11)</strong>')}
      <div style="background: #f1f5f9; border-radius: 8px; padding: 12px 16px; margin: 0 0 16px;">
        <strong>איך ממלאים:</strong>
        <ol style="margin: 6px 0 0; padding-right: 20px;">
          <li>נכנסים למערכת (בכפתור למטה) עם הסיסמה הרגילה — תיפתח ההודעה הזו, ויש ללחוץ <strong>"קראתי ואני מאשרת"</strong>.</li>
          <li>בדף הבית לוחצים על <strong>"הערכה כללית"</strong> (או בתוך <strong>"ציונים"</strong> — הפס הצהוב למעלה).</li>
          <li>מופיעה רשימת התלמידות שלך לפי מסלול — כותבים ליד כל תלמידה את המשוב. נשמר אוטומטית.</li>
        </ol>
        <p style="margin: 8px 0 0; font-size: 14px;">שימי לב: לא ניתן להגיש את דוח הנוכחות של חודש נובמבר לפני שממלאים משוב לכל התלמידות.</p>
      </div>
      ${p('<strong>עדכון:</strong> ביום רביעי הבא, כ"ב בכסלו  יתקיימו לימודי התמחות עד השעה 16:00<br>ביום חמישי, כ"ג בכסלו - לא יתקיימו לימודים')}
      ${confirmUrl ? ackButton(confirmUrl) : ''}
      <p style="margin: 20px 0;">
        <a href="${SITE_URL}" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: bold; display: inline-block;">כניסה למערכת</a>
      </p>
      ${p('בתודה ובהערכה גדולה,<br>ובתפילה להמשך סיעתא דשמיא,')}
      ${p('מיכל פיינהנדלר,<br>רכזת לימודי התמחות')}
    </div>
  `;
}

/**
 * כל העובדות הפעילות בסמינר מאיר שמלמדות (יש להן תלמידות). ברירת המחדל במייל — מי שתפקידה "מורה";
 * עובדות אחרות שמלמדות (למשל אוריה יששכרוב) מופיעות בנפרד ונבחרות ידנית.
 */
export async function evaluationEmailRecipients() {
  const [staff, resolve] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, department: DEPARTMENT },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    }),
    evaluationGroupsResolver(israelMonth()),
  ]);
  return staff.filter((t) => resolve(t.name).length > 0).map((t) => ({ ...t, isTeacher: t.role === 'מורה' }));
}

export function israelMonth(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }).slice(0, 7);
}

/**
 * שליחה לכל המורות + הפעלת חובת ההערכה לחודש הנוכחי. פעם אחת בחודש (evaluationEmailMonth) —
 * כדי שלחיצה כפולה לא תשלח פעמיים.
 */
export async function sendEvaluationEmail(selectedIds: string[]): Promise<{ sent: number; errors: string[]; month: string }> {
  if (!isEmailConfigured()) throw new Error('שליחת מייל לא מוגדרת בשרת');
  const month = israelMonth();
  const settings = await prisma.siteSettings.findUnique({ where: { id: 'singleton' }, select: { evaluationEmailMonth: true } });
  if (settings?.evaluationEmailMonth === month) throw new Error('המייל כבר נשלח החודש');
  const selected = new Set(selectedIds.map(String));
  const all = await evaluationEmailRecipients();
  const recipients = all.filter((t) => selected.has(t.id));
  if (!recipients.length) throw new Error('לא נבחרה אף מורה');
  // רק מי שנבחרה חייבת בהערכה (מי שהורדה מהרשימה — לא חוסמים לה את הדוח בלי שקיבלה הסבר)
  const evaluationRequired = JSON.stringify(recipients.map((t) => t.id));
  const evaluationExempt = JSON.stringify(all.filter((t) => !selected.has(t.id)).map((t) => t.id));
  // מסמנים ומפעילים לפני השליחה — שלחיצה כפולה לא תשלח פעמיים
  await prisma.siteSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', evaluationMonth: month, evaluationEmailMonth: month, evaluationExempt, evaluationRequired },
    update: { evaluationMonth: month, evaluationEmailMonth: month, evaluationExempt, evaluationRequired },
  });
  let sent = 0;
  const errors: string[] = [];
  for (const t of recipients) {
    if (!t.email) {
      errors.push(`${t.name}: אין כתובת מייל`);
      continue;
    }
    try {
      await sendEmail(t.email, EVALUATION_EMAIL_SUBJECT, buildEvaluationEmailHtml(ackUrl(t.id, month)));
      sent++;
    } catch (err: any) {
      errors.push(`${t.name}: ${err.message}`);
    }
  }
  if (sent === 0 && recipients.some((t) => t.email)) {
    // שום מייל לא יצא — מבטלים את סימון השליחה כדי שאפשר יהיה לנסות שוב (החובה נשארת מופעלת)
    await prisma.siteSettings.update({ where: { id: 'singleton' }, data: { evaluationEmailMonth: settings?.evaluationEmailMonth || null } });
  }
  console.log(`מייל הערכה כללית ${month}: נשלחו ${sent}${errors.length ? `, שגיאות: ${errors.join('; ')}` : ''}`);
  return { sent, errors, month };
}

/**
 * הוספת מורה לרשימה אחרי שהמייל כבר נשלח (למשל מורה שלא הופיעה ברשימה) — נעשית חייבת בהערכה
 * ומקבלת את המייל.
 */
export async function addToEvaluationEmail(userId: string): Promise<string> {
  const month = israelMonth();
  const settings = await prisma.siteSettings.findUnique({
    where: { id: 'singleton' },
    select: { evaluationRequired: true, evaluationExempt: true },
  });
  const required: string[] = JSON.parse(settings?.evaluationRequired || '[]');
  const exempt: string[] = JSON.parse(settings?.evaluationExempt || '[]');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  if (!user) throw new Error('העובדת לא נמצאה');
  await prisma.siteSettings.update({
    where: { id: 'singleton' },
    data: {
      evaluationRequired: JSON.stringify([...new Set([...required, userId])]),
      evaluationExempt: JSON.stringify(exempt.filter((id) => id !== userId)),
    },
  });
  if (!user.email) return `${user.name} נוספה לרשימה (אין לה כתובת מייל — תראה את ההודעה בכניסה לאתר)`;
  await sendEmail(user.email, EVALUATION_EMAIL_SUBJECT, buildEvaluationEmailHtml(ackUrl(userId, month)));
  return `${user.name} נוספה לרשימה והמייל נשלח אליה`;
}

/** שליחה חוזרת למורה אחת מתוך מי שנבחרו (למשל כשהמייל נכשל) */
export async function resendEvaluationEmail(userId: string): Promise<string> {
  const month = israelMonth();
  const settings = await prisma.siteSettings.findUnique({ where: { id: 'singleton' }, select: { evaluationRequired: true } });
  const required: string[] = JSON.parse(settings?.evaluationRequired || '[]');
  if (!required.includes(userId)) throw new Error('המורה לא ברשימה שנבחרה במייל');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  if (!user?.email) throw new Error('אין למורה כתובת מייל');
  await sendEmail(user.email, EVALUATION_EMAIL_SUBJECT, buildEvaluationEmailHtml(ackUrl(userId, month)));
  return user.name;
}

const page = (title: string, body: string) => `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="font-family: Arial, sans-serif; background: #f8fafc; margin: 0; padding: 40px 16px; color: #1e293b;">
<div style="max-width: 460px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 28px; text-align: center; box-shadow: 0 1px 4px rgba(0,0,0,.08);">
${body}
<p style="margin-top: 24px;"><a href="${SITE_URL}" style="color: #2563eb;">כניסה למערכת</a></p>
</div></body></html>`;

/** הכפתור "קראתי את המייל" — בלי כניסה למערכת; הקישור חתום ואישי לכל מורה */
export async function evaluationConfirmHandler(req: Request, res: Response) {
  const userId = String(req.query.u || '');
  const month = String(req.query.m || '');
  const token = String(req.query.t || '');
  const expected = /^\d{4}-\d{2}$/.test(month) && userId ? ackSignature(userId, month) : '';
  const valid =
    !!expected && token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  res.set('Content-Type', 'text/html; charset=utf-8');
  if (!valid) return res.status(400).send(page('קישור לא תקין', '<h2>הקישור לא תקין</h2><p>אפשר לאשר את הקריאה גם בכניסה למערכת.</p>'));
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    if (!user) return res.status(404).send(page('לא נמצא', '<h2>המשתמשת לא נמצאה</h2>'));
    await prisma.evaluationAck.upsert({
      where: { month_userId: { month, userId } },
      create: { month, userId, userName: user.name, via: 'email' },
      update: {},
    });
    res.send(page('תודה', `<div style="font-size: 48px;">✓</div><h2 style="color: #15803d;">תודה, ${user.name}</h2><p>אישור הקריאה נשמר.</p><p>אל תשכחי למלא את ההערכה הכללית לתלמידות במערכת עד יום שני כ' בכסלו.</p>`));
  } catch {
    res.status(500).send(page('שגיאה', '<h2>אירעה שגיאה</h2><p>נסי שוב בעוד רגע, או אשרי בכניסה למערכת.</p>'));
  }
}
