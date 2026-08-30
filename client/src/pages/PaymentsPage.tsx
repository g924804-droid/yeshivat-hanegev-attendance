import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Sparkles } from 'lucide-react';
import { Layout } from '../components/Layout';
import { api } from '../lib/api';

type Payment = {
  id: string;
  fullName: string;
  month: string;
  year: string | number;
  amountDue: number;
  amountPaid: number;
  balance: number;
  status: 'Paid' | 'Unpaid' | 'Partial';
  paymentDate: string | null;
  paymentMethod: string | null;
};

const STATUS_HE: Record<string, string> = { Paid: 'שולם', Unpaid: 'לא שולם', Partial: 'חלקי' };
const STATUS_COLOR: Record<string, string> = {
  Paid: 'bg-green-100 text-green-800',
  Unpaid: 'bg-red-100 text-red-700',
  Partial: 'bg-amber-100 text-amber-800',
};

export function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await api.get<{ payments: Payment[] }>('/payments/getPayments');
    setPayments(data.payments);
  }
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(
    () => payments.filter((p) => p.fullName?.toLowerCase().includes(search.toLowerCase())),
    [payments, search]
  );

  async function generateMonthly() {
    const month = prompt('חודש (למשל: ינואר)');
    const year = prompt('שנה (למשל: 2026)');
    if (!month || !year) return;
    setBusy(true);
    try {
      const r = await api.post<{ created: number }>('/payments/generateMonthlyPayments', { month, year });
      alert(`נוצרו ${r.created} רשומות תשלום חדשות`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function markPaid(p: Payment) {
    await api.put('/payments/updatePayment', {
      id: p.id,
      status: 'Paid',
      amountPaid: p.amountDue,
      paymentDate: new Date().toISOString().slice(0, 10),
    });
    await load();
  }

  return (
    <Layout title="תשלומים">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="relative max-w-xs">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input className="input pr-9" placeholder="חיפוש לפי שם" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button className="btn-outline" onClick={generateMonthly} disabled={busy}>
            <Sparkles size={16} /> יצירת תשלומים חודשיים
          </button>
          <button className="btn-primary" onClick={() => setShowAdd(true)}>
            <Plus size={16} /> רישום תשלום
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm text-center">
          <thead>
            <tr className="text-slate-500 border-b">
              <th className="py-2">שם</th>
              <th>חודש/שנה</th>
              <th>לתשלום</th>
              <th>שולם</th>
              <th>יתרה</th>
              <th>סטטוס</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="border-b last:border-0 hover:bg-slate-50">
                <td className="py-2">{p.fullName}</td>
                <td>{p.month} {p.year}</td>
                <td>{p.amountDue} ₪</td>
                <td>{p.amountPaid} ₪</td>
                <td>{p.balance ?? p.amountDue - p.amountPaid} ₪</td>
                <td>
                  <span className={`badge ${STATUS_COLOR[p.status] || 'bg-slate-100 text-slate-600'}`}>
                    {STATUS_HE[p.status] || p.status}
                  </span>
                </td>
                <td>
                  {p.status !== 'Paid' && (
                    <button className="text-xs text-navy underline" onClick={() => markPaid(p)}>
                      סמן כשולם
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="text-center text-slate-400 py-6">אין תשלומים להצגה</p>}
      </div>

      {showAdd && (
        <RecordPaymentModal
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
    </Layout>
  );
}

function RecordPaymentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ fullName: '', month: '', year: new Date().getFullYear(), amountDue: 0 });
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.post('/payments/recordPayment', form);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-3">
        <h3 className="font-bold text-navy text-lg">רישום תשלום</h3>
        <input className="input" placeholder="שם מלא" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        <input className="input" placeholder="חודש" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} />
        <input type="number" className="input" placeholder="שנה" value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })} />
        <input type="number" className="input" placeholder="סכום לתשלום" value={form.amountDue} onChange={(e) => setForm({ ...form, amountDue: Number(e.target.value) })} />
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-outline" onClick={onClose}>ביטול</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !form.fullName}>שמירה</button>
        </div>
      </div>
    </div>
  );
}
