import { prisma } from './prisma';

/** בדיקת חוזים לא חתומים לעובד — נקראת מ-clockIn / addSickDay / submitMonthlyReport לפי הספק. */
export async function hasPendingContracts(employeeId: string): Promise<boolean> {
  const count = await prisma.contract.count({
    where: { employeeId, status: 'ממתין לחתימה' },
  });
  return count > 0;
}
