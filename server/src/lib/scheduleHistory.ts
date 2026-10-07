import ExcelJS from 'exceljs';
import { prisma } from './prisma';
import { getFullSchedule, parseLessonFields, ParsedLesson } from './scheduleData';
import { lessonsForDate } from './scheduleRules';

const DOW_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const ACTION_HE: Record<string, string> = { create: 'נוסף', update: 'עודכן', delete: 'נמחק' };

type Ref = { id: string; name: string };
type HistoryEntry = Awaited<ReturnType<typeof prisma.scheduleHistory.findMany>>[number];

/** תאריך השינוי לפי שעון ישראל (השרת רץ ב-UTC) — "2026-10-07". */
function israelDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

function israelTime(d: Date): string {
  return d.toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
}

function parsePrevious(entry: HistoryEntry): ParsedLesson | null {
  if (!entry.previousData || !entry.lessonId) return null;
  try {
    return parseLessonFields(entry.lessonId, JSON.parse(entry.previousData));
  } catch {
    return null;
  }
}

function names(ids: string[] | undefined, refs: Ref[]): string {
  return (ids || []).map((id) => refs.find((r) => r.id === id)?.name || '').filter(Boolean).join(', ');
}

/** "2026-10-12" → "12/10/2026" */
function heDate(date: string | null | undefined): string {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
}

const FIELD_LABELS: [keyof ParsedLesson, string][] = [
  ['className', 'שיעור'],
  ['subject', 'נושא'],
  ['dayOfWeek', 'יום'],
  ['time', 'שעה'],
  ['track', 'מסלול'],
  ['teacher', 'מורה'],
  ['room', 'חדר'],
  ['notes', 'הערות'],
  ['fromDate', 'מתאריך'],
  ['toDate', 'עד תאריך'],
];

function fieldText(lesson: ParsedLesson, key: keyof ParsedLesson, teachers: Ref[], tracks: Ref[]): string {
  if (key === 'teacher') return names(lesson.teacher, teachers);
  if (key === 'track') return names(lesson.track, tracks);
  if (key === 'fromDate' || key === 'toDate') return heDate(lesson[key]);
  return String(lesson[key] ?? '').trim();
}

/**
 * היסטוריית השינויים בצורה קריאה: לכל שינוי — על איזה שיעור, ומה בדיוק השתנה (לפני → אחרי).
 *
 * ב-DB נשמרת רק הגרסה שלפני כל שינוי. הגרסה שאחרי היא הגרסה שלפני השינוי הבא של אותו שיעור,
 * או — אם זה השינוי האחרון — השיעור כפי שהוא היום ב-Airtable.
 */
export async function getReadableHistory() {
  const [entries, schedule] = await Promise.all([
    prisma.scheduleHistory.findMany({ orderBy: { changedAt: 'asc' }, take: 5000 }),
    getFullSchedule(),
  ]);
  const { teachers, tracks } = schedule;
  const current = new Map(schedule.lessons.map((l) => [l.id, l]));

  const rows = entries.map((entry, i) => {
    const before = entry.changeType === 'create' ? null : parsePrevious(entry);
    let after: ParsedLesson | null = null;
    if (entry.changeType !== 'delete' && entry.lessonId) {
      const next = entries.slice(i + 1).find((e) => e.lessonId === entry.lessonId && e.changeType !== 'create');
      after = next ? parsePrevious(next) : current.get(entry.lessonId) || null;
    }

    const changes =
      before && after
        ? FIELD_LABELS.map(([key, label]) => ({
            field: label,
            before: fieldText(before, key, teachers, tracks),
            after: fieldText(after!, key, teachers, tracks),
          })).filter((c) => c.before !== c.after)
        : [];

    const lesson = after || before;
    return {
      id: entry.id,
      changedAt: entry.changedAt.toISOString(),
      changedDate: israelDate(entry.changedAt),
      changedTime: israelTime(entry.changedAt),
      changedBy: entry.changedBy || '',
      action: ACTION_HE[entry.changeType || ''] || entry.changeType || '',
      changeType: entry.changeType || '',
      lessonName: lesson?.subject || lesson?.className || entry.className || '',
      dayOfWeek: lesson?.dayOfWeek || entry.dayOfWeek || '',
      time: lesson?.time || entry.time || '',
      track: lesson ? names(lesson.track, tracks) : '',
      teacher: lesson ? names(lesson.teacher, teachers) : '',
      room: lesson?.room || entry.room || '',
      fromDate: lesson?.fromDate || entry.fromDate || '',
      toDate: lesson?.toDate || entry.toDate || '',
      changes,
      description: entry.description,
    };
  });
  return rows.reverse(); // החדש ביותר למעלה
}

/**
 * השיעורים כפי שהיו בתאריך מסוים בעבר — כולל שיעורים שנמחקו מאז, ובגרסה שהייתה אז
 * (למשל המורה הקודמת, אם המורה הוחלפה אחר כך).
 *
 * לכל שיעור: הגרסה שלפני השינוי הראשון שנעשה אחרי התאריך היא זו שהייתה בתוקף אז. הוספת שיעור
 * לא מסתירה אותו מתאריכים קודמים — לפעמים מוסיפים בדיעבד, ותאריך ההתחלה של השיעור קובע ממתי הוא בתוקף.
 */
function makeLessonsAsOf(current: ParsedLesson[], entries: HistoryEntry[]) {
  const versions = new Map<string, { changedDate: string; before: ParsedLesson | null }[]>();
  for (const e of entries) {
    if (!e.lessonId || e.changeType === 'create') continue;
    if (!versions.has(e.lessonId)) versions.set(e.lessonId, []);
    versions.get(e.lessonId)!.push({ changedDate: israelDate(e.changedAt), before: parsePrevious(e) });
  }
  const currentById = new Map(current.map((l) => [l.id, l]));
  const ids = new Set([...currentById.keys(), ...versions.keys()]);

  return (date: string): ParsedLesson[] => {
    const result: ParsedLesson[] = [];
    for (const id of ids) {
      const later = versions.get(id)?.find((v) => v.changedDate > date);
      const version = later ? later.before : currentById.get(id);
      if (version) result.push(version);
    }
    return result;
  };
}

function startMinutes(time: string): number {
  const [h, m] = (time || '').split('-')[0].split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function styleSheet(ws: ExcelJS.Worksheet) {
  ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFF1C40F' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  header.alignment = { vertical: 'middle', horizontal: 'center' };
  header.height = 22;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

/** קובץ אקסל: המערכת כפי שהייתה בכל תאריך בטווח, ורשימת השינויים שנעשו בטווח. */
export async function buildScheduleExcel(from: string, to: string, trackId?: string): Promise<Buffer> {
  const [entries, schedule, history] = await Promise.all([
    prisma.scheduleHistory.findMany({ orderBy: { changedAt: 'asc' }, take: 5000 }),
    getFullSchedule(),
    getReadableHistory(),
  ]);
  const { teachers, tracks } = schedule;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ישיבת הנגב';

  // גיליון 1 — מה היה בכל יום
  const ws = wb.addWorksheet('מערכת לפי תאריכים');
  ws.columns = [
    { header: 'תאריך', key: 'date', width: 12 },
    { header: 'יום', key: 'day', width: 9 },
    { header: 'שעה', key: 'time', width: 13 },
    { header: 'שיעור', key: 'lesson', width: 26 },
    { header: 'מסלול', key: 'track', width: 24 },
    { header: 'מורה', key: 'teacher', width: 24 },
    { header: 'חדר', key: 'room', width: 12 },
    { header: 'סוג', key: 'kind', width: 18 },
    { header: 'הערות', key: 'notes', width: 30 },
  ];
  const lessonsAsOf = makeLessonsAsOf(schedule.lessons, entries);
  let shade = false;
  for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === 6) continue; // שבת
    const dayLessons = lessonsForDate(lessonsAsOf(date), date)
      .filter((l) => !trackId || l.track?.includes(trackId))
      .sort((a, b) => startMinutes(a.time) - startMinutes(b.time) || names(a.track, tracks).localeCompare(names(b.track, tracks), 'he'));
    if (!dayLessons.length) continue;
    shade = !shade; // צבע מתחלף בין ימים, כדי שיהיה קל לראות איפה מתחיל יום חדש
    for (const l of dayLessons) {
      const row = ws.addRow({
        date: heDate(date),
        day: DOW_HE[d.getUTCDay()],
        time: l.time,
        lesson: [l.className, l.subject].filter((x, i, a) => x && a.indexOf(x) === i).join(' — '),
        track: names(l.track, tracks),
        teacher: names(l.teacher, teachers),
        room: l.room || '',
        kind: l.toDate ? `זמני עד ${heDate(l.toDate)}` : 'קבוע',
        notes: l.notes || '',
      });
      if (shade) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      if (l.toDate) row.getCell('kind').font = { bold: true, color: { argb: 'FFB45309' } };
    }
  }
  styleSheet(ws);

  // גיליון 2 — מה שונה בטווח הזה ועל ידי מי
  const hs = wb.addWorksheet('שינויים שנעשו');
  hs.columns = [
    { header: 'תאריך השינוי', key: 'date', width: 13 },
    { header: 'שעה', key: 'hour', width: 8 },
    { header: 'מי שינתה', key: 'by', width: 18 },
    { header: 'פעולה', key: 'action', width: 9 },
    { header: 'שיעור', key: 'lesson', width: 24 },
    { header: 'יום ושעה', key: 'when', width: 20 },
    { header: 'מסלול', key: 'track', width: 22 },
    { header: 'מה השתנה', key: 'changes', width: 50 },
    { header: 'בתוקף', key: 'valid', width: 24 },
  ];
  for (const h of history.slice().reverse()) {
    if (h.changedDate < from || h.changedDate > to) continue;
    if (trackId && !h.track.split(', ').includes(tracks.find((t) => t.id === trackId)?.name || '')) continue;
    const row = hs.addRow({
      date: heDate(h.changedDate),
      hour: h.changedTime,
      by: h.changedBy,
      action: h.action,
      lesson: h.lessonName,
      when: `${h.dayOfWeek} ${h.time}`,
      track: h.track,
      changes: h.changes.map((c) => `${c.field}: ${c.before || '(ריק)'} ← ${c.after || '(ריק)'}`).join('\n'),
      valid: h.fromDate ? `מ-${heDate(h.fromDate)}${h.toDate ? ` עד ${heDate(h.toDate)}` : ''}` : '',
    });
    row.getCell('changes').alignment = { wrapText: true, vertical: 'top' };
    const color = h.changeType === 'delete' ? 'FFB91C1C' : h.changeType === 'create' ? 'FF15803D' : 'FF1D4ED8';
    row.getCell('action').font = { bold: true, color: { argb: color } };
  }
  styleSheet(hs);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
