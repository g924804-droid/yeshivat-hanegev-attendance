// שמות שדות Airtable בעברית — לפי סעיף 3.3 בספק. אם השמות בבסיס בפועל שונים, זה המקום היחיד לעדכן.
export const FIELDS = {
  tracks: {
    name: 'מסלולים',
    students: 'תלמידות',
    coordinator: 'רכז מסלול',
    description: 'תאור',
  },
  students: {
    name: 'שם התלמידה',
    // שם השדה בפועל ב-Airtable הוא "מסלולים" (רבים) — שדה מקושר מרובה-ערכים (מערך של
    // מזהי מסלולים), לא "מסלול" יחיד. שדה "תלמידות" בטבלת המסلولים עצמה הוא טקסט מחושב
    // (רשימת שמות מופרדת בפסיקים), לא שדה מקושר אמיתי — לכן זה מקור האמת האמין היחיד.
    track: 'מסלולים',
    className: 'כיתה',
    phone: 'טלפון',
    isActive: 'פעיל',
  },
  teachers: {
    name: 'שם המורה',
  },
  lessons: {
    className: 'שם הכיתה',
    subject: 'נושא',
    dayOfWeek: 'יום בשבוע',
    time: 'זמן',
    track: 'מסלול',
    teacher: 'מורה',
    room: 'חדר',
    year: 'שנה',
    notes: 'הערות',
    fromDate: 'מתאריך ', // כן, יש רווח בסוף בשם השדה בפועל ב-Airtable
    toDate: 'עד תאריך',
  },
  attendance: {
    date: 'תאריך',
    student: 'תלמידה',
    status: 'סטטוס נוכחות',
    notes: 'הערות',
  },
  grades: {
    studentLinked: 'שם התלמידה ומשפחה',
    studentName: 'שם התלמידה',
    classLinked: 'כיתה',
    testName: 'שם המבחן/מטלה',
    score: 'ציון',
    date: 'תאריך',
    notes: 'הערות',
  },
  payments: {
    fullName: 'שם מלא',
    month: 'חודש התשלום',
    year: 'שנת תשלום',
    amountDue: 'סכום לתשלום',
    amountPaid: 'Amount Paid',
    balance: 'יתרה שטרם נפרעה',
    status: 'סטטוס תשלום',
    paymentDate: 'תאריך תשלום',
    paymentMethod: 'אמצעי תשלום',
    extra: 'תוספת לתשלום הקבוע ',
    scholarship: 'מילגה',
    student: 'תלמידה',
  },
} as const;
