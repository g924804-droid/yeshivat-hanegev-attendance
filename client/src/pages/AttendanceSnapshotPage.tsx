import { Navigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { AttendanceSnapshotTab } from '../components/AttendanceSnapshotTab';
import { useAuth } from '../lib/permissions';

/** תמונת מצב נוכחות תלמידות — רק למי שסומנה "גישה לתמונת מצב" (אריח בדף הבית) */
export function AttendanceSnapshotPage() {
  const { user } = useAuth();
  if (!user) return null;
  if (!user.attendanceSnapshotAccess) return <Navigate to="/" replace />;
  return (
    <Layout title="תמונת מצב נוכחות תלמידות">
      <AttendanceSnapshotTab isFullAdmin />
    </Layout>
  );
}
