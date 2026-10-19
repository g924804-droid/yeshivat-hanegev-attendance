/**
 * תבנית "הודעה בדבר תנאי עבודה" לעובדת שעתית — לפי קובץ האקסל של הסמינר ("הודעה לעובד שעות 08").
 * המנהלת ממלאת רק את הפרטים המשתנים (סכום, תפקיד, ממונה וכו'), השאר קבוע. ה-PDF נוצר מחדש
 * גם אחרי החתימה, כדי שהחתימה תופיע בתוך המסמך עצמו.
 */
export type HourlyContractData = {
  employeeName: string;
  idNumber: string;
  address: string;
  startDate: string; // YYYY-MM-DD או ריק
  role: string;
  manager: string;
  hourlyRate: number;
  travel: string;
  approver: string;
  extraNotes: string;
};

export const HOURLY_CONTRACT_DEFAULTS = {
  travel: 'כחוק',
  approver: 'מיכל פיננהנדלר',
};

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function heDate(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(`${iso.slice(0, 10)}T00:00:00`) : iso;
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
}

function fmtRate(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** מנקה ומאמת את נתוני הטופס; זורק שגיאה בעברית אם חסר משהו חיוני. */
export function parseHourlyContractData(body: any): HourlyContractData {
  const str = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);
  const rate = Number(String(body?.hourlyRate ?? '').replace(/[,\s₪]/g, ''));
  const data: HourlyContractData = {
    employeeName: str(body?.employeeName, 100),
    idNumber: str(body?.idNumber, 20),
    address: str(body?.address),
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(body?.startDate || '')) ? String(body.startDate) : '',
    role: str(body?.role),
    manager: str(body?.manager),
    hourlyRate: rate,
    travel: str(body?.travel) || HOURLY_CONTRACT_DEFAULTS.travel,
    approver: str(body?.approver, 100) || HOURLY_CONTRACT_DEFAULTS.approver,
    extraNotes: str(body?.extraNotes, 1000),
  };
  if (!data.employeeName) throw new Error('חסר שם העובדת');
  if (!data.role) throw new Error('חסר תפקיד');
  if (!data.manager) throw new Error('חסר ממונה ישיר');
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('חסר תעריף לשעה');
  return data;
}

export function hourlyContractHtml(
  d: HourlyContractData,
  opts: { createdAt: Date; signature?: string | null; signedAt?: Date | null }
): string {
  const blank = (v: string, width = 40) => (v ? esc(v) : `<span class="blank" style="min-width:${width}mm"></span>`);
  const row = (label: string, value: string) => `<tr><th>${label}</th><td>${value}</td></tr>`;
  const extra = d.extraNotes
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<li>${esc(l)}</li>`)
    .join('');

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: Arial, 'Segoe UI', sans-serif; color: #111; font-size: 12.5px; line-height: 1.55; margin: 0; }
  h1 { text-align: center; font-size: 20px; margin: 0 0 10px; text-decoration: underline; }
  h2 { font-size: 14px; margin: 14px 0 6px; background: #eef2f7; padding: 3px 8px; border-right: 4px solid #1e3a5f; }
  .head { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 18px; margin-bottom: 4px; }
  .head div { padding: 2px 0; }
  .head b { display: inline-block; min-width: 26mm; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #94a3b8; padding: 5px 8px; text-align: right; vertical-align: top; }
  th { width: 38mm; background: #f8fafc; font-weight: bold; }
  .blank { display: inline-block; border-bottom: 1px solid #111; height: 1em; }
  ul { margin: 4px 0; padding-right: 18px; }
  li { margin: 2px 0; }
  .legal { font-size: 11.5px; }
  .notes { font-size: 10.5px; color: #333; margin-top: 10px; }
  .notes p { margin: 2px 0; }
  .hl { font-weight: bold; color: #000; background: #fff3c4; padding: 1px 4px; }
  .notes .hl { font-size: 11.5px; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 20mm; margin-top: 18px; }
  .sign .line { border-bottom: 1px solid #111; height: 22mm; display: flex; align-items: flex-end; justify-content: center; }
  .sign img { max-height: 20mm; max-width: 70mm; }
  .sign .cap { text-align: center; margin-top: 3px; font-weight: bold; }
</style></head><body>
  <h1>הודעה בדבר תנאי עבודה</h1>
  <div class="head">
    <div><b>שם המעביד:</b> "קרית חינוך ישיבת הנגב- חנוך לנער נתיבות (ע.ר)</div>
    <div><b>ע.ר.:</b> 580061851</div>
    <div><b>מען:</b> חזו"א 5 ת.ד 49, נתיבות</div>
    <div></div>
    <div><b>שם העובדת:</b> ${esc(d.employeeName)}</div>
    <div><b>מס' זהות:</b> ${blank(d.idNumber)}</div>
    <div><b>כתובת:</b> ${blank(d.address)}</div>
    <div><b>תאריך תחילת עבודה:</b> ${blank(heDate(d.startDate), 30)}</div>
    <div><b>תקופת החוזה:</b> *החוזה תואם ללוח החופשות בסמינר</div>
    <div><b>סיום העסקה:</b> עם סיום שנה"ל/ סיום הקורס</div>
  </div>

  <h2>א. פרטים כלליים</h2>
  <table>
    ${row('תפקיד:', esc(d.role))}
    ${row('ממונה ישיר:', `${esc(d.manager)}<br>בעת הצורך ניתן לפנות לממונת העל הגב' רחל קרמר`)}
    ${row('הבסיס שלפיו משולם השכר:', 'מישרה שעתית')}
    ${row('ימים ושעות:', 'לפי מערכת השעות בסמינר')}
    ${row('תעריף לשעה:', `ברוטו <b>${fmtRate(d.hourlyRate)} ₪</b> לשעה אקדמית **<br>השכר לשעה כולל חופשה ודמי הבראה***`)}
    ${row('נסיעות:', esc(d.travel))}
    ${row('אופן התשלום:', 'העברה בנקאית')}
  </table>

  <h2>הערות נוספות</h2>
  <ul class="legal">
    <li>ידוע לי שבסגרת עבודתי עלי לתת דווח אודות הספקים, התנהלות וכל מידע שאתבקש.</li>
    <li>אני מתחייבת שכל שימוש בטכנולגייה או פעילות שלא הוגדרה מראש יש לקבל אישור מגב' ${esc(d.approver)}</li>
    <li>השתתפות באסיפות צוות פעמיים בשנה הינה חלק מתנאי העסקה</li>
    ${extra}
    <li>תנאים סוציאליים לפי חוק פנסיית חובה</li>
    <li class="hl">סעיף 14 – העובד מצהיר בזאת כי ידוע לו כי הפרשות המעביד בגין פיצויי פיטורין הינם במקום פיצויי פיטורין כאמור סעיף 14 לחוק פיצויי פיטורין.</li>
    <li>הנני מצהיר/ה כי קראתי את הנהלים, והנני מסכימ/ה לאמור בהם ובהסכם.</li>
    <li>הודעה זו אינה הסכם עבודה, אלא הודעת המעביד בדבר עיקר תנאי העבודה ; אין באמור בהודעה זו כדי לגרוע מכל זכות המוקנית לעובד מכוח כל דין, צו הרחבה, הסכם קיבוצי או חוזה עבודה.</li>
  </ul>

  <div class="notes">
    <p>* בתקופות בהן אין לימודים בסמינר, העובד יוגדר כ"לא עובד"</p>
    <p class="hl">** יש לרשום בדוח השעות את מספר השיעורים שנמסרו בפועל, לא כולל הפסקות</p>
    <p>*** מוסכם בזאת כי השכר השעתי נקבע מראש בשיעור מוגדל, והוא כולל קצובת הבראה עפ"י ההסכם הקיבוצי, מוסכם בזאת כי קצובת ההבראה תשולם באופן שוטף, וחלקה היחסי לכל חודש ישולם עם השכר בגין אותו חודש וכלול בה.</p>
  </div>

  <p style="margin-top:14px"><b>תאריך:</b> ${heDate(opts.signedAt || opts.createdAt)}</p>
  <div class="sign">
    <div><div class="line"></div><div class="cap">חתימת העמותה</div></div>
    <div>
      <div class="line">${opts.signature ? `<img src="${esc(opts.signature)}" alt="">` : ''}</div>
      <div class="cap">חתימת המורה${opts.signedAt ? ` · נחתם ב-${heDate(opts.signedAt)}` : ''}</div>
    </div>
  </div>
</body></html>`;
}
