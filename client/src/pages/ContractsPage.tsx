import { useEffect, useRef, useState } from 'react';
import { FileSignature, Upload, CheckCircle2, Clock, LogOut } from 'lucide-react';
import { Layout } from '../components/Layout';
import { SignaturePad, SignaturePadHandle } from '../components/SignaturePad';
import { api } from '../lib/api';
import { useAuth } from '../lib/permissions';

type Contract = {
  id: string;
  title: string;
  status: 'ממתין לחתימה' | 'נחתם' | 'בוטל';
  fileName: string | null;
  employee: { id: string; name: string };
  uploadedAt: string;
  signedAt: string | null;
};
type Employee = { id: string; name: string };

const STATUS_STYLE: Record<Contract['status'], string> = {
  'ממתין לחתימה': 'bg-amber-100 text-amber-800',
  נחתם: 'bg-green-100 text-green-800',
  בוטל: 'bg-slate-100 text-slate-500',
};

export function ContractsPage({ forced = false }: { forced?: boolean }) {
  const { user, refresh, logout } = useAuth();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [signingId, setSigningId] = useState<string | null>(null);

  async function load() {
    const data = await api.get<{ contracts: Contract[] }>('/contracts/getContracts');
    setContracts(data.contracts);
  }
  useEffect(() => {
    load();
  }, []);

  const pending = contracts.filter((c) => c.status === 'ממתין לחתימה');
  const isAdmin = user?.role === 'מנהל';

  const body = (
    <div>
      {forced && (
        <div className="card mb-4 bg-amber-50 border-amber-200 flex items-center gap-2 text-amber-800">
          <Clock size={18} /> יש לך חוזה הממתין לחתימה — יש לחתום כדי להמשיך להשתמש במערכת
        </div>
      )}

      {isAdmin && !forced && (
        <div className="flex justify-end mb-4">
          <button className="btn-primary" onClick={() => setShowUpload(true)}>
            <Upload size={16} /> העלאת חוזה
          </button>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        {contracts.map((c) => (
          <div key={c.id} className="card">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-navy flex items-center gap-2">
                <FileSignature size={16} className="text-gold-dark" /> {c.title}
              </span>
              <span className={`badge ${STATUS_STYLE[c.status]}`}>{c.status}</span>
            </div>
            {isAdmin && <p className="text-slate-500 text-sm mb-2">עובד: {c.employee.name}</p>}
            {c.fileName && (
              <a href={`/api/contracts/${c.id}/file`} target="_blank" rel="noreferrer" className="text-sm text-navy underline">
                צפייה בקובץ החוזה
              </a>
            )}
            {c.status === 'ממתין לחתימה' && !isAdmin && (
              <button className="btn-gold w-full mt-3" onClick={() => setSigningId(c.id)}>
                חתימה על החוזה
              </button>
            )}
            {c.status === 'נחתם' && (
              <p className="text-green-700 text-xs mt-2 flex items-center gap-1">
                <CheckCircle2 size={14} /> נחתם ב-{new Date(c.signedAt!).toLocaleDateString('he-IL')}
              </p>
            )}
          </div>
        ))}
        {contracts.length === 0 && <p className="text-slate-400 col-span-2 text-center py-10">אין חוזים</p>}
      </div>

      {showUpload && (
        <UploadContractModal
          onClose={() => setShowUpload(false)}
          onSaved={() => {
            setShowUpload(false);
            load();
          }}
        />
      )}

      {signingId && (
        <SignModal
          contractId={signingId}
          onClose={() => setSigningId(null)}
          onSigned={async () => {
            setSigningId(null);
            await load();
            await refresh();
          }}
        />
      )}
    </div>
  );

  if (forced) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="flex items-center justify-between px-4 py-3 bg-navy text-white">
          <span className="font-medium">{user?.name}</span>
          <button
            onClick={() => logout()}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg hover:bg-white/10"
          >
            <LogOut size={16} /> החלפת משתמש / התנתקות
          </button>
        </div>
        <div className="p-4 max-w-3xl mx-auto py-10">{body}</div>
      </div>
    );
  }
  return <Layout title="חוזים">{body}</Layout>;
}

function UploadContractModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ employees: Employee[] }>('/employees/getEmployees').then((r) => setEmployees(r.employees));
  }, []);

  async function submit() {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('title', title);
      fd.append('employeeId', employeeId);
      if (fileRef.current?.files?.[0]) fd.append('contractFile', fileRef.current.files[0]);
      await api.postForm('/contracts/uploadContract', fd);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-3">
        <h3 className="font-bold text-navy text-lg">העלאת חוזה</h3>
        <input className="input" placeholder="כותרת החוזה" value={title} onChange={(e) => setTitle(e.target.value)} />
        <select className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">בחר/י עובד</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <input ref={fileRef} type="file" accept="application/pdf" className="input" />
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-outline" onClick={onClose}>ביטול</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !title || !employeeId}>העלאה</button>
        </div>
      </div>
    </div>
  );
}

function SignModal({ contractId, onClose, onSigned }: { contractId: string; onClose: () => void; onSigned: () => void }) {
  const sigRef = useRef<SignaturePadHandle>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const dataUrl = sigRef.current?.getDataUrl();
    if (!dataUrl) {
      setError('יש לחתום לפני האישור');
      return;
    }
    setBusy(true);
    try {
      await api.post('/contracts/signContract', { contractId, signatureDataUrl: dataUrl });
      onSigned();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-3">
        <h3 className="font-bold text-navy text-lg">חתימה על החוזה</h3>
        <SignaturePad ref={sigRef} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-outline" onClick={onClose}>ביטול</button>
          <button className="btn-gold" onClick={submit} disabled={busy}>אישור וחתימה</button>
        </div>
      </div>
    </div>
  );
}
