# מערכת נוכחות — ישיבת הנגב

גרסה עצמאית (לא תלוית Zite) של מערכת ניהול הנוכחות, עם אותה פונקציונליות מהמערכת המקורית: נוכחות עובדים (2 משמרות), דוחות חודשיים + PDF, נוכחות/ציונים/תשלומים/מערכת שעות לתלמידות (מבוססי Airtable), חוזים דיגיטליים, קבלות, וסנכרון ל-Airtable.

## מבנה

- `client/` — React + TypeScript + Vite + Tailwind (RTL, עברית)
- `server/` — Node + Express + TypeScript + Prisma (SQLite)

## התקנה ראשונית

```bash
cd server && npm install
cd ../client && npm install
```

### 1. קובץ סביבה לשרת

```bash
cd server
cp .env.example .env
```

ערוך את `server/.env`:

- `JWT_SECRET` — כבר הוגדר ערך אקראי בעת ההתקנה; אפשר להשאיר או להחליף.
- `AIRTABLE_API_KEY` — **חובה** כדי שהתחברות, תלמידות, ציונים, תשלומים ומערכת שעות יעבדו. צור Personal Access Token ב-[airtable.com/create/tokens](https://airtable.com/create/tokens) עם הרשאות `data.records:read`, `data.records:write`, `schema.bases:read` על הבסיס `appPz3YsHaKf79z37`.

### 2. בסיס הנתונים המקומי

```bash
cd server
npx prisma migrate dev   # כבר רץ פעם אחת בעת ההקמה
npm run seed              # יוצר משתמש מנהל ראשוני
```

הרצת ה-seed תדפיס את השם שנוצר (למשל "מנהל מערכת"). **חשוב:** מכיוון שההתחברות מבוססת על טבלת `passwords` ב-Airtable (בדיוק כמו במערכת המקורית), צריך להוסיף שם ידנית רשומה בטבלה הזו ב-Airtable:

| שם המשתמש | סיסמה מאוחדת | גישה למערכת |
|---|---|---|
| מנהל מערכת | (הסיסמה שתבחר/י) | מאושר |

בלי זה, אף אחד לא יכול להתחבר — גם לא המנהל.

### 3. הרצה

```bash
npm run dev   # מהתיקייה הראשית — מריץ client+server יחד
```

- שרת: http://localhost:4000
- אתר: http://localhost:5173

## הערות חשובות

- **שמות שדות Airtable**: הקובץ `server/src/lib/airtableFields.ts` וקבועי ה-Table IDs ב-`server/src/lib/airtable.ts` מבוססים על התיעוד המקורי. אם השמות בפועל בבסיס ה-Airtable שלך שונים (במיוחד בטבלאות students/lessons/payments/grades), עדכן אותם שם — זה המקום היחיד שצריך לגעת בו.
- **PDF**: הייצוא משתמש ב-Chrome/Edge שכבר מותקן במחשב (לא מוריד דפדפן משלו). אם הוא לא נמצא בנתיב הסטנדרטי, הגדר `CHROME_PATH` ב-`.env`.
- **חגים**: מחושבים אוטומטית ומדויקים לכל שנה (לא רק 2024-2027) דרך `server/src/lib/holidays.ts`. מדיניות "חג מלא מול חצי יום" מתועדת שם וניתנת לעריכה.
- **הוספת עובדים נוספים**: דרך מסך הניהול (`/admin` → עובדים) לאחר התחברות כמנהל, או ישירות ב-`npx prisma studio`.
