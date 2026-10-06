// אותו כלל קיים גם בצד הלקוח (client/src/lib/scheduleRules.ts) — לשמור על שניהם זהים.

const DOW_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

type DatedLesson = {
  dayOfWeek: string;
  time: string;
  track?: string[] | null;
  fromDate?: string | null;
  toDate?: string | null;
};

/** שיעורים ישנים בלי מתאריך/עד-תאריך נחשבים תקפים תמיד — התאריכים נוספו רק בהמשך. */
export function lessonAppliesOnDate(l: { fromDate?: string | null; toDate?: string | null }, date: string): boolean {
  if (l.fromDate && date < l.fromDate) return false;
  if (l.toDate && date > l.toDate) return false;
  return true;
}

/** "9:00-9:45" → [540, 585]. בלי שעת סיום — [התחלה, התחלה]. */
function timeRange(time: string): [number, number] {
  const [start, end] = (time || '').split('-').map((part) => {
    const [h, m] = part.trim().split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  });
  return [start, end && end > start ? end : start];
}

function timesOverlap(a: string, b: string): boolean {
  const [aStart, aEnd] = timeRange(a);
  const [bStart, bEnd] = timeRange(b);
  if (aStart === aEnd || bStart === bEnd) return aStart === bStart;
  return aStart < bEnd && bStart < aEnd;
}

/**
 * השיעורים שמתקיימים בפועל בתאריך מסוים.
 *
 * שיעור עם "עד תאריך" הוא שינוי זמני (למשל כנס): בימים שלו הוא מחליף את השיעורים הקבועים
 * (בלי "עד תאריך") של אותם מסלולים בשעות חופפות, ואחרי התאריך המערכת הקבועה חוזרת מעצמה —
 * בלי צורך למחוק ולהחזיר שיעורים ידנית.
 */
export function lessonsForDate<L extends DatedLesson>(lessons: L[], date: string): L[] {
  const dayOfWeek = DOW_HE[new Date(`${date}T00:00:00`).getDay()];
  const candidates = lessons.filter((l) => l.dayOfWeek === dayOfWeek && lessonAppliesOnDate(l, date));
  const temporary = candidates.filter((l) => l.toDate);
  return candidates.filter(
    (l) =>
      l.toDate ||
      !temporary.some(
        (t) => (t.track || []).some((id) => (l.track || []).includes(id)) && timesOverlap(t.time, l.time)
      )
  );
}
