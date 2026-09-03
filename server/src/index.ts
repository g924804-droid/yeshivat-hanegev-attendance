import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { enrichCurrentUser } from './middleware/auth';
import { warmUpBrowser } from './lib/pdf';

import authRoutes from './routes/auth';
import attendanceRoutes from './routes/attendance';
import reportsRoutes from './routes/reports';
import employeesRoutes from './routes/employees';
import studentsRoutes from './routes/students';
import gradesRoutes from './routes/grades';
import paymentsRoutes from './routes/payments';
import scheduleRoutes from './routes/schedule';
import receiptsRoutes from './routes/receipts';
import contractsRoutes from './routes/contracts';
import syncRoutes from './routes/sync';
import displayRoutes from './routes/display';
import announcementsRoutes from './routes/announcements';
import settingsRoutes from './routes/settings';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '15mb' })); // חתימות דיגיטליות מגיעות כ-data URL
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.use(enrichCurrentUser);

app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/grades', gradesRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/receipts', receiptsRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/display', displayRoutes);
app.use('/api/announcements', announcementsRoutes);
app.use('/api/settings', settingsRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// בפרודקשן (למשל Railway) שרת אחד מגיש גם את קבצי ה-React הבנויים — אין צורך בשרת סטטי נפרד.
// בפיתוח מקומי התיקייה הזו לא קיימת (הקליינט רץ דרך Vite על פורט נפרד), אז פשוט מדלגים.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  // קבצי ה-assets עם hash בשם (js/css) יכולים להישמר במטמון לצמיתות; index.html חייב תמיד
  // להיבדק מול השרת מחדש, אחרת דפדפנים ימשיכו להציג גרסה ישנה של האתר אחרי כל עדכון.
  app.use(
    express.static(clientDist, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'שגיאת שרת' });
});

app.listen(PORT, () => {
  console.log(`שרת מערכת נוכחות ישיבת הנגב פועל על פורט ${PORT}`);
  warmUpBrowser();
});
