import axios from 'axios';

const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appPz3YsHaKf79z37';
const API_KEY = process.env.AIRTABLE_API_KEY || '';

export const TABLES = {
  tracks: 'tblaHMei12vCezj0s',
  students: 'tblu6f2by25l3mzWG',
  attendance: 'tblgPzqzEcC8jgxlz',
  grades: 'tblVGayQkR1Srgr7f',
  teachers: 'tblwSgfqyKwbyOGmj',
  lessons: 'tbljkTjhHzvVtOt9r',
  payments: 'tblsGseV4tTr7jqZN',
  employeeAttendance: 'tbljaKys94D9UDSkS',
  passwords: 'tblQF4b3OT5fQrl9H',
  monthlyReports: 'tblKxtN4jLRjsmoDd',
  receiptsSync: 'tbl4erFGUizX6qXG0',
  employeesSync: 'tblckOpZcsLOhcAEW',
} as const;

export type AirtableRecord = { id: string; fields: Record<string, any>; createdTime?: string };

const client = axios.create({
  baseURL: `https://api.airtable.com/v0/${BASE_ID}`,
  headers: { Authorization: `Bearer ${API_KEY}` },
});

function assertConfigured() {
  if (!API_KEY) {
    throw new Error('AIRTABLE_API_KEY אינו מוגדר — הוסף אותו לקובץ server/.env');
  }
}

export async function airtableFetch(
  tableId: string,
  params: { filterByFormula?: string; fields?: string[]; maxRecords?: number; sort?: { field: string; direction?: 'asc' | 'desc' }[] } = {}
): Promise<AirtableRecord[]> {
  assertConfigured();
  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  const query: Record<string, any> = {};
  if (params.filterByFormula) query.filterByFormula = params.filterByFormula;
  if (params.maxRecords) query.maxRecords = params.maxRecords;
  if (params.fields) params.fields.forEach((f, i) => (query[`fields[${i}]`] = f));
  if (params.sort) {
    params.sort.forEach((s, i) => {
      query[`sort[${i}][field]`] = s.field;
      query[`sort[${i}][direction]`] = s.direction || 'asc';
    });
  }

  do {
    const { data } = await client.get(`/${tableId}`, { params: { ...query, offset } });
    records.push(...data.records);
    offset = data.offset;
  } while (offset);

  return records;
}

export async function airtableGetRecord(tableId: string, recordId: string): Promise<AirtableRecord | null> {
  assertConfigured();
  try {
    const { data } = await client.get(`/${tableId}/${recordId}`);
    return data;
  } catch (err: any) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

export async function airtableCreate(tableId: string, fields: Record<string, any>): Promise<AirtableRecord> {
  assertConfigured();
  const { data } = await client.post(`/${tableId}`, { fields });
  return data;
}

export async function airtableUpdate(
  tableId: string,
  recordId: string,
  fields: Record<string, any>
): Promise<AirtableRecord> {
  assertConfigured();
  const { data } = await client.patch(`/${tableId}/${recordId}`, { fields });
  return data;
}

export async function airtableDelete(tableId: string, recordId: string): Promise<void> {
  assertConfigured();
  await client.delete(`/${tableId}/${recordId}`);
}

/** upsert רשומת נוכחות עובד ב-Airtable, לפי מזהה מערכת (systemId = מזהה הרשומה ב-DB המקומי). */
export async function syncAttendanceToAirtable(opts: {
  systemId: string;
  employeeName: string;
  employeeEmail?: string;
  date: string;
  clockIn?: string | null;
  clockOut?: string | null;
  clockIn2?: string | null;
  clockOut2?: string | null;
  totalHours?: number;
  overtimeHours?: number;
  lessonsCount?: number;
  type: string;
  notes?: string | null;
  sickNoteUrl?: string | null;
}): Promise<void> {
  const existing = await airtableFetch(TABLES.employeeAttendance, {
    filterByFormula: `{מזהה מערכת} = "${opts.systemId}"`,
    maxRecords: 1,
  });

  const fields: Record<string, any> = {
    'שם עובד': opts.employeeName,
    'אימייל עובד': opts.employeeEmail || '',
    תאריך: opts.date,
    'כניסה 1': opts.clockIn || '',
    'יציאה 1': opts.clockOut || '',
    'כניסה 2': opts.clockIn2 || '',
    'יציאה 2': opts.clockOut2 || '',
    'סה"כ שעות': opts.totalHours ?? 0,
    'שעות עודפות': opts.overtimeHours ?? 0,
    'מספר שיעורים': opts.lessonsCount ?? 0,
    סוג: opts.type,
    הערות: opts.notes || '',
    'אישור מחלה': opts.sickNoteUrl || '',
    'מזהה מערכת': opts.systemId,
  };

  if (existing[0]) {
    await airtableUpdate(TABLES.employeeAttendance, existing[0].id, fields);
  } else {
    await airtableCreate(TABLES.employeeAttendance, fields);
  }
}

export async function deleteAttendanceFromAirtable(systemId: string): Promise<void> {
  const existing = await airtableFetch(TABLES.employeeAttendance, {
    filterByFormula: `{מזהה מערכת} = "${systemId}"`,
    maxRecords: 1,
  });
  if (existing[0]) {
    await airtableDelete(TABLES.employeeAttendance, existing[0].id);
  }
}

/** ממפה סטטוס נוכחות תלמידה בין עברית לאנגלית (טבלת Airtable משתמשת בערכים אנגליים). */
export const STUDENT_STATUS_HE_TO_EN: Record<string, string> = {
  נוכחת: 'Present',
  חסרה: 'Absent',
  איחור: 'Late',
  חופשה: 'Absent',
};

export const STUDENT_STATUS_EN_TO_HE: Record<string, string> = {
  Present: 'נוכחת',
  Absent: 'חסרה',
  Late: 'איחור',
};
