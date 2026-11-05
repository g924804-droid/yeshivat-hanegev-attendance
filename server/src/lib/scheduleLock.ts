import crypto from 'crypto';
import { prisma } from './prisma';

/**
 * נעילת העבר במערכת השעות: שינוי או מחיקה שמשפיעים על תאריכים שכבר עברו (ועליהם כבר נרשמה
 * נוכחות) דורשים קוד נעילה. הקוד נקבע ע"י מנהלת במסך מערכת השעות, ונשמר כ-hash בלבד.
 */

export const LOCK_REQUIRED_MESSAGE = '🔒 השינוי משפיע על תאריכים שכבר עברו — נדרש קוד נעילה';

export class LockRequiredError extends Error {
  constructor(message = LOCK_REQUIRED_MESSAGE) {
    super(message);
  }
}

/** היום לפי שעון ישראל — YYYY-MM-DD */
export function israelToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function hash(code: string, salt: string): string {
  return crypto.scryptSync(code, salt, 32).toString('hex');
}

export async function hasLockCode(): Promise<boolean> {
  const s = await prisma.siteSettings.findUnique({ where: { id: 'singleton' }, select: { scheduleLockCode: true } });
  return !!s?.scheduleLockCode;
}

export async function verifyLockCode(code: string | undefined | null): Promise<boolean> {
  if (!code) return false;
  const s = await prisma.siteSettings.findUnique({ where: { id: 'singleton' }, select: { scheduleLockCode: true } });
  if (!s?.scheduleLockCode) return false;
  const [salt, stored] = s.scheduleLockCode.split(':');
  const given = Buffer.from(hash(String(code), salt), 'hex');
  const expected = Buffer.from(stored, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export async function setLockCode(code: string): Promise<void> {
  const salt = crypto.randomBytes(16).toString('hex');
  const value = `${salt}:${hash(code, salt)}`;
  await prisma.siteSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', scheduleLockCode: value },
    update: { scheduleLockCode: value },
  });
}

/** זורק LockRequiredError אם אין קוד נכון. בלי קוד מוגדר — אין דרך לשנות את העבר. */
export async function requirePastUnlock(code: string | undefined | null): Promise<void> {
  if (!(await hasLockCode())) throw new LockRequiredError('🔒 השינוי משפיע על תאריכים שכבר עברו — יש להגדיר קודם קוד נעילה (מנהלת, בכפתור "קוד נעילה")');
  if (!(await verifyLockCode(code))) throw new LockRequiredError(code ? '🔒 קוד הנעילה שגוי' : LOCK_REQUIRED_MESSAGE);
}
