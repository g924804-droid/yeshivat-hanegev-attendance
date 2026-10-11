import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronLeft, FileSpreadsheet, Printer, Search, Wrench } from 'lucide-react';
import { Layout } from '../components/Layout';
import { api, FILTER_BLOCKED_MESSAGE } from '../lib/api';
import { todayStr, toHebrewDateString } from '../lib/utils';

type Counts = { total: number; present: number; absent: number; late: number; missed: number; pct: number };
type LessonRow = Counts & { category: string; lesson: string; teacher: string; over: boolean };
type AbsenceEvent = { date: string; hebDate: string; category: string; lesson: string; status: 'חסרה' | 'איחור'; notes: string };
type StudentSummary = Counts & {
  id: string;
  name: string;
  tracks: string[];
  lessons: LessonRow[];
  overLimit: boolean;
  unidentifiedDays: number;
  events: AbsenceEvent[];
};
type Summary = {
  from: string;
  to: string;
  fromHeb: string;
  toHeb: string;
  trackName: string | null;
  lateCounts: boolean;
  limitPct: number;
  students: StudentSummary[];
};
type Track = { id: string; name: string };

/** תחילת שנת הלימודים — 1 בספטמבר האחרון. */
function schoolYearStart(): string {
  const now = new Date();
  const year = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-09-01`;
}

function hebrewOf(iso: string): string {
  return iso ? toHebrewDateString(new Date(`${iso}T12:00:00`)) : '';
}

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** השיעורים מקובצים לפי קטגוריה (קודש / המסלול), בסדר שהשרת החזיר. */
function groupByCategory(lessons: LessonRow[]): [string, LessonRow[]][] {
  const groups = new Map<string, LessonRow[]>();
  for (const l of lessons) groups.set(l.category, [...(groups.get(l.category) || []), l]);
  return Array.from(groups.entries());
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
  .verdict { padding: 8px 12px; border-radius: 8px; font-weight: bold; margin: 10px 0 14px; }
  .ok { background: #dcfce7; color: #166534; }
  .bad { background: #fee2e2; color: #b91c1c; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 14px; font-size: 12.5px; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 7px; text-align: center; }
  th { background: #0f172a; color: #f1c40f; }
  td.r { text-align: right; }
  tr.cat td { background: #f1f5f9; font-weight: bold; text-align: right; }
  tr.over td { background: #fee2e2; }
  .red { color: #b91c1c; font-weight: bold; }
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
      a.download = `נוכחות תלמידות ${hebrewOf(from)} עד ${hebrewOf(to)}.xlsx`;
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
    try {
      const s = await api.get<{ siteName: string | null; hasLogo: boolean }>('/display/settings');
      if (s.hasLogo) logo = `<img src="${location.origin}/api/display/logo" />`;
    } catch {
      /* בלי לוגו */
    }
    const limit = summary.limitPct;
    const today = toHebrewDateString(new Date());
    const lines = (text: string) => esc(text).replace(/\n/g, '<br>');
    const missedHeader = summary.lateCounts ? 'היעדרויות (חיסור+איחור)' : 'חיסורים';

    const reports = list
      .map((s) => {
        const lessonRows = groupByCategory(s.lessons)
          .map(
            ([category, rows]) =>
              `<tr class="cat"><td colspan="6">${esc(category)}</td></tr>` +
              rows
                .map(
                  (l) => `<tr class="${l.over ? 'over' : ''}"><td class="r">${esc(l.lesson)}</td><td>${l.total}</td><td>${l.absent}</td>
                    <td>${l.late}</td><td>${l.missed}</td><td class="${l.over ? 'red' : ''}">${l.pct}%</td></tr>`
                )
                .join('')
          )
          .join('');
        const events = s.events
          .map(
            (e) => `<tr><td>${esc(e.hebDate)}</td><td class="r">${esc(e.category)}</td><td class="r">${esc(e.lesson)}</td>
              <td class="${e.status === 'חסרה' ? 'red' : ''}">${e.status}</td><td class="r">${esc(e.notes)}</td></tr>`
          )
          .join('');
        const overLessons = s.lessons.filter((l) => l.over);
        const verdict = overLessons.length
          ? `<div class="verdict bad">עברה ${limit}% היעדרות ב${overLessons.length === 1 ? 'שיעור' : `-${overLessons.length} שיעורים`}: ${overLessons
              .map((l) => `${esc(l.lesson)} (${esc(l.category)}) — ${l.pct}%`)
              .join(' · ')}</div>`
          : `<div class="verdict ok">בכל השיעורים אחוז ההיעדרות בתוך המותר (עד ${limit}%)</div>`;
        return `<div class="report">
          <div class="head"><h1>סמינר מאיר</h1>${logo}</div>
          <h2>דוח נוכחות — ${esc(s.name)}</h2>
          <div class="meta">תקופה: ${esc(summary.fromHeb)} – ${esc(summary.toHeb)}${
            summary.trackName ? ` · מסלול: ${esc(summary.trackName)}` : s.tracks.length ? ` · ${esc(s.tracks.join(', '))}` : ''
          }<br>הופק ב${esc(today)}</div>
          ${verdict}
          ${
            lessonRows
              ? `<h3>נוכחות לפי שיעור (לאורך כל התקופה)</h3><table><thead><tr><th>שם השיעור</th><th>שיעורים</th><th>חסרה</th><th>איחור</th><th>${missedHeader}</th><th>אחוז היעדרות</th></tr></thead><tbody>${lessonRows}</tbody></table>`
              : '<p>לא נרשמה נוכחות בתקופה זו.</p>'
          }
          ${
            events
              ? `<h3>פירוט חיסורים ואיחורים</h3><table><thead><tr><th>תאריך</th><th>קטגוריה</th><th>שם השיעור</th><th>סטטוס</th><th>הערות</th></tr></thead><tbody>${events}</tbody></table>`
              : s.lessons.length
              ? '<p>לא נרשמו חיסורים או איחורים בתקופה זו.</p>'
              : ''
          }
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
        <button onClick={() => navigate('/students/fix')} className="btn-outline text-sm py-2 border-amber-400 text-amber-800">
          <Wrench size={16} /> תיקון נתונים — נוכחות חסרה ולא משויכת
        </button>
      </div>

      {error && <div className="mb-4 text-sm bg-red-50 text-red-700 rounded-xl px-4 py-2">{error}</div>}

      <div className="card mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-sm">
            מתאריך
            <input type="date" className="input mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="block text-xs text-slate-500 mt-1 h-4">{hebrewOf(from)}</span>
          </label>
          <label className="text-sm">
            עד תאריך
            <input type="date" className="input mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
            <span className="block text-xs text-slate-500 mt-1 h-4">{hebrewOf(to)}</span>
          </label>
          <label className="text-sm min-w-[180px]">
            מסלול
            <select className="input mt-1" value={trackId} onChange={(e) => setTrackId(e.target.value)}>
              <option value="">כל המסלולים</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <span className="block h-4 mt-1" />
          </label>
          <label className="text-sm flex items-center gap-1.5 pb-7">
            <input type="checkbox" checked={lateCounts} onChange={(e) => setLateCounts(e.target.checked)} />
            איחור נחשב כהיעדרות
          </label>
          <button className="btn-primary py-2 mb-5" onClick={load} disabled={loading || !from || !to}>
            {loading ? 'טוען...' : 'הצגת הדוח'}
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          האחוז מחושב לכל שיעור בנפרד, לאורך כל התקופה, מתוך הפעמים שבהן נרשמה נוכחות. שיעור שבו התלמידה עברה{' '}
          {summary?.limitPct ?? 20}% היעדרות מסומן באדום.
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
              <div className="text-xs text-slate-500 mt-1">עברו {summary.limitPct}% בשיעור אחד לפחות</div>
            </div>
            <div className="card text-center py-3">
              <div className="text-2xl font-bold text-green-600">{summary.students.length - overCount}</div>
              <div className="text-xs text-slate-500 mt-1">בתוך המותר בכל השיעורים</div>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input pr-9" placeholder="חיפוש לפי שם..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <label className="text-sm flex items-center gap-1.5">
              <input type="checkbox" checked={onlyOver} onChange={(e) => setOnlyOver(e.target.checked)} /> רק מי שעברה {summary.limitPct}%
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
                  <th className="text-right">שיעורים מעל {summary.limitPct}%</th>
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
                      <td className="text-right">
                        <div className="flex flex-wrap gap-1">
                          {s.lessons
                            .filter((l) => l.over)
                            .map((l) => (
                              <span key={`${l.category}|${l.lesson}`} className="badge bg-red-100 text-red-700 font-bold">
                                {l.lesson} {l.pct}%
                              </span>
                            ))}
                        </div>
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
                          {s.lessons.length ? (
                            <table className="w-full text-xs text-center bg-white rounded-lg mb-3">
                              <thead>
                                <tr className="text-slate-500 border-b">
                                  <th className="py-1.5 text-right px-2">שם השיעור</th>
                                  <th>מורה</th>
                                  <th>שיעורים</th>
                                  <th>חסרה</th>
                                  <th>איחור</th>
                                  <th>אחוז היעדרות</th>
                                </tr>
                              </thead>
                              <tbody>
                                {groupByCategory(s.lessons).map(([category, rows]) => (
                                  <Fragment key={category}>
                                    <tr className="bg-slate-100">
                                      <td colSpan={6} className="py-1 px-2 text-right font-bold text-navy">{category}</td>
                                    </tr>
                                    {rows.map((l) => (
                                      <tr key={l.lesson} className={`border-b last:border-0 ${l.over ? 'bg-red-50' : ''}`}>
                                        <td className="py-1.5 text-right px-2">{l.lesson}</td>
                                        <td>{l.teacher}</td>
                                        <td>{l.total}</td>
                                        <td>{l.absent || ''}</td>
                                        <td>{l.late || ''}</td>
                                        <td className={l.over ? 'text-red-600 font-bold' : ''}>{l.pct}%</td>
                                      </tr>
                                    ))}
                                  </Fragment>
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
                                  {e.hebDate} · {e.lesson} · {e.status}
                                </span>
                              ))}
                            </div>
                          )}
                          {s.unidentifiedDays > 0 && (
                            <p className="text-xs text-slate-400 mt-2">
                              {s.unidentifiedDays} ימים עם סימון ישן שלא שויך לשיעור — לא נכללו בחישוב
                            </p>
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
