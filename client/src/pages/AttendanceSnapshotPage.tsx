import { Navigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { AttendanceSnapshotTab } from '../components/AttendanceSnapshotTab';
import { useAuth } from '../lib/permissions';

/** תמונת מצב נוכחות תלמידות — למנהלות ולמזכירות נוכחות (אריח בדף הבית) */
export function AttendanceSnapshotPage() {
  const { user } = useAuth();
  if (!user) return null;
  const isFullAdmin = user.role === 'מנהל';
  if (!isFullAdmin && !user.isAttendanceManager) return <Navigate to="/" replace />;
  return (
    <Layout title="תמונת מצב נוכחות תלמידות">
      <AttendanceSnapshotTab isFullAdmin={isFullAdmin} />
    </Layout>
  );
}
