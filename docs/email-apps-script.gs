/**
 * סקריפט שליחת מיילים של מערכת הנוכחות — ישיבת הנגב.
 *
 * Render (האחסון של האתר) חוסם בתוכנית החינמית שליחת מיילים ישירה, אז האתר שולח בקשה
 * לסקריפט הזה, והסקריפט שולח את המייל מחשבון ה-Gmail שבו הוא נוצר.
 *
 * התקנה (פעם אחת):
 *   1. script.google.com ← פרויקט חדש ← מוחקים את מה שיש ומדביקים את כל הקובץ הזה
 *   2. מחליפים את הערך של SECRET בקוד הסודי (אותו ערך כמו EMAIL_SCRIPT_SECRET ב-Render)
 *   3. פריסה (Deploy) ← פריסה חדשה ← סוג: Web app
 *        הפעלה בתור (Execute as): אני (Me)
 *        למי יש גישה (Who has access): כל אחד (Anyone)
 *   4. מאשרים את ההרשאות שגוגל מבקשת, ומעתיקים את כתובת ה-Web app ל-EMAIL_SCRIPT_URL ב-Render
 *
 * מגבלה של Google: עד 100 נמענים ביום לחשבון Gmail רגיל.
 */
const SECRET = 'הדביקי-כאן-את-הקוד-הסודי';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.secret !== SECRET) return reply({ ok: false, error: 'unauthorized' });
    GmailApp.sendEmail(data.to, data.subject, 'יש לפתוח את המייל בתצוגת HTML', {
      htmlBody: data.html,
      name: data.fromName || 'ישיבת הנגב',
    });
    return reply({ ok: true, remainingToday: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

/** להרצה ידנית מתוך העורך — כדי לאשר הרשאות ולבדוק ששליחה עובדת. */
function testSend() {
  GmailApp.sendEmail(Session.getActiveUser().getEmail(), 'בדיקה — סקריפט מיילים', 'הסקריפט עובד');
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
