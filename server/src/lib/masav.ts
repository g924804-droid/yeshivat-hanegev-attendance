import crypto from 'crypto';
import ExcelJS from 'exceljs';
import { isGivenName } from './givenNames';

/**
 * דוח מס"ב (הוראות קבע ששודרו) — קובץ CSV (בדרך כלל UTF-16 עם טאבים) או אקסל.
 * עמודות: שם לקוח (הורים + "התלמידה X"), זהות, כתובת, טלפון, פרטי חשבון, סכום, יתרת תשלומים, קטגוריה, הערות.
 */
export type MasavRow = {
  line: number;
  customer: string;
  /** מזהה המשלם (גיבוב של ת"ז, ואם אין — של מספר החשבון). לא שומרים את המספר עצמו. */
  payerKey: string;
  amount: number;
  /** "חיוב בודד" וכד' */
  kind: string;
  notes: string;
};

const clean = (s: unknown) => String(s ?? '').replace(/[‎‏﻿]/g, '').replace(/\s+/g, ' ').trim();

function decode(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  const utf8 = buf.toString('utf8');
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '');
  try {
    return new TextDecoder('windows-1255').decode(buf);
  } catch {
    return utf8;
  }
}

/** פיצול שורת CSV עם מרכאות ("" = מרכאה בתוך שדה) */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"' && !cur.trim()) q = true;
    else if (c === sep) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

async function readTable(buf: Buffer): Promise<string[][]> {
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.worksheets[0];
    const rows: string[][] = [];
    ws?.eachRow({ includeEmpty: true }, (row) => {
      const vals: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const v: any = cell.value;
        vals[col - 1] = v && typeof v === 'object' ? String(v.result ?? v.text ?? (v.richText ? v.richText.map((r: any) => r.text).join('') : '')) : String(v ?? '');
      });
      rows.push(Array.from(vals, (v) => v ?? ''));
    });
    return rows;
  }
  const text = decode(buf);
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const sep = (lines[0] || '').includes('\t') ? '\t' : ',';
  return lines.map((l) => splitLine(l, sep));
}

export function payerKeyOf(id: string, account: string): string {
  const digits = (s: string) => s.replace(/\D/g, '');
  const base = digits(id) ? 'id:' + digits(id).replace(/^0+/, '') : digits(account) ? 'acc:' + digits(account) : '';
  return base ? crypto.createHash('sha256').update('masav|' + base).digest('hex').slice(0, 32) : '';
}

export async function parseMasavFile(buf: Buffer): Promise<MasavRow[]> {
  const table = await readTable(buf);
  const headerIdx = table.findIndex((r) => r.some((c) => clean(c).includes('סכום')) && r.some((c) => clean(c).includes('שם')));
  if (headerIdx < 0) throw new Error('לא נמצאה שורת כותרות (שם לקוח / סכום) בקובץ');
  const header = table[headerIdx].map(clean);
  const col = (...keys: string[]) => header.findIndex((h) => keys.some((k) => h.includes(k)));
  const cName = col('שם');
  const cId = col('זהות', 'ת.ז', 'ת"ז');
  const cAcc = col('חשבון');
  const cAmount = col('סכום');
  const cKind = col('יתרת תשלומים', 'סוג');
  const cNotes = col('הערות');
  const rows: MasavRow[] = [];
  table.slice(headerIdx + 1).forEach((r, i) => {
    const customer = clean(r[cName]);
    const amount = Number(clean(r[cAmount]).replace(/[^\d.\-]/g, ''));
    if (!customer || !amount) return;
    rows.push({
      line: headerIdx + i + 2,
      customer,
      payerKey: payerKeyOf(cId >= 0 ? clean(r[cId]) : '', cAcc >= 0 ? clean(r[cAcc]) : ''),
      amount: Math.round(amount * 100) / 100,
      kind: cKind >= 0 ? clean(r[cKind]) : '',
      notes: cNotes >= 0 ? clean(r[cNotes]) : '',
    });
  });
  return rows;
}

/** תאריך משם הקובץ: DohMasav151126 → 2026-11-15 */
export function dateFromFileName(name: string): string | null {
  const m = name.match(/(\d{2})(\d{2})(\d{2})(?!\d)/);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), 2000 + Number(m[3])];
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const words = (s: string) =>
  s
    .replace(/["'״׳,.()\-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/**
 * "פליישמן יעל ויהודה עזרא התלמידה שרה" → הורים: [פליישמן, יעל, יהודה, עזרא], בת: [שרה].
 * מילה שמתחילה ב-ו ("ויהודה") נספרת גם בלי ה-ו.
 */
export function splitCustomer(customer: string): { parentWords: string[]; girlWords: string[] } {
  const m = customer.match(/^(.*?)(?:ה)?תלמיד(?:ה|ות)\s*:?\s*(.*)$/);
  const parentPart = m ? m[1] : customer.replace(/,?\s*לומדת.*$/, '');
  const girlPart = m ? m[2].split(/[,(]|\sלומדת/)[0] : '';
  const pw = words(parentPart);
  const parentWords = [...new Set(pw.flatMap((w) => (w.length > 2 && w.startsWith('ו') ? [w, w.slice(1)] : [w])))];
  return { parentWords, girlWords: words(girlPart).slice(0, 3) };
}

export type MatchResult = { name: string | null; how: 'exact' | 'family' | 'none' | 'ambiguous'; candidates: string[] };

/** שלד המילה — בלי ו/י באמצע (אילה=איילה, גרינבוים=גרינבויים, סמיא=סימא) */
const sk = (w: string) => w[0] + w.slice(1).replace(/[וי]/g, '');
const hasWord = (list: string[], w: string) => list.some((x) => x === w || sk(x) === sk(w));

export type MatchCandidate = { name: string; parents?: string[] };

/**
 * התאמת שורה לתלמידה: שם המשפחה (מילה מהשם שאינה שם פרטי) מופיע בשם הלקוח, השם הפרטי של הבת אחרי
 * "התלמידה", ושמות ההורים (שם אבא / שם אמא מטבלת התלמידות) — מכריעים כשיש כמה בנות באותה משפחה.
 */
export function matchStudent(customer: string, candidates: MatchCandidate[]): MatchResult {
  const { parentWords, girlWords } = splitCustomer(customer);
  const scored = candidates
    .map(({ name, parents = [] }) => {
      const nw = words(name);
      const rest = nw.filter((w) => !hasWord(girlWords, w));
      const family = rest.filter((w) => !isGivenName(w));
      const familyHit = (family.length ? family : rest).some((w) => hasWord(parentWords, w));
      const girlHit = girlWords.length > 0 && girlWords.every((w) => hasWord(nw, w));
      const parentHits = [...new Set(parents.flatMap(words))].filter((w) => w.length > 1 && hasWord(parentWords, w)).length;
      // בלי "התלמידה" — לפעמים כתוב בשם הלקוח השם המלא של הבת עצמה ("פינקל שפרה")
      const fullHit = !girlWords.length && nw.length > 1 && nw.every((w) => hasWord(parentWords, w));
      const score = (familyHit ? 4 : 0) + (girlHit ? 4 : 0) + (fullHit ? 4 : 0) + Math.min(parentHits, 2) * 2;
      return { name, familyHit, girlHit: girlHit || fullHit, parentHits, score };
    })
    .filter((x) => x.familyHit || (x.girlHit && x.parentHits))
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { name: null, how: 'none', candidates: [] };
  const top = scored.filter((x) => x.score === scored[0].score);
  if (top.length > 1) return { name: null, how: 'ambiguous', candidates: top.map((x) => x.name) };
  const t = top[0];
  // מספיק שניים מהשלושה: משפחה, שם הבת, שמות ההורים
  const signals = (t.familyHit ? 1 : 0) + (t.girlHit ? 1 : 0) + (t.parentHits ? 1 : 0);
  if (signals >= 2) return { name: t.name, how: 'exact', candidates: [] };
  // רק שם משפחה — בסדר אם יש בת אחת בלבד עם השם הזה (מסומן לבדיקה)
  if (scored.length === 1) return { name: t.name, how: 'family', candidates: [] };
  return { name: null, how: 'ambiguous', candidates: scored.slice(0, 6).map((x) => x.name) };
}
