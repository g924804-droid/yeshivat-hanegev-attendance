// אותה המרה קיימת גם בצד הלקוח (client/src/lib/utils.ts, toHebrewDateString) — לשמור על שתיהן זהות.

const HEB_ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const HEB_TENS: Record<number, string> = { 10: 'י', 20: 'כ', 30: 'ל', 40: 'מ', 50: 'נ', 60: 'ס', 70: 'ע', 80: 'פ', 90: 'צ' };
const HEB_HUNDREDS: Record<number, string> = {
  100: 'ק', 200: 'ר', 300: 'ש', 400: 'ת', 500: 'תק', 600: 'תר', 700: 'תש', 800: 'תת', 900: 'תתק',
};

/** ממיר מספר (1-999) לאותיות עבריות, עם החריגים המקובלים ט"ו/ט"ז במקום י"ה/י"ו. */
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
  if (remaining === 15 || remaining === 16) return result + (remaining === 15 ? 'טו' : 'טז');
  for (const t of [90, 80, 70, 60, 50, 40, 30, 20, 10]) {
    if (remaining >= t) {
      result += HEB_TENS[t];
      remaining -= t;
      break;
    }
  }
  return remaining > 0 ? result + HEB_ONES[remaining] : result;
}

function withGershayim(letters: string): string {
  if (letters.length <= 1) return `${letters}׳`;
  return `${letters.slice(0, -1)}״${letters.slice(-1)}`;
}

const formatter = new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' });

/** "2026-10-11" → "כ״ט בתשרי ה׳תשפ״ז". withYear=false → "כ״ט בתשרי". */
export function hebrewDate(iso: string, withYear = true): string {
  const parts = formatter.formatToParts(new Date(`${iso}T12:00:00`));
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  const month = parts.find((p) => p.type === 'month')?.value || '';
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const dayStr = withGershayim(numberToHebrewLetters(day));
  if (!withYear) return `${dayStr} ב${month}`;
  const yearStr = `${HEB_ONES[Math.floor(year / 1000)]}׳${withGershayim(numberToHebrewLetters(year % 1000))}`;
  return `${dayStr} ב${month} ${yearStr}`;
}
