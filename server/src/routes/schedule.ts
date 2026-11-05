import { Router } from 'express';
import { airtableFetch, airtableCreate, airtableUpdate, airtableDelete, TABLES } from '../lib/airtable';
import { FIELDS } from '../lib/airtableFields';
import { getFullSchedule, invalidateScheduleCache } from '../lib/scheduleData';
import { prisma } from '../lib/prisma';
import { getReadableHistory, buildScheduleExcel } from '../lib/scheduleHistory';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getCancellations, cancelLessons, restoreLesson, getDayNotes, setDayNote } from '../lib/lessonCancellations';
import { lessonsForDate } from '../lib/scheduleRules';
import { LockRequiredError, requirePastUnlock, israelToday, addDays, hasLockCode, verifyLockCode, setLockCode } from '../lib/scheduleLock';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('system'));

router.get('/getSchedule', async (req, res) => {
  try {
    res.json(await getFullSchedule());
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת מערכת השעות' });
  }
});

// שדות ההפוכים בטבלת השיעורים — הנוכחות והציונים שמקושרים לשיעור. שיעור שיש לו כאלה לא נמחק
// לעולם מ-Airtable (המחיקה מנתקת את הנוכחות ממנו) — רק "נסגר" בתאריך.
const LESSON_ATTENDANCE = 'רישומי נוכחות';
const LESSON_GRADES = 'ציונים';
const hasLinkedRecords = (fields: Record<string, any>) =>
  [LESSON_ATTENDANCE, LESSON_GRADES].some((f) => Array.isArray(fields[f]) && fields[f].length > 0);

/** אם כל שינוי שמשפיע על העבר — 423 עם הודעה, והלקוח מבקש קוד נעילה ושולח שוב */
function sendLockError(res: any, err: any): boolean {
  if (err instanceof LockRequiredError) {
    res.status(423).json({ error: err.message, needCode: true });
    return true;
  }
  return false;
}

async function logHistory(data: Parameters<typeof prisma.scheduleHistory.create>[0]['data']) {
  // השיעור כבר נשמר ב-Airtable — רישום ההיסטוריה הוא תיעוד נלווה, וכישלון בו לא אמור להיראות ככישלון השמירה
  try {
    await prisma.scheduleHistory.create({ data });
  } catch (historyErr: any) {
    console.error('שגיאה ברישום היסטוריית מערכת שעות (השינוי עצמו כן בוצע):', historyErr.message);
  }
}

const sundayDays = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  return Math.round((t.getTime() / 86400000 - t.getUTCDay()));
};

/**
 * שמירת שיעור. כדי לא לשנות את העבר (ואת הנוכחות שכבר נרשמה):
 * - שיעור קבוע שכבר התחיל ומשתנה (מורה/שעה/מסלול...) — השינוי חל מ"applyFrom" (ברירת מחדל: היום):
 *   השיעור הקיים נסגר יום לפני, ונוצר שיעור חדש מאותו תאריך. השבועות שעברו נשארים כמו שהיו.
 * - כל שינוי שנוגע בתאריך שכבר עבר — רק עם קוד נעילה.
 */
router.post('/updateScheduleLesson', async (req, res) => {
  try {
    const { id, className, subject, dayOfWeek, time, trackIds, teacherIds, room, year, notes, fromDate, toDate, everyTwoWeeks, applyFrom, lockCode } =
      req.body as {
        id?: string;
        className: string;
        subject?: string;
        dayOfWeek: string;
        time: string;
        trackIds?: string[];
        teacherIds?: string[];
        room?: string;
        year?: string;
        notes?: string;
        fromDate: string;
        toDate?: string;
        everyTwoWeeks?: boolean;
        applyFrom?: string;
        lockCode?: string;
      };
    if (!fromDate) return res.status(400).json({ error: 'חובה לרשום תאריך התחלה' });
    if (!trackIds?.length) return res.status(400).json({ error: 'חובה לבחור לפחות מסלול אחד' });
    if (toDate && toDate < fromDate) return res.status(400).json({ error: '"עד תאריך" לפני "מתאריך"' });
    const today = israelToday();

    const fields: Record<string, any> = {
      [FIELDS.lessons.className]: className,
      [FIELDS.lessons.subject]: subject,
      [FIELDS.lessons.dayOfWeek]: dayOfWeek,
      [FIELDS.lessons.time]: time,
      [FIELDS.lessons.room]: room,
      [FIELDS.lessons.year]: year,
      [FIELDS.lessons.notes]: notes,
      [FIELDS.lessons.fromDate]: fromDate,
      [FIELDS.lessons.toDate]: toDate || null,
      // מסלול הוא כבר שדה מקושר מרובה-ערכים ב-Airtable (כמו "תפילה" ששייכת גם לקודש י"ג
      // וגם לקודש י"ד) — אירוע/כנס משותף לכמה מסלולים נכתב כאן פשוט כשיעור אחד עם כמה מסלולים.
      [FIELDS.lessons.track]: trackIds,
    };
    if (teacherIds?.length) fields[FIELDS.lessons.teacher] = teacherIds;

    const saveRotation = async (lessonId: string, to?: string | null) => {
      if (!to) await prisma.lessonEnded.deleteMany({ where: { lessonId } }).catch(() => {});
      if (everyTwoWeeks && !to) {
        await prisma.lessonRotation.upsert({
          where: { lessonId },
          create: { lessonId, everyTwoWeeks: true },
          update: { everyTwoWeeks: true },
        });
      } else {
        await prisma.lessonRotation.deleteMany({ where: { lessonId } });
      }
    };
    const describe = (verb: string, from: string, to?: string | null) =>
      `${verb} שיעור: ${className} — ${dayOfWeek} ${time} (${from}${to ? ` עד ${to}` : ''})${everyTwoWeeks && !to ? ' · כל שבועיים' : ''}`;
    const historyBase = { changedBy: req.user!.name, className, dayOfWeek, time, room };

    // ---- שיעור חדש ----
    if (!id) {
      if (fromDate < today) await requirePastUnlock(lockCode);
      const record = await airtableCreate(TABLES.lessons, fields);
      await saveRotation(record.id, toDate);
      await logHistory({ ...historyBase, description: describe('נוצר', fromDate, toDate), changeType: 'create', lessonId: record.id, fromDate, toDate: toDate || null });
      invalidateScheduleCache();
      return res.json({ success: true, recordId: record.id });
    }

    // ---- עריכה ----
    const before = (await airtableFetch(TABLES.lessons, { filterByFormula: `RECORD_ID()="${id}"`, maxRecords: 1 }))[0];
    if (!before) return res.status(404).json({ error: 'שיעור לא נמצא' });
    const prev = before.fields;
    const oldFrom: string = prev[FIELDS.lessons.fromDate] || '';
    const oldTo: string = prev[FIELDS.lessons.toDate] || '';
    const same = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null) || (!a && !b);
    const sameList = (a: any, b: any) => same([...(a || [])].sort(), [...(b || [])].sort());
    // מה השתנה (חוץ מהתאריכים וההערה הקבועה)
    const contentChanged =
      !same(prev[FIELDS.lessons.className], className) ||
      !same(prev[FIELDS.lessons.subject], subject) ||
      !same(prev[FIELDS.lessons.dayOfWeek], dayOfWeek) ||
      !same(prev[FIELDS.lessons.time], time) ||
      !same(prev[FIELDS.lessons.room], room) ||
      !same(prev[FIELDS.lessons.year], year) ||
      !sameList(prev[FIELDS.lessons.track], trackIds) ||
      (teacherIds?.length ? !sameList(prev[FIELDS.lessons.teacher], teacherIds) : false);
    const startedInPast = !!oldFrom && oldFrom < today;

    // השיעור עוד לא התחיל — עריכה רגילה (אלא אם מזיזים אותו אחורה לעבר)
    // רק ההערה / "עד תאריך" מהיום והלאה — עריכה רגילה
    // שינוי בתוכן של שיעור שכבר התחיל, מתאריך עתידי — פיצול
    const effectiveFrom = applyFrom && applyFrom > oldFrom ? applyFrom : today;
    const onlyEnding = !contentChanged && same(oldFrom, fromDate);
    const plain =
      !startedInPast ||
      (onlyEnding && (!toDate || toDate >= addDays(today, -1)) && (!oldTo || oldTo >= addDays(today, -1)));

    if (plain) {
      if (fromDate < today && fromDate !== oldFrom) await requirePastUnlock(lockCode);
      const record = await airtableUpdate(TABLES.lessons, id, fields);
      await saveRotation(record.id, toDate);
      await logHistory({ ...historyBase, description: describe('עודכן', fromDate, toDate), changeType: 'update', lessonId: id, fromDate, toDate: toDate || null, previousData: JSON.stringify(prev) });
      invalidateScheduleCache();
      return res.json({ success: true, recordId: record.id });
    }

    // משנים גם את העבר — רק עם קוד: עדכון של השיעור כולו. כך גם שיעור שכבר הסתיים לפני תאריך
    // השינוי (אין "מהיום והלאה" לפצל אליו — כל השינוי הוא בעבר).
    if ((applyFrom && applyFrom < today) || !contentChanged || (oldTo && oldTo < effectiveFrom)) {
      await requirePastUnlock(lockCode);
      const record = await airtableUpdate(TABLES.lessons, id, fields);
      await saveRotation(record.id, toDate);
      await logHistory({ ...historyBase, description: describe('עודכן (כולל תאריכים שעברו)', fromDate, toDate), changeType: 'update', lessonId: id, fromDate, toDate: toDate || null, previousData: JSON.stringify(prev) });
      invalidateScheduleCache();
      return res.json({ success: true, recordId: record.id });
    }

    // פיצול: הקיים נסגר יום לפני effectiveFrom, החדש מתחיל ב-effectiveFrom
    let newFrom = effectiveFrom;
    // רוטציה "כל שבועיים" — שומרים על אותם שבועות (מתחילים בשבוע הבא אם זה שבוע "חופשי")
    if (everyTwoWeeks && oldFrom && Math.round((sundayDays(newFrom) - sundayDays(oldFrom)) / 7) % 2 !== 0) newFrom = addDays(newFrom, 7);
    const closeAt = addDays(effectiveFrom, -1);
    await airtableUpdate(TABLES.lessons, id, { [FIELDS.lessons.toDate]: closeAt });
    await markEnded(id, req.user!.name);
    await logHistory({
      ...historyBase,
      description: `שיעור נסגר ב-${closeAt} (השינוי חל מ-${effectiveFrom}): ${prev[FIELDS.lessons.className] || ''} — ${prev[FIELDS.lessons.dayOfWeek] || ''} ${prev[FIELDS.lessons.time] || ''}`,
      changeType: 'update',
      lessonId: id,
      fromDate: oldFrom || null,
      toDate: closeAt,
      previousData: JSON.stringify(prev),
    });
    const newTo = toDate && toDate >= newFrom ? toDate : null;
    const created = await airtableCreate(TABLES.lessons, { ...fields, [FIELDS.lessons.fromDate]: newFrom, [FIELDS.lessons.toDate]: newTo });
    await saveRotation(created.id, newTo);
    await logHistory({ ...historyBase, description: describe('נוצר (המשך של שיעור קיים)', newFrom, newTo), changeType: 'create', lessonId: created.id, fromDate: newFrom, toDate: newTo });
    invalidateScheduleCache();
    res.json({ success: true, recordId: created.id, split: { closedAt: closeAt, newFrom } });
  } catch (err: any) {
    if (sendLockError(res, err)) return;
    res.status(500).json({ error: err.message || 'שגיאה בעדכון שיעור' });
  }
});

/**
 * מחיקת שיעור מתאריך מסוים (ברירת מחדל: היום). השבועות שלפני נשארים, עם הנוכחות שנרשמה.
 * מחיקה מתאריך שכבר עבר — רק עם קוד נעילה. שיעור שיש לו נוכחות/ציונים לא נמחק מ-Airtable אף פעם —
 * הוא נסגר בתאריך (גם "מחיקה מלאה" = נסגר לפני שהתחיל), כך שאפשר להחזיר אותו עם הנוכחות.
 */
router.post('/deleteScheduleLesson', async (req, res) => {
  try {
    const { id, fromDate: deleteFromRaw, lockCode } = req.body as { id?: string; fromDate?: string; lockCode?: string };
    if (!id) return res.status(400).json({ error: 'חסר מזהה שיעור' });
    const today = israelToday();
    const deleteFrom = deleteFromRaw && /^\d{4}-\d{2}-\d{2}$/.test(deleteFromRaw) ? deleteFromRaw : today;

    const record = (await airtableFetch(TABLES.lessons, { filterByFormula: `RECORD_ID()="${id}"`, maxRecords: 1 }))[0];
    if (!record) return res.status(404).json({ error: 'שיעור לא נמצא' });
    const prev = record.fields;
    const oldFrom: string = prev[FIELDS.lessons.fromDate] || '';
    const oldTo: string = prev[FIELDS.lessons.toDate] || '';
    // מחיקה שנוגעת בתאריך שעבר (והשיעור באמת התקיים אז) — רק עם קוד
    const touchesPast = deleteFrom < today && (!oldFrom || oldFrom < today) && (!oldTo || oldTo >= deleteFrom);
    if (touchesPast) await requirePastUnlock(lockCode);

    const className = prev[FIELDS.lessons.className] || '';
    const dayOfWeek = prev[FIELDS.lessons.dayOfWeek] || '';
    const time = prev[FIELDS.lessons.time] || '';
    const historyBase = { changedBy: req.user!.name, lessonId: id, className, dayOfWeek, time, room: prev[FIELDS.lessons.room] || null, previousData: JSON.stringify(prev) };
    const whole = !oldFrom || deleteFrom <= oldFrom;

    if (whole && !hasLinkedRecords(prev)) {
      // אין נוכחות ואין ציונים — מחיקה אמיתית
      await airtableDelete(TABLES.lessons, id);
      await prisma.lessonRotation.deleteMany({ where: { lessonId: id } }).catch(() => {});
      await logHistory({ ...historyBase, description: `נמחק שיעור: ${className} — ${dayOfWeek} ${time}`, changeType: 'delete', fromDate: oldFrom || null, toDate: oldTo || null });
    } else {
      // נסגר יום לפני תאריך המחיקה (מחיקה מלאה של שיעור עם נוכחות — נסגר יום לפני שהתחיל, ונשאר מוסתר)
      const closeAt = addDays(whole ? oldFrom || deleteFrom : deleteFrom, -1);
      if (!oldTo || oldTo > closeAt) {
        await airtableUpdate(TABLES.lessons, id, { [FIELDS.lessons.toDate]: closeAt });
        await markEnded(id, req.user!.name);
      }
      await logHistory({
        ...historyBase,
        description: whole
          ? `נמחק שיעור (נשמר מוסתר, כי יש בו נוכחות/ציונים): ${className} — ${dayOfWeek} ${time}`
          : `נמחק שיעור מ-${deleteFrom} (השבועות שלפני נשארו): ${className} — ${dayOfWeek} ${time}`,
        changeType: 'update',
        fromDate: oldFrom || null,
        toDate: closeAt,
      });
    }
    invalidateScheduleCache();
    res.json({ success: true });
  } catch (err: any) {
    if (sendLockError(res, err)) return;
    res.status(500).json({ error: err.message || 'שגיאה במחיקת שיעור' });
  }
});

/** שיעור שנסגר (לא שינוי זמני) — כדי שלא יסתיר שיעורים קבועים באותה שעה בשבועות שלפני */
async function markEnded(lessonId: string, by: string) {
  await prisma.lessonEnded
    .upsert({ where: { lessonId }, create: { lessonId, endedBy: by }, update: { endedBy: by, endedAt: new Date() } })
    .catch((e) => console.error('שגיאה בסימון שיעור כנסגר:', e.message));
}

/** האם הוגדר קוד נעילה (למסך מערכת השעות) */
router.get('/lockStatus', async (_req, res) => {
  try {
    res.json({ hasCode: await hasLockCode() });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה' });
  }
});

/** הגדרת / החלפת קוד הנעילה — רק מנהלת. החלפה דורשת את הקוד הנוכחי. */
router.post('/lockCode', async (req, res) => {
  try {
    if (req.user!.role !== 'מנהל') return res.status(403).json({ error: 'רק מנהלת יכולה להגדיר קוד נעילה' });
    const { currentCode, newCode } = req.body as { currentCode?: string; newCode?: string };
    const code = String(newCode || '').trim();
    if (code.length < 4) return res.status(400).json({ error: 'הקוד צריך להיות לפחות 4 תווים' });
    if ((await hasLockCode()) && !(await verifyLockCode(currentCode))) return res.status(403).json({ error: 'הקוד הנוכחי שגוי' });
    await setLockCode(code);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בשמירת הקוד' });
  }
});

const isIsoDate = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** ביטולי שיעורים בטווח תאריכים — להצגה במערכת השעות של השבוע. */
router.get('/cancellations', async (req, res) => {
  try {
    const { from, to } = req.query as Record<string, string | undefined>;
    if (!isIsoDate(from) || !isIsoDate(to)) return res.status(400).json({ error: 'חסר טווח תאריכים' });
    res.json({ cancellations: await getCancellations(from!, to!) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת ביטולים' });
  }
});

/** הערות לשיעורים ליום אחד בלבד — בטווח התאריכים של השבוע המוצג */
router.get('/dayNotes', async (req, res) => {
  try {
    const { from, to } = req.query as Record<string, string | undefined>;
    if (!isIsoDate(from) || !isIsoDate(to)) return res.status(400).json({ error: 'חסר טווח תאריכים' });
    res.json({ notes: await getDayNotes(from!, to!) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת הערות' });
  }
});

/** שמירת הערה לשיעור בתאריך אחד בלבד (טקסט ריק = מחיקה) — לא נוגעת בשיעור הקבוע */
router.post('/dayNote', async (req, res) => {
  try {
    const { lessonId, date, text } = req.body as { lessonId?: string; date?: string; text?: string };
    if (!lessonId || !isIsoDate(date)) return res.status(400).json({ error: 'חסרים פרטים' });
    await setDayNote(lessonId, date!, String(text || ''), req.user!.name);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בשמירת ההערה' });
  }
});

/** ביטול שיעור (או כמה) בתאריך מסוים — המורה לא תתבקש למלא עליו נוכחות. */
router.post('/cancelLessons', async (req, res) => {
  try {
    const { lessonIds, date, reason } = req.body as { lessonIds?: string[]; date?: string; reason?: string };
    if (!Array.isArray(lessonIds) || !lessonIds.length || !isIsoDate(date)) return res.status(400).json({ error: 'חסרים פרטי ביטול' });
    await cancelLessons(lessonIds, date!, reason?.trim().slice(0, 200) || null, req.user!.name);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בביטול שיעור' });
  }
});

/** כל התאריכים מ-from עד to (כולל), בלי שבתות */
function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end && out.length < 400) {
    if (d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * ביטול יום שלם (או כמה ימים — חופשה/חג/תוכנית): כל השיעורים של אותם תאריכים לפי המערכת בפועל,
 * של כל המסלולים או של מסלול אחד. במקום לבטל שיעור-שיעור. המורות לא יתבקשו למלא עליהם נוכחות.
 */
router.post('/cancelDays', async (req, res) => {
  try {
    const { from, to, reason, trackId } = req.body as { from?: string; to?: string; reason?: string; trackId?: string };
    const end = to || from;
    if (!isIsoDate(from) || !isIsoDate(end) || end! < from!) return res.status(400).json({ error: 'יש לבחור תאריך (ועד תאריך)' });
    const dates = datesInRange(from!, end!);
    if (dates.length > 62) return res.status(400).json({ error: 'אפשר לבטל עד חודשיים בבת אחת' });
    const { lessons } = await getFullSchedule();
    const why = reason?.trim().slice(0, 200) || null;
    let count = 0;
    for (const date of dates) {
      const ids = lessonsForDate(lessons, date)
        .filter((l) => !trackId || (l.track || []).includes(trackId))
        .map((l) => l.id);
      if (!ids.length) continue;
      await cancelLessons(ids, date, why, req.user!.name);
      count += ids.length;
    }
    res.json({ success: true, cancelled: count, days: dates.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בביטול היום' });
  }
});

/** החזרת יום שלם שבוטל — מוחק את כל ביטולי השיעורים של התאריך (או רק של מסלול אחד) */
router.post('/restoreDay', async (req, res) => {
  try {
    const { date, trackId } = req.body as { date?: string; trackId?: string };
    if (!isIsoDate(date)) return res.status(400).json({ error: 'חסר תאריך' });
    let lessonIds: string[] | undefined;
    if (trackId) {
      const { lessons } = await getFullSchedule();
      lessonIds = lessonsForDate(lessons, date!).filter((l) => (l.track || []).includes(trackId)).map((l) => l.id);
    }
    const r = await prisma.lessonCancellation.deleteMany({
      where: { date: date!, ...(lessonIds ? { lessonId: { in: lessonIds } } : {}) },
    });
    res.json({ success: true, restored: r.count });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בהחזרת היום' });
  }
});

router.post('/restoreLesson', async (req, res) => {
  try {
    const { lessonId, date } = req.body as { lessonId?: string; date?: string };
    if (!lessonId || !isIsoDate(date)) return res.status(400).json({ error: 'חסרים פרטים' });
    await restoreLesson(lessonId, date!);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בהחזרת שיעור' });
  }
});

// השדות שאפשר לכתוב בשיעור (בלי שדות מחושבים/lookup שנשמרו ב-previousData)
const LESSON_WRITABLE = [
  FIELDS.lessons.className,
  FIELDS.lessons.subject,
  FIELDS.lessons.dayOfWeek,
  FIELDS.lessons.time,
  FIELDS.lessons.track,
  FIELDS.lessons.teacher,
  FIELDS.lessons.room,
  FIELDS.lessons.year,
  FIELDS.lessons.notes,
  FIELDS.lessons.fromDate,
  FIELDS.lessons.toDate,
];
const LINKED = new Set<string>([FIELDS.lessons.track, FIELDS.lessons.teacher]);

function writableLessonFields(prev: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of LESSON_WRITABLE) {
    const v = prev[f];
    out[f] = v === undefined || v === '' ? (LINKED.has(f) ? [] : null) : v;
  }
  return out;
}

/**
 * ביטול שינויים מההיסטוריה (שינוי שנעשה בטעות): כל שיעור חוזר למצב שלפני השינוי המוקדם ביותר
 * שנבחר עבורו — שיעור שעודכן מקבל בחזרה את הנתונים הקודמים, שיעור שנמחק נוצר מחדש, ושיעור
 * שנוסף נמחק. גם הביטול עצמו נרשם בהיסטוריה (וגם אותו אפשר לבטל).
 */
router.post('/revertChanges', async (req, res) => {
  try {
    const { ids } = req.body as { ids?: string[] };
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'לא נבחרו שינויים' });
    const entries = await prisma.scheduleHistory.findMany({ where: { id: { in: ids.slice(0, 500) } }, orderBy: { changedAt: 'asc' } });
    const earliest = new Map<string, (typeof entries)[number]>();
    for (const e of entries) if (e.lessonId && !earliest.has(e.lessonId)) earliest.set(e.lessonId, e);

    const errors: string[] = [];
    let reverted = 0;
    for (const [lessonId, e] of earliest) {
      const label = `${e.className || ''} ${e.dayOfWeek || ''} ${e.time || ''}`.trim();
      try {
        const current = (await airtableFetch(TABLES.lessons, { filterByFormula: `RECORD_ID()="${lessonId}"`, maxRecords: 1 }))[0];
        let description: string;
        let changeType: string;
        let newId = lessonId;
        if (e.changeType === 'create') {
          if (current && hasLinkedRecords(current.fields)) {
            const from = current.fields[FIELDS.lessons.fromDate] || israelToday();
            await airtableUpdate(TABLES.lessons, lessonId, { [FIELDS.lessons.toDate]: addDays(from, -1) });
            await markEnded(lessonId, req.user!.name);
          } else if (current) {
            await airtableDelete(TABLES.lessons, lessonId);
            await prisma.lessonRotation.deleteMany({ where: { lessonId } }).catch(() => {});
          }
          description = `ביטול שינוי — נמחק שיעור שנוסף: ${label}`;
          changeType = 'delete';
        } else {
          if (!e.previousData) throw new Error('אין נתונים קודמים לשחזור');
          const fields = writableLessonFields(JSON.parse(e.previousData));
          if (current) {
            await airtableUpdate(TABLES.lessons, lessonId, fields);
            if (!fields[FIELDS.lessons.toDate]) await prisma.lessonEnded.deleteMany({ where: { lessonId } }).catch(() => {});
            description = `ביטול שינוי — שיעור הוחזר למצב הקודם: ${label}`;
            changeType = 'update';
          } else {
            const prevFields = JSON.parse(e.previousData);
            const relink: Record<string, string[]> = {};
            for (const f of [LESSON_ATTENDANCE, LESSON_GRADES]) if (Array.isArray(prevFields[f]) && prevFields[f].length) relink[f] = prevFields[f];
            let created;
            try {
              created = await airtableCreate(TABLES.lessons, { ...fields, ...relink });
            } catch {
              // אם חלק מרישומי הנוכחות כבר לא קיימים — יוצרים בלי הקישור (כמו קודם)
              created = await airtableCreate(TABLES.lessons, fields);
            }
            newId = created.id;
            description = `ביטול שינוי — שיעור שנמחק נוצר מחדש: ${label}`;
            changeType = 'create';
          }
        }
        await prisma.scheduleHistory
          .create({
            data: {
              description,
              changedBy: req.user!.name,
              changeType,
              lessonId: newId,
              className: e.className,
              dayOfWeek: e.dayOfWeek,
              time: e.time,
              room: e.room,
              fromDate: e.fromDate,
              toDate: e.toDate,
              previousData: current && changeType !== 'create' ? JSON.stringify(current.fields) : null,
            },
          })
          .catch((err) => console.error('שגיאה ברישום היסטוריה (הביטול עצמו בוצע):', err.message));
        reverted++;
      } catch (err: any) {
        errors.push(`${label}: ${err.message}`);
      }
    }
    invalidateScheduleCache();
    res.json({ success: true, reverted, errors });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בביטול השינויים' });
  }
});

router.get('/getScheduleHistory', async (req, res) => {
  try {
    res.json({ history: await getReadableHistory() });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת היסטוריה' });
  }
});

router.get('/exportScheduleExcel', async (req, res) => {
  try {
    const { from, to, trackId } = req.query as { from?: string; to?: string; trackId?: string };
    const isDate = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: 'יש לבחור מתאריך ועד תאריך' });
    if (from! > to!) return res.status(400).json({ error: 'תאריך ההתחלה אחרי תאריך הסיום' });
    const days = (Date.parse(to!) - Date.parse(from!)) / 86_400_000;
    if (days > 400) return res.status(400).json({ error: 'אפשר לייצא עד שנה אחת בכל פעם' });

    const buffer = await buildScheduleExcel(from!, to!, trackId || undefined);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`מערכת שעות ${from} עד ${to}.xlsx`)}`);
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בייצוא לאקסל' });
  }
});

export default router;
