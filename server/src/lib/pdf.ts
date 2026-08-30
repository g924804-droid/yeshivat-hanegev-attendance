import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

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

/** מרנדר HTML ל-PDF (מחליף את ZitePdf.renderHtml), שומר תחת uploads/<subdir>/ ומחזיר URL יחסי + שם קובץ. */
export async function renderHtmlToPdf(
  html: string,
  opts: { subdir: string; filename: string; landscape?: boolean }
): Promise<{ url: string; filename: string }> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: !!opts.landscape,
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
    });

    const dir = path.join(UPLOADS_DIR, opts.subdir);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, opts.filename);
    fs.writeFileSync(filePath, pdfBuffer);

    return { url: `/uploads/${opts.subdir}/${opts.filename}`, filename: opts.filename };
  } finally {
    await page.close();
  }
}
