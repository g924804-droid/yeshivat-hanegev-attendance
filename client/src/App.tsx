import { ReactNode, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/permissions';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PermissionGuard } from './components/PermissionGuard';
import { LoadingProgress } from './components/LoadingProgress';
import { api } from './lib/api';

import { PasswordLogin } from './pages/PasswordLogin';
import { Home } from './pages/Home';
import { Dashboard } from './pages/Dashboard';
import { MonthlyReport } from './pages/MonthlyReport';
import { AdminReports } from './pages/AdminReports';
import { StudentTracks } from './pages/StudentTracks';
import { StudentsList } from './pages/StudentsList';
import { GradesPage } from './pages/GradesPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { SchedulePage } from './pages/SchedulePage';
import { ContractsPage } from './pages/ContractsPage';
import { DisplayBoard } from './pages/DisplayBoard';

/**
 * זו אפליקציית דף-יחיד (SPA): מעבר בין דפים בתוך האתר לא טוען שום דבר מחדש מהשרת, אז
 * טאב שנשאר פתוח ממשיך להריץ בזיכרון את קוד ה-JS הישן שנטען כשהיא פתחה אותו — גם אחרי
 * שאני מתקנת ומעלה גרסה חדשה. זה בדיוק מה שגרם לתחושת "לא מגיב" גם אחרי שהתיקון כבר היה
 * חי בשרת. הבדיקה הזו משווה את קובץ ה-JS שכבר נטען מול מה שהשרת מגיש עכשיו, ומציעה רענון
 * ברור במקום להסתמך על שהמשתמשת תדע לעשות רענון-כפוי בעצמה.
 */
function NewVersionBanner() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const currentScript = document.querySelector('script[src*="/assets/index-"]')?.getAttribute('src');
    if (!currentScript) return;

    async function check() {
      try {
        const res = await fetch('/', { cache: 'no-store' });
        const html = await res.text();
        const match = html.match(/\/assets\/index-[a-zA-Z0-9]+\.js/);
        if (match && match[0] !== currentScript) setAvailable(true);
      } catch {
        /* בעיית רשת זמנית — לא קשור לגרסה, מתעלמים */
      }
    }

    const interval = setInterval(check, 60000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  if (!available) return null;
  return (
    <div className="fixed top-0 inset-x-0 z-50 bg-amber-500 text-white text-sm py-2 px-4 flex items-center justify-center gap-3 shadow-md">
      <span>עודכנה גרסה חדשה של המערכת — יש לרענן כדי שהעדכונים ייכנסו לתוקף</span>
      <button
        onClick={() => window.location.reload()}
        className="bg-white text-amber-700 font-bold rounded-lg px-3 py-1 hover:bg-amber-50"
      >
        רענון עכשיו
      </button>
    </div>
  );
}

function RequireNoPendingContracts({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const [pending, setPending] = useState<boolean | null>(null);

  useEffect(() => {
    // מנהל רואה שיש חוזה ממתין (בעמוד הבית/בניהול) אבל אף פעם לא נחסם משימוש במערכת.
    if (user?.role === 'מנהל') {
      setPending(false);
      return;
    }
    api
      .get<{ contracts: { status: string }[] }>('/contracts/getContracts')
      .then((r) => setPending(r.contracts.some((c) => c.status === 'ממתין לחתימה')))
      .catch(() => setPending(false));
  }, [location.pathname, user?.role]);

  if (pending === null) return <LoadingProgress />;
  if (pending) return <ContractsPage forced />;
  return <>{children}</>;
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'מנהל' && !user.isAttendanceManager) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // מסך התצוגה הציבורי (מערכת שעות + הודעות למסך גדול) פתוח בלי התחברות בכוונה.
  if (location.pathname === '/display') return <DisplayBoard />;

  if (loading) return <LoadingProgress />;
  if (!user) return <PasswordLogin />;

  return (
    <Routes>
      <Route path="/contracts" element={<ContractsPage />} />
      <Route
        path="/*"
        element={
          <RequireNoPendingContracts>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route
                path="/attendance"
                element={
                  <PermissionGuard permission="teacherAttendance">
                    <Dashboard />
                  </PermissionGuard>
                }
              />
              <Route
                path="/report/:month"
                element={
                  <PermissionGuard permission="teacherAttendance">
                    <MonthlyReport />
                  </PermissionGuard>
                }
              />
              <Route
                path="/admin"
                element={
                  <AdminOnly>
                    <AdminReports />
                  </AdminOnly>
                }
              />
              <Route
                path="/students"
                element={
                  <PermissionGuard permission="studentAttendance">
                    <StudentTracks />
                  </PermissionGuard>
                }
              />
              <Route
                path="/students/:trackId"
                element={
                  <PermissionGuard permission="studentAttendance">
                    <StudentsList />
                  </PermissionGuard>
                }
              />
              <Route
                path="/grades"
                element={
                  <PermissionGuard permission="grades">
                    <GradesPage />
                  </PermissionGuard>
                }
              />
              <Route
                path="/payments"
                element={
                  <PermissionGuard permission="payments">
                    <PaymentsPage />
                  </PermissionGuard>
                }
              />
              <Route
                path="/schedule"
                element={
                  <PermissionGuard permission="system">
                    <SchedulePage />
                  </PermissionGuard>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </RequireNoPendingContracts>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <NewVersionBanner />
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ErrorBoundary>
  );
}
