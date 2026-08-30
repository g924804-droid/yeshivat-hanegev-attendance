import { Router } from 'express';
import { airtableFetch, airtableCreate, airtableUpdate, TABLES } from '../lib/airtable';
import { FIELDS } from '../lib/airtableFields';
import { prisma } from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('system'));

router.get('/getSchedule', async (req, res) => {
  try {
    const [lessons, teachers, tracks] = await Promise.all([
      airtableFetch(TABLES.lessons),
      airtableFetch(TABLES.teachers),
      airtableFetch(TABLES.tracks),
    ]);

    res.json({
      lessons: lessons.map((l) => ({
        id: l.id,
        className: l.fields[FIELDS.lessons.className],
        dayOfWeek: l.fields[FIELDS.lessons.dayOfWeek],
        time: l.fields[FIELDS.lessons.time],
        track: l.fields[FIELDS.lessons.track],
        teacher: l.fields[FIELDS.lessons.teacher],
        room: l.fields[FIELDS.lessons.room],
        year: l.fields[FIELDS.lessons.year],
        notes: l.fields[FIELDS.lessons.notes],
      })),
      teachers: teachers.map((t) => ({ id: t.id, name: t.fields[FIELDS.teachers.name] })),
      tracks: tracks.map((t) => ({ id: t.id, name: t.fields[FIELDS.tracks.name] })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת מערכת השעות' });
  }
});

router.post('/updateScheduleLesson', async (req, res) => {
  try {
    const { id, className, dayOfWeek, time, trackId, teacherId, room, year, notes } = req.body;

    const fields: Record<string, any> = {
      [FIELDS.lessons.className]: className,
      [FIELDS.lessons.dayOfWeek]: dayOfWeek,
      [FIELDS.lessons.time]: time,
      [FIELDS.lessons.room]: room,
      [FIELDS.lessons.year]: year,
      [FIELDS.lessons.notes]: notes,
    };
    if (trackId) fields[FIELDS.lessons.track] = [trackId];
    if (teacherId) fields[FIELDS.lessons.teacher] = [teacherId];

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

    res.json({ success: true, recordId: record.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בעדכון שיעור' });
  }
});

router.get('/getScheduleHistory', async (req, res) => {
  try {
    const history = await prisma.scheduleHistory.findMany({ orderBy: { changedAt: 'desc' }, take: 200 });
    res.json({ history });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'שגיאה בטעינת היסטוריה' });
  }
});

export default router;
