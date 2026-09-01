import { Router } from 'express';
import { airtableFetch, airtableCreate, airtableUpdate, airtableDelete, TABLES } from '../lib/airtable';
import { FIELDS } from '../lib/airtableFields';
import { getFullSchedule, invalidateScheduleCache } from '../lib/scheduleData';
import { prisma } from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';

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
    const { id, className, subject, dayOfWeek, time, trackId, teacherIds, room, year, notes } = req.body as {
      id?: string;
      className: string;
      subject?: string;
      dayOfWeek: string;
      time: string;
      trackId?: string;
      teacherIds?: string[];
      room?: string;
      year?: string;
      notes?: string;
    };

    const fields: Record<string, any> = {
      [FIELDS.lessons.className]: className,
      [FIELDS.lessons.subject]: subject,
      [FIELDS.lessons.dayOfWeek]: dayOfWeek,
      [FIELDS.lessons.time]: time,
      [FIELDS.lessons.room]: room,
      [FIELDS.lessons.year]: year,
      [FIELDS.lessons.notes]: notes,
    };
    if (trackId) fields[FIELDS.lessons.track] = [trackId];
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

    await prisma.scheduleHistory.create({
      data: {
        description: `${changeType === 'create' ? 'נוצר' : 'עודכן'} שיעור: ${className} — ${dayOfWeek} ${time}`,
        changedBy: req.user!.name,
        changeType,
        lessonId: record.id,
        className,
        dayOfWeek,
        time,
        room,
        previousData: previousData ? JSON.stringify(previousData) : null,
      },
    });

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

    const className = record.fields[FIELDS.lessons.className] || '';
    const dayOfWeek = record.fields[FIELDS.lessons.dayOfWeek] || '';
    const time = record.fields[FIELDS.lessons.time] || '';
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
        previousData: JSON.stringify(record.fields),
      },
    });

    invalidateScheduleCache();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה במחיקת שיעור' });
  }
});

router.get('/getScheduleHistory', async (req, res) => {
  try {
    // שנה שלמה של שינויים לא אמורה לחצות את המספר הזה בפועל — לא רוצים לחתוך היסטוריה בטעות
    // כשמישהי רוצה לבדוק אחורה בסוף שנה.
    const history = await prisma.scheduleHistory.findMany({ orderBy: { changedAt: 'desc' }, take: 5000 });
    res.json({ history });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת היסטוריה' });
  }
});

export default router;
