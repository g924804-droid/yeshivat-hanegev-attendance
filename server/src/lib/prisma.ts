import { PrismaClient } from '@prisma/client';

const basePrisma = new PrismaClient();

/**
 * enrichCurrentUser קורא ל-DB בכל בקשה בודדת לאפליקציה (בדיקת session). כשהחיבור המאוגד
 * (connection pool) ל-Postgres של Render "נרדם" אחרי חוסר פעילות, השאילתה הראשונה אחרי זה
 * נכשלת עם "Can't reach database server" — והשנייה, מיד אחריה, מצליחה בלי שום שינוי אחר.
 * ראינו את זה ישירות: בקשה נכשלה ב-500, ניסיון חוזר מיידי הצליח. בלי retry כאן, כל לחיצה
 * במסך (כניסה/יציאה, סימון נוכחות, כל endpoint) שנתקלת ברגע הזה בדיוק היתה נראית למשתמשת
 * כאילו "לא מגיבה" — כישלון שקט בלי שום סיבה עסקית אמיתית.
 */
function isTransientConnectionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("Can't reach database server") || message.includes('P1001') || message.includes('P1017');
}

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        try {
          return await query(args);
        } catch (err) {
          if (!isTransientConnectionError(err)) throw err;
          await new Promise((resolve) => setTimeout(resolve, 300));
          return await query(args);
        }
      },
    },
  },
});
