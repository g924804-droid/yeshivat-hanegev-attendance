import { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, Home } from 'lucide-react';
import { useAuth } from '../lib/permissions';
import { TimerStrip } from './TimerStrip';

/** wide — לעמודים עם טבלאות רחבות: משתמש בכל רוחב המסך במקום עמודה צרה באמצע */
export function Layout({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  const width = wide ? 'max-w-[1800px]' : 'max-w-6xl';
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-navy text-white">
        <div className={`${width} mx-auto px-4 py-3 flex items-center justify-between`}>
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2 text-gold font-bold text-lg">
              <div className="h-8 w-8 rounded-lg bg-gold text-navy flex items-center justify-center font-black">
                נ
              </div>
              ישיבת הנגב
            </Link>
            <span className="text-slate-400">/</span>
            <span className="font-medium">{title}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-300 hidden sm:inline">{user?.name}</span>
            <button
              onClick={() => navigate('/')}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors"
              title="בית"
            >
              <Home size={18} />
            </button>
            <button
              onClick={async () => {
                await logout();
                navigate('/');
              }}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors"
              title="התנתקות"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>
      <TimerStrip />
      <main className={`${width} mx-auto px-4 py-6`}>{children}</main>
    </div>
  );
}
