import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Clock,
  Users,
  GraduationCap,
  Wallet,
  CalendarClock,
  FileSignature,
  ShieldCheck,
  Receipt,
  LogOut,
  FolderSearch,
  BarChart3,
  PenLine,
} from 'lucide-react';
import { useAuth } from '../lib/permissions';
import { api } from '../lib/api';
import { TimerStrip } from '../components/TimerStrip';

type ContractRow = { id: string; status: string };

export function Home() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [pendingContracts, setPendingContracts] = useState(0);
  // חודש שבו נדרשת הערכה כללית לתלמידות (ריק = לא נדרש)
  const [evaluationRequired, setEvaluationRequired] = useState(false);
  const [evaluationAdmin, setEvaluationAdmin] = useState(false);
  // הודעת ההערכה שעוד לא אושרה — נפתחת בחלון עד שלוחצים "קראתי ואני מאשרת"
  const [notice, setNotice] = useState<{ subject: string; html: string } | null>(null);
  const [acking, setAcking] = useState(false);

  useEffect(() => {
    api
      .get<{ contracts: ContractRow[] }>('/contracts/getContracts')
      .then((r) => setPendingContracts(r.contracts.filter((c) => c.status === 'ממתין לחתימה').length))
      .catch(() => {});
    api
      .get<{ month: string | null; required: boolean; needsAck: boolean; isAdmin: boolean }>('/evaluations/status')
      .then(async (r) => {
        setEvaluationRequired(r.required);
        setEvaluationAdmin(r.isAdmin);
        if (r.needsAck) setNotice(await api.get<{ subject: string; html: string }>('/evaluations/notice'));
      })
      .catch(() => {});
  }, []);

  if (!user) return null;
  const isAdmin = user.role === 'מנהל';
  const canSeeAdminButton = isAdmin || user.isAttendanceManager;

  const modules = [
    {
      to: '/evaluations',
      icon: PenLine,
      label: 'הערכה כללית',
      // למי שחייבת במילוי, ולמנהלת ההערכה (שם מפעילים ורואים מי מילאה)
      show: evaluationRequired || evaluationAdmin,
    },
    {
      to: '/attendance',
      icon: Clock,
      label: 'נוכחות מורות',
      show: user.permissions.teacherAttendance,
    },
    {
      to: '/students',
      icon: Users,
      label: 'נוכחות תלמידות',
      show: user.permissions.studentAttendance,
    },
    {
      to: '/attendance-snapshot',
      icon: BarChart3,
      label: 'תמונת מצב נוכחות',
      show: !!user.attendanceSnapshotAccess,
    },
    {
      to: '/grades',
      icon: GraduationCap,
      label: 'ציונים',
      show: user.permissions.grades,
    },
    {
      to: '/payments',
      icon: Wallet,
      label: 'תשלומים',
      show: user.permissions.payments,
    },
    {
      to: '/student-files',
      icon: FolderSearch,
      label: 'תיק תלמידה',
      show: user.permissions.payments || !!user.studentFilesAccess,
    },
    {
      to: '/schedule',
      icon: CalendarClock,
      label: 'מערכת שעות',
      show: user.permissions.system,
    },
    {
      to: '/expenses',
      icon: Receipt,
      label: 'פנקס הוצאות',
      show: !!user.permissions.expenses,
    },
    {
      to: '/contracts',
      icon: FileSignature,
      label: 'חוזים',
      show: true,
      badge: pendingContracts || undefined,
    },
  ];

  async function ackNotice() {
    setAcking(true);
    try {
      await api.post('/evaluations/ack');
      setNotice(null);
    } catch {
      setAcking(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {notice && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-3 z-50">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
            <div className="px-5 py-3 border-b font-bold text-navy">{notice.subject}</div>
            <div className="px-5 py-4 overflow-y-auto" dangerouslySetInnerHTML={{ __html: notice.html }} />
            <div className="px-5 py-3 border-t flex flex-wrap items-center gap-3">
              <button className="btn-primary" disabled={acking} onClick={ackNotice}>
                {acking ? 'שומר...' : 'קראתי ואני מאשרת'}
              </button>
              <span className="text-sm text-slate-500">ההודעה תופיע בכל כניסה עד שמאשרים.</span>
            </div>
          </div>
        </div>
      )}
      <header className="bg-navy text-white">
        <div className="max-w-5xl mx-auto px-4 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gold text-navy flex items-center justify-center text-xl font-black">
              נ
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">ישיבת הנגב</h1>
              <p className="text-slate-300 text-xs">שלום, {user.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canSeeAdminButton && (
              <button onClick={() => navigate('/admin')} className="btn-gold text-sm py-2">
                <ShieldCheck size={16} /> ניהול
              </button>
            )}
            <button
              onClick={async () => {
                await logout();
                navigate('/');
              }}
              className="p-2.5 rounded-lg hover:bg-white/10"
              title="התנתקות"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>
      <TimerStrip />

      <main className="max-w-5xl mx-auto px-4 py-8">
        <h2 className="text-slate-500 font-medium mb-4">מודולים</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {modules
            .filter((m) => m.show)
            .map((m) => (
              <Link
                key={m.to}
                to={m.to}
                className="card relative flex flex-col items-center justify-center gap-3 py-8 hover:shadow-md hover:-translate-y-0.5 transition-all"
              >
                {m.badge ? (
                  <span className="absolute top-3 left-3 badge bg-red-100 text-red-700">{m.badge}</span>
                ) : null}
                <m.icon className="text-gold-dark" size={32} />
                <span className="font-semibold text-navy">{m.label}</span>
              </Link>
            ))}
        </div>
      </main>
    </div>
  );
}
