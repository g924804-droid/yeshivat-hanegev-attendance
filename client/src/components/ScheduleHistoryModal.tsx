import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, X } from 'lucide-react';
import { api, FILTER_BLOCKED_MESSAGE } from '../lib/api';
import { addDays, localIsoDate } from '../lib/scheduleRules';

type Change = { field: string; before: string; after: string };
export type HistoryRow = {
  id: string;
  changedDate: string;
  changedTime: string;
  changedBy: string;
  action: string;
  changeType: string;
  lessonName: string;
  dayOfWeek: string;
  time: string;
  track: string;
  teacher: string;
  room: string;
  fromDate: string;
  toDate: string;
  changes: Change[];
};
type Ref = { id: string; name: string };

const ACTION_STYLE: Record<string, string> = {
  create: 'bg-green-100 text-green-800',
  update: 'bg-blue-100 text-blue-800',
  delete: 'bg-red-100 text-red-800',
};

/** "2026-10-12" → "12/10/26" */
function heDate(date: string): string {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  return `${Number(d)}/${Number(m)}/${y.slice(2)}`;
}

function longDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function ScheduleHistoryModal({ tracks, trackFilter, onClose }: { tracks: Ref[]; trackFilter: string; onClose: () => void }) {
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const today = localIsoDate(new Date());
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const [exportTrack, setExportTrack] = useState(trackFilter);
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ history: HistoryRow[] }>('/schedule/getScheduleHistory')
      .then((d) => setHistory(d.history))
      .catch((err) => setLoadError(err.message));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim();
    return (history || []).filter(
      (h) =>
        h.changedDate >= from &&
        h.changedDate <= to &&
        (!action || h.changeType === action) &&
        (!q || [h.lessonName, h.teacher, h.track, h.changedBy, h.room].some((v) => v?.includes(q)))
    );
  }, [history, search, action, from, to]);

  // מקובץ לפי יום השינוי — כך רואים בבירור מה נעשה בכל יום
  const byDate = useMemo(() => {
    const groups = new Map<string, HistoryRow[]>();
    for (const h of filtered) {
      if (!groups.has(h.changedDate)) groups.set(h.changedDate, []);
      groups.get(h.changedDate)!.push(h);
    }
    return Array.from(groups.entries());
  }, [filtered]);

  async function exportExcel() {
    setBusy(true);
    setExportError(null);
    try {
      const qs = new URLSearchParams({ from, to, ...(exportTrack ? { trackId: exportTrack } : {}) });
      const res = await fetch(`/api/schedule/exportScheduleExcel?${qs}`, { credentials: 'include' });
      if (res.status === 418) throw new Error(FILTER_BLOCKED_MESSAGE);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `הייצוא נכשל (${res.status})`);
      }
      const blobUrl = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `מערכת שעות ${heDate(from).replace(/\//g, '-')} עד ${heDate(to).replace(/\//g, '-')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (err: any) {
      setExportError(err.message || 'שגיאה בייצוא');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-5 w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-navy text-lg">היסטוריית מערכת השעות</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-2 mb-3 bg-slate-50 rounded-xl p-3">
          <label className="text-xs text-slate-500">
            מתאריך
            <input type="date" className="input py-1.5 block" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-xs text-slate-500">
            עד תאריך
            <input type="date" className="input py-1.5 block" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="text-xs text-slate-500">
            מסלול (לאקסל)
            <select className="input py-1.5 block" value={exportTrack} onChange={(e) => setExportTrack(e.target.value)}>
              <option value="">כל המסלולים</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          <button className="btn-primary py-2" onClick={exportExcel} disabled={busy || !from || !to}>
            <FileSpreadsheet size={16} /> {busy ? 'מכין קובץ...' : 'ייצוא לאקסל'}
          </button>
          <p className="text-xs text-slate-500 basis-full">
            בקובץ האקסל: גיליון אחד עם המערכת כפי שהייתה בכל יום בטווח (כולל שיעורים שנמחקו מאז, ומורות שהוחלפו),
            וגיליון שני עם כל השינויים שנעשו בטווח.
          </p>
          {exportError && <p className="text-sm text-red-700 basis-full">{exportError}</p>}
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          <input
            className="input py-1.5 flex-1 min-w-[180px]"
            placeholder="חיפוש שיעור, מורה, מסלול או מי שינתה..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input py-1.5 w-auto" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">כל הפעולות</option>
            <option value="create">נוסף</option>
            <option value="update">עודכן</option>
            <option value="delete">נמחק</option>
          </select>
        </div>

        <div className="overflow-y-auto flex-1">
          {loadError && <p className="text-red-700 text-sm">{loadError}</p>}
          {!history && !loadError && <p className="text-slate-500 text-sm">טוען...</p>}
          {history && byDate.length === 0 && <p className="text-slate-500 text-sm">אין שינויים בטווח שנבחר</p>}
          {byDate.map(([date, rows]) => (
            <div key={date} className="mb-4">
              <div className="sticky top-0 bg-white font-semibold text-navy text-sm border-b-2 border-gold pb-1 mb-1">
                {longDate(date)} <span className="text-slate-400 font-normal">· {rows.length} שינויים</span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {rows.map((h) => (
                    <tr key={h.id} className="border-b border-slate-100 align-top">
                      <td className="py-2 pl-2 w-14 text-slate-400 text-xs">{h.changedTime}</td>
                      <td className="py-2 pl-2 w-16">
                        <span className={`badge ${ACTION_STYLE[h.changeType] || 'bg-slate-100'}`}>{h.action}</span>
                      </td>
                      <td className="py-2 pl-3">
                        <div className="font-semibold text-navy">{h.lessonName}</div>
                        <div className="text-xs text-slate-500">
                          {[`${h.dayOfWeek} ${h.time}`, h.track, h.teacher, h.room].filter((v) => v?.trim()).join(' · ')}
                        </div>
                        {h.fromDate && (
                          <div className="text-xs text-slate-400">
                            בתוקף מ-{heDate(h.fromDate)}
                            {h.toDate ? ` עד ${heDate(h.toDate)} (זמני)` : ''}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pl-3">
                        {h.changes.length > 0 ? (
                          <ul className="text-xs space-y-0.5">
                            {h.changes.map((c) => (
                              <li key={c.field}>
                                <span className="text-slate-500">{c.field}:</span>{' '}
                                <span className="line-through text-red-600">{c.before || '(ריק)'}</span>
                                {' ← '}
                                <span className="text-green-700 font-semibold">{c.after || '(ריק)'}</span>
                              </li>
                            ))}
                          </ul>
                        ) : h.changeType === 'update' ? (
                          <span className="text-xs text-slate-400">נשמר בלי שינוי</span>
                        ) : null}
                      </td>
                      <td className="py-2 w-28 text-xs text-slate-500">{h.changedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
