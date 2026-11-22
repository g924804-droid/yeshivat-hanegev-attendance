import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { DOW_HE } from '../lib/utils';

/**
 * ניהול הדוחות: השלמות לחודשים קודמים שצורפו לחודש המוצג — צפייה בימים ובחתימה, אישור או דחייה.
 * ההשלמה לא נכללת בסה"כ של החודש — משולמת כהפרשים.
 */
type Day = { date: string; clockIn: string; clockOut: string; clockIn2: string; clockOut2: string; hours: number; lessons: number; notes: string };
type Completion = {
  id: string;
  forMonth: string;
  forLabel: string;
  status: string;
  employee: { id: string; name: string };
  days: Day[];
  workDays: number;
  hours: number;
  lessons: number;
  employeeNote: string | null;
  signature: string;
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: string;
};

export function LateCompletionsPanel({ month, onChanged }: { month: string; onChanged?: () => void }) {
  const [list, setList] = useState<Completion[]>([]);
  const [others, setOthers] = useState<{ month: string; label: string }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      const r = await api.get<{ completions: Completion[]; pendingOtherMonths: { month: string; label: string }[] }>('/lateCompletion/month', { month });
      setList(r.completions);
      setOthers(r.pendingOtherMonths);
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function review(c: Completion, approve: boolean) {
    let note: string | null = '';
    if (!approve) {
      note = prompt(`למה דוחים את ההשלמה של ${c.employee.name}? (המורה תראה את זה)`);
      if (!note?.trim()) return;
    }
    try {
      await api.post(`/lateCompletion/${c.id}/review`, { approve, note });
      await load();
      onChanged?.();
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (!list.length && !others.length) return null;
  const badge = (s: string) =>
    s === 'אושר' ? <span className="badge bg-green-100 text-green-800">אושרה</span> : s === 'נדחה' ? <span className="badge bg-red-100 text-red-700">נדחתה</span> : <span className="badge bg-amber-200 text-amber-900">ממתינה לאישור</span>;

  return (
    <div className="card mb-6 border-2 border-amber-300 bg-amber-50/40">
      <h3 className="font-bold text-navy mb-1">השלמות לחודשים קודמים שצורפו לחודש הזה</h3>
      <p className="text-xs text-slate-600 mb-3">לתשלום כהפרשים — לא כלולות בסה"כ של החודש. מופיעות גם בדוח ה-PDF של המורה ובסיכום.</p>
      {error && <p className="text-sm text-red-700 mb-2">{error}</p>}
      {others.length > 0 && (
        <p className="text-sm text-amber-900 mb-2">יש גם השלמות שממתינות לאישור בחודשים: {others.map((o) => o.label).join(', ')}</p>
      )}
      <ul className="space-y-2">
        {list.map((c) => (
          <li key={c.id} className="bg-white rounded-xl border px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <b className="text-navy">{c.employee.name}</b>
              <span>
                השלמה ל{c.forLabel}: {c.workDays} ימים, {c.hours} שעות{c.lessons ? `, ${c.lessons} שיעורים` : ''}
              </span>
              {badge(c.status)}
              {c.reviewedBy && c.status !== 'ממתין' && <span className="text-xs text-slate-500">ע"י {c.reviewedBy}</span>}
              <span className="flex-1" />
              <button className="text-sm text-navy underline" onClick={() => setOpen(open === c.id ? null : c.id)}>
                {open === c.id ? 'הסתרה' : 'פירוט'}
              </button>
              {c.status === 'ממתין' && (
                <>
                  <button className="btn-primary py-1 px-3 text-sm" onClick={() => review(c, true)}>
                    אישור
                  </button>
                  <button className="btn-outline py-1 px-3 text-sm text-red-700" onClick={() => review(c, false)}>
                    דחייה
                  </button>
                </>
              )}
            </div>
            {c.status === 'נדחה' && c.reviewNote && <p className="text-xs text-red-700 mt-1">סיבת הדחייה: {c.reviewNote}</p>}
            {open === c.id && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-right text-slate-500 border-b">
                      {['תאריך', 'כניסה 1', 'יציאה 1', 'כניסה 2', 'יציאה 2', 'שעות', 'שיעורים', 'הערות'].map((h) => (
                        <th key={h} className="py-1 px-2">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {c.days.map((d) => (
                      <tr key={d.date} className="border-b">
                        <td className="py-1 px-2 whitespace-nowrap">
                          {d.date.split('-').reverse().join('/')} {DOW_HE[new Date(`${d.date}T00:00:00`).getDay()]}
                        </td>
                        <td className="py-1 px-2">{d.clockIn}</td>
                        <td className="py-1 px-2">{d.clockOut}</td>
                        <td className="py-1 px-2">{d.clockIn2}</td>
                        <td className="py-1 px-2">{d.clockOut2}</td>
                        <td className="py-1 px-2 font-semibold">{d.hours.toFixed(2)}</td>
                        <td className="py-1 px-2">{d.lessons || ''}</td>
                        <td className="py-1 px-2">{d.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {c.employeeNote && <p className="text-sm mt-2">הערת המורה: {c.employeeNote}</p>}
                <div className="mt-2 text-xs text-slate-500">
                  נשלחה ב-{new Date(c.createdAt).toLocaleDateString('he-IL')} · חתימה:
                  <img src={c.signature} alt="חתימה" className="h-12 border-b inline-block mr-2" />
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
