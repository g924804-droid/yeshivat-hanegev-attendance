import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, LogIn } from 'lucide-react';
import { useAuth } from '../lib/permissions';

export function PasswordLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(password);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'שגיאה בהתחברות');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-navy flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-gold text-navy flex items-center justify-center text-3xl font-black mb-4 shadow-lg">
            נ
          </div>
          <h1 className="text-2xl font-bold text-white">ישיבת הנגב</h1>
          <p className="text-slate-300 text-sm mt-1">מערכת ניהול נוכחות</p>
        </div>

        <form onSubmit={onSubmit} className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
          <div>
            <label className="label">סיסמה</label>
            <div className="relative">
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input pr-10"
                placeholder="הזן סיסמה"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <button type="submit" disabled={busy || !password} className="btn-gold w-full">
            <LogIn size={18} />
            {busy ? 'מתחבר...' : 'התחברות'}
          </button>
        </form>
      </div>
    </div>
  );
}
