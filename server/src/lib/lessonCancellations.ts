import { prisma } from './prisma';

export type Cancellation = { lessonId: string; date: string; reason: string | null };

/** ביטולי שיעורים בטווח תאריכים (כולל). */
export async function getCancellations(from: string, to: string): Promise<Cancellation[]> {
  return prisma.lessonCancellation.findMany({
    where: { date: { gte: from, lte: to } },
    select: { lessonId: true, date: true, reason: true },
  });
}

/** סט של `${date}|${lessonId}` — לבדיקה מהירה אם שיעור בוטל בתאריך מסוים. */
export async function getCancelledKeys(from: string, to: string): Promise<Set<string>> {
  const list = await getCancellations(from, to);
  return new Set(list.map((c) => `${c.date}|${c.lessonId}`));
}

export async function cancelLessons(lessonIds: string[], date: string, reason: string | null, createdBy: string | null) {
  for (const lessonId of lessonIds) {
    await prisma.lessonCancellation.upsert({
      where: { lessonId_date: { lessonId, date } },
      create: { lessonId, date, reason, createdBy },
      update: { reason, createdBy },
    });
  }
}

export type DayNote = { lessonId: string; date: string; text: string };

/** הערות ליום אחד בלבד, בטווח תאריכים (כולל) */
export async function getDayNotes(from: string, to: string): Promise<DayNote[]> {
  return prisma.lessonDayNote.findMany({
    where: { date: { gte: from, lte: to } },
    select: { lessonId: true, date: true, text: true },
  });
}

/** שמירת הערה לשיעור בתאריך אחד; טקסט ריק = מחיקת ההערה */
export async function setDayNote(lessonId: string, date: string, text: string, createdBy: string | null) {
  const t = text.trim().slice(0, 300);
  if (!t) {
    await prisma.lessonDayNote.deleteMany({ where: { lessonId, date } });
    return;
  }
  await prisma.lessonDayNote.upsert({
    where: { lessonId_date: { lessonId, date } },
    create: { lessonId, date, text: t, createdBy },
    update: { text: t, createdBy },
  });
}

export async function restoreLesson(lessonId: string, date: string) {
  await prisma.lessonCancellation.deleteMany({ where: { lessonId, date } });
}
