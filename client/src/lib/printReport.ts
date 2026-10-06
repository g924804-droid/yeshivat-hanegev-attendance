import { api } from './api';

type DayDetail = {
  date: string;
  dayOfWeek: number;
  isSaturday: boolean;
  holiday?: { name: string; type: 'full' | 'half' };
  isAbsence: boolean;
  record: {
    type: string;
    totalHours: number;
    overtimeHours: number;
    lessonsCount: number;
    clockIn: string | null;
    clockOut: string | null;
    clockIn2: string | null;
    clockOut2: string | null;
    notes: string | null;
    sickNoteUrl: string | null;
    hasSpecialRate: boolean;
  } | null;
};

type Report = {
  month: string;
  status: string;
  totalWorkDays: number;
  totalHours: number;
  totalOvertime: number;
  sickDays: number;
  vacationDays: number;
  holidayDays: number;
  absenceDays: number;
  totalLessons: number;
  specialRateHours: number;
  employeeSignature: string | null;
};

const DOW_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// אותו עיצוב כמו דוח ה-PDF שבשרת (server/src/lib/pdfTemplates.ts), כדי שההדפסה תיראה אותו דבר.
const STYLE = `
  * { box-sizing: border-box; }
  @page { size: A4; margin: 12mm 10mm; }
  body { font-family: 'Arial', 'Rubik', sans-serif; direction: rtl; padding: 0; margin: 0; color: #1e293b;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { color: #0f172a; font-size: 17px; margin: 0 0 2px; }
  h2 { color: #1e3a5f; font-size: 15px; margin: 0 0 8px; }
  .meta { color: #475569; font-size: 11px; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
  th, td { border: 1px solid #cbd5e1; padding: 2px 5px; text-align: center; }
  th { background: #0f172a; color: #f1c40f; }
  .summary { display: flex; gap: 10px; flex-wrap: wrap; margin: 8px 0; }
  .stat { border: 1px solid #cbd5e1; border-radius: 6px; padding: 4px 10px; min-width: 76px; }
  .stat .label { font-size: 9px; color: #64748b; }
  .stat .value { font-size: 14px; font-weight: bold; color: #0f172a; }
  .signature { margin-top: 10px; page-break-inside: avoid; font-size: 11px; }
  .signature img { max-height: 50px; border-bottom: 1px solid #94a3b8; }
  .holiday-row { background: #fef9e7; }
  .absence-row { background: #fdecea; }
  .special-row td { border-top: 2px solid #000 !important; border-bottom: 2px solid #000 !important; font-weight: bold; }
  .special-badge { display: inline-block; border: 2px solid #000; border-radius: 50%; width: 15px; height: 15px;
                   line-height: 11px; font-size: 9px; font-weight: 900; text-align: center; margin-left: 3px; }
  .stat.special-stat { border: 3px solid #000; background: #fef3c7; }
  .stat.special-stat .label { color: #000; font-weight: bold; }
  .sick-notes-list { margin-top: 8px; font-size: 11px; page-break-inside: avoid; }
  .sick-note { page-break-before: always; text-align: center; }
  .sick-note img { max-width: 100%; max-height: 245mm; object-fit: contain; }
`;

function esc(s: string | null | undefined): string {
  return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function buildHtml(employeeName: string, report: Report, days: DayDetail[]): string {
  const rows = days
    .map((d) => {
      const r = d.record;
      const cls = [d.holiday ? 'holiday-row' : '', d.isAbsence ? 'absence-row' : '', r?.hasSpecialRate ? 'special-row' : '']
        .filter(Boolean)
        .join(' ');
      const type = d.holiday ? d.holiday.name : r ? r.type : d.isAbsence ? 'העדרות' : d.isSaturday ? 'שבת' : '—';
      return `<tr class="${cls}">
        <td>${d.date}</td><td>${DOW_HE[d.dayOfWeek]}</td><td>${esc(type)}</td>
        <td>${r?.clockIn || ''}</td><td>${r?.clockOut || ''}</td><td>${r?.clockIn2 || ''}</td><td>${r?.clockOut2 || ''}</td>
        <td>${r ? r.totalHours.toFixed(2) : ''}${r?.hasSpecialRate ? '<span class="special-badge">₪</span>' : ''}</td>
        <td>${r ? r.overtimeHours.toFixed(2) : ''}</td><td>${r?.lessonsCount || ''}</td><td>${esc(r?.notes)}</td>
      </tr>`;
    })
    .join('');

  const stat = (label: string, value: string | number) =>
    `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;

  // אישור מחלה שהועלה מוצג כתמונה בעמוד נפרד. אם הוא בעצם PDF, התמונה לא נטענת — ואז היא מוחלפת
  // (ב-onerror) בהודעה שהאישור מצורף כקובץ, כי דפדפן לא יכול להטמיע PDF בתוך הדפסה.
  const sickDays = days.filter((d) => d.record?.type === 'מחלה' && d.record.sickNoteUrl);
  const sickList = sickDays.length
    ? `<div class="sick-notes-list"><strong>אישורי מחלה:</strong><ul>${sickDays
        .map((d) => `<li>${d.date}</li>`)
        .join('')}</ul></div>`
    : '';
  const sickPages = sickDays
    .map((d) => {
      const url = esc(d.record!.sickNoteUrl);
      const fallback = `אישור המחלה הועלה כקובץ PDF ולא ניתן להדפיס אותו מכאן — יש להשתמש בהורדת הדוח`;
      return `<div class="sick-note"><h2>אישור מחלה — ${d.date}</h2>
        <img src="${url}" onerror="this.outerHTML='<p>${fallback}</p>'" /></div>`;
    })
    .join('');

  return `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>דוח ${esc(employeeName)} ${report.month}</title>
    <style>${STYLE}</style></head><body>
    <h1>דוח נוכחות חודשי — ישיבת הנגב</h1>
    <div class="meta">עובד/ת: ${esc(employeeName)} &nbsp;|&nbsp; חודש: ${report.month} &nbsp;|&nbsp; סטטוס: ${esc(report.status)}</div>
    <div class="summary">
      ${stat('ימי עבודה', report.totalWorkDays)}
      ${stat('סה"כ שעות', report.totalHours.toFixed(2))}
      ${stat('שעות עודפות', report.totalOvertime.toFixed(2))}
      ${stat('ימי מחלה', report.sickDays)}
      ${stat('ימי חופשה', report.vacationDays)}
      ${stat('ימי חג', report.holidayDays)}
      ${stat('ימי העדרות', report.absenceDays)}
      ${stat('שיעורים', report.totalLessons)}
      ${
        report.specialRateHours > 0
          ? `<div class="stat special-stat"><div class="label">⚠ שעות בשכר שונה — לתשומת לב חשבת שכר</div><div class="value">${report.specialRateHours.toFixed(2)}</div></div>`
          : ''
      }
    </div>
    <table>
      <thead><tr><th>תאריך</th><th>יום</th><th>סוג</th><th>כניסה 1</th><th>יציאה 1</th><th>כניסה 2</th><th>יציאה 2</th>
        <th>שעות</th><th>עודפות</th><th>שיעורים</th><th>הערות</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${report.employeeSignature ? `<div class="signature"><div>חתימת עובד/ת:</div><img src="${esc(report.employeeSignature)}" /></div>` : ''}
    ${sickList}
    ${sickPages}
  </body></html>`;
}

/** ממתין שכל התמונות (חתימה, אישורי מחלה) ייטענו לפני ההדפסה — אחרת הן יוצאות ריקות. */
function waitForImages(doc: Document, timeoutMs = 10_000): Promise<void> {
  const pending = Array.from(doc.images).filter((img) => !img.complete);
  const all = Promise.all(
    pending.map((img) => new Promise<void>((resolve) => {
      img.addEventListener('load', () => resolve(), { once: true });
      img.addEventListener('error', () => resolve(), { once: true });
    }))
  ).then(() => undefined);
  return Promise.race([all, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}

/**
 * הדפסה מיידית של דוח חודשי של עובד/ת — נבנה בדפדפן מהנתונים (בלי ליצור PDF בשרת, שזה החלק האיטי)
 * ונפתח ישר בחלון ההדפסה של הדפדפן. משם אפשר גם "שמירה כ-PDF".
 */
export async function printMonthlyReport(month: string, userId: string): Promise<void> {
  const data = await api.get<{ report: Report; days: DayDetail[]; employeeName: string }>('/reports/getMonthlyReport', {
    month,
    userId,
  });

  // iframe נסתר בתוך הדף — בלי לפתוח טאב חדש ובלי חסימת חלונות קופצים.
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;left:0;bottom:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(buildHtml(data.employeeName, data.report, data.days));
  doc.close();

  await waitForImages(doc);
  iframe.contentWindow!.focus();
  iframe.contentWindow!.print();
  // print() חוסם עד שחלון ההדפסה נסגר ברוב הדפדפנים; מנקים אחרי השהיה כדי לא לחתוך הדפסה שעוד רצה.
  setTimeout(() => iframe.remove(), 60_000);
}
