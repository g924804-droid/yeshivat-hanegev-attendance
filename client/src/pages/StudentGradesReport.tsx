import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronLeft, FileSpreadsheet, Printer, Search } from 'lucide-react';
import { Layout } from '../components/Layout';
import { api, FILTER_BLOCKED_MESSAGE } from '../lib/api';
import { todayStr, toHebrewDateString } from '../lib/utils';

type GradeEntry = { date: string; hebDate: string; testName: string; score: number; notes: string };
type SubjectRow = { category: string; subject: string; teacher: string; grades: GradeEntry[]; average: number };
type StudentGrades = {
  id: string;
  name: string;
  tracks: string[];
  subjects: SubjectRow[];
  count: number;
  average: number | null;
  failing: number;
};
type Summary = {
  from: string;
  to: string;
  fromHeb: string;
  toHeb: string;
  trackName: string | null;
  passScore: number;
  students: StudentGrades[];
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

/** המקצועות מקובצים לפי קטגוריה (קודש / המסלול), בסדר שהשרת החזיר. */
function groupByCategory(subjects: SubjectRow[]): [string, SubjectRow[]][] {
  const groups = new Map<string, SubjectRow[]>();
  for (const s of subjects) groups.set(s.category, [...(groups.get(s.category) || []), s]);
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
  .avg { padding: 8px 12px; border-radius: 8px; font-weight: bold; margin: 10px 0 14px; background: #f1f5f9; color: #0f172a; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 14px; font-size: 12.5px; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 7px; text-align: center; }
  th { background: #0f172a; color: #f1c40f; }
  td.r { text-align: right; }
  tr.cat td { background: #e2e8f0; font-weight: bold; text-align: right; }
  tr.sub td { background: #f8fafc; font-weight: bold; }
  .red { color: #b91c1c; font-weight: bold; }
  .note { margin-top: 12px; }
  .sign { margin-top: 28px; }
`;

export function StudentGradesReport() {
  const navigate = useNavigate();
  const [from, setFrom] = useState(schoolYearStart());
  const [to, setTo] = useState(todayStr());
  const [trackId, setTrackId] = useState('');
  const [passScore, setPassScore] = useState('55');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [onlyWithGrades, setOnlyWithGrades] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [signature, setSignature] = useState('בברכה,\nהנהלת הסמינר');

  const query = () => ({ from, to, trackId: trackId || undefined, passScore });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setSummary(await api.get<Summary>('/grades/gradesSummary', query()));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api
      .get<{ tracks: Track[] }>('/grades/getTracks')
      .then((r) => setTracks(r.tracks.sort((a, b) => a.name.localeCompare(b.name, 'he'))))
      .catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(
    () => (summary?.students || []).filter((s) => s.name.includes(search.trim()) && (!onlyWithGrades || s.count > 0)),
    [summary, search, onlyWithGrades]
  );
  const pass = summary?.passScore ?? 55;
  const scoreClass = (n: number | null) => (n != null && n < pass ? 'text-red-600 font-bold' : '');

  async function exportExcel() {
    setExporting(true);
    setError(null);
    try {
      const q = query();
      const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined) as [string, string][]);
      const res = await fetch(`/api/grades/exportGradesExcel?${qs}`, { credentials: 'include' });
      if (res.status === 418) throw new Error(FILTER_BLOCKED_MESSAGE);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `הייצוא נכשל (${res.status})`);
      }
      const blobUrl = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `ציונים ${hebrewOf(from)} עד ${hebrewOf(to)}.xlsx`;
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

  /** גליון ציונים מודפס — כל תלמידה בעמוד נפרד. נפתח בחלון ההדפסה, ומשם אפשר גם לשמור כ-PDF. */
  async function print(list: StudentGrades[]) {
    if (!summary || !list.length) return;
    let logo = '';
    try {
      const s = await api.get<{ siteName: string | null; hasLogo: boolean }>('/display/settings');
      if (s.hasLogo) logo = `<img src="${location.origin}/api/display/logo" />`;
    } catch {
      /* בלי לוגו */
    }
    const today = toHebrewDateString(new Date());
    const lines = (text: string) => esc(text).replace(/\n/g, '<br>');
    const red = (n: number) => (n < summary.passScore ? 'red' : '');

    const reports = list
      .map((s) => {
        const rows = groupByCategory(s.subjects)
          .map(
            ([category, subjects]) =>
              `<tr class="cat"><td colspan="4">${esc(category)}</td></tr>` +
              subjects
                .map(
                  (sub) =>
                    sub.grades
                      .map(
                        (g, i) => `<tr>${i === 0 ? `<td class="r" rowspan="${sub.grades.length + (sub.grades.length > 1 ? 1 : 0)}"><b>${esc(sub.subject)}</b></td>` : ''}
                          <td class="r">${esc(g.testName)}</td><td>${esc(g.hebDate)}</td><td class="${red(g.score)}">${g.score}</td></tr>`
                      )
                      .join('') +
                    (sub.grades.length > 1
                      ? `<tr class="sub"><td class="r">ממוצע במקצוע</td><td></td><td class="${red(sub.average)}">${sub.average}</td></tr>`
                      : '')
                )
                .join('')
          )
          .join('');
        return `<div class="report">
          <div class="head"><h1>סמינר מאיר</h1>${logo}</div>
          <h2>גליון ציונים — ${esc(s.name)}</h2>
          <div class="meta">תקופה: ${esc(summary.fromHeb)} – ${esc(summary.toHeb)}${
            summary.trackName ? ` · מסלול: ${esc(summary.trackName)}` : s.tracks.length ? ` · ${esc(s.tracks.join(', '))}` : ''
          }<br>הופק ב${esc(today)}</div>
          ${
            rows
              ? `${s.average != null ? `<div class="avg">ממוצע כללי: <span class="${red(s.average)}">${s.average}</span></div>` : ''}
                 <table><thead><tr><th>מקצוע</th><th>מבחן/מטלה</th><th>תאריך</th><th>ציון</th></tr></thead><tbody>${rows}</tbody></table>`
              : '<p>לא נרשמו ציונים בתקופה זו.</p>'
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
    doc.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>גליון ציונים</title><style>${PRINT_STYLE}</style></head><body>${reports}</body></html>`);
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

  const withGrades = summary?.students.filter((s) => s.count > 0) || [];
  const averages = withGrades.map((s) => s.average!).filter((n) => n != null);
  const overall = averages.length ? Math.round((averages.reduce((a, b) => a + b, 0) / averages.length) * 10) / 10 : null;

  return (
    <Layout title="דוחות ציונים">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate('/grades')} className="btn-outline text-sm py-2">
          <ArrowRight size={16} /> חזרה למסלולים
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
          <label className="text-sm">
            ציון עובר
            <input
              type="number"
              min={0}
              max={100}
              className="input mt-1 w-24"
              value={passScore}
              onChange={(e) => setPassScore(e.target.value)}
            />
            <span className="block h-4 mt-1" />
          </label>
          <button className="btn-primary py-2 mb-5" onClick={load} disabled={loading || !from || !to}>
            {loading ? 'טוען...' : 'הצגת הדוח'}
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          ממוצע במקצוע = ממוצע כל הציונים בו בתקופה. ממוצע כללי = ממוצע של ממוצעי המקצועות. ציון נמוך מהציון העובר
          מסומן באדום. ציון שנרשם בלי תאריך נכלל תמיד.
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
              <div className="text-2xl font-bold text-navy">{withGrades.reduce((n, s) => n + s.count, 0)}</div>
              <div className="text-xs text-slate-500 mt-1">ציונים בתקופה</div>
            </div>
            <div className="card text-center py-3">
              <div className={`text-2xl font-bold ${overall != null && overall < pass ? 'text-red-600' : 'text-green-600'}`}>
                {overall ?? '—'}
              </div>
              <div className="text-xs text-slate-500 mt-1">ממוצע כללי</div>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input pr-9" placeholder="חיפוש לפי שם..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <label className="text-sm flex items-center gap-1.5">
              <input type="checkbox" checked={onlyWithGrades} onChange={(e) => setOnlyWithGrades(e.target.checked)} /> רק מי שיש לה ציונים
            </label>
            <button className="btn-outline py-2" onClick={exportExcel} disabled={exporting}>
              <FileSpreadsheet size={16} /> {exporting ? 'מייצא...' : 'ייצוא לאקסל'}
            </button>
            <button className="btn-outline py-2" onClick={() => print(shown)} disabled={!shown.length}>
              <Printer size={16} /> הדפסת גליונות ({shown.length})
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
                  <th>ציונים</th>
                  <th>ממוצע כללי</th>
                  <th>מתחת ל-{pass}</th>
                  <th>דוח</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <Fragment key={s.id}>
                    <tr className="border-b hover:bg-slate-50 cursor-pointer" onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                      <td className="py-2 text-slate-400">{openId === s.id ? <ChevronDown size={16} /> : <ChevronLeft size={16} />}</td>
                      <td className="text-right">
                        <div className="font-medium">{s.name}</div>
                        <div className="text-xs text-slate-400">{s.tracks.join(' · ')}</div>
                      </td>
                      <td>{s.count || <span className="text-slate-300">—</span>}</td>
                      <td className={`font-bold ${scoreClass(s.average)}`}>{s.average ?? ''}</td>
                      <td className="text-red-600">{s.failing || ''}</td>
                      <td>
                        <button
                          className="p-1.5 rounded-lg hover:bg-slate-200 text-navy"
                          title="הדפסת גליון ציונים לתלמידה"
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
                        <td colSpan={6} className="p-3 text-right">
                          {s.subjects.length ? (
                            <table className="w-full text-xs text-center bg-white rounded-lg">
                              <thead>
                                <tr className="text-slate-500 border-b">
                                  <th className="py-1.5 text-right px-2">מקצוע</th>
                                  <th>מורה</th>
                                  <th className="text-right">ציונים</th>
                                  <th>ממוצע</th>
                                </tr>
                              </thead>
                              <tbody>
                                {groupByCategory(s.subjects).map(([category, rows]) => (
                                  <Fragment key={category}>
                                    <tr className="bg-slate-100">
                                      <td colSpan={4} className="py-1 px-2 text-right font-bold text-navy">{category}</td>
                                    </tr>
                                    {rows.map((sub) => (
                                      <tr key={sub.subject} className="border-b last:border-0">
                                        <td className="py-1.5 text-right px-2">{sub.subject}</td>
                                        <td>{sub.teacher}</td>
                                        <td className="text-right">
                                          <div className="flex flex-wrap gap-1">
                                            {sub.grades.map((g, i) => (
                                              <span
                                                key={i}
                                                className={`badge ${g.score < pass ? 'bg-red-100 text-red-700' : 'bg-navy-50 text-navy'}`}
                                                title={g.notes}
                                              >
                                                {g.testName ? `${g.testName}: ` : ''}
                                                <b>{g.score}</b> · {g.hebDate}
                                              </span>
                                            ))}
                                          </div>
                                        </td>
                                        <td className={`font-bold ${scoreClass(sub.average)}`}>{sub.average}</td>
                                      </tr>
                                    ))}
                                  </Fragment>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="text-slate-400 text-xs">לא נרשמו ציונים בתקופה זו</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && (
              <p className="text-center text-slate-400 py-6">
                {summary.students.length ? 'אין תלמידות להצגה' : 'לא נרשמו ציונים בתקופה זו — בחרי מסלול כדי לראות את התלמידות שלו'}
              </p>
            )}
          </div>
        </>
      )}
    </Layout>
  );
}
