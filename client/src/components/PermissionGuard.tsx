import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth, Permissions } from '../lib/permissions';
import { LoadingProgress } from './LoadingProgress';
import { ShieldAlert } from 'lucide-react';

/** שומר הרשאות לעמודים — מנהל (system=true) עובר תמיד, לפי הספק 5.4. */
export function PermissionGuard({ permission, children }: { permission?: keyof Permissions; children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return <LoadingProgress />;
  if (!user) return <Navigate to="/" replace />;
  if (user.role === 'מנהל') return <>{children}</>;
  if (permission && !user.permissions[permission]) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="card max-w-sm text-center">
          <ShieldAlert className="mx-auto mb-3 text-gold-dark" size={36} />
          <h2 className="text-lg font-bold text-navy mb-1">אין הרשאה</h2>
          <p className="text-sm text-slate-500">אין לך גישה למודול הזה. פנה/י למנהל המערכת.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
