import { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { SESSION_COOKIE, verifySession, SessionPayload } from '../lib/auth';
import { User } from '@prisma/client';

export type AuthedUser = User & { permissions: SessionPayload['permissions'] };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

/** מקביל ל-enrichCurrentUser(context) מהספק: מאמת session, טוען את רשומת ה-User, ותולה ב-req.user. */
export async function enrichCurrentUser(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return next();

    const session = verifySession(token);
    if (!session) return next();

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || !user.isActive) return next();

    req.user = { ...user, permissions: session.permissions };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'לא מחובר' });
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'לא מחובר' });
  if (req.user.role !== 'מנהל') return res.status(403).json({ error: 'אין הרשאה' });
  next();
}

/** מנהל, או מי שקיבל הרשאת ניהול נוכחות (isAttendanceManager) — לצפייה/אישור דוחות הנוכחות של כל המורות. */
export function requireAdminOrAttendanceManager(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'לא מחובר' });
  if (req.user.role !== 'מנהל' && !req.user.isAttendanceManager) return res.status(403).json({ error: 'אין הרשאה' });
  next();
}

export function requirePermission(key: keyof SessionPayload['permissions']) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'לא מחובר' });
    if (req.user.role === 'מנהל') return next();
    if (!req.user.permissions[key]) return res.status(403).json({ error: 'אין הרשאה' });
    next();
  };
}
