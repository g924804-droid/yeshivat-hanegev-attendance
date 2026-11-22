import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../lib/api';
import { SignaturePad, SignaturePadHandle } from './SignaturePad';
import { DOW_HE } from '../lib/utils';

/**
 * השלמת חודש קודם שננעל: המורה ממלאת את הימים שחסרים, חותמת ושולחת. החודש הנעול לא נפתח —
 * ההשלמה מצורפת לדוח של החודש הנוכחי וממתינה לאישור ההנהלה. משולמת כהפרשים (לא בסה"כ של החודש).
 */
type FormDay = {
  date: string;
  dow: number;
  holiday: { name: string; type: 'full' | 'half' } | null;
  existing: { type: string; clockIn: string | null; clockOut: string | null; totalHours: number } | null;
};
type Mine = {
  id: string;
  forMonth: string;
  forLabel: string;
  inLabel: string;
  status: string;
  reviewNote: string | null;
  workDays: number;
  hours: number;
  createdAt: string;
};
type FormData_ = { months: { month: string; label: string; active: string | null }[]; month: string; days: FormDay[]; mine: Mine[] };
type Row = { clockIn: string; clockOut: string; clockIn2: string; clockOut2: string; lessons: string; notes: string };
const EMPTY: Row = { clockIn: '', clockOut: '', clockIn2: '', clockOut2: '', lessons: '', notes: '' };

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
function rowHours(r: Row): number {
  let min = 0;
  if (r.clockIn && r.clockOut) min += Math.max(0, toMin(r.clockOut) - toMin(r.clockIn));
  if (r.clockIn2 && r.clockOut2) min += Math.max(0, toMin(r.clockOut2) - toMin(r.clockIn2));
  return Math.round((min / 60) * 100) / 100;
}
const filled = (r?: Row) => !!r && Object.values(r).some((v) => v.trim());

export function LateCompletionModal({ initialMonth, trackLessons, onClose }: { initialMonth?: string; trackLessons?: boolean; onClose: () => void }) {
  const [month, setMonth] = useState(initialMonth || '');
  const [data, setData] = useState<FormData_ | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const sig = useRef<SignaturePadHandle>(null);

  async function load(m = month) {
    try {
      const d = await api.get<FormData_>('/lateCompletion/form', m ? { month: m } : {});
      setData(d);
      setMonth(d.month);
      setRows({});
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = data?.months.find((m) => m.month === month);
  const canFill = !!selected && !selected.active;
  const set = (date: string, k: keyof Row, v: string) => setRows((p) => ({ ...p, [date]: { ...(p[date] || EMPTY), [k]: v } }));
  const filledDays = Object.entries(rows).filter(([, r]) => filled(r));
  const totalHours = filledDays.reduce((s, [, r]) => s + rowHours(r), 0);

  async function submit() {
    setError('');
    if (!filledDays.length) return setError('לא מולא אף יום');
    if (!sig.current || sig.current.isEmpty()) return setError('חובה לחתום');
    setSaving(true);
    try {
      const r = await api.post<{ inLabel: string }>('/lateCompletion', {
        forMonth: month,
        note,
        signature: sig.current.getDataUrl(),
        days: filledDays.map(([date, row]) => ({ date, ...row })),
      });
      setDone(r.inLabel);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function cancel(c: Mine) {
    if (!confirm(`לבטל את ההשלמה ל${c.forLabel}?`)) return;
    try {
      await api.delete(`/lateCompletion/${c.id}`);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const statusBadge = (s: string) =>
    s === 'אושר' ? <span className="badge bg-green-100 text-green-800">אושרה</span> : s === 'נדחה' ? <span className="badge bg-red-100 text-red-700">נדחתה</span> : <span className="badge bg-amber-100 text-amber-800">ממתינה לאישור</span>;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-2 sm:p-4 z-50">
      <div className="bg-white rounded-2xl p-4 sm:p-6 w-full max-w-4xl max-h-[94vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-navy text-lg">השלמת חודש קודם</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100">
            <X size={20} />
          </button>
        </div>

        {done ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-green-50 text-green-800 px-4 py-3">
              ההשלמה נשלחה ✓ היא צורפה לדוח של {done} וממתינה לאישור ההנהלה.
            </div>
            <button className="btn-primary" onClick={onClose}>
              סגירה
            </button>
          </div>
        ) : !data ? (
          error ? <p className="text-red-700">{error}</p> : <p>טוען...</p>
        ) : (
          <>
            <p className="text-sm text-slate-600 mb-3">
              לחודש שננעל ולא מולא: ממלאים כאן את הימים, חותמים ושולחים. החודש עצמו נשאר נעול — ההשלמה מצורפת לדוח של החודש הנוכחי
              וממתינה לאישור ההנהלה.
            </p>

            {data.mine.length > 0 && (
              <div className="mb-4 text-sm">
                <div className="font-semibold text-navy mb-1">השלמות ששלחת</div>
                <ul className="space-y-1">
                  {data.mine.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2">
                      <span>
                        {c.forLabel} — {c.workDays} ימים, {c.hours} שעות (צורפה ל{c.inLabel})
                      </span>
                      {statusBadge(c.status)}
                      {c.status === 'נדחה' && c.reviewNote && <span className="text-red-700">סיבה: {c.reviewNote}</span>}
                      {c.status === 'ממתין' && (
                        <button className="text-xs text-red-600 hover:underline" onClick={() => cancel(c)}>
                          ביטול
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!data.months.length ? (
              <p className="text-sm text-slate-500">אין חודש נעול שאפשר להשלים.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <label className="label mb-0">חודש להשלמה:</label>
                  <select className="input w-auto" value={month} onChange={(e) => load(e.target.value)}>
                    {data.months.map((m) => (
                      <option key={m.month} value={m.month}>
                        {m.label}
                        {m.active ? ` — כבר נשלחה (${m.active === 'אושר' ? 'אושרה' : 'ממתינה'})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {!canFill ? (
                  <p className="text-sm text-amber-800 bg-amber-50 rounded-xl px-3 py-2">
                    כבר נשלחה השלמה לחודש הזה. אם צריך לתקן — אפשר לבטל אותה (כל עוד היא ממתינה) ולשלוח מחדש.
                  </p>
                ) : (
                  <>
                    <div className="overflow-x-auto border rounded-xl">
                      <table className="w-full text-sm">
                        <thead className="bg-navy text-white">
                          <tr>
                            {['תאריך', 'כניסה 1', 'יציאה 1', 'כניסה 2', 'יציאה 2', ...(trackLessons !== false ? ['שיעורים'] : []), 'הערות', 'שעות'].map((h) => (
                              <th key={h} className="px-2 py-2 text-right font-bold whitespace-nowrap">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {data.days
                            .filter((d) => d.dow !== 6)
                            .map((d) => {
                              const r = rows[d.date] || EMPTY;
                              const blocked = !!d.existing;
                              const label = (
                                <td className="px-2 py-1.5 whitespace-nowrap">
                                  <b>{Number(d.date.slice(8))}/{Number(d.date.slice(5, 7))}</b>{' '}
                                  <span className="text-slate-500">{DOW_HE[d.dow]}</span>
                                  {d.holiday && <div className="text-xs text-amber-700">{d.holiday.name}</div>}
                                </td>
                              );
                              if (blocked) {
                                return (
                                  <tr key={d.date} className="border-t bg-slate-50 text-slate-500">
                                    {label}
                                    <td colSpan={trackLessons !== false ? 7 : 6} className="px-2 py-1.5 text-xs">
                                      כבר רשום בחודש: {d.existing!.type}
                                      {d.existing!.clockIn ? ` ${d.existing!.clockIn}–${d.existing!.clockOut || ''}` : ''}
                                    </td>
                                  </tr>
                                );
                              }
                              const t = (k: keyof Row) => (
                                <td className="px-1 py-1">
                                  <input type="time" className="input py-1 px-1.5 w-[92px]" value={r[k]} onChange={(e) => set(d.date, k, e.target.value)} />
                                </td>
                              );
                              return (
                                <tr key={d.date} className={`border-t ${filled(r) ? 'bg-gold/10' : d.holiday?.type === 'full' ? 'bg-amber-50/60' : ''}`}>
                                  {label}
                                  {t('clockIn')}
                                  {t('clockOut')}
                                  {t('clockIn2')}
                                  {t('clockOut2')}
                                  {trackLessons !== false && (
                                    <td className="px-1 py-1">
                                      <input className="input py-1 px-1.5 w-14" inputMode="numeric" value={r.lessons} onChange={(e) => set(d.date, 'lessons', e.target.value.replace(/\D/g, ''))} />
                                    </td>
                                  )}
                                  <td className="px-1 py-1">
                                    <input className="input py-1 px-1.5 min-w-[120px]" value={r.notes} onChange={(e) => set(d.date, 'notes', e.target.value)} />
                                  </td>
                                  <td className="px-2 py-1.5 font-semibold whitespace-nowrap">{filled(r) && rowHours(r) ? rowHours(r).toFixed(2) : ''}</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-sm mt-2">
                      מולאו <b>{filledDays.length}</b> ימים · סה"כ <b>{totalHours.toFixed(2)}</b> שעות
                    </p>
                    <div className="mt-3">
                      <label className="label">הערה (לא חובה)</label>
                      <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                    </div>
                    <div className="mt-3">
                      <label className="label">חתימה *</label>
                      <SignaturePad ref={sig} />
                    </div>
                    {error && <div className="mt-3 text-sm bg-red-50 text-red-700 rounded-xl px-3 py-2">{error}</div>}
                    <div className="flex gap-2 mt-4">
                      <button className="btn-primary" disabled={saving} onClick={submit}>
                        {saving ? 'שולח...' : 'שליחת ההשלמה'}
                      </button>
                      <button className="btn-outline" onClick={onClose}>
                        ביטול
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
            {error && !canFill && <div className="mt-3 text-sm bg-red-50 text-red-700 rounded-xl px-3 py-2">{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}
