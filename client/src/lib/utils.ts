export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function safeFixed(n: number | null | undefined, digits = 2): string {
  return typeof n === 'number' && !Number.isNaN(n) ? n.toFixed(digits) : (0).toFixed(digits);
}

export const DOW_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** ממיר "9:00-9:45" למספר דקות מתחילת היום, לצורך מיון כרונולוגי נכון (מיון מחרוזות רגיל שובר בין 9 ל-11). */
export function startMinutes(time: string): number {
  const [h, m] = (time || '').split('-')[0].split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** מבנה היום הרשמי — משמש גם את מערכת השעות במסך הניהול וגם את מסך התצוגה, כדי שהשעות תמיד יסתדרו בשורה אחת מסודרת. */
export const TIME_SLOTS = [
  { time: '8:30-9:00', label: 'תפילה' },
  { time: '9:00-9:45', label: 'שיעור ראשון' },
  { time: '9:45-10:30', label: 'שיעור שני' },
  { time: '10:30-11:00', label: 'הפסקה' },
  { time: '11:00-11:45', label: 'שיעור שלישי' },
  { time: '11:45-12:30', label: 'שיעור רביעי' },
  { time: '12:30-12:45', label: 'הפסקה' },
  { time: '12:45-13:30', label: 'שיעור חמישי' },
  { time: '13:30-14:15', label: 'שיעור שישי' },
  { time: '14:15-14:30', label: 'הפסקה' },
  { time: '14:30-15:15', label: 'שיעור שביעי' },
  { time: '15:15-16:00', label: 'שיעור שמיני' },
];

export const TRACK_COLORS = [
  'bg-blue-50 border-blue-200 text-blue-800',
  'bg-purple-50 border-purple-200 text-purple-800',
  'bg-emerald-50 border-emerald-200 text-emerald-800',
  'bg-amber-50 border-amber-200 text-amber-800',
  'bg-rose-50 border-rose-200 text-rose-800',
  'bg-teal-50 border-teal-200 text-teal-800',
  'bg-indigo-50 border-indigo-200 text-indigo-800',
  'bg-orange-50 border-orange-200 text-orange-800',
];

/** צבע קבוע לכל מסלול (לפי המיקום שלו ברשימת המסלולים), כדי שאותו מסלול תמיד יופיע באותו צבע. */
export function trackColor(trackId: string | undefined, trackIds: string[]): string {
  if (!trackId) return 'bg-slate-50 border-slate-200 text-slate-700';
  const idx = trackIds.indexOf(trackId);
  return TRACK_COLORS[idx % TRACK_COLORS.length] || TRACK_COLORS[0];
}

const HEB_ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const HEB_TENS: Record<number, string> = { 10: 'י', 20: 'כ', 30: 'ל', 40: 'מ', 50: 'נ', 60: 'ס', 70: 'ע', 80: 'פ', 90: 'צ' };
const HEB_HUNDREDS: Record<number, string> = {
  100: 'ק', 200: 'ר', 300: 'ש', 400: 'ת', 500: 'תק', 600: 'תר', 700: 'תש', 800: 'תת', 900: 'תתק',
};

/** ממיר מספר (1-999) לאותיות עבריות (גימטריה), עם החריגים המקובלים ט"ו/ט"ז במקום י"ה/י"ו. */
function numberToHebrewLetters(n: number): string {
  let remaining = n;
  let result = '';

  for (const h of [900, 800, 700, 600, 500, 400, 300, 200, 100]) {
    if (remaining >= h) {
      result += HEB_HUNDREDS[h];
      remaining -= h;
      break;
    }
  }

  if (remaining === 15) {
    result += 'טו';
    remaining = 0;
  } else if (remaining === 16) {
    result += 'טז';
    remaining = 0;
  } else {
    for (const t of [90, 80, 70, 60, 50, 40, 30, 20, 10]) {
      if (remaining >= t) {
        result += HEB_TENS[t];
        remaining -= t;
        break;
      }
    }
    if (remaining > 0) result += HEB_ONES[remaining];
  }

  return result;
}

/** מוסיף גרש/גרשיים במקום המקובל (גרש לאות בודדת, גרשיים לפני האות האחרונה). */
function withGershayim(letters: string): string {
  if (letters.length <= 1) return `${letters}׳`;
  return `${letters.slice(0, -1)}״${letters.slice(-1)}`;
}

/** מחזיר תאריך עברי מלא בכתיב עברי מסורתי (אותיות, לא ספרות), למשל "י״ז באלול ה׳תשפ״ו". */
export function toHebrewDateString(date: Date): string {
  const parts = new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(
    date
  );
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  const month = parts.find((p) => p.type === 'month')?.value || '';
  const year = Number(parts.find((p) => p.type === 'year')?.value);

  const dayStr = withGershayim(numberToHebrewLetters(day));
  const thousands = Math.floor(year / 1000);
  const yearRemainder = year % 1000;
  const yearStr = `${HEB_ONES[thousands]}׳${withGershayim(numberToHebrewLetters(yearRemainder))}`;

  return `${dayStr} ב${month} ${yearStr}`;
}
