import { prisma } from './prisma';
import { DayDetail } from './monthlyReport';

/**
 * אישור מחלה של יום מסוים, כפי שהוא נכנס לדוח ה-PDF:
 * image — תמונה שהועלתה, מוטמעת ישירות בדוח;
 * pdf — קובץ PDF שהועלה, מצורף כעמודים נוספים אחרי הדוח;
 * link — קישור חיצוני ישן (מלפני שהייתה העלאת קבצים), מוצג כטקסט.
 */
export type SickNote =
  | { date: string; kind: 'image'; dataUrl: string }
  | { date: string; kind: 'pdf'; data: Buffer; fileName: string }
  | { date: string; kind: 'link'; url: string };

const UPLOADED_NOTE = /\/api\/attendance\/sickNote\/([A-Za-z0-9_-]+)$/;

export async function loadSickNotes(days: DayDetail[]): Promise<SickNote[]> {
  const notes: SickNote[] = [];
  for (const d of days) {
    const url = d.record?.type === 'מחלה' ? d.record.sickNoteUrl : null;
    if (!url) continue;

    const id = url.match(UPLOADED_NOTE)?.[1];
    if (!id) {
      notes.push({ date: d.date, kind: 'link', url });
      continue;
    }
    const file = await prisma.sickNoteFile.findUnique({ where: { id } });
    if (!file) continue;
    if (file.fileMime === 'application/pdf') {
      notes.push({ date: d.date, kind: 'pdf', data: Buffer.from(file.fileData), fileName: file.fileName });
    } else {
      notes.push({
        date: d.date,
        kind: 'image',
        dataUrl: `data:${file.fileMime};base64,${Buffer.from(file.fileData).toString('base64')}`,
      });
    }
  }
  return notes;
}
