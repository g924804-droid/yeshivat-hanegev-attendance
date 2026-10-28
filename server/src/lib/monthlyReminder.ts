import { prisma } from './prisma';
import { sendEmail, isEmailConfigured } from './email';

/**
 * נוסח שאושר עם המשתמשת — לא לשנות בלי לתאם, זה בדיוק מה שהיא אישרה שיישלח בפועל
 * לכל הצוות. השורה על קבלה מופיעה רק למי שמוגדרת "נגד קבלה".
 */
function buildReminderHtml(name: string, needsReceipt: boolean): string {
  return `
    <div dir="rtl" style="font-family: Arial, sans-serif; font-size: 15px; color: #1e293b; line-height: 1.6;">
      <p>שלום ${name},</p>
      <p>תזכורת לקראת סוף החודש: באחריותך למלא ולהגיש עד תום החודש את דוח השעות/הנוכחות שלך במערכת.</p>
      ${needsReceipt ? '<p>מי שמועסקת נגד קבלה — באחריותך בלבד להעלות קבלה עבור החודש הנוכחי.</p>' : ''}
      <p>בנוסף, יש למלא את דוח הנוכחות של הבנות ולחתום על דוח הנוכחות.</p>
      <p>מילוי הדוח (וקבלה, במידה ורלוונטי) הוא תנאי לקבלת השכר.</p>
      <p style="margin: 24px 0;">
        <a href="${SITE_URL}" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: bold; display: inline-block;">כניסה למערכת</a>
      </p>
      <p style="font-size: 13px; color: #64748b;">או בקישור: <a href="${SITE_URL}" style="color: #2563eb;">${SITE_URL}</a></p>
      <p>בברכה,<br>סמינר מאיר שכר</p>
    </div>
  `;
}

/**
 * התזכורת האחרונה (ב-30) — נוסח שאושר עם המשתמשת (לבקשת המורות): נשלחת רק למי שעוד לא הגישה.
 * לא לשנות בלי לתאם.
 */
function buildFinalReminderHtml(name: string, needsReceipt: boolean): string {
  return `
    <div dir="rtl" style="font-family: Arial, sans-serif; font-size: 15px; color: #1e293b; line-height: 1.6;">
      <p>שלום ${name},</p>
      <p>עדיין לא מילאת והגשת את דוח השעות/הנוכחות שלך לחודש זה.</p>
      <p><strong>יש להזדרז ולהשלים אותו עוד היום, על מנת שהחודש תקבלי את השכר.</strong></p>
      ${needsReceipt ? '<p>יש להעלות גם קבלה עבור החודש.</p>' : ''}
      <p>בנוסף, יש למלא את דוח הנוכחות של הבנות ולחתום על דוח הנוכחות.</p>
      <p style="margin: 24px 0;">
        <a href="${SITE_URL}" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: bold; display: inline-block;">כניסה למערכת</a>
      </p>
      <p style="font-size: 13px; color: #64748b;">או בקישור: <a href="${SITE_URL}" style="color: #2563eb;">${SITE_URL}</a></p>
      <p>בברכה,<br>סמינר מאיר שכר</p>
    </div>
  `;
}

const SUBJECT = 'תזכורת חודשית — דוח שעות ונוכחות';
const FINAL_SUBJECT = 'תזכורת אחרונה — דוח השעות שלך עדיין לא הוגש';

type ReminderKind = 'early' | 'final';
const TEMPLATES: Record<ReminderKind, { subject: string; html: (name: string, needsReceipt: boolean) => string }> = {
  early: { subject: SUBJECT, html: buildReminderHtml },
  final: { subject: FINAL_SUBJECT, html: buildFinalReminderHtml },
};

/** תזכורת מוקדמת — כמה ימים לפני האחרונה, כדי שיהיה זמן למלא (בקשת המורות) */
const EARLY_REMINDER_DAY = 25;

/** כתובת האתר לכפתור "כניסה למערכת" במייל. */
const SITE_URL = process.env.APP_URL || 'https://yeshivaanegev.onrender.com';

/** התאריך לפי שעון ישראל (השרת רץ ב-UTC, ובחצות זה כבר יום אחר). */
function israelToday(): { year: number; month: number; day: number; monthStr: string } {
  const [year, month, day] = new Date()
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })
    .split('-')
    .map(Number);
  return { year, month, day, monthStr: `${year}-${String(month).padStart(2, '0')}` };
}

/** יום השליחה בחודש: ה-30, ובחודש קצר יותר (פברואר) — היום האחרון שלו. */
function reminderDay(year: number, month: number): number {
  return Math.min(30, new Date(year, month, 0).getDate());
}

function earlyReminderDay(year: number, month: number): number {
  return Math.min(EARLY_REMINDER_DAY, reminderDay(year, month) - 1);
}

/**
 * מי צריכה לקבל תזכורת: עובדות פעילות שנדרשות בדוח שעות (לא "חודשי"), שלא הוצאו מהתזכורת
 * בהגדרות העובד, ושעוד לא הגישו את הדוח של החודש — מי שכבר הגישה לא צריכה תזכורת.
 */
async function reminderRecipients(month: string) {
  const employees = await prisma.user.findMany({
    where: { isActive: true, employmentType: { not: 'חודשי' }, noMonthlyReminder: false },
    include: { monthlyReports: { where: { month }, select: { status: true } } },
    orderBy: { name: 'asc' },
  });
  return employees.filter((e) => !e.monthlyReports.some((r) => r.status === 'הוגש' || r.status === 'אושר'));
}

export async function sendMonthlyReminders(
  month = israelToday().monthStr,
  kind: ReminderKind = 'early'
): Promise<{ sent: number; errors: string[] }> {
  const template = TEMPLATES[kind];
  const employees = await reminderRecipients(month);
  let sent = 0;
  const errors: string[] = [];
  for (const emp of employees) {
    if (!emp.email) {
      errors.push(`${emp.name}: אין כתובת מייל`);
      continue;
    }
    try {
      await sendEmail(emp.email, template.subject, template.html(emp.name, emp.employmentType === 'נגד קבלה'));
      sent++;
    } catch (err: any) {
      errors.push(`${emp.name}: ${err.message}`);
    }
  }
  return { sent, errors };
}

/** מייל בדיקה בשני הנוסחים — המוקדמת (25) והאחרונה (30) — כדי לראות בדיוק מה יקבלו. */
export async function sendTestReminder(to: string, name: string): Promise<void> {
  await sendEmail(to, `[בדיקה] ${SUBJECT}`, buildReminderHtml(name, true));
  await sendEmail(to, `[בדיקה] ${FINAL_SUBJECT}`, buildFinalReminderHtml(name, true));
}

/** מצב התזכורות — למסך הניהול. */
export async function getReminderStatus() {
  const today = israelToday();
  const settings = await prisma.siteSettings.findUnique({ where: { id: 'singleton' } });
  const pad = (n: number) => String(n).padStart(2, '0');
  const finalSent = settings?.lastReminderMonth === today.monthStr;
  const earlySent = settings?.lastEarlyReminderMonth === today.monthStr || finalSent;
  // השליחה הבאה: המוקדמת (25) אם עוד לא נשלחה, אחרת האחרונה (30), ואם גם היא נשלחה — ה-25 בחודש הבא
  const [ny, nm] = today.month === 12 ? [today.year + 1, 1] : [today.year, today.month + 1];
  const next = !earlySent
    ? { y: today.year, m: today.month, d: Math.max(today.day, earlyReminderDay(today.year, today.month)), kind: 'early' as const }
    : !finalSent
      ? { y: today.year, m: today.month, d: Math.max(today.day, reminderDay(today.year, today.month)), kind: 'final' as const }
      : { y: ny, m: nm, d: earlyReminderDay(ny, nm), kind: 'early' as const };
  const recipients = await reminderRecipients(today.monthStr);
  return {
    emailConfigured: isEmailConfigured(),
    lastReminderMonth: settings?.lastReminderMonth || null,
    nextSendDate: `${next.y}-${pad(next.m)}-${pad(next.d)}`,
    nextSendKind: next.kind,
    recipients: recipients.length,
    missingEmail: recipients.filter((e) => !e.email).map((e) => e.name),
  };
}

/**
 * נבדק כל שעה מהשרת, וגם מבחוץ (GitHub Actions מעיר את השרת כל יום — בשכבה החינמית של Render
 * השרת נרדם כשאין כניסות, ואז הבדיקה הפנימית לא רצה). שתי תזכורות בחודש, כל אחת פעם אחת:
 * מוקדמת ב-25 (הנוסח הרגיל) ואחרונה ב-30 ("עדיין לא מילאת"). אם השרת היה רדום ביום השליחה,
 * השליחה תתבצע ביום שאחריו; ואם הוא התעורר רק ב-30, נשלחת רק האחרונה.
 */
export async function checkAndSendMonthlyReminder(): Promise<string> {
  const today = israelToday();
  const kind: ReminderKind | null =
    today.day >= reminderDay(today.year, today.month)
      ? 'final'
      : today.day >= earlyReminderDay(today.year, today.month)
        ? 'early'
        : null;
  if (!kind) return 'עוד לא הגיע יום השליחה';

  const field = kind === 'final' ? 'lastReminderMonth' : 'lastEarlyReminderMonth';
  const settings = await prisma.siteSettings.findUnique({ where: { id: 'singleton' } });
  if (settings?.[field] === today.monthStr) {
    return kind === 'final' ? 'התזכורת האחרונה כבר נשלחה החודש' : 'התזכורת המוקדמת כבר נשלחה החודש';
  }
  if (!isEmailConfigured()) return 'שליחת מייל לא מוגדרת';

  // באחרונה מסמנים גם את המוקדמת — כדי שלא תצא מוקדמת אחרי האחרונה
  const mark =
    kind === 'final'
      ? { lastReminderMonth: today.monthStr, lastEarlyReminderMonth: today.monthStr }
      : { lastEarlyReminderMonth: today.monthStr };
  try {
    // מסמנים לפני השליחה, כדי ששתי בדיקות שרצות בו-זמנית (פנימית וחיצונית) לא ישלחו פעמיים
    await prisma.siteSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...mark },
      update: mark,
    });
    const result = await sendMonthlyReminders(today.monthStr, kind);
    if (result.sent === 0 && result.errors.length > 0) {
      // שום מייל לא יצא (למשל סיסמה שגויה) — מבטלים את הסימון כדי שהבדיקה הבאה תנסה שוב
      await prisma.siteSettings.update({
        where: { id: 'singleton' },
        data: {
          lastReminderMonth: settings?.lastReminderMonth || null,
          lastEarlyReminderMonth: settings?.lastEarlyReminderMonth || null,
        },
      });
    }
    const label = kind === 'final' ? 'תזכורת אחרונה' : 'תזכורת מוקדמת';
    const message = `${label} ${today.monthStr}: נשלחו ${result.sent} מיילים${result.errors.length ? `, שגיאות: ${result.errors.join('; ')}` : ''}`;
    console.log(message);
    return message;
  } catch (err: any) {
    console.error('שגיאה בשליחת תזכורת חודשית אוטומטית:', err.message);
    return `שגיאה: ${err.message}`;
  }
}
