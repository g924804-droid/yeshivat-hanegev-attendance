import { prisma } from './prisma';
import { sendEmail } from './email';

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

/** עובדת "חודשי" (משכורת גלובלית) לא נדרשת בדוח שעות בכלל — לא מקבלת את התזכורת הזו. */
export async function sendMonthlyReminders(): Promise<{ sent: number; errors: string[] }> {
  const employees = await prisma.user.findMany({
    where: { isActive: true, employmentType: { not: 'חודשי' } },
  });

  let sent = 0;
  const errors: string[] = [];
  for (const emp of employees) {
    if (!emp.email) {
      errors.push(`${emp.name}: אין כתובת מייל`);
      continue;
    }
    try {
      await sendEmail(
        emp.email,
        'תזכורת חודשית — דוח שעות ונוכחות',
        buildReminderHtml(emp.name, emp.employmentType === 'נגד קבלה')
      );
      sent++;
    } catch (err: any) {
      errors.push(`${emp.name}: ${err.message}`);
    }
  }
  return { sent, errors };
}

/** נבדק פעם בשעה מהשרת — אם היום הוא היום האחרון בחודש הלועזי ועוד לא נשלחה תזכורת החודש, שולח. */
export async function checkAndSendMonthlyReminder(): Promise<void> {
  const now = new Date();
  const isLastDayOfMonth = now.getDate() === new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  if (!isLastDayOfMonth) return;

  const currentMonth = now.toISOString().slice(0, 7);
  const settings = await prisma.siteSettings.findUnique({ where: { id: 'singleton' } });
  if (settings?.lastReminderMonth === currentMonth) return;

  try {
    const result = await sendMonthlyReminders();
    console.log(`תזכורת חודשית ${currentMonth}: נשלחו ${result.sent} מיילים${result.errors.length ? `, שגיאות: ${result.errors.join('; ')}` : ''}`);
    await prisma.siteSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', lastReminderMonth: currentMonth },
      update: { lastReminderMonth: currentMonth },
    });
  } catch (err: any) {
    console.error('שגיאה בשליחת תזכורת חודשית אוטומטית:', err.message);
  }
}
