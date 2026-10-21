import { Router } from 'express';
import { airtableFetch, airtableCreate, airtableUpdate, airtableDelete, TABLES } from '../lib/airtable';
import { FIELDS } from '../lib/airtableFields';
import { getFullSchedule, invalidateScheduleCache } from '../lib/scheduleData';
import { prisma } from '../lib/prisma';
import { getReadableHistory, buildScheduleExcel } from '../lib/scheduleHistory';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getCancellations, cancelLessons, restoreLesson } from '../lib/lessonCancellations';

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

router.post('/updateScheduleLesson', async (req, res) => {
  try {
    const { id, className, subject, dayOfWeek, time, trackIds, teacherIds, room, year, notes, fromDate, toDate, everyTwoWeeks } =
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
      };
    if (!fromDate) return res.status(400).json({ error: 'חובה לרשום תאריך התחלה' });
    if (!trackIds?.length) return res.status(400).json({ error: 'חובה לבחור לפחות מסלול אחד' });

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

    let previousData: any = null;
    let record;
    let changeType: 'create' | 'update';
    if (id) {
      const before = await airtableFetch(TABLES.lessons, { filterByFormula: `RECORD_ID()="${id}"`, maxRecords: 1 });
      previousData = before[0]?.fields || null;
      record = await airtableUpdate(TABLES.lessons, id, fields);
      changeType = 'update';
    } else {
      record = await airtableCreate(TABLES.lessons, fields);
      changeType = 'create';
    }

    // רוטציה "כל שבועיים" — רק לשיעור קבוע (שיעור זמני עם "עד תאריך" לא צריך)
    if (everyTwoWeeks && !toDate) {
      await prisma.lessonRotation.upsert({
        where: { lessonId: record.id },
        create: { lessonId: record.id, everyTwoWeeks: true },
        update: { everyTwoWeeks: true },
      });
    } else {
      await prisma.lessonRotation.deleteMany({ where: { lessonId: record.id } });
    }

    // השיעור כבר נשמר בהצלחה ב-Airtable בשלב הזה — רישום ההיסטוריה הוא תיעוד נלווה, לא
    // חלק מהפעולה עצמה. אם כתיבה זו נכשלת (למשל תקלת חיבור זמנית ל-DB המקומי, שקורה מדי
    // פעם), אסור שזה יגרום למשתמשת לראות "נכשל" על שינוי שבפועל כבר הצליח ונשמר.
    try {
      await prisma.scheduleHistory.create({
        data: {
          description: `${changeType === 'create' ? 'נוצר' : 'עודכן'} שיעור: ${className} — ${dayOfWeek} ${time} (${fromDate}${toDate ? ` עד ${toDate}` : ''})${everyTwoWeeks && !toDate ? ' · כל שבועיים' : ''}`,
          changedBy: req.user!.name,
          changeType,
          lessonId: record.id,
          className,
          dayOfWeek,
          time,
          room,
          fromDate,
          toDate: toDate || null,
          previousData: previousData ? JSON.stringify(previousData) : null,
        },
      });
    } catch (historyErr: any) {
      console.error('שגיאה ברישום היסטוריית מערכת שעות (השיעור עצמו כן נשמר):', historyErr.message);
    }

    invalidateScheduleCache();
    res.json({ success: true, recordId: record.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בעדכון שיעור' });
  }
});

router.post('/deleteScheduleLesson', async (req, res) => {
  try {
    const { id } = req.body as { id?: string };
    if (!id) return res.status(400).json({ error: 'חסר מזהה שיעור' });

    const before = await airtableFetch(TABLES.lessons, { filterByFormula: `RECORD_ID()="${id}"`, maxRecords: 1 });
    const record = before[0];
    if (!record) return res.status(404).json({ error: 'שיעור לא נמצא' });

    await airtableDelete(TABLES.lessons, id);
    await prisma.lessonRotation.deleteMany({ where: { lessonId: id } }).catch(() => {});

    const className = record.fields[FIELDS.lessons.className] || '';
    const dayOfWeek = record.fields[FIELDS.lessons.dayOfWeek] || '';
    const time = record.fields[FIELDS.lessons.time] || '';
    // המחיקה מ-Airtable כבר הצליחה בשלב הזה — כנ"ל, לא רוצים שכישלון ברישום ההיסטוריה
    // הנלווה יגרום לדווח "נכשל" על מחיקה שבפועל כבר קרתה.
    try {
      await prisma.scheduleHistory.create({
        data: {
          description: `נמחק שיעור: ${className} — ${dayOfWeek} ${time}`,
          changedBy: req.user!.name,
          changeType: 'delete',
          lessonId: id,
          className,
          dayOfWeek,
          time,
          room: record.fields[FIELDS.lessons.room] || null,
          fromDate: record.fields[FIELDS.lessons.fromDate] || null,
          toDate: record.fields[FIELDS.lessons.toDate] || null,
          previousData: JSON.stringify(record.fields),
        },
      });
    } catch (historyErr: any) {
      console.error('שגיאה ברישום היסטוריית מערכת שעות (המחיקה עצמה כן בוצעה):', historyErr.message);
    }

    invalidateScheduleCache();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה במחיקת שיעור' });
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
