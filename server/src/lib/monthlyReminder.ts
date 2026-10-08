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
      <p>מילוי הדוח (וקבלה, במידה ורלוונטי) הוא תנאי לקבלת השכר.</p>
      <p>בברכה,<br>ישיבת הנגב</p>
    </div>
  `;
}

const SUBJECT = 'תזכורת חודשית — דוח שעות ונוכחות';

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

/**
 * מי צריכה לקבל תזכורת: עובדות פעילות שנדרשות בדוח שעות (לא "חודשי"), ושעוד לא הגישו את
 * הדוח של החודש — מי שכבר הגישה לא צריכה תזכורת.
 */
async function reminderRecipients(month: string) {
  const employees = await prisma.user.findMany({
    where: { isActive: true, employmentType: { not: 'חודשי' } },
    include: { monthlyReports: { where: { month }, select: { status: true } } },
    orderBy: { name: 'asc' },
  });
  return employees.filter((e) => !e.monthlyReports.some((r) => r.status === 'הוגש' || r.status === 'אושר'));
}

export async function sendMonthlyReminders(month = israelToday().monthStr): Promise<{ sent: number; errors: string[] }> {
  const employees = await reminderRecipients(month);
  let sent = 0;
  const errors: string[] = [];
  for (const emp of employees) {
    if (!emp.email) {
      errors.push(`${emp.name}: אין כתובת מייל`);
      continue;
    }
    try {
      await sendEmail(emp.email, SUBJECT, buildReminderHtml(emp.name, emp.employmentType === 'נגד קבלה'));
      sent++;
    } catch (err: any) {
      errors.push(`${emp.name}: ${err.message}`);
    }
  }
  return { sent, errors };
}

/** מייל בדיקה עם אותו נוסח — כדי לוודא שהשליחה עובדת לפני ה-30. */
export async function sendTestReminder(to: string, name: string): Promise<void> {
  await sendEmail(to, `[בדיקה] ${SUBJECT}`, buildReminderHtml(name, true));
}

/** מצב התזכורות — למסך הניהול. */
export async function getReminderStatus() {
  const today = israelToday();
  const settings = await prisma.siteSettings.findUnique({ where: { id: 'singleton' } });
  const sentThisMonth = settings?.lastReminderMonth === today.monthStr;
  // אם כבר נשלח החודש — השליחה הבאה בחודש הבא
  const [y, m] = sentThisMonth ? (today.month === 12 ? [today.year + 1, 1] : [today.year, today.month + 1]) : [today.year, today.month];
  const recipients = await reminderRecipients(today.monthStr);
  return {
    emailConfigured: isEmailConfigured(),
    lastReminderMonth: settings?.lastReminderMonth || null,
    nextSendDate: `${y}-${String(m).padStart(2, '0')}-${String(reminderDay(y, m)).padStart(2, '0')}`,
    recipients: recipients.length,
    missingEmail: recipients.filter((e) => !e.email).map((e) => e.name),
  };
}

/**
 * נבדק כל שעה מהשרת, וגם מבחוץ (GitHub Actions מעיר את השרת כל יום — בשכבה החינמית של Render
 * השרת נרדם כשאין כניסות, ואז הבדיקה הפנימית לא רצה). שולח פעם אחת בחודש, החל מיום השליחה —
 * אם השרת היה רדום בדיוק ב-30, השליחה תתבצע ב-31.
 */
export async function checkAndSendMonthlyReminder(): Promise<string> {
  const today = israelToday();
  if (today.day < reminderDay(today.year, today.month)) return 'עוד לא הגיע יום השליחה';

  const settings = await prisma.siteSettings.findUnique({ where: { id: 'singleton' } });
  if (settings?.lastReminderMonth === today.monthStr) return 'כבר נשלח החודש';
  if (!isEmailConfigured()) return 'שליחת מייל לא מוגדרת';

  try {
    // מסמנים לפני השליחה, כדי ששתי בדיקות שרצות בו-זמנית (פנימית וחיצונית) לא ישלחו פעמיים
    await prisma.siteSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', lastReminderMonth: today.monthStr },
      update: { lastReminderMonth: today.monthStr },
    });
    const result = await sendMonthlyReminders(today.monthStr);
    if (result.sent === 0 && result.errors.length > 0) {
      // שום מייל לא יצא (למשל סיסמה שגויה) — מבטלים את הסימון כדי שהבדיקה הבאה תנסה שוב
      await prisma.siteSettings.update({
        where: { id: 'singleton' },
        data: { lastReminderMonth: settings?.lastReminderMonth || null },
      });
    }
    const message = `תזכורת חודשית ${today.monthStr}: נשלחו ${result.sent} מיילים${result.errors.length ? `, שגיאות: ${result.errors.join('; ')}` : ''}`;
    console.log(message);
    return message;
  } catch (err: any) {
    console.error('שגיאה בשליחת תזכורת חודשית אוטומטית:', err.message);
    return `שגיאה: ${err.message}`;
  }
}
