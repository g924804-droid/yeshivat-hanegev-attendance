import { useState } from 'react';
import { Plus, Trash2, X, Pencil } from 'lucide-react';
import { api } from '../../lib/api';
import { Payment, shekel, todayIso, STATUS_HE } from '../../lib/payments';

type Row = { method: string; amount: string; date: string; notes: string };

/**
 * רישום תשלום לחודש של תלמידה. אפשר לפצל בין כמה אמצעי תשלום (למשל חצי מזומן וחצי צ'ק),
 * ולקבוע מלגה לחודש — כך "חצי מלגה וחצי תשלום" נרשם בפשטות: מלגה בשדה המלגה, והשאר כתשלום.
 */
export function PaymentModal({
  payment,
  methods,
  defaultMethod,
  onClose,
  onSaved,
}: {
  payment: Payment;
  methods: string[];
  defaultMethod: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [scholarship, setScholarship] = useState(String(payment.scholarship || ''));
  const [rows, setRows] = useState<Row[]>([{ method: defaultMethod, amount: '', date: todayIso(), notes: '' }]);
  const [editingCharge, setEditingCharge] = useState(false);
  const [amountDue, setAmountDue] = useState(String(payment.amountDue));
  const [extra, setExtra] = useState(String(payment.extra || ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sch = Number(scholarship) || 0;
  const owed = Math.max(0, (Number(amountDue) || 0) + (Number(extra) || 0) - sch);
  const newPaid = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const remaining = Math.max(0, owed - payment.amountPaid - newPaid);

  function setRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    const other = methods.find((m) => !rows.some((r) => r.method === m)) || methods[0];
    setRows((prev) => [...prev, { method: other, amount: remaining ? String(remaining) : '', date: todayIso(), notes: '' }]);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (editingCharge && (Number(amountDue) !== payment.amountDue || (Number(extra) || 0) !== payment.extra)) {
        await api.put('/payments/updatePayment', { id: payment.id, amountDue: Number(amountDue) || 0, extra: Number(extra) || 0 });
      }
      const entries = rows.filter((r) => Number(r.amount) > 0).map((r) => ({ ...r, amount: Number(r.amount) }));
      if (entries.length || sch !== payment.scholarship) {
        await api.post('/payments/addPayment', { paymentId: payment.id, scholarship: sch, entries });
      }
      onSaved();
    } catch (err: any) {
      setError(err.message || 'שגיאה בשמירה');
      setBusy(false);
    }
  }

  async function removeEntry(id: string) {
    if (!confirm('לבטל את התשלום הזה? הסכום יורד מהסכום ששולם.')) return;
    setBusy(true);
    try {
      await api.delete(`/payments/entry/${id}`);
      onSaved();
    } catch (err: any) {
      setError(err.message || 'שגיאה בביטול');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-5 w-full max-w-lg max-h-[92vh] overflow-y-auto space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-bold text-navy text-lg">{payment.fullName}</h3>
            <p className="text-sm text-slate-500">
              {payment.month} {payment.year} · {STATUS_HE[payment.status]}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        {/* החיוב */}
        <div className="bg-slate-50 rounded-xl p-3 text-sm space-y-1.5">
          <div className="flex justify-between items-center">
            <span>סכום קבוע</span>
            {editingCharge ? (
              <input type="number" className="input py-1 w-28" value={amountDue} onChange={(e) => setAmountDue(e.target.value)} />
            ) : (
              <span className="flex items-center gap-1">
                {shekel(payment.amountDue)}
                <button title="תיקון החיוב לחודש הזה" onClick={() => setEditingCharge(true)} className="text-slate-400 hover:text-navy">
                  <Pencil size={13} />
                </button>
              </span>
            )}
          </div>
          {(editingCharge || payment.extra > 0) && (
            <div className="flex justify-between items-center">
              <span>תוספת</span>
              {editingCharge ? (
                <input type="number" className="input py-1 w-28" value={extra} onChange={(e) => setExtra(e.target.value)} />
              ) : (
                <span>{shekel(payment.extra)}</span>
              )}
            </div>
          )}
          <div className="flex justify-between items-center">
            <span>מלגה</span>
            <input
              type="number"
              min={0}
              className="input py-1 w-28"
              placeholder="0"
              value={scholarship}
              onChange={(e) => setScholarship(e.target.value)}
            />
          </div>
          <div className="flex justify-between font-semibold border-t pt-1.5">
            <span>לתשלום אחרי מלגה</span>
            <span>{shekel(owed)}</span>
          </div>
          <div className="flex justify-between text-green-700">
            <span>שולם עד עכשיו</span>
            <span>{shekel(payment.amountPaid)}</span>
          </div>
        </div>

        {payment.entries.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-navy mb-1">תשלומים שנרשמו</p>
            <ul className="text-sm divide-y border rounded-xl">
              {payment.entries.map((e) => (
                <li key={e.id} className="flex items-center justify-between px-3 py-1.5">
                  <span>
                    {e.date.split('-').reverse().join('/')} · {e.method} · <strong>{shekel(e.amount)}</strong>
                    {e.notes && <span className="text-slate-500"> · {e.notes}</span>}
                  </span>
                  <button title="ביטול התשלום" className="text-red-500 hover:text-red-700" onClick={() => removeEntry(e.id)} disabled={busy}>
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* תשלום חדש — אפשר כמה אמצעים */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold text-navy">תשלום חדש</p>
            {payment.amountPaid < owed && (
              <button
                className="text-xs text-navy underline"
                onClick={() => setRows((prev) => [{ ...prev[0], amount: String(Math.max(0, owed - payment.amountPaid)) }, ...prev.slice(1).map((r) => ({ ...r, amount: '' }))])}
              >
                כל היתרה ({shekel(Math.max(0, owed - payment.amountPaid))})
              </button>
            )}
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="border rounded-xl p-2 space-y-2">
                <div className="flex gap-2">
                  <select className="input py-1.5" value={r.method} onChange={(e) => setRow(i, { method: e.target.value })}>
                    {methods.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    className="input py-1.5 w-32"
                    placeholder="סכום"
                    value={r.amount}
                    onChange={(e) => setRow(i, { amount: e.target.value })}
                  />
                  {rows.length > 1 && (
                    <button className="text-slate-400 hover:text-red-600" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>
                      <X size={16} />
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <input type="date" className="input py-1.5 w-40" value={r.date} onChange={(e) => setRow(i, { date: e.target.value })} />
                  <input
                    className="input py-1.5"
                    placeholder="הערה (למשל מספר צ׳ק)"
                    value={r.notes}
                    onChange={(e) => setRow(i, { notes: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>
          <button className="text-sm text-navy mt-2 inline-flex items-center gap-1 hover:underline" onClick={addRow}>
            <Plus size={14} /> אמצעי תשלום נוסף
          </button>
        </div>

        <div className="flex justify-between text-sm font-semibold">
          <span>יישאר לתשלום אחרי השמירה</span>
          <span className={remaining > 0 ? 'text-red-700' : 'text-green-700'}>{shekel(remaining)}</span>
        </div>

        {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-2">
          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy ? 'שומר...' : 'שמירה'}
          </button>
          <button className="btn-outline" onClick={onClose} disabled={busy}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}
