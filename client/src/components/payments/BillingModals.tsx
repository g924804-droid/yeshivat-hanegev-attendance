import { useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../lib/api';
import { MonthColumn, SCHOOL_MONTHS, StudentRow, shekel } from '../../lib/payments';

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-5 w-full max-w-md max-h-[92vh] overflow-y-auto space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-navy text-lg">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** הגדרות קבועות לתלמידה (או הוספת תלמידה חדשה לתשלומים). */
export function BillingModal({
  student,
  allStudentNames,
  existingNames,
  onClose,
  onSaved,
}: {
  student: StudentRow | null; // null = הוספת תלמידה
  allStudentNames: string[];
  existingNames: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(student?.name || '');
  const [amount, setAmount] = useState(String(student?.monthlyAmount || ''));
  const [scholarship, setScholarship] = useState(String(student?.monthlyScholarship || ''));
  const [active, setActive] = useState(student?.active ?? true);
  const [notes, setNotes] = useState(student?.billingNotes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = allStudentNames.filter((n) => !existingNames.includes(n));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/payments/saveBilling', {
        studentName: name,
        monthlyAmount: Number(amount) || 0,
        monthlyScholarship: Number(scholarship) || 0,
        active,
        notes,
      });
      onSaved();
    } catch (err: any) {
      setError(err.message || 'שגיאה בשמירה');
      setBusy(false);
    }
  }

  const owed = Math.max(0, (Number(amount) || 0) - (Number(scholarship) || 0));
  return (
    <ModalShell title={student ? `הגדרות תשלום — ${student.name}` : 'הוספת תלמידה לתשלומים'} onClose={onClose}>
      {!student && (
        <label className="block text-sm">
          תלמידה
          <input className="input mt-1" list="students-list" value={name} onChange={(e) => setName(e.target.value)} placeholder="הקלידי שם..." />
          <datalist id="students-list">
            {candidates.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
      )}
      <label className="block text-sm">
        סכום חודשי קבוע
        <input type="number" min={0} className="input mt-1" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="block text-sm">
        מלגה חודשית קבועה
        <input type="number" min={0} className="input mt-1" placeholder="0" value={scholarship} onChange={(e) => setScholarship(e.target.value)} />
      </label>
      <p className="text-sm text-slate-600">
        בכל חודש: לתשלום <strong>{shekel(owed)}</strong>
        {Number(scholarship) > 0 && ` (אחרי מלגה של ${shekel(Number(scholarship))})`}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        לחייב אותה בכל חודש (לבטל כשהתלמידה סיימה או עזבה)
      </label>
      <label className="block text-sm">
        הערות
        <input className="input mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <p className="text-xs text-slate-500">ההגדרות חלות על חודשים שייפתחו מעכשיו. חודשים שכבר נפתחו מתקנים בלחיצה על החודש בטבלה.</p>
      {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" onClick={save} disabled={busy || !name.trim()}>
          {busy ? 'שומר...' : 'שמירה'}
        </button>
        <button className="btn-outline" onClick={onClose}>ביטול</button>
      </div>
    </ModalShell>
  );
}

/** פתיחת חודש לכל התלמידות בלחיצה אחת. */
export function GenerateMonthModal({
  defaultMonth,
  onClose,
  onDone,
}: {
  defaultMonth: MonthColumn;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [month, setMonth] = useState(defaultMonth.month);
  const [year, setYear] = useState(defaultMonth.year);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ created: number; skipped: string[] }>('/payments/generateMonthlyPayments', { month, year });
      onDone(
        `נפתח חודש ${month} ${year}: נוצרו ${r.created} חיובים.` +
          (r.skipped.length ? ` לא נוצר חיוב ל-${r.skipped.join(', ')} — אין להן סכום חודשי (אפשר להגדיר בגלגל השיניים ליד השם).` : '')
      );
    } catch (err: any) {
      setError(err.message || 'שגיאה בפתיחת החודש');
      setBusy(false);
    }
  }

  return (
    <ModalShell title="פתיחת חודש חדש" onClose={onClose}>
      <p className="text-sm text-slate-600">
        ייווצר חיוב לכל תלמידה פעילה לפי הסכום והמלגה הקבועים שלה. תלמידות שכבר יש להן חיוב לחודש הזה לא ייפגעו.
      </p>
      <div className="flex gap-2">
        <select className="input" value={month} onChange={(e) => setMonth(e.target.value)}>
          {SCHOOL_MONTHS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input type="number" className="input w-28" value={year} onChange={(e) => setYear(e.target.value)} />
      </div>
      {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" onClick={run} disabled={busy}>
          {busy ? 'פותח...' : `פתיחת ${month} ${year}`}
        </button>
        <button className="btn-outline" onClick={onClose}>ביטול</button>
      </div>
    </ModalShell>
  );
}

/** חיוב לחודש אחד שעוד לא נפתח לתלמידה (למשל תלמידה שהצטרפה באמצע). */
export function NewChargeModal({
  student,
  column,
  onClose,
  onSaved,
}: {
  student: StudentRow;
  column: MonthColumn;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(String(student.monthlyAmount || ''));
  const [scholarship, setScholarship] = useState(String(student.monthlyScholarship || ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/payments/recordPayment', {
        fullName: student.name,
        month: column.month,
        year: column.year,
        amountDue: Number(amount) || 0,
        scholarship: Number(scholarship) || 0,
      });
      onSaved();
    } catch (err: any) {
      setError(err.message || 'שגיאה ביצירת החיוב');
      setBusy(false);
    }
  }

  return (
    <ModalShell title={`חיוב ל${column.month} ${column.year} — ${student.name}`} onClose={onClose}>
      <label className="block text-sm">
        סכום
        <input type="number" min={0} className="input mt-1" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="block text-sm">
        מלגה
        <input type="number" min={0} className="input mt-1" placeholder="0" value={scholarship} onChange={(e) => setScholarship(e.target.value)} />
      </label>
      {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" onClick={save} disabled={busy || !Number(amount)}>
          {busy ? 'שומר...' : 'יצירת חיוב'}
        </button>
        <button className="btn-outline" onClick={onClose}>ביטול</button>
      </div>
    </ModalShell>
  );
}
