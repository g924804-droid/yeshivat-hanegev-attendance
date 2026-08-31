import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from './api';

export type Permissions = {
  system: boolean;
  grades: boolean;
  payments: boolean;
  teacherAttendance: boolean;
  studentAttendance: boolean;
  contracts: boolean;
};

export type CurrentUser = {
  id: string;
  name: string;
  role: 'מורה' | 'עובד' | 'מנהל';
  department: string | null;
  permissions: Permissions;
  idNumber: string | null;
  dailyTravelCost: number | null;
  monthlyBusPass: number | null;
  isAttendanceManager: boolean;
};

type AuthContextValue = {
  user: CurrentUser | null;
  loading: boolean;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<CurrentUser>('/auth/me');
      setUser(me);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(
    async (password: string) => {
      await api.post('/auth/login', { password });
      await refresh();
    },
    [refresh]
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth חייב לרוץ בתוך AuthProvider');
  return ctx;
}
