import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

// puppeteer-core לא מוריד Chromium משלו (מונע בעיות התקנה) — משתמשים בכרום/edge שכבר מותקן במחשב.
// אפשר לדרוס את הנתיב עם משתנה הסביבה CHROME_PATH אם הדפדפן מותקן במיקום אחר.
const CANDIDATE_PATHS = [
  process.env.CHROME_PATH,
  // Windows (פיתוח מקומי)
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  // Linux (שרת פרודקשן, למשל Railway עם nixpacks.toml שמתקין chromium)
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
].filter(Boolean) as string[];

function findExecutablePath(): string {
  const found = CANDIDATE_PATHS.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      'לא נמצא דפדפן Chrome/Edge מותקן ליצירת PDF. התקן Google Chrome, או הגדר את הנתיב במשתנה הסביבה CHROME_PATH.'
    );
  }
  return found;
}

let browserPromise: ReturnType<typeof puppeteer.launch> | null = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      executablePath: findExecutablePath(),
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserPromise;
}

/**
 * מרימה את הדפדפן מראש עם עליית השרת, לא בבקשת ה-PDF הראשונה. בלי זה, הפעלת Chromium
 * לראשונה על שרת עמוס (Render) לוקחת מעל 30 שניות — יותר מזמן ה-timeout של Puppeteer —
 * וההדפסה הראשונה של כל עובד/ת אחרי כל עליית שרת נכשלת עם "Navigation timeout" בלי סיבה
 * עסקית אמיתית. נבדק ישירות: ניסיון ראשון 31.6 שניות (נכשל), ניסיון שני 4.5 שניות (הצליח).
 */
export function warmUpBrowser(): void {
  getBrowser().catch((err) => {
    console.error('שגיאה בהכנה מראש של דפדפן ה-PDF (לא קריטי — ינסה שוב בבקשה הבאה):', err.message);
    browserPromise = null;
  });
}

/** מרנדר HTML ל-PDF ומחזיר את תוכן הקובץ, בלי לשמור. */
export async function htmlToPdfBuffer(html: string, landscape = false): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // 'load' ולא 'networkidle0' — כל התוכן (תמונות, חתימות, אישורי מחלה) מוטמע ישירות ב-HTML ואין מה
    // לחכות לרשת; networkidle0 מוסיף לפחות חצי שנייה של המתנה סתמית לכל קובץ.
    await page.setContent(html, { waitUntil: 'load', timeout: 60000 });
    const pdf = await page.pdf({
      format: 'A4',
      landscape,
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

/**
 * מחבר כמה קבצי PDF לקובץ אחד, לפי הסדר. קובץ שלא ניתן לקרוא (פגום/מוצפן בצורה שלא נתמכת)
 * מדולג — עדיף דוח בלי צרופה אחת מאשר שכל ההורדה תיכשל.
 */
export async function mergePdfs(buffers: Buffer[]): Promise<Buffer> {
  if (buffers.length === 1) return buffers[0];
  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    try {
      const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    } catch (err: any) {
      console.error('דילוג על PDF שלא ניתן לצרף:', err.message);
    }
  }
  return Buffer.from(await merged.save());
}

/** שומר PDF תחת uploads/<subdir>/ ומחזיר URL יחסי + שם קובץ. */
export function savePdf(buffer: Buffer, opts: { subdir: string; filename: string }): { url: string; filename: string } {
  const dir = path.join(UPLOADS_DIR, opts.subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, opts.filename), buffer);
  return { url: `/uploads/${opts.subdir}/${opts.filename}`, filename: opts.filename };
}

/** מרנדר HTML ל-PDF (מחליף את ZitePdf.renderHtml), שומר תחת uploads/<subdir>/ ומחזיר URL יחסי + שם קובץ. */
export async function renderHtmlToPdf(
  html: string,
  opts: { subdir: string; filename: string; landscape?: boolean }
): Promise<{ url: string; filename: string }> {
  return savePdf(await htmlToPdfBuffer(html, !!opts.landscape), opts);
}
