import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, X, RotateCcw } from 'lucide-react';
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

export function ScheduleHistoryModal({
  tracks,
  trackFilter,
  onClose,
  onChanged,
}: {
  tracks: Ref[];
  trackFilter: string;
  onClose: () => void;
  /** אחרי ביטול שינויים — לרענן את מערכת השעות שמאחורי החלון */
  onChanged?: () => void;
}) {
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

  // ביטול שינויים שנעשו בטעות — בחירה של שורה אחת או כמה
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reverting, setReverting] = useState(false);
  const [revertMsg, setRevertMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function loadHistory() {
    api
      .get<{ history: HistoryRow[] }>('/schedule/getScheduleHistory')
      .then((d) => setHistory(d.history))
      .catch((err) => setLoadError(err.message));
  }
  useEffect(loadHistory, []);

  const toggle = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
      return n;
    });

  async function revert(ids: string[]) {
    const n = ids.length;
    const msg =
      n === 1
        ? 'לבטל את השינוי הזה? השיעור יחזור בדיוק למצב שהיה לפניו (שיעור שנוסף יימחק, שיעור שנמחק יחזור).'
        : `לבטל ${n} שינויים? כל שיעור יחזור למצב שהיה לפני השינוי המוקדם ביותר שסימנת.`;
    if (!confirm(msg)) return;
    setReverting(true);
    setRevertMsg(null);
    try {
      const r = await api.post<{ reverted: number; errors: string[] }>('/schedule/revertChanges', { ids });
      setRevertMsg({
        ok: !r.errors.length,
        text: `הוחזרו ${r.reverted} שיעורים למצב הקודם${r.errors.length ? ` — לא הצליח: ${r.errors.join('; ')}` : ''}`,
      });
      setSelected(new Set());
      loadHistory();
      onChanged?.();
    } catch (err: any) {
      setRevertMsg({ ok: false, text: err.message || 'שגיאה בביטול' });
    } finally {
      setReverting(false);
    }
  }

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

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-2 rounded-xl bg-amber-50 border border-amber-300 px-3 py-2 text-sm">
            <span className="font-semibold text-amber-900">סומנו {selected.size} שינויים</span>
            <button className="btn-primary bg-red-600 hover:bg-red-700 py-1.5 text-sm" onClick={() => revert(Array.from(selected))} disabled={reverting}>
              <RotateCcw size={14} /> {reverting ? 'מבטל...' : 'ביטול השינויים המסומנים'}
            </button>
            <button className="text-slate-600 underline" onClick={() => setSelected(new Set())}>
              ניקוי סימון
            </button>
          </div>
        )}
        {revertMsg && (
          <p className={`mb-2 text-sm rounded-lg px-3 py-2 ${revertMsg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{revertMsg.text}</p>
        )}

        <div className="overflow-y-auto flex-1">
          {loadError && <p className="text-red-700 text-sm">{loadError}</p>}
          {!history && !loadError && <p className="text-slate-500 text-sm">טוען...</p>}
          {history && byDate.length === 0 && <p className="text-slate-500 text-sm">אין שינויים בטווח שנבחר</p>}
          {byDate.map(([date, rows]) => (
            <div key={date} className="mb-4">
              <div className="sticky top-0 bg-white font-semibold text-navy text-sm border-b-2 border-gold pb-1 mb-1 flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer"
                  title="סימון כל השינויים של היום הזה"
                  checked={rows.every((r) => selected.has(r.id))}
                  onChange={(e) => toggle(rows.map((r) => r.id), e.target.checked)}
                />
                {longDate(date)} <span className="text-slate-400 font-normal">· {rows.length} שינויים</span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {rows.map((h) => (
                    <tr key={h.id} className={`border-b border-slate-100 align-top ${selected.has(h.id) ? 'bg-amber-50' : ''}`}>
                      <td className="py-2 pl-1 w-6">
                        <input type="checkbox" className="h-4 w-4 cursor-pointer" checked={selected.has(h.id)} onChange={(e) => toggle([h.id], e.target.checked)} />
                      </td>
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
                      <td className="py-2 w-16 text-left">
                        <button
                          className="inline-flex items-center gap-1 text-xs text-red-600 hover:bg-red-50 rounded px-1.5 py-0.5"
                          title="החזרת השיעור למצב שלפני השינוי הזה"
                          onClick={() => revert([h.id])}
                          disabled={reverting}
                        >
                          <RotateCcw size={12} /> ביטול
                        </button>
                      </td>
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
