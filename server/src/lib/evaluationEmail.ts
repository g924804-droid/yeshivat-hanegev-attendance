import { prisma } from './prisma';
import { sendEmail, isEmailConfigured } from './email';
import { teacherStudentResolver } from './teacherScope';

/**
 * מייל "משוב לקראת חנוכה" למורות — הנוסח של המשתמשת (מיכל פיינהנדלר) מילה במילה, חוץ מתיקון
 * התאריך "(30/6)" ← "(30/11)" (יום שני כ' בכסלו תשפ"ז = 30/11/2026), ובתוספת הסבר איך ממלאים
 * וכפתור כניסה (כמו בתזכורת החודשית). לא לשנות בלי לתאם.
 */
const SITE_URL = process.env.APP_URL || 'https://yeshivaanegev.onrender.com';
export const EVALUATION_EMAIL_SUBJECT = 'משוב על התלמידות לקראת חנוכה — למילוי באתר עד יום שני כ\' בכסלו';
const DEPARTMENT = 'סמינר מאיר';

const p = (html: string) => `<p style="margin: 0 0 12px;">${html}</p>`;

export function buildEvaluationEmailHtml(): string {
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
    teacherStudentResolver(),
  ]);
  return staff.filter((t) => resolve(t.name).size > 0).map((t) => ({ ...t, isTeacher: t.role === 'מורה' }));
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
  const html = buildEvaluationEmailHtml();
  let sent = 0;
  const errors: string[] = [];
  for (const t of recipients) {
    if (!t.email) {
      errors.push(`${t.name}: אין כתובת מייל`);
      continue;
    }
    try {
      await sendEmail(t.email, EVALUATION_EMAIL_SUBJECT, html);
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
