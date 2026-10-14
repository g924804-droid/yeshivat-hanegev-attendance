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

/**
 * קובץ שהעובד/ת צירפ/ה לדוח לחשבת השכר: תמונה מוטמעת בדוח, PDF מצורף כעמודים נוספים,
 * וכל סוג אחר (Word, Excel...) רק מופיע ברשימה — אפשר לפתוח אותו מהמערכת.
 */
export type ReportFile =
  | { kind: 'image'; fileName: string; dataUrl: string }
  | { kind: 'pdf'; fileName: string; data: Buffer }
  | { kind: 'other'; fileName: string };

export async function loadReportAttachments(reportId: string): Promise<ReportFile[]> {
  const files = await prisma.reportAttachment.findMany({ where: { reportId }, orderBy: { createdAt: 'asc' } });
  return files.map((f): ReportFile => {
    if (f.fileMime === 'application/pdf') return { kind: 'pdf', fileName: f.fileName, data: Buffer.from(f.fileData) };
    if (f.fileMime.startsWith('image/'))
      return { kind: 'image', fileName: f.fileName, dataUrl: `data:${f.fileMime};base64,${Buffer.from(f.fileData).toString('base64')}` };
    return { kind: 'other', fileName: f.fileName };
  });
}

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
