import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronLeft, FileSpreadsheet, Printer, Search } from 'lucide-react';
import { Layout } from '../components/Layout';
import { api, FILTER_BLOCKED_MESSAGE } from '../lib/api';
import { todayStr } from '../lib/utils';

type Counts = { total: number; present: number; absent: number; late: number; missed: number; pct: number };
type CategoryRow = Counts & { category: string };
type AbsenceEvent = { date: string; category: string; subject: string; status: 'חסרה' | 'איחור'; notes: string };
type StudentSummary = Counts & {
  id: string;
  name: string;
  className: string;
  tracks: string[];
  overLimit: boolean;
  categories: CategoryRow[];
  events: AbsenceEvent[];
};
type Summary = { from: string; to: string; trackName: string | null; lateCounts: boolean; limitPct: number; students: StudentSummary[] };
type Track = { id: string; name: string };

/** תחילת שנת הלימודים — 1 בספטמבר האחרון. */
function schoolYearStart(): string {
  const now = new Date();
  const year = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-09-01`;
}

function heDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * שורה לכל מסלול של התלמידה (קודש + המסלול המקצועי), גם כשלא נרשמה בו נוכחות — כדי שיהיה ברור
 * שאין נתונים ולא שהשורה נשכחה. אחריהן קטגוריות נוספות (למשל "לא ידוע").
 */
function categoryRows(s: StudentSummary): CategoryRow[] {
  const empty = { total: 0, present: 0, absent: 0, late: 0, missed: 0, pct: 0 };
  const own = s.tracks.map((t) => s.categories.find((c) => c.category === t) || { category: t, ...empty });
  return [...own, ...s.categories.filter((c) => !s.tracks.includes(c.category))];
}

function eventLabel(e: AbsenceEvent): string {
  return e.subject ? `${e.category} · ${e.subject}` : e.category;
}

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const PRINT_STYLE = `
  @page { size: A4; margin: 16mm 14mm; }
  body { font-family: 'Arial', sans-serif; direction: rtl; color: #1e293b; margin: 0;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .report { page-break-after: always; font-size: 13px; line-height: 1.6; }
  .report:last-child { page-break-after: auto; }
  .head { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #c9a227; padding-bottom: 8px; margin-bottom: 14px; }
  .head h1 { margin: 0; font-size: 21px; color: #0f172a; }
  .head img { max-height: 56px; }
  h2 { font-size: 18px; margin: 0 0 4px; color: #0f172a; }
  .meta { color: #475569; margin-bottom: 12px; }
  .boxes { display: flex; gap: 8px; margin: 12px 0; }
  .box { flex: 1; border: 1px solid #cbd5e1; border-radius: 8px; text-align: center; padding: 6px 4px; }
  .box b { display: block; font-size: 20px; color: #0f172a; }
  .verdict { padding: 8px 12px; border-radius: 8px; font-weight: bold; margin: 10px 0 14px; }
  .ok { background: #dcfce7; color: #166534; }
  .bad { background: #fee2e2; color: #b91c1c; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 14px; font-size: 12.5px; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 7px; text-align: center; }
  th { background: #0f172a; color: #f1c40f; }
  td.r { text-align: right; }
  .over { color: #b91c1c; font-weight: bold; }
  h3 { font-size: 14px; margin: 12px 0 4px; }
  .note { margin-top: 12px; }
  .sign { margin-top: 28px; }
`;

export function StudentAttendanceReport() {
  const navigate = useNavigate();
  const [from, setFrom] = useState(schoolYearStart());
  const [to, setTo] = useState(todayStr());
  const [trackId, setTrackId] = useState('');
  const [lateCounts, setLateCounts] = useState(true);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [onlyOver, setOnlyOver] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [signature, setSignature] = useState('בברכה,\nהנהלת הסמינר');

  const query = () => ({ from, to, trackId: trackId || undefined, lateCounts: lateCounts ? '1' : '0' });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setSummary(await api.get<Summary>('/students/attendanceSummary', query()));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api
      .get<{ tracks: Track[] }>('/students/getTracks')
      .then((r) => setTracks(r.tracks.sort((a, b) => a.name.localeCompare(b.name, 'he'))))
      .catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(
    () => (summary?.students || []).filter((s) => s.name.includes(search.trim()) && (!onlyOver || s.overLimit)),
    [summary, search, onlyOver]
  );

  async function exportExcel() {
    setExporting(true);
    setError(null);
    try {
      const q = query();
      const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined) as [string, string][]);
      const res = await fetch(`/api/students/exportAttendanceExcel?${qs}`, { credentials: 'include' });
      if (res.status === 418) throw new Error(FILTER_BLOCKED_MESSAGE);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `הייצוא נכשל (${res.status})`);
      }
      const blobUrl = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `נוכחות תלמידות ${heDate(from).replace(/\//g, '-')} עד ${heDate(to).replace(/\//g, '-')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (err: any) {
      setError(err.message || 'שגיאה בייצוא');
    } finally {
      setExporting(false);
    }
  }

  /** דוח מודפס — כל תלמידה בעמוד נפרד. נפתח בחלון ההדפסה, ומשם אפשר גם לשמור כ-PDF. */
  async function print(list: StudentSummary[]) {
    if (!summary || !list.length) return;
    let logo = '';
    const siteName = 'סמינר מאיר שכר';
    try {
      const s = await api.get<{ siteName: string | null; hasLogo: boolean }>('/display/settings');
      if (s.hasLogo) logo = `<img src="${location.origin}/api/display/logo" />`;
    } catch {
      /* בלי לוגו */
    }
    const period = `${heDate(summary.from)} – ${heDate(summary.to)}`;
    const today = new Date().toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
    const lines = (text: string) => esc(text).replace(/\n/g, '<br>');
    const missedLabel = summary.lateCounts ? 'היעדרויות (חיסור + איחור)' : 'היעדרויות (חיסורים)';

    const reports = list
      .map((s) => {
        const categories = categoryRows(s)
          .map((c) =>
            c.total
              ? `<tr><td class="r">${esc(c.category)}</td><td>${c.total}</td><td>${c.present}</td><td>${c.absent}</td>
                <td>${c.late}</td><td class="${c.pct > summary.limitPct ? 'over' : ''}">${c.pct}%</td></tr>`
              : `<tr><td class="r">${esc(c.category)}</td><td colspan="5">לא נרשמה נוכחות בתקופה זו</td></tr>`
          )
          .join('');
        const events = s.events
          .map(
            (e) => `<tr><td>${heDate(e.date)}</td><td class="r">${esc(eventLabel(e))}</td>
              <td class="${e.status === 'חסרה' ? 'over' : ''}">${e.status}</td><td class="r">${esc(e.notes)}</td></tr>`
          )
          .join('');
        const verdict = s.overLimit
          ? `<div class="verdict bad">אחוז ההיעדרות ${s.pct}% — מעל המותר (${summary.limitPct}%)</div>`
          : `<div class="verdict ok">אחוז ההיעדרות ${s.pct}% — בתוך המותר (עד ${summary.limitPct}%)</div>`;
        return `<div class="report">
          <div class="head"><h1>${esc(siteName)}</h1>${logo}</div>
          <h2>דוח נוכחות — ${esc(s.name)}</h2>
          <div class="meta">תקופה: ${period}${summary.trackName ? ` · מסלול: ${esc(summary.trackName)}` : s.tracks.length ? ` · ${esc(s.tracks.join(', '))}` : ''} · הופק ב-${today}</div>
          <div class="boxes">
            <div class="box"><b>${s.total}</b>שיעורים</div>
            <div class="box"><b>${s.present}</b>נוכחת</div>
            <div class="box"><b>${s.absent}</b>חסרה</div>
            <div class="box"><b>${s.late}</b>איחור</div>
            <div class="box"><b>${s.missed}</b>${missedLabel}</div>
          </div>
          ${verdict}
          ${categories ? `<h3>קודש ומסלול</h3><table><thead><tr><th>קטגוריה</th><th>שיעורים</th><th>נוכחת</th><th>חסרה</th><th>איחור</th><th>אחוז היעדרות</th></tr></thead><tbody>${categories}</tbody></table>` : ''}
          ${events ? `<h3>פירוט חיסורים ואיחורים</h3><table><thead><tr><th>תאריך</th><th>קטגוריה</th><th>סטטוס</th><th>הערות</th></tr></thead><tbody>${events}</tbody></table>` : '<p>לא נרשמו חיסורים או איחורים בתקופה זו.</p>'}
          ${note.trim() ? `<div class="note">${lines(note)}</div>` : ''}
          <div class="sign">${lines(signature)}</div>
        </div>`;
      })
      .join('');

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;left:0;bottom:0;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>דוח נוכחות</title><style>${PRINT_STYLE}</style></head><body>${reports}</body></html>`);
    doc.close();
    await Promise.race([
      Promise.all(
        Array.from(doc.images).map((img) =>
          img.complete ? null : new Promise((r) => { img.onload = img.onerror = () => r(null); })
        )
      ),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
    iframe.contentWindow!.focus();
    iframe.contentWindow!.print();
    setTimeout(() => iframe.remove(), 60_000);
  }

  const overCount = summary?.students.filter((s) => s.overLimit).length || 0;

  return (
    <Layout title="דוחות נוכחות תלמידות">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate('/students')} className="btn-outline text-sm py-2">
          <ArrowRight size={16} /> חזרה למסלולים
        </button>
      </div>

      {error && <div className="mb-4 text-sm bg-red-50 text-red-700 rounded-xl px-4 py-2">{error}</div>}

      <div className="card mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-sm">
            מתאריך
            <input type="date" className="input mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-sm">
            עד תאריך
            <input type="date" className="input mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="text-sm min-w-[180px]">
            מסלול
            <select className="input mt-1" value={trackId} onChange={(e) => setTrackId(e.target.value)}>
              <option value="">כל המסלולים</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm flex items-center gap-1.5 pb-2">
            <input type="checkbox" checked={lateCounts} onChange={(e) => setLateCounts(e.target.checked)} />
            איחור נחשב כהיעדרות
          </label>
          <button className="btn-primary py-2" onClick={load} disabled={loading || !from || !to}>
            {loading ? 'טוען...' : 'הצגת הדוח'}
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-3">
          האחוז מחושב מתוך השיעורים שבהם נרשמה נוכחות בתקופה. מעל 20% היעדרות מסומן באדום.
        </p>
      </div>

      {summary && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="card text-center py-3">
              <div className="text-2xl font-bold text-navy">{summary.students.length}</div>
              <div className="text-xs text-slate-500 mt-1">תלמידות</div>
            </div>
            <div className="card text-center py-3">
              <div className="text-2xl font-bold text-red-600">{overCount}</div>
              <div className="text-xs text-slate-500 mt-1">מעל {summary.limitPct}% היעדרות</div>
            </div>
            <div className="card text-center py-3">
              <div className="text-2xl font-bold text-green-600">{summary.students.length - overCount}</div>
              <div className="text-xs text-slate-500 mt-1">בתוך המותר</div>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input pr-9" placeholder="חיפוש לפי שם..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <label className="text-sm flex items-center gap-1.5">
              <input type="checkbox" checked={onlyOver} onChange={(e) => setOnlyOver(e.target.checked)} /> רק מעל {summary.limitPct}%
            </label>
            <button className="btn-outline py-2" onClick={exportExcel} disabled={exporting}>
              <FileSpreadsheet size={16} /> {exporting ? 'מייצא...' : 'ייצוא לאקסל'}
            </button>
            <button className="btn-outline py-2" onClick={() => print(shown)} disabled={!shown.length}>
              <Printer size={16} /> הדפסת דוחות ({shown.length})
            </button>
          </div>

          <details className="card mb-4 text-sm">
            <summary className="cursor-pointer font-bold text-navy">טקסט בדוח המודפס (הערה וחתימה)</summary>
            <label className="block mt-3">
              הערה (תופיע בכל דוח, לא חובה)
              <textarea className="input mt-1" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <label className="block mt-2">
              חתימה
              <textarea className="input mt-1" rows={2} value={signature} onChange={(e) => setSignature(e.target.value)} />
            </label>
          </details>

          <div className="card overflow-x-auto">
            <table className="w-full text-sm text-center">
              <thead>
                <tr className="text-slate-500 border-b">
                  <th className="py-2 w-6"></th>
                  <th className="text-right">שם</th>
                  <th>שיעורים</th>
                  <th>נוכחת</th>
                  <th>חסרה</th>
                  <th>איחור</th>
                  <th>אחוז היעדרות</th>
                  <th>דוח</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <Fragment key={s.id}>
                    <tr
                      className={`border-b hover:bg-slate-50 cursor-pointer ${s.overLimit ? 'bg-red-50' : ''}`}
                      onClick={() => setOpenId(openId === s.id ? null : s.id)}
                    >
                      <td className="py-2 text-slate-400">
                        {openId === s.id ? <ChevronDown size={16} /> : <ChevronLeft size={16} />}
                      </td>
                      <td className="text-right">
                        <div className="font-medium">{s.name}</div>
                        <div className="text-xs text-slate-400">{s.tracks.join(' · ')}</div>
                      </td>
                      <td>{s.total}</td>
                      <td className="text-green-700">{s.present}</td>
                      <td className="text-red-600">{s.absent || ''}</td>
                      <td className="text-amber-700">{s.late || ''}</td>
                      <td>
                        <span className={`badge ${s.overLimit ? 'bg-red-100 text-red-700 font-bold' : 'bg-green-100 text-green-800'}`}>
                          {s.pct}%
                        </span>
                      </td>
                      <td>
                        <button
                          className="p-1.5 rounded-lg hover:bg-slate-200 text-navy"
                          title="הדפסת דוח לתלמידה"
                          onClick={(e) => {
                            e.stopPropagation();
                            print([s]);
                          }}
                        >
                          <Printer size={16} />
                        </button>
                      </td>
                    </tr>
                    {openId === s.id && (
                      <tr className="border-b bg-slate-50">
                        <td colSpan={8} className="p-3 text-right">
                          {categoryRows(s).length ? (
                            <table className="w-full text-xs text-center bg-white rounded-lg mb-3">
                              <thead>
                                <tr className="text-slate-500 border-b">
                                  <th className="py-1.5 text-right px-2">קטגוריה</th>
                                  <th>שיעורים</th>
                                  <th>נוכחת</th>
                                  <th>חסרה</th>
                                  <th>איחור</th>
                                  <th>אחוז</th>
                                </tr>
                              </thead>
                              <tbody>
                                {categoryRows(s).map((c) => (
                                  <tr key={c.category} className="border-b last:border-0">
                                    <td className="py-1.5 text-right px-2">{c.category}</td>
                                    {c.total ? (
                                      <>
                                        <td>{c.total}</td>
                                        <td>{c.present}</td>
                                        <td>{c.absent || ''}</td>
                                        <td>{c.late || ''}</td>
                                        <td className={c.pct > summary.limitPct ? 'text-red-600 font-bold' : ''}>{c.pct}%</td>
                                      </>
                                    ) : (
                                      <td colSpan={5} className="text-slate-400">לא נרשמה נוכחות בתקופה זו</td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="text-slate-400 text-xs mb-2">לא נרשמה נוכחות בתקופה זו</p>
                          )}
                          {s.events.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {s.events.map((e, i) => (
                                <span
                                  key={i}
                                  className={`badge ${e.status === 'חסרה' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}
                                  title={e.notes}
                                >
                                  {heDate(e.date)} · {eventLabel(e)} · {e.status}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <p className="text-center text-slate-400 py-6">אין תלמידות להצגה</p>}
          </div>
        </>
      )}
    </Layout>
  );
}
