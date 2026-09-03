import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Download, Send, CheckCircle2 } from 'lucide-react';
import { Layout } from '../components/Layout';
import { SignaturePad, SignaturePadHandle } from '../components/SignaturePad';
import { api } from '../lib/api';
import { safeFixed, DOW_HE, currentMonth } from '../lib/utils';

type Report = {
  id: string;
  month: string;
  totalWorkDays: number;
  totalHours: number;
  totalOvertime: number;
  sickDays: number;
  vacationDays: number;
  totalLessons: number;
  holidayDays: number;
  absenceDays: number;
  absenceHours: number;
  specialRateHours: number;
  status: 'טיוטה' | 'הוגש' | 'אושר';
  pdfUrl: string | null;
};

type Day = {
  date: string;
  dayOfWeek: number;
  isSaturday: boolean;
  isFuture: boolean;
  holiday?: { name: string; type: 'full' | 'half' };
  isAbsence: boolean;
  record: {
    type: string;
    totalHours: number;
    overtimeHours: number;
    lessonsCount: number;
    notes: string | null;
    hasSpecialRate: boolean;
  } | null;
};

const STATUS_STYLE: Record<Report['status'], string> = {
  טיוטה: 'bg-slate-100 text-slate-600',
  הוגש: 'bg-amber-100 text-amber-800',
  אושר: 'bg-green-100 text-green-800',
};

export function MonthlyReport() {
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const month = params.month || currentMonth();
  // נוכח כשמנהל/ת או מזכירת נוכחות פותחים דוח של עובדת אחרת (מ"ניהול" → "צפייה") — אז גם
  // מציגים למי שייך הדוח, וגם מסתירים חתימה/הגשה כדי שלא "יחתמו" בטעות במקום העובדת עצמה.
  const targetUserId = searchParams.get('userId') || undefined;
  const [report, setReport] = useState<Report | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [employeeName, setEmployeeName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sigRef = useRef<SignaturePadHandle>(null);

  async function load() {
    const data = await api.get<{ report: Report; days: Day[]; employeeName: string }>('/reports/getMonthlyReport', {
      month,
      ...(targetUserId ? { userId: targetUserId } : {}),
    });
    setReport(data.report);
    setDays(data.days);
    setEmployeeName(data.employeeName);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, targetUserId]);

  async function submit() {
    setError(null);
    setNotice(null);
    const dataUrl = sigRef.current?.getDataUrl();
    if (!dataUrl) {
      setError('יש לחתום לפני ההגשה');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<{ warning?: string }>('/reports/submitMonthlyReport', {
        reportId: report!.id,
        signatureDataUrl: dataUrl,
      });
      if (r.warning) setNotice(r.warning);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function exportPdf() {
    setBusy(true);
    try {
      const dataUrl = sigRef.current?.getDataUrl();
      const r = await api.post<{ url: string }>('/reports/exportReportPdf', {
        reportId: report!.id,
        signatureDataUrl: dataUrl || undefined,
      });
      window.open(r.url, '_blank');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!report) return <Layout title="דוח חודשי">טוען...</Layout>;

  return (
    <Layout title={`דוח חודשי — ${month}${employeeName && targetUserId ? ` — ${employeeName}` : ''}`}>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate(-1)} className="btn-outline text-sm py-2">
          חזרה
        </button>
        <span className={`badge ${STATUS_STYLE[report.status]}`}>{report.status}</span>
      </div>
      {targetUserId && (
        <div className="mb-4 text-sm bg-blue-50 text-blue-800 rounded-xl px-4 py-2">
          צפייה בדוח של {employeeName} — חתימה והגשה זמינות רק לעובדת עצמה
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          ['ימי עבודה', report.totalWorkDays],
          ['סה"כ שעות', safeFixed(report.totalHours)],
          ['שעות עודפות', safeFixed(report.totalOvertime)],
          ['ימי מחלה', report.sickDays],
          ['ימי חופשה', report.vacationDays],
          ['ימי חג', report.holidayDays],
          ['ימי היעדרות', report.absenceDays],
          ['שיעורים', report.totalLessons],
        ].map(([label, value]) => (
          <div key={label as string} className="card text-center py-4">
            <p className="text-slate-500 text-xs mb-1">{label}</p>
            <p className="text-xl font-bold text-navy">{value}</p>
          </div>
        ))}
        {report.specialRateHours > 0 && (
          <div className="card text-center py-4 border-2 border-black bg-amber-50 col-span-2">
            <p className="text-black text-xs mb-1 font-bold">⚠ שעות בשכר שונה מהרגיל — לתשומת לב חשבת השכר</p>
            <p className="text-xl font-black text-black">{safeFixed(report.specialRateHours)}</p>
          </div>
        )}
      </div>

      <div className="card mb-6 overflow-x-auto">
        <table className="w-full text-sm text-center">
          <thead>
            <tr className="text-slate-500 border-b">
              <th className="py-2">תאריך</th>
              <th>יום</th>
              <th>מצב</th>
              <th>שעות</th>
              <th>עודפות</th>
              <th>שיעורים</th>
            </tr>
          </thead>
          <tbody>
            {days
              .filter((d) => !d.isFuture)
              .map((d) => (
                <tr
                  key={d.date}
                  className={
                    d.holiday
                      ? 'bg-amber-50'
                      : d.isAbsence
                      ? 'bg-red-50'
                      : d.isSaturday
                      ? 'bg-slate-50 text-slate-400'
                      : ''
                  }
                >
                  <td className="py-1.5">{d.date}</td>
                  <td>{DOW_HE[d.dayOfWeek]}</td>
                  <td>{d.holiday ? d.holiday.name : d.record ? d.record.type : d.isAbsence ? 'העדרות' : d.isSaturday ? 'שבת' : '—'}</td>
                  <td>
                    {d.record ? (
                      <span className="inline-flex items-center gap-1">
                        {safeFixed(d.record.totalHours)}
                        {d.record.hasSpecialRate && (
                          <span
                            title={d.record.notes || 'שכר שונה מהרגיל'}
                            className="inline-flex items-center justify-center w-4 h-4 rounded-full border-2 border-black bg-amber-300 text-black text-[9px] font-black"
                          >
                            ₪
                          </span>
                        )}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{d.record ? safeFixed(d.record.overtimeHours) : '—'}</td>
                  <td>{d.record?.lessonsCount || '—'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {notice && <div className="mb-4 text-sm bg-amber-50 text-amber-800 rounded-xl px-4 py-2">{notice}</div>}
      {error && <div className="mb-4 text-sm bg-red-50 text-red-700 rounded-xl px-4 py-2">{error}</div>}

      {report.status === 'טיוטה' && !targetUserId ? (
        <div className="card">
          <h3 className="font-bold text-navy mb-3">חתימה והגשה</h3>
          <SignaturePad ref={sigRef} />
          <div className="flex gap-2 mt-4">
            <button className="btn-primary" onClick={submit} disabled={busy}>
              <Send size={16} /> הגשת דוח
            </button>
          </div>
        </div>
      ) : report.status === 'טיוטה' ? (
        <div className="card flex items-center gap-2 text-slate-500">
          <span>הדוח עדיין בטיוטה — {employeeName} צריכה להגיש אותו בעצמה</span>
        </div>
      ) : (
        <div className="card flex items-center justify-between">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 size={20} />
            <span>הדוח {report.status === 'אושר' ? 'אושר' : 'הוגש וממתין לאישור'}</span>
          </div>
          <button className="btn-outline" onClick={exportPdf} disabled={busy}>
            <Download size={16} /> ייצוא PDF
          </button>
        </div>
      )}
    </Layout>
  );
}
