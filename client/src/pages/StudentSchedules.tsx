import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Printer, Search } from 'lucide-react';
import { Layout } from '../components/Layout';
import { api } from '../lib/api';
import { lessonsForDate, lessonAppliesOnDate, currentWeekSunday, weekDates, addDays } from '../lib/scheduleRules';
import {
  startMinutes,
  lessonColor,
  compareLessonDisplayOrder,
  toHebrewDateString,
} from '../lib/utils';

type Lesson = {
  id: string;
  className: string;
  subject: string | null;
  dayOfWeek: string;
  time: string;
  track: string[];
  teacher: string[];
  room: string;
  fromDate?: string | null;
  toDate?: string | null;
};
type Ref = { id: string; name: string };
type Student = { id: string; name: string; trackIds: string[] };
type Data = { students: Student[]; lessons: Lesson[]; teachers: Ref[]; tracks: Ref[] };

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי'];
/** שעת ההתחלה של שיעור ("9:00-9:45" → "9:00") — שורות המערכת הן לפי שעת התחלה, כי השעות בפועל משתנות
 *  מאוד בין הימים והמסלולים (אחר הצהריים, שיעורים כפולים) ולא נכנסות למבנה השיעורים הקבוע. */
const startOf = (time: string) => (time || '').split('-')[0].trim();

/** "2026-10-12" → "12/10" */
function shortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(d)}/${Number(m)}`;
}

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

// גווני Tailwind של צבעי המסלולים — חלון ההדפסה לא טוען את ה-CSS של האתר, אז מתרגמים את המחלקות לצבעים ממשיים
const HEX: Record<string, Record<string, string>> = {
  amber: { 100: '#fef3c7', 300: '#fcd34d', 500: '#f59e0b', 900: '#78350f', 950: '#451a03' },
  sky: { 100: '#e0f2fe', 300: '#7dd3fc', 900: '#0c4a6e' },
  fuchsia: { 100: '#fae8ff', 300: '#f0abfc', 900: '#701a75' },
  teal: { 100: '#ccfbf1', 300: '#5eead4', 900: '#134e4a' },
  violet: { 100: '#ede9fe', 300: '#c4b5fd', 900: '#4c1d95' },
  lime: { 100: '#ecfccb', 300: '#bef264', 900: '#365314' },
  blue: { 100: '#dbeafe', 300: '#93c5fd', 900: '#1e3a8a' },
  rose: { 100: '#ffe4e6', 300: '#fda4af', 900: '#881337' },
  cyan: { 100: '#cffafe', 300: '#67e8f9', 900: '#164e63' },
  purple: { 100: '#f3e8ff', 300: '#d8b4fe', 900: '#581c87' },
  emerald: { 100: '#d1fae5', 300: '#6ee7b7', 900: '#064e3b' },
  indigo: { 100: '#e0e7ff', 300: '#a5b4fc', 900: '#312e81' },
  slate: { 50: '#f8fafc', 200: '#e2e8f0', 700: '#334155' },
};
function classesToStyle(classes: string): string {
  const pick = (prefix: string) => {
    const token = classes.split(' ').find((c) => c.startsWith(`${prefix}-`)) || '';
    const [, color, shade] = token.split('-');
    return HEX[color]?.[shade] || '';
  };
  return `background:${pick('bg')};border-color:${pick('border')};color:${pick('text')};`;
}

const PRINT_STYLE = `
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: 'Arial', sans-serif; direction: rtl; color: #1e293b; margin: 0;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { page-break-after: always; font-size: 11px; }
  .page:last-child { page-break-after: auto; }
  .head { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #c9a227; padding-bottom: 6px; margin-bottom: 8px; }
  .head h1 { margin: 0; font-size: 19px; color: #0f172a; }
  .head img { max-height: 46px; }
  h2 { font-size: 17px; margin: 0 0 2px; color: #0f172a; }
  .meta { color: #475569; margin-bottom: 6px; }
  .legend { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }
  .legend span { border: 1px solid; border-radius: 10px; padding: 1px 9px; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #cbd5e1; padding: 3px; vertical-align: top; }
  th { background: #0f172a; color: #f1c40f; font-size: 13px; padding: 5px; }
  th.p { width: 78px; }
  td.p { background: #f1f5f9; font-weight: bold; text-align: center; vertical-align: middle; }
  td.p small { display: block; font-weight: normal; color: #64748b; }
  .l { border: 1px solid; border-radius: 6px; padding: 3px 5px; margin-bottom: 2px; line-height: 1.3; }
  .l b { display: block; font-size: 12px; }
  .l small { opacity: .8; }
  .dense { font-size: 9.5px; }
  .dense .l { padding: 1px 4px; }
  .dense .l b { font-size: 10.5px; }
  .dense th { padding: 3px; }
`;

export function StudentSchedules() {
  const navigate = useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackId, setTrackId] = useState('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(currentWeekSunday());
  // ברירת מחדל: המערכת הקבועה. אפשר לכלול גם שינויים זמניים (כנס וכו') של השבוע שנבחר.
  const [withTemporary, setWithTemporary] = useState(false);

  useEffect(() => {
    api
      .get<Data>('/students/studentSchedules')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  const tracks = data?.tracks || [];
  const dates = useMemo(() => weekDates(weekStart), [weekStart]);

  const weekLessons = useMemo(() => {
    if (!data) return [];
    return DAYS.flatMap((day) =>
      withTemporary
        ? lessonsForDate(data.lessons, dates[day])
        : data.lessons.filter((l) => l.dayOfWeek === day && !l.toDate && lessonAppliesOnDate(l, dates[day]))
    );
  }, [data, dates, withTemporary]);

  const teacherName = (ids: string[]) =>
    (ids || []).map((id) => data?.teachers.find((t) => t.id === id)?.name).filter(Boolean).join(', ');
  // צבע המסלול כמו בכרטיסי השיעורים (קודש י"ג/י"ד מקבלים את הגוונים הקבועים שלהם)
  const trackColorOf = (id: string) => lessonColor({ track: [id] }, tracks);
  const trackName = (id: string) => tracks.find((t) => t.id === id)?.name || '';

  const lessonsOf = (s: Student) => weekLessons.filter((l) => (l.track || []).some((t) => s.trackIds.includes(t)));

  const sortedTracks = useMemo(() => [...tracks].sort((a, b) => String(a.name).localeCompare(String(b.name), 'he')), [tracks]);
  const shown = useMemo(
    () =>
      (data?.students || [])
        .filter((s) => (!trackId || s.trackIds.includes(trackId)) && s.name.includes(search.trim()))
        .sort((a, b) => a.name.localeCompare(b.name, 'he')),
    [data, trackId, search]
  );

  /** טבלת שעה×יום לתלמידה — שורה לכל שעת התחלה שיש בה שיעור באחד הימים. */
  function grid(s: Student) {
    const mine = lessonsOf(s);
    const cells = new Map<string, Lesson[]>();
    for (const l of mine) {
      const key = `${startOf(l.time)}|${l.dayOfWeek}`;
      cells.set(key, [...(cells.get(key) || []), l]);
    }
    for (const list of cells.values()) list.sort((a, b) => compareLessonDisplayOrder(a, b, tracks));
    const periods = Array.from(new Set(mine.map((l) => startOf(l.time)))).sort((a, b) => startMinutes(a) - startMinutes(b));
    return { mine, cells, periods };
  }
  const weekLabel = `${shortDate(dates['ראשון'])}–${shortDate(dates['חמישי'])}`;

  async function print(list: Student[]) {
    if (!list.length) return;
    let logo = '';
    try {
      const st = await api.get<{ siteName: string | null; hasLogo: boolean }>('/display/settings');
      if (st.hasLogo) logo = `<img src="${location.origin}/api/display/logo" />`;
    } catch {
      /* בלי לוגו */
    }
    const today = toHebrewDateString(new Date());
    const pages = list
      .map((s) => {
        const { cells, periods } = grid(s);
        const legend = s.trackIds
          .filter((t) => trackName(t))
          .map((t) => `<span style="${classesToStyle(trackColorOf(t))}">${esc(trackName(t))}</span>`)
          .join('');
        const rows = periods
          .map(
            (p) =>
              `<tr><td class="p">${esc(p)}</td>${DAYS.map(
                (d) =>
                  `<td>${(cells.get(`${p}|${d}`) || [])
                    .map(
                      (l) => `<div class="l" style="${classesToStyle(lessonColor(l, tracks))}">
                        <b>${esc(l.subject || l.className)}</b>
                        ${teacherName(l.teacher) ? `<div>${esc(teacherName(l.teacher))}</div>` : ''}
                        <small>${esc(l.time)}${l.room ? ` · ${esc(l.room)}` : ''}${l.toDate ? ` · זמני עד ${shortDate(l.toDate)}` : ''}</small>
                      </div>`
                    )
                    .join('')}</td>`
              ).join('')}</tr>`
          )
          .join('');
        // הרבה שורות (שיעורי אחר הצהריים וכו') — מקטינים כדי שהכל ייכנס בעמוד אחד
        return `<div class="page${periods.length > 11 ? ' dense' : ''}">
          <div class="head"><h1>סמינר מאיר</h1>${logo}</div>
          <h2>מערכת שעות — ${esc(s.name)}</h2>
          <div class="meta">${withTemporary ? `שבוע ${esc(weekLabel)} · ` : ''}הופק ב${esc(today)}</div>
          ${legend ? `<div class="legend">${legend}</div>` : ''}
          ${
            rows
              ? `<table><thead><tr><th class="p">שעה</th>${DAYS.map((d) => `<th>${d}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`
              : '<p>אין שיעורים במערכת למסלולים של התלמידה.</p>'
          }
        </div>`;
      })
      .join('');

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;left:0;bottom:0;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>מערכת שעות</title><style>${PRINT_STYLE}</style></head><body>${pages}</body></html>`);
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

  function preview(s: Student) {
    const { cells, periods } = grid(s);
    if (!periods.length) return <p className="text-slate-400 text-xs">אין שיעורים במערכת למסלולים של התלמידה</p>;
    return (
      <table className="w-full text-xs border-collapse bg-white table-fixed">
        <thead>
          <tr>
            <th className="border border-slate-200 bg-slate-50 p-1.5 w-20">שעה</th>
            {DAYS.map((d) => (
              <th key={d} className="border border-slate-200 bg-slate-50 p-1.5 text-navy">{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p}>
              <td className="border border-slate-200 bg-slate-50 p-1.5 text-center font-medium text-navy">
                {p}
              </td>
              {DAYS.map((d) => (
                <td key={d} className="border border-slate-200 p-1 align-top">
                  {(cells.get(`${p}|${d}`) || []).map((l) => (
                    <div key={l.id} className={`rounded-lg border px-1.5 py-1 mb-1 ${lessonColor(l, tracks)}`}>
                      <div className="font-semibold">{l.subject || l.className}</div>
                      <div className="opacity-80">{teacherName(l.teacher)}</div>
                      <div className="opacity-70">
                        {l.time}
                        {l.room ? ` · ${l.room}` : ''}
                        {l.toDate ? ` · זמני עד ${shortDate(l.toDate)}` : ''}
                      </div>
                    </div>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <Layout title="מערכות שעות אישיות">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate('/students')} className="btn-outline text-sm py-2">
          <ArrowRight size={16} /> חזרה למסלולים
        </button>
      </div>

      {error && <div className="mb-4 text-sm bg-red-50 text-red-700 rounded-xl px-4 py-2">{error}</div>}
      {!data && !error && <p className="text-center text-slate-400 py-6">טוען...</p>}

      {data && (
        <>
          <div className="card mb-4">
            <div className="flex flex-wrap gap-3 items-end">
              <label className="text-sm min-w-[180px]">
                מסלול
                <select className="input mt-1" value={trackId} onChange={(e) => setTrackId(e.target.value)}>
                  <option value="">כל המסלולים</option>
                  {sortedTracks.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>
              <div className="relative flex-1 min-w-[200px]">
                <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input pr-9" placeholder="חיפוש לפי שם..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <button className="btn-primary py-2" onClick={() => print(shown)} disabled={!shown.length}>
                <Printer size={16} /> הדפסת מערכות ({shown.length})
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={withTemporary} onChange={(e) => setWithTemporary(e.target.checked)} />
                כולל שינויים זמניים של שבוע מסוים
              </label>
              {withTemporary && (
                <div className="flex items-center gap-1">
                  <button className="p-1.5 rounded-lg hover:bg-slate-100" onClick={() => setWeekStart(addDays(weekStart, -7))} title="שבוע קודם">
                    <ChevronRight size={16} />
                  </button>
                  <span className="font-medium text-navy">שבוע {weekLabel}</span>
                  <button className="p-1.5 rounded-lg hover:bg-slate-100" onClick={() => setWeekStart(addDays(weekStart, 7))} title="שבוע הבא">
                    <ChevronLeft size={16} />
                  </button>
                </div>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-2">
              לכל תלמידה מוצגים השיעורים של כל המסלולים שהיא רשומה אליהם, בצבע של המסלול (כמו במערכת השעות). כל תלמידה מודפסת
              בעמוד נפרד לרוחב — ומחלון ההדפסה אפשר גם לשמור כ-PDF.
            </p>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full text-sm text-center">
              <thead>
                <tr className="text-slate-500 border-b">
                  <th className="py-2 w-6"></th>
                  <th className="text-right">שם</th>
                  <th className="text-right">מסלולים</th>
                  <th>שיעורים בשבוע</th>
                  <th>הדפסה</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <Fragment key={s.id}>
                    <tr className="border-b hover:bg-slate-50 cursor-pointer" onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                      <td className="py-2 text-slate-400">{openId === s.id ? <ChevronDown size={16} /> : <ChevronLeft size={16} />}</td>
                      <td className="text-right font-medium">{s.name}</td>
                      <td className="text-right">
                        <div className="flex flex-wrap gap-1 py-1">
                          {s.trackIds.filter((t) => trackName(t)).map((t) => (
                            <span key={t} className={`badge border ${trackColorOf(t)}`}>{trackName(t)}</span>
                          ))}
                        </div>
                      </td>
                      <td>{lessonsOf(s).length || <span className="text-slate-300">—</span>}</td>
                      <td>
                        <button
                          className="p-1.5 rounded-lg hover:bg-slate-200 text-navy"
                          title="הדפסת מערכת שעות לתלמידה"
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
                        <td colSpan={5} className="p-3 text-right">{preview(s)}</td>
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
