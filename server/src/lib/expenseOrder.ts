/**
 * סדר ההוצאות בקטגוריה — לפי תאריך, מחולק לחודשים (לועזיים). שורות של אותו "נושא הפעילות"
 * נשארות יחד, במקום של התאריך המוקדם ביניהן. שורות בלי תאריך — בסוף, לפי הסדר שבו הוכנסו.
 * groupMonth = החודש (YYYY-MM) שתחתיו השורה מוצגת, או '' כשאין תאריך.
 */
export function orderExpensesByDate<T extends { date: string | null; topic: string | null; sortOrder: number }>(
  rows: T[]
): (T & { groupMonth: string })[] {
  const hasDate = (d: string | null) => !!d && /^\d{4}-\d{2}-\d{2}/.test(d);
  const groups = new Map<string, T[]>();
  rows.forEach((r, i) => {
    const key = r.topic?.trim() ? `topic:${r.topic.trim()}` : `row:${i}`;
    groups.set(key, [...(groups.get(key) || []), r]);
  });
  const byDateThenOrder = (a: T, b: T) => {
    const da = hasDate(a.date) ? a.date! : '9999';
    const db = hasDate(b.date) ? b.date! : '9999';
    return da < db ? -1 : da > db ? 1 : a.sortOrder - b.sortOrder;
  };
  const list = [...groups.values()].map((g) => {
    const sorted = [...g].sort(byDateThenOrder);
    const first = sorted.find((r) => hasDate(r.date));
    return {
      rows: sorted,
      date: first ? first.date!.slice(0, 10) : '',
      order: Math.min(...g.map((r) => r.sortOrder)),
    };
  });
  list.sort((a, b) => {
    const da = a.date || '9999';
    const db = b.date || '9999';
    return da < db ? -1 : da > db ? 1 : a.order - b.order;
  });
  return list.flatMap((g) => g.rows.map((r) => ({ ...r, groupMonth: g.date.slice(0, 7) })));
}

const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

/** 2026-10 ← "אוקטובר 2026"; ריק ← "בלי תאריך" */
export function expenseMonthLabel(month: string): string {
  if (!month) return 'בלי תאריך';
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS_HE[m - 1]} ${y}`;
}
