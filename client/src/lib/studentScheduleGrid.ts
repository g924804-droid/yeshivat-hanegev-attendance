import { getTimeSlotsForDay, TIME_SLOTS } from './utils';

/**
 * פריסת מערכת שעות אישית לפי שורות קבועות (תפילה, שיעור ראשון...) ולא לפי שעה מדויקת —
 * ביום שלישי השעות שונות, ויש שיעורים בשעות לא עגולות (9:30, 12:50) ושיעורים כפולים. שורה לכל
 * שעה מדויקת פיזרה את המערכת על הרבה שורות חצי ריקות, אז כל שיעור נכנס לשורה שהוא חופף לה
 * ברובה, ושיעור כפול תופס כמה שורות.
 */

const minutes = (t: string) => {
  const [h, m] = t.trim().split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
function range(time: string): [number, number] {
  const [a, b] = (time || '').split('-');
  const start = minutes(a || '');
  const end = b ? minutes(b) : start;
  return [start, end > start ? end : start];
}

// שעות אחר הצהריים — אחרי השיעור השמיני (בשלישי הוא נגמר ב-16:45, בשאר הימים ב-16:00; השיעור הראשון אחה"צ מתחיל ב-16:15)
const AFTERNOON = ['אחה"צ א', 'אחה"צ ב', 'אחה"צ ג'];
const AFTERNOON_TIMES: Record<string, string[]> = {
  regular: ['16:15-17:00', '17:00-17:45', '17:45-18:30'],
  שלישי: ['16:45-17:30', '17:30-18:15', '18:15-19:00'],
};

/** כל השורות האפשריות, עם השעה ביום רגיל (לכותרת השורה). */
export const ROWS = [
  ...TIME_SLOTS.filter((s) => s.label !== 'הפסקה').map((s) => ({ label: s.label, time: s.time })),
  ...AFTERNOON.map((label, i) => ({ label, time: AFTERNOON_TIMES.regular[i] })),
];

function daySlots(day: string): [number, number][] {
  const regular = getTimeSlotsForDay(day).filter((s) => s.label !== 'הפסקה').map((s) => range(s.time));
  const extra = (AFTERNOON_TIMES[day] || AFTERNOON_TIMES.regular).map(range);
  return [...regular, ...extra];
}

/** השורות (מאינדקס עד אינדקס) שהשיעור תופס: כל שורה שהוא חופף ליותר מחציה (או ליותר מחצי השיעור). */
export function rowsOf(day: string, time: string): [number, number] {
  const slots = daySlots(day);
  const [s, e] = range(time);
  if (s === e) {
    const i = slots.findIndex(([a, b]) => s >= a && s < b);
    return i === -1 ? [slots.length - 1, slots.length - 1] : [i, i];
  }
  const overlap = slots.map(([a, b]) => Math.max(0, Math.min(b, e) - Math.max(a, s)));
  const hits = overlap
    .map((o, i) => (o * 2 > Math.min(slots[i][1] - slots[i][0], e - s) ? i : -1))
    .filter((i) => i !== -1);
  if (hits.length) return [hits[0], hits[hits.length - 1]];
  const best = overlap.indexOf(Math.max(...overlap));
  if (overlap[best] > 0) return [best, best];
  // לא חופף אף שורה (שיעור בזמן הפסקה, לפני/אחרי היום) — לשורה הקרובה ביותר, לא לשורה האחרונה
  const gap = slots.map(([a, b]) => (s >= b ? s - b : a - e));
  const nearest = gap.indexOf(Math.min(...gap));
  return [nearest, nearest];
}

export type GridCell<L> = { lessons: L[]; span: number } | 'covered' | null;

/**
 * טבלה: rows = אינדקסים של השורות שמוצגות (מהשורה הראשונה שיש בה שיעור עד האחרונה),
 * cells[day][row] = השיעורים שמתחילים בשורה + כמה שורות הם תופסים (rowSpan), 'covered' לשורה
 * שתפוסה ע"י שיעור כפול מלמעלה, או null לשעה חופשית.
 */
export function buildGrid<L extends { dayOfWeek: string; time: string }>(lessons: L[], days: string[], order: (a: L, b: L) => number) {
  const cells: Record<string, GridCell<L>[]> = {};
  let first = Infinity;
  let last = -1;
  for (const day of days) {
    const col: GridCell<L>[] = ROWS.map(() => null);
    const placed = lessons
      .filter((l) => l.dayOfWeek === day)
      .map((l) => ({ l, r: rowsOf(day, l.time) }))
      .sort((a, b) => a.r[0] - b.r[0]);
    const starts = new Set(placed.map((p) => p.r[0]));
    for (const row of Array.from(starts)) {
      const group = placed.filter((p) => p.r[0] === row);
      let span = Math.min(...group.map((p) => p.r[1] - p.r[0] + 1));
      // לא לדרוס שורה שיש בה שיעור אחר שמתחיל בה
      for (let r = row + 1; r < row + span; r++) if (starts.has(r)) { span = r - row; break; }
      // אם השורה כבר מכוסה ע"י שיעור כפול מלמעלה — מקצרים את הכפול כדי שגם זה יוצג
      if (col[row] === 'covered') {
        let top = row - 1;
        while (col[top] === 'covered') top--;
        const above = col[top] as { lessons: L[]; span: number };
        const oldEnd = top + above.span;
        above.span = row - top;
        for (let r = row; r < oldEnd; r++) col[r] = null;
      }
      col[row] = { lessons: group.map((p) => p.l).sort(order), span };
      for (let r = row + 1; r < row + span; r++) col[r] = 'covered';
      first = Math.min(first, row);
      last = Math.max(last, row + span - 1);
    }
    cells[day] = col;
  }
  const rows = last === -1 ? [] : ROWS.map((_, i) => i).filter((i) => i >= first && i <= last);
  return { rows, cells };
}
