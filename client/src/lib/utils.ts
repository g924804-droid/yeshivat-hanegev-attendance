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
