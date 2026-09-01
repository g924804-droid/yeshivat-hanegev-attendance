import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, LogOut as LogOutIcon, Plus, Trash2, Pencil, FileBarChart, Save, X, Receipt } from 'lucide-react';
import { Layout } from '../components/Layout';
import { api } from '../lib/api';
import { useAuth } from '../lib/permissions';
import { cn, currentMonth, safeFixed, todayStr, DOW_HE } from '../lib/utils';

type AttendanceRecord = {
  id: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  clockIn2: string | null;
  clockOut2: string | null;
  totalHours: number;
  overtimeHours: number;
  lessonsCount: number;
  type: string;
  notes: string | null;
  sickNoteUrl: string | null;
};

type Holiday = { date: string; name: string; type: 'full' | 'half' };

const TYPE_OPTIONS = ['רגיל', 'מחלה', 'חופשה שנתית', 'חופשה אישית', 'חג', 'חצי יום'];

/** רשומת "טיוטה" ליום שעדיין אין לו רשומה בכלל — id ריק מסמן ל-EditRow וליצירה בשרת שמדובר ביצירה, לא עדכון. */
function draftAttendanceRecord(date: string): AttendanceRecord {
  return {
    id: '',
    date,
    clockIn: null,
    clockOut: null,
    clockIn2: null,
    clockOut2: null,
    totalHours: 0,
    overtimeHours: 0,
    lessonsCount: 0,
    type: 'רגיל',
    notes: null,
    sickNoteUrl: null,
  };
}

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [month, setMonth] = useState(currentMonth());
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAbsence, setShowAbsence] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // "מזכירת נוכחות" (או מנהל) יכולה למלא נוכחות עבור עובדת אחרת — למשל מורה מחליפה/מבוגרת
  // שלא ממלאת בעצמה. בררת מחדל: הנוכחות של המשתמשת המחוברת עצמה.
  const canManageOthers = user?.role === 'מנהל' || !!user?.isAttendanceManager;
  const [employeeList, setEmployeeList] = useState<{ id: string; name: string }[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const targetUserId = canManageOthers && selectedEmployeeId ? selectedEmployeeId : undefined;

  useEffect(() => {
    if (!canManageOthers) return;
    api
      .get<{ employees: { id: string; name: string }[] }>('/employees/getEmployeeNames')
      .then((d) => setEmployeeList(d.employees))
      .catch(() => {});
  }, [canManageOthers]);

  async function load() {
    setLoading(true);
    try {
      const data = await api.get<{ records: AttendanceRecord[]; holidays: Holiday[] }>('/attendance/getMyAttendance', {
        month,
        ...(targetUserId ? { userId: targetUserId } : {}),
      });
      setRecords(data.records);
      setHolidays(data.holidays);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, targetUserId]);

  const today = todayStr();
  const todayRecord = records.find((r) => r.date === today);

  // כל ימי החודש (כולל עתידיים, למשל חופשה מתוכננת מראש) — לא רק ימים שכבר יש להם רשומה,
  // כדי שאפשר יהיה ללחוץ על העט ולמלא נוכחות רטרואקטיבית/מראש גם ליום שעדיין ריק.
  const monthDays = useMemo(() => {
    const [year, monthNum] = month.split('-').map(Number);
    const daysInMonth = new Date(year, monthNum, 0).getDate();
    const days: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      days.push(`${month}-${String(d).padStart(2, '0')}`);
    }
    return days;
  }, [month]);

  const clockState: 'in1' | 'out1' | 'in2' | 'out2' | 'done' = useMemo(() => {
    if (!todayRecord) return 'in1';
    if (todayRecord.clockIn && !todayRecord.clockOut) return 'out1';
    if (todayRecord.clockIn && todayRecord.clockOut && !todayRecord.clockIn2) return 'in2';
    if (todayRecord.clockIn2 && !todayRecord.clockOut2) return 'out2';
    return 'done';
  }, [todayRecord]);

  async function handleClock() {
    setError(null);
    setNotice(null);
    try {
      const now = new Date().toTimeString().slice(0, 5);
      if (clockState === 'in1' || clockState === 'in2') {
        await api.post('/attendance/clockIn', { date: today, clockIn: now, ...(targetUserId ? { userId: targetUserId } : {}) });
      } else if (clockState === 'out1' || clockState === 'out2') {
        await api.post('/attendance/clockOut', { recordId: todayRecord!.id, clockOut: now });
      }
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function deleteRecord(id: string) {
    if (!confirm('למחוק את הרשומה?')) return;
    try {
      await api.delete('/attendance/deleteAttendance', { recordId: id });
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  const totalHours = records.reduce((s, r) => s + (r.type === 'רגיל' ? r.totalHours : 0), 0);
  const totalOvertime = records.reduce((s, r) => s + r.overtimeHours, 0);

  const clockLabel: Record<typeof clockState, string> = {
    in1: 'כניסה',
    out1: 'יציאה',
    in2: 'כניסה (משמרת 2)',
    out2: 'יציאה (משמרת 2)',
    done: 'היום הושלם',
  };

  return (
    <Layout title="נוכחות מורות">
      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <div className="card md:col-span-2 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <p className="text-slate-500 text-sm">שעון נוכחות — היום</p>
            <p className="text-2xl font-bold text-navy">{today}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleClock}
              disabled={clockState === 'done'}
              className={cn(clockState.startsWith('in') ? 'btn-primary' : 'btn-gold')}
            >
              {clockState.startsWith('in') ? <LogIn size={18} /> : <LogOutIcon size={18} />}
              {clockLabel[clockState]}
            </button>
            <button className="btn-outline" onClick={() => setShowAbsence(true)}>
              <Plus size={18} /> מחלה/חופשה
            </button>
          </div>
        </div>
        <button
          onClick={() => navigate(`/report/${month}`)}
          className="card flex flex-col items-center justify-center gap-2 hover:shadow-md transition-shadow"
        >
          <FileBarChart className="text-gold-dark" size={28} />
          <span className="font-semibold text-navy">דוח חודשי</span>
        </button>
      </div>

      {notice && <div className="mb-4 text-sm bg-amber-50 text-amber-800 rounded-xl px-4 py-2">{notice}</div>}
      {error && <div className="mb-4 text-sm bg-red-50 text-red-700 rounded-xl px-4 py-2">{error}</div>}

      <div className="card">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="font-bold text-navy">
            טבלת נוכחות חודשית {canManageOthers && selectedEmployeeId ? `— ${employeeList.find((e) => e.id === selectedEmployeeId)?.name || ''}` : ''}
          </h3>
          <div className="flex items-center gap-2">
            {canManageOthers && (
              <select
                className="input w-auto"
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
              >
                <option value="">הנוכחות שלי</option>
                {employeeList.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            )}
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input w-auto" />
          </div>
        </div>

        <div className="flex gap-4 mb-4 text-sm">
          <div className="text-slate-500">
            סה"כ שעות: <span className="font-bold text-navy">{safeFixed(totalHours)}</span>
          </div>
          <div className="text-slate-500">
            שעות עודפות: <span className="font-bold text-navy">{safeFixed(totalOvertime)}</span>
          </div>
        </div>

        {loading ? (
          <p className="text-slate-400 text-sm py-8 text-center">טוען...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-center">
              <thead>
                <tr className="text-slate-500 border-b">
                  <th className="py-2">תאריך</th>
                  <th>יום</th>
                  <th>סוג</th>
                  <th>כניסה 1</th>
                  <th>יציאה 1</th>
                  <th>כניסה 2</th>
                  <th>יציאה 2</th>
                  <th>שעות</th>
                  <th>עודפות</th>
                  <th>שיעורים</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {monthDays.map((date) => {
                  const dow = DOW_HE[new Date(`${date}T00:00:00`).getDay()];
                  const record = records.find((r) => r.date === date);
                  const holiday = holidays.find((h) => h.date === date);
                  const editKey = record?.id || date;

                  if (editingId === editKey) {
                    return (
                      <EditRow
                        key={editKey}
                        record={record || draftAttendanceRecord(date)}
                        employeeId={targetUserId}
                        onCancel={() => setEditingId(null)}
                        onSaved={() => { setEditingId(null); load(); }}
                      />
                    );
                  }

                  if (record) {
                    return (
                      <tr key={date} className="border-b last:border-0 hover:bg-slate-50">
                        <td className="py-2">{record.date}</td>
                        <td>{dow}</td>
                        <td>{record.type}</td>
                        <td>{record.clockIn || '—'}</td>
                        <td>{record.clockOut || '—'}</td>
                        <td>{record.clockIn2 || '—'}</td>
                        <td>{record.clockOut2 || '—'}</td>
                        <td>{safeFixed(record.totalHours)}</td>
                        <td>{safeFixed(record.overtimeHours)}</td>
                        <td>{record.lessonsCount}</td>
                        <td>
                          <div className="flex gap-1 justify-center">
                            <button onClick={() => setEditingId(record.id)} className="p-1.5 rounded-lg hover:bg-slate-200">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => deleteRecord(record.id)} className="p-1.5 rounded-lg hover:bg-red-100 text-red-600">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  if (holiday) {
                    return (
                      <tr key={date} className="bg-amber-50 text-amber-800">
                        <td className="py-2">{date}</td>
                        <td>{dow}</td>
                        <td colSpan={8}>{holiday.name} {holiday.type === 'half' ? '(חצי יום)' : ''}</td>
                        <td>
                          <button onClick={() => setEditingId(date)} className="p-1.5 rounded-lg hover:bg-amber-100">
                            <Pencil size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  }

                  // אין רשומה ואין חג — יום ריק; העט פותח מילוי רטרואקטיבי במקום רק לאפשר עריכה של מה שכבר קיים.
                  return (
                    <tr key={date} className="border-b last:border-0 text-slate-300">
                      <td className="py-2">{date}</td>
                      <td>{dow}</td>
                      <td colSpan={8}>—</td>
                      <td>
                        <button onClick={() => setEditingId(date)} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500">
                          <Pencil size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {records.length === 0 && <p className="text-center text-slate-400 py-6">אין רשומות החודש</p>}
          </div>
        )}
      </div>

      <ProfileCard />
      <ReceiptsCard />

      {showAbsence && (
        <AbsenceModal
          employeeId={targetUserId}
          onClose={() => setShowAbsence(false)}
          onSaved={() => {
            setShowAbsence(false);
            load();
          }}
        />
      )}
    </Layout>
  );
}

function EditRow({
  record,
  employeeId,
  onCancel,
  onSaved,
}: {
  record: AttendanceRecord;
  employeeId?: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(record);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.put('/attendance/updateAttendance', {
        recordId: record.id,
        ...form,
        ...(employeeId ? { userId: employeeId } : {}),
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="bg-slate-50">
      <td className="py-2">{record.date}</td>
      <td>{DOW_HE[new Date(`${record.date}T00:00:00`).getDay()]}</td>
      <td>
        <select className="input py-1 text-xs" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          {TYPE_OPTIONS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </td>
      {(['clockIn', 'clockOut', 'clockIn2', 'clockOut2'] as const).map((f) => (
        <td key={f}>
          <input
            type="time"
            className="input py-1 text-xs"
            value={form[f] || ''}
            onChange={(e) => setForm({ ...form, [f]: e.target.value })}
          />
        </td>
      ))}
      <td colSpan={2} className="text-slate-400 text-xs">מחושב אוטומטית</td>
      <td>
        <input
          type="number"
          className="input py-1 text-xs w-16"
          value={form.lessonsCount}
          onChange={(e) => setForm({ ...form, lessonsCount: Number(e.target.value) })}
        />
      </td>
      <td>
        <div className="flex gap-1 justify-center">
          <button onClick={save} disabled={saving} className="p-1.5 rounded-lg hover:bg-green-100 text-green-700">
            <Save size={14} />
          </button>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-slate-200">
            <X size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function AbsenceModal({
  employeeId,
  onClose,
  onSaved,
}: {
  employeeId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(todayStr());
  const [type, setType] = useState<'מחלה' | 'חופשה שנתית' | 'חופשה אישית'>('חופשה שנתית');
  const [notes, setNotes] = useState('');
  const [sickNoteUrl, setSickNoteUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await api.post('/attendance/addSickDay', {
        date,
        type,
        notes,
        sickNoteUrl: sickNoteUrl || undefined,
        ...(employeeId ? { userId: employeeId } : {}),
      });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4">
        <h3 className="font-bold text-navy text-lg">הוספת מחלה / חופשה</h3>
        <div>
          <label className="label">תאריך</label>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="label">סוג</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="חופשה שנתית">חופשה שנתית</option>
            <option value="חופשה אישית">חופשה אישית</option>
            <option value="מחלה">מחלה</option>
          </select>
        </div>
        {type === 'מחלה' && (
          <div>
            <label className="label">קישור לאישור מחלה</label>
            <input
              className="input"
              placeholder="https://..."
              value={sickNoteUrl}
              onChange={(e) => setSickNoteUrl(e.target.value)}
            />
          </div>
        )}
        <div>
          <label className="label">הערות</label>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button className="btn-outline" onClick={onClose}>
            ביטול
          </button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            שמירה
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfileCard() {
  const { user, refresh } = useAuth();
  const [form, setForm] = useState({ idNumber: '', dailyTravelCost: '', monthlyBusPass: '' });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    setForm({
      idNumber: user.idNumber || '',
      dailyTravelCost: user.dailyTravelCost != null ? String(user.dailyTravelCost) : '',
      monthlyBusPass: user.monthlyBusPass != null ? String(user.monthlyBusPass) : '',
    });
  }, [user]);

  async function save() {
    await api.put('/employees/updateMyProfile', {
      idNumber: form.idNumber || undefined,
      dailyTravelCost: form.dailyTravelCost ? Number(form.dailyTravelCost) : undefined,
      monthlyBusPass: form.monthlyBusPass ? Number(form.monthlyBusPass) : undefined,
    });
    await refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="card mt-6">
      <h3 className="font-bold text-navy mb-4">פרטי פרופיל</h3>
      <div className="grid sm:grid-cols-3 gap-4">
        <div>
          <label className="label">תעודת זהות</label>
          <input className="input" value={form.idNumber} onChange={(e) => setForm({ ...form, idNumber: e.target.value })} />
        </div>
        <div>
          <label className="label">עלות נסיעה יומית (₪)</label>
          <input
            type="number"
            className="input"
            value={form.dailyTravelCost}
            onChange={(e) => setForm({ ...form, dailyTravelCost: e.target.value })}
          />
        </div>
        <div>
          <label className="label">חופשי חודשי (₪)</label>
          <input
            type="number"
            className="input"
            value={form.monthlyBusPass}
            onChange={(e) => setForm({ ...form, monthlyBusPass: e.target.value })}
          />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button className="btn-primary" onClick={save}>
          שמירת פרופיל
        </button>
        {saved && <span className="text-green-600 text-sm">נשמר בהצלחה</span>}
      </div>
    </div>
  );
}

type ReceiptRow = {
  id: string;
  description: string;
  amount: number;
  month: string;
  receiptDate: string;
  status: 'ממתין' | 'אושר' | 'נדחה';
  fileName: string | null;
};

const RECEIPT_STATUS_STYLE: Record<ReceiptRow['status'], string> = {
  ממתין: 'bg-slate-100 text-slate-600',
  אושר: 'bg-green-100 text-green-800',
  נדחה: 'bg-red-100 text-red-700',
};

function ReceiptsCard() {
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  async function load() {
    const data = await api.get<{ receipts: ReceiptRow[] }>('/receipts/getMyReceipts');
    setReceipts(data.receipts);
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="card mt-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-navy flex items-center gap-2">
          <Receipt size={18} className="text-gold-dark" /> קבלות
        </h3>
        <button className="btn-outline text-sm py-2" onClick={() => setShowAdd(true)}>
          <Plus size={16} /> הגשת קבלה
        </button>
      </div>
      <div className="space-y-2">
        {receipts.map((r) => (
          <div key={r.id} className="flex items-center justify-between text-sm border-b last:border-0 pb-2">
            <div>
              <p className="font-medium">{r.description}</p>
              <p className="text-slate-400 text-xs">
                {r.month} · {r.amount} ₪
                {r.fileName && (
                  <>
                    {' · '}
                    <a href={`/api/receipts/${r.id}/file`} target="_blank" rel="noreferrer" className="underline text-navy">
                      קובץ מצורף
                    </a>
                  </>
                )}
              </p>
            </div>
            <span className={`badge ${RECEIPT_STATUS_STYLE[r.status]}`}>{r.status}</span>
          </div>
        ))}
        {receipts.length === 0 && <p className="text-slate-400 text-sm text-center py-4">אין קבלות שהוגשו</p>}
      </div>

      {showAdd && (
        <AddReceiptModal
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

function AddReceiptModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('description', description);
      fd.append('amount', amount);
      fd.append('month', currentMonth());
      fd.append('receiptDate', todayStr());
      if (file) fd.append('receiptFile', file);
      await api.postForm('/receipts/submitReceipt', fd);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-3">
        <h3 className="font-bold text-navy text-lg">הגשת קבלה</h3>
        <input className="input" placeholder="תיאור" value={description} onChange={(e) => setDescription(e.target.value)} />
        <input type="number" className="input" placeholder="סכום (₪)" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input type="file" className="input" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-outline" onClick={onClose}>ביטול</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !description || !amount}>שליחה</button>
        </div>
      </div>
    </div>
  );
}
