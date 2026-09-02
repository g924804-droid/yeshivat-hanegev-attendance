// חגים ישראליים — מחושבים דינמית (מדויק לכל שנה, לא רק 5785-5787 כמו במקור) דרך @hebcal/core.
// @hebcal/core הוא חבילת ESM-בלבד; הפרויקט הזה הוא CommonJS (Node 16), אז טוענים אותה ב-import()
// אמיתי דרך ה-Function trick למטה כדי שטייפסקריפט לא "יוריד רמה" את ה-import() ל-require() (שהיה נכשל על ESM).
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<any>;

export type HolidayType = 'full' | 'half';
export type Holiday = { date: string; name: string; type: HolidayType };

// מדיניות (ניתנת לעריכה): אלו הימים שנחשבים "חג" (ללא עבודה) מול "חצי יום/צום".
// full  = חג בפועל: ר"ה (2 ימים), יו"כ, סוכות א', שמיני עצרת, פסח א'+ז', שבועות, יום העצמאות, פורים.
// half  = חוה"מ, ערבי חג, וצומות (גדליה, עשרה בטבת, תענית אסתר, י"ז בתמוז, ט' באב, תענית בכורות).
const CHAG = 0x1;
const EREV = 0x100000;
const CHOL_HAMOED = 0x200000;
const MINOR_FAST = 0x100;
const MAJOR_FAST = 0x4000;

function classify(basename: string, flags: number): HolidayType | null {
  const isErev = !!(flags & EREV);
  const isCholHamoed = !!(flags & CHOL_HAMOED);
  const isChag = !!(flags & CHAG);

  if (isChag && !isErev && !isCholHamoed) return 'full'; // ר"ה, יו"כ, סוכות א', שמיני עצרת, פסח א'/ז', שבועות
  if (basename === "Yom HaAtzma'ut") return 'full';
  if (basename === 'Purim') return 'full';
  if (isCholHamoed || isErev) return 'half';
  if (flags & MINOR_FAST || flags & MAJOR_FAST) return 'half';
  return null;
}

const HEBREW_NAMES: Record<string, string> = {
  'Rosh Hashana': 'ראש השנה',
  'Yom Kippur': 'יום כיפור',
  Sukkot: 'סוכות',
  'Shmini Atzeret': 'שמיני עצרת',
  Pesach: 'פסח',
  Shavuot: 'שבועות',
  "Yom HaAtzma'ut": 'יום העצמאות',
  Purim: 'פורים',
  "Ta'anit Esther": "תענית אסתר",
  'Tzom Gedaliah': 'צום גדליה',
  "Asara B'Tevet": "עשרה בטבת",
  'Tzom Tammuz': "י\"ז בתמוז",
  "Tish'a B'Av": "תשעה באב",
  "Ta'anit Bechorot": 'תענית בכורות',
};

let cache: { minYear: number; maxYear: number; holidays: Map<string, Holiday> } | null = null;

async function loadRange(minYear: number, maxYear: number) {
  const { HebrewCalendar, Location } = await dynamicImport('@hebcal/core');
  const events = HebrewCalendar.calendar({
    year: minYear,
    isHebrewYear: false,
    numYears: maxYear - minYear + 1,
    il: true,
    location: Location.lookup('Jerusalem'),
    candlelighting: false,
    sedrot: false,
    omer: false,
    noRoshChodesh: true,
  });

  const map = new Map<string, Holiday>();
  for (const ev of events) {
    const base: string = ev.basename();
    const type = classify(base, ev.getFlags());
    if (!type) continue;
    const iso = ev.getDate().greg().toISOString().slice(0, 10);
    map.set(iso, { date: iso, name: HEBREW_NAMES[base] || base, type });
  }
  cache = { minYear, maxYear, holidays: map };
}

async function ensureLoaded(year: number) {
  if (cache && year >= cache.minYear && year <= cache.maxYear) return;
  const minYear = cache ? Math.min(cache.minYear, year - 1) : year - 1;
  const maxYear = cache ? Math.max(cache.maxYear, year + 1) : year + 1;
  await loadRange(minYear, maxYear);
}

/** מחזיר את פרטי החג לתאריך נתון (YYYY-MM-DD), אם קיים. */
export async function getHoliday(dateStr: string): Promise<Holiday | undefined> {
  const year = Number(dateStr.slice(0, 4));
  await ensureLoaded(year);
  return cache?.holidays.get(dateStr);
}

/** מחזיר את כל החגים בטווח שנים (למסכי לוח שנה / חישוב דוח חודשי). */
export async function getHolidaysForYear(year: number): Promise<Holiday[]> {
  await ensureLoaded(year);
  return Array.from(cache!.holidays.values()).filter((h) => h.date.startsWith(String(year)));
}

const HEBREW_MONTH_NAMES: Record<string, string> = {
  Nisan: 'ניסן',
  Iyyar: 'אייר',
  Sivan: 'סיוון',
  Tamuz: 'תמוז',
  Av: 'אב',
  Elul: 'אלול',
  Tishrei: 'תשרי',
  Cheshvan: 'חשוון',
  Kislev: 'כסלו',
  Tevet: 'טבת',
  "Sh'vat": 'שבט',
  Adar: 'אדר',
  'Adar I': "אדר א'",
  'Adar II': "אדר ב'",
};

/** תאריך עברי לתצוגה בלבד (למשל "20 באלול 5786"), לא לחישובים — פורמט פשוט בלי ניקוד. */
export async function getHebrewDateLabel(dateStr: string): Promise<string> {
  const { HDate } = await dynamicImport('@hebcal/core');
  const hd = new HDate(new Date(`${dateStr}T00:00:00`));
  const monthName = HEBREW_MONTH_NAMES[hd.getMonthName()] || hd.getMonthName();
  return `${hd.getDate()} ב${monthName} ${hd.getFullYear()}`;
}
