import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Download, Send, CheckCircle2, Pencil, Paperclip, Trash2, FileText } from 'lucide-react';
import { Layout } from '../components/Layout';
import { SignaturePad, SignaturePadHandle } from '../components/SignaturePad';
import { api } from '../lib/api';
import { useAuth } from '../lib/permissions';
import { DayEditModal, DayRecord } from '../components/DayEditModal';
import { safeFixed, DOW_HE, currentMonth, formatHours, academicHours } from '../lib/utils';

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
  employeeNote: string | null;
};

type Attachment = { id: string; fileName: string; fileMime: string };

type Day = {
  date: string;
  dayOfWeek: number;
  isSaturday: boolean;
  isFuture: boolean;
  holiday?: { name: string; type: 'full' | 'half' };
  isAbsence: boolean;
  record: (DayRecord & { totalHours: number; overtimeHours: number }) | null;
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
  // שעות אקדמיות (45 דק') — רק בדוח של מורה
  const [isTeacher, setIsTeacher] = useState(false);
  const [missingReceipt, setMissingReceipt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sigRef = useRef<SignaturePadHandle>(null);
  const { user } = useAuth();
  // הנהלה ומזכירת נוכחות יכולות לתקן ימים ישירות מתוך הדוח של עובדת
  const canEdit = !!targetUserId && (user?.role === 'מנהל' || !!user?.isAttendanceManager);
  const [editingDay, setEditingDay] = useState<Day | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load(recalc = false) {
    const data = await api.get<{
      report: Report;
      days: Day[];
      employeeName: string;
      employeeRole?: string;
      missingReceipt: boolean;
      attachments: Attachment[];
    }>(
      '/reports/getMonthlyReport',
      { month, ...(targetUserId ? { userId: targetUserId } : {}), ...(recalc ? { recalc: '1' } : {}) }
    );
    setReport(data.report);
    setDays(data.days);
    setEmployeeName(data.employeeName);
    setIsTeacher(data.employeeRole === 'מורה');
    setMissingReceipt(data.missingReceipt);
    setAttachments(data.attachments || []);
    setNote(data.report.employeeNote || '');
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length || !report) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        const r = await api.postForm<{ attachment: Attachment }>(`/reports/${report.id}/attachments`, fd);
        setAttachments((prev) => [...prev, r.attachment]);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeAttachment(a: Attachment) {
    if (!confirm(`להסיר את הקובץ "${a.fileName}"?`)) return;
    try {
      await api.delete(`/reports/attachments/${a.id}`);
      setAttachments((prev) => prev.filter((x) => x.id !== a.id));
    } catch (err: any) {
      setError(err.message);
    }
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
        employeeNote: note,
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
    // חייבים לפתוח את הטאב באופן מיידי וסינכרוני בתוך ה-click handler — יצירת ה-PDF לוקחת
    // כמה שניות, ואם פותחים את הטאב רק אחרי ה-await, הדפדפן כבר לא מזהה את זה כתוצאה ישירה
    // מלחיצת המשתמשת וחוסם את זה כ"פופ-אפ" בשקט, בלי שום הודעת שגיאה נראית.
    const pdfWindow = window.open('', '_blank');
    setBusy(true);
    try {
      const dataUrl = sigRef.current?.getDataUrl();
      const r = await api.post<{ url: string }>('/reports/exportReportPdf', {
        reportId: report!.id,
        signatureDataUrl: dataUrl || undefined,
      });
      if (pdfWindow) pdfWindow.location.href = r.url;
      else window.open(r.url, '_blank');
    } catch (err: any) {
      pdfWindow?.close();
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
          {canEdit && (
            <div className="mt-1">
              אפשר לתקן כל יום בלחיצה על <Pencil size={12} className="inline" /> בטבלה.
              {report.status !== 'טיוטה' && ' הדוח כבר הוגש — אחרי תיקון הסכומים יתעדכנו, והחתימה של העובדת נשארת.'}
            </div>
          )}
        </div>
      )}
      {missingReceipt && !targetUserId && (
        <div className="mb-4 text-sm bg-red-50 text-red-700 rounded-xl px-4 py-2">
          את מוגדרת כעובדת נגד קבלה — יש להעלות קבלה לחודש {month} (בעמוד "נוכחות מורות", בקטע "קבלות") לפני שאפשר להגיש את הדוח.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          ['ימי עבודה', report.totalWorkDays],
          ['סה"כ שעות', safeFixed(report.totalHours)],
          ...(isTeacher ? [["שעות אקדמיות (45 דק')", academicHours(report.totalHours)]] : []),
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
            <p className="text-xl font-black text-black">{formatHours(report.specialRateHours)}</p>
            {days
              .filter((d) => d.record?.hasSpecialRate)
              .map((d) => (
                <p key={d.date} className="text-xs text-slate-700">
                  {Number(d.date.slice(8, 10))}/{Number(d.date.slice(5, 7))}: {d.record!.notes || formatHours(d.record!.totalHours)}
                </p>
              ))}
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
              {isTeacher && <th title="שעה אקדמית = 45 דקות">אקדמיות</th>}
              <th>עודפות</th>
              <th>שיעורים</th>
              {canEdit && <th></th>}
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
                  {isTeacher && <td className="text-slate-500">{d.record ? academicHours(d.record.totalHours) : '—'}</td>}
                  <td>{d.record ? safeFixed(d.record.overtimeHours) : '—'}</td>
                  <td>{d.record?.lessonsCount || '—'}</td>
                  {canEdit && (
                    <td>
                      {!d.isSaturday && (
                        <button
                          onClick={() => setEditingDay(d)}
                          title="עריכת היום"
                          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {notice && <div className="mb-4 text-sm bg-amber-50 text-amber-800 rounded-xl px-4 py-2">{notice}</div>}
      {error && <div className="mb-4 text-sm bg-red-50 text-red-700 rounded-xl px-4 py-2">{error}</div>}

      {report.status === 'טיוטה' && !targetUserId ? (
        <div className="card">
          <h3 className="font-bold text-navy mb-3">הערה לחשבת השכר (לא חובה)</h3>
          <textarea
            className="input mb-2"
            rows={3}
            maxLength={2000}
            placeholder="למשל: בתאריך 12 עבדתי במילוי מקום, נסיעות מיוחדות, שינוי בשעות..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
              className="hidden"
              onChange={(e) => uploadFiles(e.target.files)}
            />
            <button className="btn-outline text-sm py-1.5" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Paperclip size={15} /> {uploading ? 'מעלה...' : 'צירוף קובץ'}
            </button>
            {attachments.map((a) => (
              <span key={a.id} className="badge bg-navy-50 text-navy inline-flex items-center gap-1">
                <a href={`/api/reports/attachments/${a.id}`} target="_blank" rel="noreferrer" className="hover:underline">
                  {a.fileName}
                </a>
                <button title="הסרת הקובץ" className="text-red-600 hover:text-red-800" onClick={() => removeAttachment(a)}>
                  <Trash2 size={12} />
                </button>
              </span>
            ))}
            <span className="text-xs text-slate-400">תמונה, PDF, Word או Excel — עד 10MB</span>
          </div>
          <h3 className="font-bold text-navy mb-3">חתימה והגשה</h3>
          <SignaturePad ref={sigRef} />
          <div className="flex gap-2 mt-4">
            <button className="btn-primary" onClick={submit} disabled={busy || missingReceipt} title={missingReceipt ? 'יש להעלות קבלה לחודש הזה לפני ההגשה' : ''}>
              <Send size={16} /> הגשת דוח
            </button>
          </div>
        </div>
      ) : report.status === 'טיוטה' ? (
        <div className="card flex items-center gap-2 text-slate-500">
          <span>הדוח עדיין בטיוטה — {employeeName} צריכה להגיש אותו בעצמה</span>
        </div>
      ) : (
        <>
        {(report.employeeNote || attachments.length > 0) && (
          <div className="card mb-4 border-2 border-gold/60">
            <h3 className="font-bold text-navy mb-2">הערה לחשבת השכר</h3>
            {report.employeeNote && <p className="text-sm whitespace-pre-wrap mb-2">{report.employeeNote}</p>}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((a) => (
                  <a
                    key={a.id}
                    href={`/api/reports/attachments/${a.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="badge bg-navy-50 text-navy inline-flex items-center gap-1 hover:underline"
                  >
                    <FileText size={12} /> {a.fileName}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="card flex items-center justify-between">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 size={20} />
            <span>הדוח {report.status === 'אושר' ? 'אושר' : 'הוגש וממתין לאישור'}</span>
          </div>
          <button className="btn-outline" onClick={exportPdf} disabled={busy}>
            <Download size={16} /> ייצוא PDF
          </button>
        </div>
        </>
      )}
      {editingDay && targetUserId && (
        <DayEditModal
          date={editingDay.date}
          record={editingDay.record}
          employeeId={targetUserId}
          onClose={() => setEditingDay(null)}
          onSaved={() => {
            setEditingDay(null);
            load(true);
          }}
        />
      )}
    </Layout>
  );
}
