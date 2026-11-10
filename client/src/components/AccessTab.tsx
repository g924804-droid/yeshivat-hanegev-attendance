import { useEffect, useState } from 'react';
import { Eye, EyeOff, Lock, Plus, Search } from 'lucide-react';
import { FILTER_BLOCKED_MESSAGE } from '../lib/api';

type Row = { id: string; name: string; password: string; perms: Record<string, boolean> };
type Perm = { key: string; label: string };

/**
 * סיסמאות והרשאות (מנהלות בלבד) — נפתח רק עם קוד נפרד, ל-15 דקות. השינויים נשמרים ישירות בטבלת
 * "סיסמאות והרשאות" ב-Airtable. הרשאה חדשה נכנסת לתוקף כשהעובד/ת מתנתק/ת ומתחבר/ת מחדש.
 */
export function AccessTab() {
  const [hasCode, setHasCode] = useState<boolean | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [newCode, setNewCode] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [editingPw, setEditingPw] = useState<{ id: string; value: string } | null>(null);
  const [adding, setAdding] = useState<{ name: string; password: string } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // בקשה עם ה-token של הפתיחה; כשהלשונית ננעלת (423) — חוזרים למסך הקוד
  async function call<T>(method: 'GET' | 'POST', path: string, body?: any): Promise<T> {
    const res = await fetch(`/api/access${path}`, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-access-token': token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (res.status === 423) {
      setToken(null);
      setRows(null);
    }
    if (!res.ok) throw new Error(res.status === 418 ? FILTER_BLOCKED_MESSAGE : data?.error || `שגיאה (${res.status})`);
    return data as T;
  }

  useEffect(() => {
    call<{ hasCode: boolean }>('GET', '/status').then((r) => setHasCode(r.hasCode)).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!token) return;
    call<{ rows: Row[]; perms: Perm[] }>('GET', '/list')
      .then((r) => {
        setRows(r.rows);
        setPerms(r.perms);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function unlock() {
    setError('');
    try {
      const r = await call<{ token: string }>('POST', '/unlock', { code });
      setCode('');
      setToken(r.token);
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function setFirstCode() {
    setError('');
    try {
      await call('POST', '/setCode', { newCode });
      setHasCode(true);
      setNewCode('');
      setNotice('הקוד נשמר. עכשיו מקלידים אותו כדי לפתוח.');
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function update(id: string, body: Record<string, any>) {
    setError('');
    setNotice('');
    try {
      const r = await call<{ row: Row }>('POST', '/update', { id, ...body });
      setRows((prev) => prev!.map((x) => (x.id === id ? r.row : x)));
      setNotice('נשמר. ההרשאה נכנסת לתוקף כשהעובד/ת מתנתק/ת ומתחבר/ת מחדש.');
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  }
  async function create() {
    if (!adding) return;
    setError('');
    try {
      const r = await call<{ row: Row }>('POST', '/create', adding);
      setRows((prev) => [...(prev || []), r.row].sort((a, b) => a.name.localeCompare(b.name, 'he')));
      setAdding(null);
      setNotice(`נוסף/ה: ${r.row.name}. עכשיו מסמנים לה את ההרשאות.`);
    } catch (e: any) {
      setError(e.message);
    }
  }

  // ---- נעול ----
  if (!token) {
    return (
      <div className="card max-w-sm mx-auto text-center space-y-3">
        <Lock className="mx-auto text-navy" size={28} />
        <h3 className="font-bold text-navy">סיסמאות והרשאות</h3>
        {hasCode === null ? (
          <p className="text-sm text-slate-400">טוען...</p>
        ) : hasCode ? (
          <>
            <p className="text-sm text-slate-600">הלשונית מוגנת בקוד נפרד.</p>
            <input className="input text-center" type="password" placeholder="קוד" value={code} autoFocus
              onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && unlock()} />
            <button className="btn-primary w-full" onClick={unlock}>פתיחה</button>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-600">עוד לא נקבע קוד ללשונית הזו. בחרי קוד (לפחות 4 תווים) — בכל פתיחה יידרש.</p>
            <input className="input text-center" type="password" placeholder="קוד חדש" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
            <button className="btn-primary w-full" onClick={setFirstCode}>שמירת קוד</button>
          </>
        )}
        {notice && <p className="text-sm text-green-700">{notice}</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  // ---- פתוח ----
  const q = search.trim();
  const list = (rows || []).filter((r) => !q || r.name.includes(q));
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pr-9 py-2" placeholder="חיפוש שם" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="btn-outline" onClick={() => setAdding({ name: '', password: '' })}>
          <Plus size={16} /> עובד/ת חדש/ה
        </button>
        <button className="btn-outline" onClick={() => { setToken(null); setRows(null); }}>
          <Lock size={16} /> נעילה
        </button>
        <span className="text-xs text-slate-500">ננעל לבד אחרי 15 דקות בלי פעולה</span>
      </div>
      {notice && <div className="mb-3 text-sm bg-green-50 text-green-800 rounded-xl px-4 py-2">{notice}</div>}
      {error && <div className="mb-3 text-sm bg-red-50 text-red-700 rounded-xl px-4 py-2">{error}</div>}
      {adding && (
        <div className="card mb-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">שם המשתמש
            <input className="input mt-1" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
          </label>
          <label className="text-sm">סיסמה
            <input className="input mt-1" value={adding.password} onChange={(e) => setAdding({ ...adding, password: e.target.value })} />
          </label>
          <button className="btn-primary" onClick={create}>הוספה</button>
          <button className="btn-outline" onClick={() => setAdding(null)}>ביטול</button>
          <p className="text-xs text-slate-500 w-full">השם צריך להיות כמו שם העובד/ת במערכת (ניהול ← עובדים), כדי שהכניסה תתחבר לכרטיס שלה.</p>
        </div>
      )}
      {!rows ? (
        <div className="card text-slate-500">טוען...</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm text-center">
            <thead>
              <tr className="text-slate-500 border-b bg-slate-50">
                <th className="py-2.5 pr-4 text-right">שם</th>
                <th>סיסמה</th>
                {perms.map((p) => <th key={p.key} className="px-1">{p.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-b hover:bg-slate-50">
                  <td className="py-2 pr-4 text-right font-medium text-navy">{r.name || '(בלי שם)'}</td>
                  <td className="whitespace-nowrap">
                    {editingPw?.id === r.id ? (
                      <span className="inline-flex gap-1">
                        <input className="input py-1 w-28 text-xs" autoFocus value={editingPw.value} onChange={(e) => setEditingPw({ id: r.id, value: e.target.value })} />
                        <button className="text-xs text-navy underline" onClick={async () => { if (await update(r.id, { password: editingPw.value })) setEditingPw(null); }}>שמירה</button>
                        <button className="text-xs text-slate-500" onClick={() => setEditingPw(null)}>ביטול</button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="font-mono">{shown.has(r.id) ? r.password : '••••••'}</span>
                        <button title={shown.has(r.id) ? 'הסתרה' : 'הצגה'} className="text-slate-400 hover:text-navy"
                          onClick={() => setShown((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}>
                          {shown.has(r.id) ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        <button className="text-xs text-navy underline" onClick={() => setEditingPw({ id: r.id, value: '' })}>שינוי</button>
                      </span>
                    )}
                  </td>
                  {perms.map((p) => (
                    <td key={p.key}>
                      <input type="checkbox" className="h-4 w-4 accent-navy cursor-pointer" checked={!!r.perms[p.key]}
                        onChange={(e) => update(r.id, { perms: { [p.key]: e.target.checked } })} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500 mt-2">
        השינויים נשמרים ישירות בטבלת "סיסמאות והרשאות". הרשאה שנוספה/הוסרה נכנסת לתוקף כשהעובד/ת מתנתק/ת ומתחבר/ת מחדש.
        הכניסה למערכת היא לפי הסיסמה — לכל אחד/ת סיסמה אחרת.
      </p>
    </div>
  );
}
