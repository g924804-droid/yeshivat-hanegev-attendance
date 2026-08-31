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
  LogOut,
} from 'lucide-react';
import { useAuth } from '../lib/permissions';
import { api } from '../lib/api';

type ContractRow = { id: string; status: string };

export function Home() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [pendingContracts, setPendingContracts] = useState(0);

  useEffect(() => {
    api
      .get<{ contracts: ContractRow[] }>('/contracts/getContracts')
      .then((r) => setPendingContracts(r.contracts.filter((c) => c.status === 'ממתין לחתימה').length))
      .catch(() => {});
  }, []);

  if (!user) return null;
  const isAdmin = user.role === 'מנהל';
  const canSeeAdminButton = isAdmin || user.isAttendanceManager;

  const modules = [
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
      to: '/schedule',
      icon: CalendarClock,
      label: 'מערכת שעות',
      show: user.permissions.system,
    },
    {
      to: '/contracts',
      icon: FileSignature,
      label: 'חוזים',
      show: true,
      badge: pendingContracts || undefined,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
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
