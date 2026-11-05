import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

type U = { id: string; name: string; role: string; trackLessons: boolean };
type T = { id: string; name: string; lessons: number; linked: string[]; auto: string[] };

/**
 * קישור מורות: לכל שם מורה במערכת השעות — לאיזו עובדת (או עובדות) הוא שייך. שמות שזהים לשם העובדת
 * מקושרים לבד; כאן מקשרים שמות שונים ("הרבנית א. הורביץ") ושמות של שתי מורות יחד ("משואה + שרה").
 */
export function TeacherLinksModal({ onClose }: { onClose: () => void }) {
  const [teachers, setTeachers] = useState<T[] | null>(null);
  const [users, setUsers] = useState<U[]>([]);
  const [error, setError] = useState('');
  const [onlyUnlinked, setOnlyUnlinked] = useState(true);
  const [adding, setAdding] = useState<{ teacherId: string; q: string } | null>(null);

  const load = () =>
    api
      .get<{ teachers: T[]; users: U[] }>('/schedule/teacherLinks')
      .then((r) => {
        setTeachers(r.teachers);
        setUsers(r.users);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const userName = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const shown = (teachers || [])
    .filter((t) => !onlyUnlinked || (!t.linked.length && !t.auto.length))
    .sort((a, b) => b.lessons - a.lessons);

  async function save(t: T, linked: string[]) {
    setError('');
    try {
      await api.post('/schedule/teacherLinks', { teacherId: t.id, userIds: linked });
      setTeachers((prev) => prev!.map((x) => (x.id === t.id ? { ...x, linked } : x)));
    } catch (e: any) {
      setError(e.message);
    }
  }

  const badge = (u: U | undefined, removable?: () => void) =>
    u && (
      <span key={u.id} className="inline-flex items-center gap-1 text-xs bg-navy text-white rounded-full px-2 py-0.5">
        {u.name}
        {!u.trackLessons && <span className="opacity-70" title='לא מסומן "מעקב שיעורים" — לא תתבקש למלא נוכחות'>⚠</span>}
        {removable && (
          <button onClick={removable} className="opacity-80 hover:opacity-100" title="הסרת הקישור">
            ✕
          </button>
        )}
      </span>
    );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-2xl space-y-3 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-navy text-lg">קישור מורות</h3>
          <button className="btn-outline" onClick={onClose}>
            סגירה
          </button>
        </div>
        <p className="text-sm text-slate-600">
          לכל שם מורה במערכת השעות — העובדת שהשיעורים שלה שייכים אליה (לנוכחות תלמידות ולתמונת המצב). שם שזהה לשם העובדת
          מקושר לבד (אפור). ⚠ = לא מסומן אצלה "מעקב שיעורים", ולכן לא תתבקש למלא נוכחות.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyUnlinked} onChange={(e) => setOnlyUnlinked(e.target.checked)} />
          רק שמות שלא מקושרים לאף עובדת
        </label>
        {error && <div className="text-sm bg-red-50 text-red-700 rounded-xl px-3 py-2">{error}</div>}
        {!teachers ? (
          <p className="text-sm text-slate-400">טוען...</p>
        ) : !shown.length ? (
          <p className="text-sm text-green-700">כל השמות במערכת השעות מקושרים לעובדות ✓</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-slate-500 border-b">
                <th className="py-1.5">שם במערכת השעות</th>
                <th>שיעורים</th>
                <th>עובדות</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const q = adding?.teacherId === t.id ? adding.q.trim() : '';
                const options = q ? users.filter((u) => u.name.includes(q) && !t.linked.includes(u.id)).slice(0, 6) : [];
                return (
                  <tr key={t.id} className="border-b align-top">
                    <td className="py-2 font-medium">{t.name}</td>
                    <td className="py-2">{t.lessons}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1 items-center">
                        {t.auto.map((id) => (
                          <span key={id} className="text-xs bg-slate-200 text-slate-700 rounded-full px-2 py-0.5" title="מקושרת לפי השם">
                            {userName.get(id)?.name}
                          </span>
                        ))}
                        {t.linked.map((id) => badge(userName.get(id), () => save(t, t.linked.filter((x) => x !== id))))}
                        {adding?.teacherId === t.id ? (
                          <div className="relative">
                            <input
                              className="input py-1 text-xs w-40"
                              autoFocus
                              placeholder="שם העובדת"
                              value={adding.q}
                              onChange={(e) => setAdding({ teacherId: t.id, q: e.target.value })}
                              onBlur={() => setTimeout(() => setAdding(null), 200)}
                            />
                            {!!options.length && (
                              <div className="absolute z-10 bg-white border rounded-lg shadow mt-1 w-56">
                                {options.map((u) => (
                                  <button
                                    key={u.id}
                                    className="block w-full text-right px-2 py-1 text-xs hover:bg-slate-50"
                                    onMouseDown={() => {
                                      save(t, [...t.linked, u.id]);
                                      setAdding(null);
                                    }}
                                  >
                                    {u.name} <span className="text-slate-400">({u.role})</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <button className="text-xs text-navy underline" onClick={() => setAdding({ teacherId: t.id, q: '' })}>
                            + קישור לעובדת
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
