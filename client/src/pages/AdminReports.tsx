import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Download, RefreshCw, Users, FileText, Receipt, Trash2, Plus } from 'lucide-react';
import { Layout } from '../components/Layout';
import { api } from '../lib/api';
import { currentMonth, safeFixed } from '../lib/utils';

type ReportRow = {
  id: string;
  month: string;
  status: 'טיוטה' | 'הוגש' | 'אושר';
  totalHours: number;
  totalOvertime: number;
  sickDays: number;
  vacationDays: number;
  absenceDays: number;
  employee: { id: string; name: string; department: string | null };
};

type Employee = {
  id: string;
  name: string;
  role: string;
  department: string | null;
  isActive: boolean;
  email: string | null;
};

type ReceiptRow = {
  id: string;
  description: string;
  amount: number;
  status: string;
  month: string;
  fileName: string | null;
  employee: { name: string };
};

const TABS = ['reports', 'employees', 'receipts', 'sync'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { reports: 'דוחות', employees: 'עובדים', receipts: 'קבלות', sync: 'סנכרון' };

export function AdminReports() {
  const [tab, setTab] = useState<Tab>('reports');

  return (
    <Layout title="ניהול">
      <div className="flex gap-2 mb-6 border-b">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-gold text-navy' : 'border-transparent text-slate-400 hover:text-navy'
            }`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === 'reports' && <ReportsTab />}
      {tab === 'employees' && <EmployeesTab />}
      {tab === 'receipts' && <ReceiptsTab />}
      {tab === 'sync' && <SyncTab />}
    </Layout>
  );
}

function ReportsTab() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(currentMonth());
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [missing, setMissing] = useState<{ id: string; name: string }[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await api.get<{ reports: ReportRow[]; missingEmployees: any[]; summary: any }>(
      '/reports/getAllReports',
      { month }
    );
    setReports(data.reports);
    setMissing(data.missingEmployees);
    setSummary(data.summary);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function approve(id: string) {
    await api.post('/reports/approveReport', { reportId: id });
    await load();
  }

  async function exportSummary() {
    setBusy(true);
    try {
      const r = await api.get<{ url: string }>('/reports/exportSummaryPdf', { month });
      window.open(r.url, '_blank');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input w-auto" />
        <button className="btn-outline" onClick={exportSummary} disabled={busy}>
          <Download size={16} /> ייצוא סיכום PDF
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            ['סה"כ עובדים', summary.totalEmployees],
            ['הוגשו', summary.submitted],
            ['אושרו', summary.approved],
            ['חסרים', summary.missing],
          ].map(([l, v]) => (
            <div key={l as string} className="card text-center py-4">
              <p className="text-slate-500 text-xs mb-1">{l}</p>
              <p className="text-xl font-bold text-navy">{v}</p>
            </div>
          ))}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm text-center">
          <thead>
            <tr className="text-slate-500 border-b">
              <th className="py-2">שם</th>
              <th>מחלקה</th>
              <th>סטטוס</th>
              <th>שעות</th>
              <th>עודפות</th>
              <th>מחלה</th>
              <th>חופשה</th>
              <th>היעדרות</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-slate-50">
                <td className="py-2">{r.employee.name}</td>
                <td>{r.employee.department || '—'}</td>
                <td>{r.status}</td>
                <td>{safeFixed(r.totalHours)}</td>
                <td>{safeFixed(r.totalOvertime)}</td>
                <td>{r.sickDays}</td>
                <td>{r.vacationDays}</td>
                <td>{r.absenceDays}</td>
                <td className="flex gap-1 justify-center py-1">
                  <button className="btn-outline text-xs py-1 px-2" onClick={() => navigate(`/report/${month}`)}>
                    צפייה
                  </button>
                  {r.status === 'הוגש' && (
                    <button className="btn-gold text-xs py-1 px-2" onClick={() => approve(r.id)}>
                      <CheckCircle2 size={14} /> אשר
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {missing.length > 0 && (
          <p className="text-amber-700 text-sm mt-4">חסרים דוח: {missing.map((m) => m.name).join(', ')}</p>
        )}
      </div>
    </div>
  );
}

function EmployeesTab() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  async function load() {
    const data = await api.get<{ employees: Employee[] }>('/employees/getEmployees');
    setEmployees(data.employees);
  }
  useEffect(() => {
    load();
  }, []);

  async function remove(id: string) {
    if (!confirm('למחוק עובד? פעולה זו תמחק גם את כל הנתונים המשויכים אליו.')) return;
    await api.delete('/employees/deleteEmployee', { id });
    await load();
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button className="btn-primary" onClick={() => setShowAdd(true)}>
          <Plus size={16} /> הוספת עובד
        </button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm text-center">
          <thead>
            <tr className="text-slate-500 border-b">
              <th className="py-2"><Users size={14} className="inline" /> שם</th>
              <th>תפקיד</th>
              <th>מחלקה</th>
              <th>פעיל</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id} className="border-b last:border-0 hover:bg-slate-50">
                <td className="py-2">{e.name}</td>
                <td>{e.role}</td>
                <td>{e.department || '—'}</td>
                <td>{e.isActive ? 'כן' : 'לא'}</td>
                <td>
                  <button onClick={() => remove(e.id)} className="p-1.5 rounded-lg hover:bg-red-100 text-red-600">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showAdd && (
        <AddEmployeeModal
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function AddEmployeeModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', role: 'עובד', department: '', dailyRequiredHours: 8 });
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.post('/employees/addEmployee', form);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-3">
        <h3 className="font-bold text-navy text-lg">הוספת עובד</h3>
        <input className="input" placeholder="שם מלא" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input" placeholder="אימייל" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="עובד">עובד</option>
          <option value="מורה">מורה</option>
          <option value="מנהל">מנהל</option>
        </select>
        <select className="input" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
          <option value="">מחלקה</option>
          <option>ישיבה קטנה</option>
          <option>ישיבה גדולה</option>
          <option>תיכון</option>
          <option>סמינר</option>
          <option>ניהול</option>
        </select>
        <div>
          <label className="label">שעות יומיות נדרשות</label>
          <input
            type="number"
            className="input"
            value={form.dailyRequiredHours}
            onChange={(e) => setForm({ ...form, dailyRequiredHours: Number(e.target.value) })}
          />
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-outline" onClick={onClose}>ביטול</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !form.name}>שמירה</button>
        </div>
      </div>
    </div>
  );
}

function ReceiptsTab() {
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);

  async function load() {
    const data = await api.get<{ receipts: ReceiptRow[] }>('/receipts/getAllReceipts');
    setReceipts(data.receipts);
  }
  useEffect(() => {
    load();
  }, []);

  async function updateStatus(id: string, status: string) {
    await api.put('/receipts/updateReceiptStatus', { id, status });
    await load();
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm text-center">
        <thead>
          <tr className="text-slate-500 border-b">
            <th className="py-2"><Receipt size={14} className="inline" /> תיאור</th>
            <th>עובד</th>
            <th>חודש</th>
            <th>סכום</th>
            <th>סטטוס</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((r) => (
            <tr key={r.id} className="border-b last:border-0 hover:bg-slate-50">
              <td className="py-2">
                {r.description}
                {r.fileName && (
                  <>
                    {' '}
                    <a href={`/api/receipts/${r.id}/file`} target="_blank" rel="noreferrer" className="text-navy underline text-xs">
                      (קובץ)
                    </a>
                  </>
                )}
              </td>
              <td>{r.employee.name}</td>
              <td>{r.month}</td>
              <td>{r.amount} ₪</td>
              <td>{r.status}</td>
              <td className="flex gap-1 justify-center py-1">
                <button className="btn-gold text-xs py-1 px-2" onClick={() => updateStatus(r.id, 'אושר')}>
                  אישור
                </button>
                <button className="btn-danger text-xs py-1 px-2" onClick={() => updateStatus(r.id, 'נדחה')}>
                  דחייה
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {receipts.length === 0 && <p className="text-center text-slate-400 py-6">אין קבלות</p>}
    </div>
  );
}

function SyncTab() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function sync() {
    setBusy(true);
    setResult(null);
    try {
      const r = await api.post('/sync/syncAttendanceToAirtable', { syncType: 'all' });
      setResult(r);
    } catch (err: any) {
      setResult({ error: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card max-w-lg">
      <h3 className="font-bold text-navy mb-3 flex items-center gap-2">
        <FileText size={18} /> סנכרון מלא ל-Airtable
      </h3>
      <p className="text-sm text-slate-500 mb-4">מסנכרן נוכחות, דוחות, קבלות ועובדים לפי מזהה מערכת (upsert).</p>
      <button className="btn-primary" onClick={sync} disabled={busy}>
        <RefreshCw size={16} className={busy ? 'animate-spin' : ''} /> {busy ? 'מסנכרן...' : 'סנכרון עכשיו'}
      </button>
      {result && (
        <pre className="mt-4 bg-slate-50 rounded-xl p-3 text-xs overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
