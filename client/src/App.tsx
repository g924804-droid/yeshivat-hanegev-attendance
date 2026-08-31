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
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ErrorBoundary>
  );
}
