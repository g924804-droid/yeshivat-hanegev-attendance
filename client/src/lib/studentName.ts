/**
 * שמות התלמידות ב-Airtable כתובים בשני סדרים — "כהן יסכה" (משפחה קודם) וגם "מרים לוין" (פרטי קודם),
 * ואין שדה נפרד לשם משפחה. כדי להציג ולמיין לפי שם משפחה מזהים את השם הפרטי לפי רשימת שמות נפוצים:
 * אם השם מסתיים בשם פרטי — הוא כבר בסדר "משפחה פרטי"; אם הוא מתחיל בשם פרטי — הופכים את הסדר.
 * שם שלא זוהה נשאר כמו שהוא.
 */
const FIRST_NAMES = new Set(
  (
    'אביגיל אביטל אגם אודיה אוריה אורית אורה אושרת אחינועם איילת אילת אילה אלישבע אסתר אסתי אפרת ' +
    'בתיה בת-שבע בת-ציון ברכה גאולה גילה דבורה דינה הדס הדסה הדר הודיה הילה הלל ' +
    'זהבה חגית חוה חיה חנה חני טובה טליה יהודית יוכבד יסכה יעל יפה ליאת לאה מוריה מיכל מירי מלכה ' +
    'מרים נגה נוי נועה נחמה נעמי סימא עדי עדינה פנינה צפורה ציפורה רבקה רוחמה רוחמי רחל רינה רננה ' +
    'רעות רות שולמית שושנה שני שפרה שרה שרית שירה תאיר תהילה תמר'
  ).split(' ')
);

function isFirst(tokens: string[]): boolean {
  return FIRST_NAMES.has(tokens.join('-'));
}

/** כמה מילים (1 או 2, למשל "בת שבע") בתחילת/סוף המערך הן שם פרטי; 0 אם אין */
function firstNameLength(tokens: string[], fromEnd: boolean): number {
  for (const n of [2, 1]) {
    if (tokens.length <= n) continue; // חייב להישאר לפחות שם משפחה אחד
    const part = fromEnd ? tokens.slice(-n) : tokens.slice(0, n);
    if (isFirst(part)) return n;
  }
  return 0;
}

/** השם בסדר "שם משפחה שם פרטי" */
export function familyFirstName(fullName: string): string {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return tokens.join(' ');
  if (firstNameLength(tokens, true)) return tokens.join(' ');
  // שם פרטי בהתחלה — אולי כפול ("טובה ברכה עסיס", "רחל אפרת בן שטרית")
  let n = 0;
  while (tokens.length - n > 1) {
    const len = firstNameLength(tokens.slice(n), false);
    if (!len) break;
    n += len;
  }
  if (!n) return tokens.join(' ');
  return [...tokens.slice(n), ...tokens.slice(0, n)].join(' ');
}

export function compareByStudentFamilyName(a: string, b: string): number {
  return familyFirstName(a).localeCompare(familyFirstName(b), 'he');
}
