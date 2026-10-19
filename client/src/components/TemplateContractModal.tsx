import { useEffect, useMemo, useState } from 'react';
import { Eye, FilePlus2 } from 'lucide-react';
import { api, FILTER_BLOCKED_MESSAGE } from '../lib/api';
import { compareByFamilyName } from '../lib/utils';

type Employee = {
  id: string;
  name: string;
  lastName: string | null;
  isActive: boolean;
  idNumber: string | null;
  workArea: string | null;
};

/** ממונות ישירות לפי תחום — מתוך התבנית של הסמינר; אפשר גם להקליד ממונה אחרת. */
const MANAGERS: { area: string; text: string }[] = [
  { area: 'אדריכלות', text: 'אדריכלות- לאה שוב' },
  { area: 'ספורט', text: 'ספורט- מיכל פיננהנדלר' },
  { area: 'סולם', text: 'סול"ם- מיכל אלימלך' },
  { area: 'הנהלת חשבונות', text: 'הנהלת חשבונות ויועוץ מס- עטרה אזולאי' },
];

const EMPTY = {
  employeeName: '',
  idNumber: '',
  address: '',
  startDate: '',
  role: '',
  manager: '',
  hourlyRate: '',
  travel: 'כחוק',
  approver: 'מיכל פיננהנדלר',
  extraNotes: '',
};

/** יצירת "הודעה בדבר תנאי עבודה" מהתבנית — ממלאים רק את הפרטים המשתנים, והחוזה נשלח לעובדת לחתימה. */
export function TemplateContractModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ employees: Employee[] }>('/employees/getEmployees')
      .then((r) => setEmployees(r.employees.filter((e) => e.isActive).sort(compareByFamilyName)));
  }, []);

  const set = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function pickEmployee(id: string) {
    setEmployeeId(id);
    const e = employees.find((x) => x.id === id);
    if (!e) return;
    const manager = MANAGERS.find((m) => e.workArea && m.area === e.workArea.replace(/"/g, ''))?.text;
    setForm((f) => ({
      ...f,
      employeeName: e.name,
      idNumber: e.idNumber || '',
      role: f.role || (e.workArea ? `מורה ל${e.workArea}` : ''),
      manager: f.manager || manager || '',
    }));
  }

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!employeeId) m.push('עובדת');
    if (!form.role.trim()) m.push('תפקיד');
    if (!form.manager.trim()) m.push('ממונה ישיר');
    if (!(Number(form.hourlyRate) > 0)) m.push('תעריף לשעה');
    return m;
  }, [employeeId, form]);

  async function preview() {
    setError(null);
    setBusy('preview');
    // פותחים חלון מיד (בתוך הלחיצה) כדי שהדפדפן לא יחסום אותו כחלון קופץ
    const win = window.open('', '_blank');
    try {
      const res = await fetch('/api/contracts/templatePreview', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        if (res.status === 418) throw new Error(FILTER_BLOCKED_MESSAGE);
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || `שגיאה (${res.status})`);
      }
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url;
      else window.open(url, '_blank');
    } catch (err: any) {
      win?.close();
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setError(null);
    setBusy('save');
    try {
      await api.post('/contracts/createFromTemplate', { ...form, employeeId });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg space-y-3 max-h-[92vh] overflow-y-auto">
        <h3 className="font-bold text-navy text-lg">חוזה מתבנית — הודעה בדבר תנאי עבודה (שעתי)</h3>

        <div>
          <label className="label">עובדת *</label>
          <select className="input" value={employeeId} onChange={(e) => pickEmployee(e.target.value)}>
            <option value="">בחר/י עובדת</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">מס' זהות</label>
            <input className="input" value={form.idNumber} onChange={(e) => set('idNumber', e.target.value)} />
          </div>
          <div>
            <label className="label">תאריך תחילת עבודה</label>
            <input type="date" className="input" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">כתובת</label>
          <input className="input" value={form.address} onChange={(e) => set('address', e.target.value)} />
        </div>

        <div>
          <label className="label">תפקיד (מה היא עושה) *</label>
          <input className="input" value={form.role} onChange={(e) => set('role', e.target.value)} placeholder="למשל: מורה לאדריכלות" />
        </div>
        <div>
          <label className="label">ממונה ישיר (מי אחראית) *</label>
          <input
            className="input"
            list="contract-managers"
            value={form.manager}
            onChange={(e) => set('manager', e.target.value)}
            placeholder="בחירה מהרשימה או הקלדה חופשית"
          />
          <datalist id="contract-managers">
            {MANAGERS.map((m) => (
              <option key={m.text} value={m.text} />
            ))}
          </datalist>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">תעריף לשעה אקדמית (₪ ברוטו) *</label>
            <input className="input" inputMode="decimal" value={form.hourlyRate} onChange={(e) => set('hourlyRate', e.target.value)} />
          </div>
          <div>
            <label className="label">נסיעות</label>
            <input className="input" value={form.travel} onChange={(e) => set('travel', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">אישור לשימוש בטכנולוגיה / פעילות חריגה — מגב'</label>
          <input className="input" value={form.approver} onChange={(e) => set('approver', e.target.value)} />
        </div>
        <div>
          <label className="label">הערות נוספות לחוזה (לא חובה — כל שורה סעיף)</label>
          <textarea className="input min-h-[60px]" value={form.extraNotes} onChange={(e) => set('extraNotes', e.target.value)} />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {missing.length > 0 && <p className="text-xs text-slate-500">חסר: {missing.join(', ')}</p>}

        <div className="flex gap-2 justify-end pt-2 flex-wrap">
          <button className="btn-outline" onClick={onClose}>
            ביטול
          </button>
          <button className="btn-outline" onClick={preview} disabled={!!busy || missing.length > 0}>
            <Eye size={16} /> {busy === 'preview' ? 'מכין...' : 'תצוגה מקדימה'}
          </button>
          <button className="btn-primary" onClick={save} disabled={!!busy || missing.length > 0}>
            <FilePlus2 size={16} /> {busy === 'save' ? 'יוצר...' : 'יצירה ושליחה לחתימה'}
          </button>
        </div>
      </div>
    </div>
  );
}
