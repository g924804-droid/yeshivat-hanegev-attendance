import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Printer, Search } from 'lucide-react';
import { Layout } from '../components/Layout';
import { api } from '../lib/api';
import { buildGrid, ROWS } from '../lib/studentScheduleGrid';
import { lessonsForDate, lessonAppliesOnDate, currentWeekSunday, weekDates, addDays } from '../lib/scheduleRules';
import {
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

// עמוד A4 לרוחב פחות שוליים: 277×190 מ"מ. כל מערכת נכנסת לעמוד אחד — אחרי הציור מגדילים/מקטינים אותה (fitPages).
const PRINT_STYLE = `
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: 'Arial', sans-serif; direction: rtl; color: #1e293b; margin: 0;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 277mm; height: 189mm; overflow: hidden; page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .fit { font-size: 12px; transform-origin: top right; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 12px;
          border-bottom: 4px solid #c9a227; padding-bottom: 6px; margin-bottom: 8px; }
  .name { font-size: 30px; font-weight: 900; color: #0f172a; line-height: 1.15; }
  .sub { font-size: 14px; color: #475569; margin-top: 2px; }
  .brand { text-align: left; font-size: 16px; font-weight: bold; color: #0f172a; white-space: nowrap; }
  .brand img { max-height: 54px; display: block; margin: 0 0 2px auto; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .legend span { border: 1.5px solid; border-radius: 12px; padding: 1px 10px; font-weight: bold; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #94a3b8; padding: 3px; vertical-align: top; }
  th { background: #0f172a; color: #f1c40f; font-size: 16px; padding: 6px; }
  th.p { width: 92px; }
  td.p { background: #e2e8f0; font-weight: bold; font-size: 14px; text-align: center; vertical-align: middle; color: #0f172a; }
  td.p small { display: block; font-weight: normal; font-size: 10px; color: #475569; }
  td.one { text-align: center; vertical-align: middle; padding: 5px; line-height: 1.3; border: 1px solid #94a3b8 !important; }
  td.one b { display: block; font-size: 15px; }
  td.one .t { font-size: 13px; }
  td.one small { font-size: 11px; opacity: .85; }
  .l { border: 1.5px solid; border-radius: 7px; padding: 4px 6px; margin-bottom: 3px; line-height: 1.25; text-align: center; }
  .l + .l { margin-top: 3px; }
  .l b { display: block; font-size: 14px; }
  .l .t { font-size: 12px; }
  .l small { font-size: 10.5px; opacity: .85; }
`;

/** מגדיל/מקטין כל מערכת כך שתמלא בדיוק עמוד אחד — לא נחתכת לשני עמודים, ולא קטנה מדי כשיש מעט שיעורים. */
function fitPages(doc: Document) {
  doc.querySelectorAll<HTMLElement>('.page').forEach((page) => {
    const fit = page.querySelector<HTMLElement>('.fit')!;
    let scale = 1;
    // הטבלה נפרשת מחדש לפי הרוחב, אז מחשבים כמה פעמים עד שמתייצב
    for (let i = 0; i < 4; i++) {
      fit.style.width = `${page.clientWidth / scale}px`;
      fit.style.transform = `scale(${scale})`;
      const next = Math.min(1.6, (page.clientHeight / fit.scrollHeight) * 0.98, 1.6);
      if (Math.abs(next - scale) < 0.01) break;
      scale = next;
    }
  });
}


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

  /** טבלת שורות קבועות (תפילה, שיעור ראשון...) × ימים לתלמידה — ראו studentScheduleGrid. */
  function grid(s: Student) {
    return buildGrid(lessonsOf(s), DAYS, (a, b) => compareLessonDisplayOrder(a, b, tracks));
  }
  const weekLabel = `${shortDate(dates['ראשון'])}–${shortDate(dates['חמישי'])}`;
  // השעה מוצגת בשיעור רק כשהיא שונה מהשעה הרגילה של השורה (למשל ביום שלישי, או שיעור כפול)
  const timeNote = (l: Lesson, row: number) => (l.time.replace(/\s/g, '') === ROWS[row].time ? '' : l.time);

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
    const lessonHtml = (l: Lesson, row: number) => {
      const extra = [timeNote(l, row), l.room, l.toDate ? `זמני עד ${shortDate(l.toDate)}` : ''].filter(Boolean).join(' · ');
      return `<b>${esc(l.subject || l.className)}</b>${teacherName(l.teacher) ? `<div class="t">${esc(teacherName(l.teacher))}</div>` : ''}${
        extra ? `<small>${esc(extra)}</small>` : ''
      }`;
    };
    const pages = list
      .map((s) => {
        const { rows, cells } = grid(s);
        const legend = s.trackIds
          .filter((t) => trackName(t))
          .map((t) => `<span style="${classesToStyle(trackColorOf(t))}">${esc(trackName(t))}</span>`)
          .join('');
        const body = rows
          .map(
            (r) =>
              `<tr><td class="p">${esc(ROWS[r].label)}<small>${esc(ROWS[r].time)}</small></td>${DAYS.map((d) => {
                const c = cells[d][r];
                if (c === 'covered') return '';
                if (!c) return '<td></td>';
                const span = c.span > 1 ? ` rowspan="${c.span}"` : '';
                if (c.lessons.length === 1)
                  return `<td class="one"${span} style="${classesToStyle(lessonColor(c.lessons[0], tracks))}">${lessonHtml(c.lessons[0], r)}</td>`;
                return `<td${span}>${c.lessons
                  .map((l) => `<div class="l" style="${classesToStyle(lessonColor(l, tracks))}">${lessonHtml(l, r)}</div>`)
                  .join('')}</td>`;
              }).join('')}</tr>`
          )
          .join('');
        const tracksLine = s.trackIds.map(trackName).filter(Boolean).join(' · ');
        return `<div class="page"><div class="fit">
          <div class="head">
            <div>
              <div class="name">${esc(s.name)}</div>
              <div class="sub">מערכת שעות${withTemporary ? ` · שבוע ${esc(weekLabel)}` : ''} · הופק ב${esc(today)}</div>
              ${legend ? `<div class="legend">${legend}</div>` : tracksLine ? `<div class="sub">${esc(tracksLine)}</div>` : ''}
            </div>
            <div class="brand">${logo}סמינר מאיר</div>
          </div>
          ${
            body
              ? `<table><thead><tr><th class="p"></th>${DAYS.map((d) => `<th>${d}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`
              : '<p>אין שיעורים במערכת למסלולים של התלמידה.</p>'
          }
        </div></div>`;
      })
      .join('');

    const iframe = document.createElement('iframe');
    // מחוץ למסך אבל ברוחב עמוד אמיתי — כדי שאפשר יהיה למדוד את המערכות ולהתאים אותן לעמוד
    iframe.style.cssText = 'position:fixed;width:300mm;height:200mm;border:0;left:-10000px;top:0;';
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
    fitPages(doc);
    iframe.contentWindow!.focus();
    iframe.contentWindow!.print();
    setTimeout(() => iframe.remove(), 60_000);
  }

  function preview(s: Student) {
    const { rows, cells } = grid(s);
    if (!rows.length) return <p className="text-slate-400 text-xs">אין שיעורים במערכת למסלולים של התלמידה</p>;
    const lessonBody = (l: Lesson, r: number) => {
      const extra = [timeNote(l, r), l.room, l.toDate ? `זמני עד ${shortDate(l.toDate)}` : ''].filter(Boolean).join(' · ');
      return (
        <>
          <div className="font-bold text-[13px]">{l.subject || l.className}</div>
          <div>{teacherName(l.teacher)}</div>
          {extra && <div className="opacity-75 text-[11px]">{extra}</div>}
        </>
      );
    };
    return (
      <table className="w-full text-xs border-collapse bg-white table-fixed">
        <thead>
          <tr>
            <th className="border border-slate-300 bg-navy p-1.5 w-24"></th>
            {DAYS.map((d) => (
              <th key={d} className="border border-slate-300 bg-navy text-gold p-1.5 text-sm">{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <td className="border border-slate-300 bg-slate-100 p-1.5 text-center font-bold text-navy">
                {ROWS[r].label}
                <div className="font-normal text-slate-500 text-[11px]">{ROWS[r].time}</div>
              </td>
              {DAYS.map((d) => {
                const c = cells[d][r];
                if (c === 'covered') return null;
                if (!c) return <td key={d} className="border border-slate-300" />;
                if (c.lessons.length === 1)
                  return (
                    <td
                      key={d}
                      rowSpan={c.span}
                      className={`border border-slate-300 p-1.5 text-center align-middle ${lessonColor(c.lessons[0], tracks)}`}
                    >
                      {lessonBody(c.lessons[0], r)}
                    </td>
                  );
                return (
                  <td key={d} rowSpan={c.span} className="border border-slate-300 p-1 align-top">
                    {c.lessons.map((l) => (
                      <div key={l.id} className={`rounded-lg border px-1.5 py-1 mb-1 text-center ${lessonColor(l, tracks)}`}>
                        {lessonBody(l, r)}
                      </div>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <Layout title="מערכות שעות אישיות">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate(-1)} className="btn-outline text-sm py-2">
          <ArrowRight size={16} /> חזרה
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
