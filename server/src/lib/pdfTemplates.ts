import { MonthlyReport, User } from '@prisma/client';
import { DayDetail } from './monthlyReport';

const BASE_STYLE = `
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Arial', 'Rubik', sans-serif; direction: rtl; padding: 24px; color: #1e293b; }
    h1 { color: #0f172a; font-size: 20px; margin-bottom: 4px; }
    h2 { color: #1e3a5f; font-size: 15px; margin-top: 24px; }
    .meta { color: #475569; font-size: 13px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: center; }
    th { background: #0f172a; color: #f1c40f; }
    .summary { display: flex; gap: 16px; flex-wrap: wrap; margin: 16px 0; }
    .stat { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 14px; min-width: 90px; }
    .stat .label { font-size: 10px; color: #64748b; }
    .stat .value { font-size: 18px; font-weight: bold; color: #0f172a; }
    .signature { margin-top: 24px; }
    .signature img { max-height: 80px; border-bottom: 1px solid #94a3b8; }
    .holiday-row { background: #fef9e7; }
    .absence-row { background: #fdecea; }
    /* מודגש גם בהדפסה שחור-לבן: לא מסתמכים על צבע בלבד — מסגרת שחורה עבה + סימן + טקסט מודגש. */
    .special-row td { border-top: 2px solid #000 !important; border-bottom: 2px solid #000 !important; font-weight: bold; }
    .special-badge {
      display: inline-block; border: 2px solid #000; border-radius: 50%; width: 15px; height: 15px;
      line-height: 11px; font-size: 9px; font-weight: 900; text-align: center; margin-left: 3px;
    }
    .stat.special-stat { border: 3px solid #000; background: #fef3c7; }
    .stat.special-stat .label { color: #000; font-weight: bold; }
  </style>
`;

const DOW_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export function reportPdfHtml(
  employee: User,
  report: MonthlyReport,
  days: DayDetail[],
  signatureDataUrl?: string
): string {
  const rows = days
    .map((d) => {
      const r = d.record;
      const cls = [d.holiday ? 'holiday-row' : '', d.isAbsence ? 'absence-row' : '', r?.hasSpecialRate ? 'special-row' : '']
        .filter(Boolean)
        .join(' ');
      return `<tr class="${cls}">
        <td>${d.date}</td>
        <td>${DOW_HE[d.dayOfWeek]}</td>
        <td>${d.holiday ? d.holiday.name : r ? r.type : d.isAbsence ? 'העדרות' : d.isSaturday ? 'שבת' : '—'}</td>
        <td>${r?.clockIn || ''}</td>
        <td>${r?.clockOut || ''}</td>
        <td>${r?.clockIn2 || ''}</td>
        <td>${r?.clockOut2 || ''}</td>
        <td>${r ? r.totalHours.toFixed(2) : ''}${r?.hasSpecialRate ? '<span class="special-badge">₪</span>' : ''}</td>
        <td>${r ? r.overtimeHours.toFixed(2) : ''}</td>
        <td>${r?.lessonsCount || ''}</td>
        <td>${r?.notes || ''}</td>
      </tr>`;
    })
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8">${BASE_STYLE}</head><body>
    <h1>דוח נוכחות חודשי — ישיבת הנגב</h1>
    <div class="meta">עובד/ת: ${employee.name} &nbsp;|&nbsp; חודש: ${report.month} &nbsp;|&nbsp; סטטוס: ${report.status}</div>
    <div class="summary">
      <div class="stat"><div class="label">ימי עבודה</div><div class="value">${report.totalWorkDays}</div></div>
      <div class="stat"><div class="label">סה"כ שעות</div><div class="value">${report.totalHours.toFixed(2)}</div></div>
      <div class="stat"><div class="label">שעות עודפות</div><div class="value">${report.totalOvertime.toFixed(2)}</div></div>
      <div class="stat"><div class="label">ימי מחלה</div><div class="value">${report.sickDays}</div></div>
      <div class="stat"><div class="label">ימי חופשה</div><div class="value">${report.vacationDays}</div></div>
      <div class="stat"><div class="label">ימי חג</div><div class="value">${report.holidayDays}</div></div>
      <div class="stat"><div class="label">ימי העדרות</div><div class="value">${report.absenceDays}</div></div>
      <div class="stat"><div class="label">שיעורים</div><div class="value">${report.totalLessons}</div></div>
      ${
        report.specialRateHours > 0
          ? `<div class="stat special-stat"><div class="label">⚠ שעות בשכר שונה — לתשומת לב חשבת שכר</div><div class="value">${report.specialRateHours.toFixed(2)}</div></div>`
          : ''
      }
    </div>
    <table>
      <thead><tr>
        <th>תאריך</th><th>יום</th><th>סוג</th><th>כניסה 1</th><th>יציאה 1</th><th>כניסה 2</th><th>יציאה 2</th>
        <th>שעות</th><th>עודפות</th><th>שיעורים</th><th>הערות</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${signatureDataUrl ? `<div class="signature"><div>חתימת עובד/ת:</div><img src="${signatureDataUrl}" /></div>` : ''}
  </body></html>`;
}

export function summaryPdfHtml(month: string, reports: (MonthlyReport & { employee: User })[]): string {
  const byDept = new Map<string, (MonthlyReport & { employee: User })[]>();
  for (const r of reports) {
    const dep = r.employee.department || 'ללא מחלקה';
    if (!byDept.has(dep)) byDept.set(dep, []);
    byDept.get(dep)!.push(r);
  }

  const sections = Array.from(byDept.entries())
    .map(([dep, list]) => {
      const rows = list
        .map(
          (r) => `<tr class="${r.specialRateHours > 0 ? 'special-row' : ''}">
        <td>${r.employee.name}</td><td>${r.status}</td><td>${r.totalWorkDays}</td>
        <td>${r.totalHours.toFixed(2)}</td><td>${r.totalOvertime.toFixed(2)}</td>
        <td>${r.sickDays}</td><td>${r.vacationDays}</td><td>${r.absenceDays}</td>
        <td>${r.specialRateHours > 0 ? `<span class="special-badge">₪</span> ${r.specialRateHours.toFixed(2)}` : '—'}</td>
      </tr>`
        )
        .join('');
      return `<h2>${dep}</h2>
      <table>
        <thead><tr><th>שם</th><th>סטטוס</th><th>ימי עבודה</th><th>שעות</th><th>עודפות</th><th>מחלה</th><th>חופשה</th><th>העדרות</th><th>⚠ שכר שונה</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    })
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8">${BASE_STYLE}</head><body>
    <h1>סיכום נוכחות עובדים — ${month}</h1>
    ${sections}
  </body></html>`;
}
