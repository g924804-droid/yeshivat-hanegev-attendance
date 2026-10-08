import { useMemo, useState } from 'react';
import { Printer, X } from 'lucide-react';
import { api } from '../../lib/api';
import { MonthColumn, Payment, StudentRow, shekel } from '../../lib/payments';

type Who = 'debtors' | 'all' | 'one';

const DEFAULT_OPENING = 'להלן פירוט מצב תשלומי שכר הלימוד של בתכם לתקופה {תקופה}:';
const DEFAULT_DEBT = 'נודה לכם אם תסדירו את היתרה בהקדם. לבירורים ניתן לפנות למזכירות הישיבה.';
const DEFAULT_PAID = 'כל התשלומים לתקופה זו הוסדרו — תודה רבה על שיתוף הפעולה!';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const STYLE = `
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: 'Arial', sans-serif; direction: rtl; color: #1e293b; margin: 0;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .letter { page-break-after: always; font-size: 14px; line-height: 1.7; }
  .letter:last-child { page-break-after: auto; }
  .head { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #c9a227; padding-bottom: 8px; margin-bottom: 18px; }
  .head h1 { margin: 0; font-size: 22px; color: #0f172a; }
  .head img { max-height: 60px; }
  .date { text-align: left; color: #475569; margin-bottom: 14px; }
  .to { margin-bottom: 16px; }
  .subject { font-weight: bold; text-decoration: underline; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
  th, td { border: 1px solid #cbd5e1; padding: 5px 8px; text-align: center; }
  th { background: #0f172a; color: #f1c40f; }
  .total td { font-weight: bold; background: #f1f5f9; }
  .debt { color: #b91c1c; }
  .sign { margin-top: 36px; }
`;

/**
 * מכתבים להורים על מצב התשלומים לתקופה — לכל התלמידות שיש להן חוב, לכולן, או לתלמידה אחת.
 * כל מכתב בעמוד נפרד, ונפתח ישר בחלון ההדפסה (משם אפשר גם לשמור כ-PDF).
 */
export function LettersModal({
  students,
  payments,
  columns,
  onlyStudent,
  onClose,
}: {
  students: StudentRow[];
  payments: Payment[];
  columns: MonthColumn[];
  onlyStudent?: StudentRow;
  onClose: () => void;
}) {
  const nowKey = new Date().getFullYear() * 100 + new Date().getMonth() + 1;
  const pastColumns = columns.filter((c) => c.key <= nowKey);
  const [fromKey, setFromKey] = useState(columns[0].key);
  const [toKey, setToKey] = useState((pastColumns[pastColumns.length - 1] || columns[0]).key);
  const [who, setWho] = useState<Who>(onlyStudent ? 'one' : 'debtors');
  const [opening, setOpening] = useState(DEFAULT_OPENING);
  const [closingDebt, setClosingDebt] = useState(DEFAULT_DEBT);
  const [closingPaid, setClosingPaid] = useState(DEFAULT_PAID);
  const [signature, setSignature] = useState('בברכה,\nהנהלת הישיבה');
  const [busy, setBusy] = useState(false);

  const label = (key: number) => {
    const c = columns.find((x) => x.key === key)!;
    return `${c.month} ${c.year}`;
  };

  const recipients = useMemo(() => {
    const inRange = (p: Payment) => p.monthKey >= fromKey && p.monthKey <= toKey;
    const list = (who === 'one' && onlyStudent ? [onlyStudent] : students).map((s) => {
      const rows = payments.filter((p) => p.fullName === s.name && inRange(p)).sort((a, b) => a.monthKey - b.monthKey);
      return { student: s, rows, balance: rows.reduce((sum, p) => sum + p.balance, 0) };
    });
    return list.filter((r) => r.rows.length && (who !== 'debtors' || r.balance > 0));
  }, [students, payments, fromKey, toKey, who, onlyStudent]);

  async function print() {
    setBusy(true);
    let logo = '';
    try {
      const s = await api.get<{ siteName: string | null; hasLogo: boolean }>('/display/settings');
      if (s.hasLogo) logo = `<img src="${location.origin}/api/display/logo" />`;
    } catch {
      /* בלי לוגו */
    }
    const period = `${label(fromKey)} – ${label(toKey)}`;
    const today = new Date().toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
    const paragraphs = (text: string) => esc(text).replace(/\n/g, '<br>');

    const letters = recipients
      .map(({ student, rows, balance }) => {
        const parents = [student.fatherName, student.motherName].filter(Boolean);
        const toLine = parents.length ? `לכבוד ${parents.join(' ו')}` : 'לכבוד ההורים';
        const address = [student.address, student.city].filter(Boolean).join(', ');
        const body = rows
          .map(
            (p) => `<tr><td>${p.month} ${p.year}</td><td>${shekel(p.amountDue + p.extra)}</td><td>${p.scholarship ? shekel(p.scholarship) : '—'}</td>
              <td>${shekel(p.amountPaid)}</td><td class="${p.balance > 0 ? 'debt' : ''}">${shekel(p.balance)}</td></tr>`
          )
          .join('');
        const sum = (k: 'amountPaid' | 'scholarship') => rows.reduce((s, p) => s + p[k], 0);
        return `<div class="letter">
          <div class="head"><h1>ישיבת הנגב</h1>${logo}</div>
          <div class="date">${today}</div>
          <div class="to">${esc(toLine)}<br>הורי התלמידה ${esc(student.name)}${address ? `<br>${esc(address)}` : ''}</div>
          <div class="subject">הנדון: מצב תשלומי שכר לימוד</div>
          <p>שלום רב,</p>
          <p>${paragraphs(opening.replace('{תקופה}', period))}</p>
          <table>
            <thead><tr><th>חודש</th><th>חיוב</th><th>מלגה</th><th>שולם</th><th>יתרה</th></tr></thead>
            <tbody>${body}
              <tr class="total"><td>סה"כ</td><td>${shekel(rows.reduce((s, p) => s + p.amountDue + p.extra, 0))}</td>
              <td>${sum('scholarship') ? shekel(sum('scholarship')) : '—'}</td><td>${shekel(sum('amountPaid'))}</td>
              <td class="${balance > 0 ? 'debt' : ''}">${shekel(balance)}</td></tr>
            </tbody>
          </table>
          ${balance > 0 ? `<p><strong>יתרה לתשלום: ${shekel(balance)}</strong></p>` : ''}
          <p>${paragraphs(balance > 0 ? closingDebt : closingPaid)}</p>
          <div class="sign">${paragraphs(signature)}</div>
        </div>`;
      })
      .join('');

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;left:0;bottom:0;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>מכתבים להורים</title><style>${STYLE}</style></head><body>${letters}</body></html>`);
    doc.close();
    // מחכים ללוגו לפני ההדפסה, אחרת הוא יוצא ריק
    await Promise.race([
      Promise.all(
        Array.from(doc.images).map((img) =>
          img.complete ? null : new Promise((r) => { img.onload = img.onerror = () => r(null); })
        )
      ),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
    iframe.contentWindow!.focus();
    iframe.contentWindow!.print();
    setTimeout(() => iframe.remove(), 60_000);
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-5 w-full max-w-lg max-h-[92vh] overflow-y-auto space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-navy text-lg">{onlyStudent ? `מכתב להורי ${onlyStudent.name}` : 'מכתבים להורים'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="flex gap-2 items-end">
          <label className="text-sm flex-1">
            מחודש
            <select className="input mt-1" value={fromKey} onChange={(e) => setFromKey(Number(e.target.value))}>
              {columns.map((c) => (
                <option key={c.key} value={c.key}>{c.month} {c.year}</option>
              ))}
            </select>
          </label>
          <label className="text-sm flex-1">
            עד חודש
            <select className="input mt-1" value={toKey} onChange={(e) => setToKey(Number(e.target.value))}>
              {columns.filter((c) => c.key >= fromKey).map((c) => (
                <option key={c.key} value={c.key}>{c.month} {c.year}</option>
              ))}
            </select>
          </label>
        </div>

        {!onlyStudent && (
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={who === 'debtors'} onChange={() => setWho('debtors')} /> רק למי שיש חוב
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={who === 'all'} onChange={() => setWho('all')} /> לכל התלמידות
            </label>
          </div>
        )}

        <label className="block text-sm">
          פתיחה <span className="text-slate-400">({'{תקופה}'} יוחלף בתקופה שנבחרה)</span>
          <textarea className="input mt-1" rows={2} value={opening} onChange={(e) => setOpening(e.target.value)} />
        </label>
        <label className="block text-sm">
          סיום — כשיש חוב
          <textarea className="input mt-1" rows={2} value={closingDebt} onChange={(e) => setClosingDebt(e.target.value)} />
        </label>
        <label className="block text-sm">
          סיום — כשהכל שולם
          <textarea className="input mt-1" rows={2} value={closingPaid} onChange={(e) => setClosingPaid(e.target.value)} />
        </label>
        <label className="block text-sm">
          חתימה
          <textarea className="input mt-1" rows={2} value={signature} onChange={(e) => setSignature(e.target.value)} />
        </label>

        <p className="text-sm text-slate-600">
          {recipients.length ? `יודפסו ${recipients.length} מכתבים` : 'אין מכתבים להדפסה בתקופה הזו'}
          {recipients.some((r) => !r.student.fatherName && !r.student.motherName) &&
            ' (לחלק מהתלמידות אין שמות הורים בטבלת התלמידות — שם ייכתב "לכבוד ההורים")'}
        </p>

        <div className="flex gap-2">
          <button className="btn-primary" onClick={print} disabled={busy || !recipients.length}>
            <Printer size={16} /> {busy ? 'מכין...' : 'הדפסה'}
          </button>
          <button className="btn-outline" onClick={onClose}>סגירה</button>
        </div>
      </div>
    </div>
  );
}
