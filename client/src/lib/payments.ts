export type PaymentEntry = {
  id: string;
  method: string;
  amount: number;
  date: string;
  notes: string | null;
  createdBy: string | null;
};

export type Payment = {
  id: string;
  fullName: string;
  month: string;
  year: string;
  monthKey: number;
  amountDue: number;
  extra: number;
  scholarship: number;
  owed: number;
  amountPaid: number;
  balance: number;
  status: 'Paid' | 'Partial' | 'Unpaid';
  paymentDate: string | null;
  paymentMethod: string | null;
  entries: PaymentEntry[];
};

export type StudentRow = {
  name: string;
  tracks: string[];
  trackIds: string[];
  motherName: string;
  fatherName: string;
  address: string;
  city: string;
  matched: boolean;
  monthlyAmount: number; // מה שבפועל יחויב: אישי אם הוגדר, אחרת לפי המגמה
  personalAmount: number; // 0 = אין סכום אישי
  trackAmount: number;
  monthlyScholarship: number;
  active: boolean;
  billingNotes: string;
};

export type TrackPrice = { trackId: string; trackName: string; monthlyAmount: number };

export type Overview = {
  payments: Payment[];
  students: StudentRow[];
  trackPrices: TrackPrice[];
  tracks: { id: string; name: string }[];
  allStudentNames: string[];
  methods: string[];
};

/** שנת לימודים: ספטמבר עד אוגוסט */
export const SCHOOL_MONTHS = ['ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר', 'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט'];
export const MONTH_NUM: Record<string, number> = {
  ינואר: 1, פברואר: 2, מרץ: 3, אפריל: 4, מאי: 5, יוני: 6, יולי: 7, אוגוסט: 8, ספטמבר: 9, אוקטובר: 10, נובמבר: 11, דצמבר: 12,
};
const MONTH_BY_NUM = Object.fromEntries(Object.entries(MONTH_NUM).map(([name, n]) => [n, name]));

export type MonthColumn = { month: string; year: string; key: number };

/** 12 העמודות של שנת הלימודים שמתחילה בספטמבר של startYear */
export function schoolYearColumns(startYear: number): MonthColumn[] {
  return SCHOOL_MONTHS.map((month, i) => {
    const year = i < 4 ? startYear : startYear + 1;
    return { month, year: String(year), key: year * 100 + MONTH_NUM[month] };
  });
}

/** שנת הלימודים הנוכחית — מספטמבר והלאה זו השנה החדשה */
export function currentSchoolYear(now = new Date()): number {
  return now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}

export function currentMonthColumn(now = new Date()): MonthColumn {
  const n = now.getMonth() + 1;
  return { month: MONTH_BY_NUM[n], year: String(now.getFullYear()), key: now.getFullYear() * 100 + n };
}

export function shekel(n: number): string {
  return `${Math.round(n).toLocaleString('he-IL')} ₪`;
}

export const STATUS_HE: Record<Payment['status'], string> = { Paid: 'שולם', Partial: 'שולם חלקית', Unpaid: 'לא שולם' };

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
