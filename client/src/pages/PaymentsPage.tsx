import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, CalendarPlus, FileSpreadsheet, Mail, Settings2, ChevronRight, ChevronLeft } from 'lucide-react';
import { Layout } from '../components/Layout';
import { api, FILTER_BLOCKED_MESSAGE } from '../lib/api';
import { useUrlState } from '../lib/useUrlState';
import {
  Overview,
  Payment,
  StudentRow,
  MonthColumn,
  schoolYearColumns,
  currentSchoolYear,
  currentMonthColumn,
  shekel,
  STATUS_HE,
} from '../lib/payments';
import { PaymentModal } from '../components/payments/PaymentModal';
import { BillingModal, GenerateMonthModal, NewChargeModal } from '../components/payments/BillingModals';
import { LettersModal } from '../components/payments/LettersModal';

const CELL_STYLE: Record<Payment['status'], string> = {
  Paid: 'bg-green-100 text-green-800 hover:bg-green-200',
  Partial: 'bg-orange-100 text-orange-800 hover:bg-orange-200',
  Unpaid: 'bg-red-100 text-red-700 hover:bg-red-200',
};

export function PaymentsPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [schoolYear, setSchoolYear] = useUrlState('year', String(currentSchoolYear()));
  const [search, setSearch] = useState('');
  const [trackFilter, setTrackFilter] = useState('');
  const [onlyDebts, setOnlyDebts] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [openPayment, setOpenPayment] = useState<Payment | null>(null);
  const [newCharge, setNewCharge] = useState<{ student: StudentRow; column: MonthColumn } | null>(null);
  const [billingFor, setBillingFor] = useState<StudentRow | 'new' | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [letters, setLetters] = useState<{ student?: StudentRow } | null>(null);

  async function load() {
    try {
      setData(await api.get<Overview>('/payments/overview'));
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err.message || 'שגיאה בטעינה');
    }
  }
  useEffect(() => {
    load();
  }, []);

  const columns = useMemo(() => schoolYearColumns(Number(schoolYear)), [schoolYear]);
  const nowColumn = currentMonthColumn();
  // החודש לסיכום: החודש הנוכחי אם הוא בשנה המוצגת, אחרת החודש האחרון בה
  const summaryColumn = columns.find((c) => c.key === nowColumn.key) || (nowColumn.key > columns[11].key ? columns[11] : columns[0]);

  const paymentAt = useMemo(() => {
    const map = new Map<string, Payment>();
    for (const p of data?.payments || []) map.set(`${p.fullName}|${p.monthKey}`, p);
    return map;
  }, [data]);

  const debtByStudent = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of data?.payments || []) map.set(p.fullName, (map.get(p.fullName) || 0) + p.balance);
    return map;
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim();
    return data.students
      .filter((s) => showInactive || s.active || (debtByStudent.get(s.name) || 0) > 0)
      .filter((s) => !q || s.name.includes(q))
      .filter((s) => !trackFilter || s.trackIds.includes(trackFilter))
      .filter((s) => !onlyDebts || (debtByStudent.get(s.name) || 0) > 0)
      .sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }, [data, search, trackFilter, onlyDebts, showInactive, debtByStudent]);

  const summary = useMemo(() => {
    const monthPayments = (data?.payments || []).filter((p) => p.monthKey === summaryColumn.key);
    return {
      owed: monthPayments.reduce((s, p) => s + p.owed, 0),
      paid: monthPayments.reduce((s, p) => s + Math.min(p.amountPaid, p.owed), 0),
      scholarship: monthPayments.reduce((s, p) => s + p.scholarship, 0),
      missing: monthPayments.reduce((s, p) => s + p.balance, 0),
      debtors: monthPayments.filter((p) => p.balance > 0).length,
      opened: monthPayments.length > 0,
      totalDebt: [...debtByStudent.values()].reduce((s, v) => s + v, 0),
      totalDebtors: [...debtByStudent.values()].filter((v) => v > 0).length,
    };
  }, [data, summaryColumn, debtByStudent]);

  // אמצעי התשלום שבו התלמידה שילמה לאחרונה — ברירת מחדל נוחה לתשלום הבא
  function lastMethod(name: string): string {
    const methods = data?.methods || [];
    const entries = (data?.payments || []).filter((p) => p.fullName === name).flatMap((p) => p.entries);
    const last = entries.sort((a, b) => b.date.localeCompare(a.date))[0]?.method;
    const fromAirtable = (data?.payments || []).filter((p) => p.fullName === name && p.paymentMethod).sort((a, b) => b.monthKey - a.monthKey)[0]
      ?.paymentMethod;
    return [last, fromAirtable].find((m) => m && methods.includes(m)) || methods[0];
  }

  async function exportExcel() {
    setExporting(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/payments/exportExcel?schoolYear=${schoolYear}`, { credentials: 'include' });
      if (res.status === 418) throw new Error(FILTER_BLOCKED_MESSAGE);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `הייצוא נכשל (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `תשלומים ${schoolYear}-${Number(schoolYear) + 1}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      setNotice(err.message || 'שגיאה בייצוא');
    } finally {
      setExporting(false);
    }
  }

  if (!data) {
    return <Layout title="תשלומים">{loadError ? <p className="text-red-700">{loadError}</p> : 'טוען...'}</Layout>;
  }

  return (
    <Layout title="תשלומים">
      {/* סיכום */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <SummaryCard label={`צריך להיכנס — ${summaryColumn.month}`} value={summary.opened ? shekel(summary.owed) : 'החודש עוד לא נפתח'} />
        <SummaryCard label="נכנס" value={shekel(summary.paid)} tone="green" />
        <SummaryCard label="חסר" value={`${shekel(summary.missing)}${summary.debtors ? ` · ${summary.debtors} תלמידות` : ''}`} tone="red" />
        <SummaryCard label={`מלגות — ${summaryColumn.month}`} value={shekel(summary.scholarship)} />
        <SummaryCard label="סה״כ חובות פתוחים" value={`${shekel(summary.totalDebt)} · ${summary.totalDebtors} תלמידות`} tone="red" />
      </div>

      {/* כלים */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex items-center gap-1">
          <button className="btn-outline py-2 px-2" onClick={() => setSchoolYear(String(Number(schoolYear) - 1))} title="שנה קודמת">
            <ChevronRight size={16} />
          </button>
          <span className="font-semibold text-navy text-sm px-1">
            שנת לימודים {schoolYear}–{Number(schoolYear) + 1}
          </span>
          <button className="btn-outline py-2 px-2" onClick={() => setSchoolYear(String(Number(schoolYear) + 1))} title="שנה הבאה">
            <ChevronLeft size={16} />
          </button>
        </div>
        <div className="relative">
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pr-9 py-2 w-48" placeholder="חיפוש לפי שם" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input py-2 w-auto" value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)}>
          <option value="">כל המסלולים</option>
          {data.tracks.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={onlyDebts} onChange={(e) => setOnlyDebts(e.target.checked)} /> רק עם חוב
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-500">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> גם שסיימו
        </label>
        <div className="flex flex-wrap gap-2 mr-auto">
          <button className="btn-primary py-2" onClick={() => setShowGenerate(true)}>
            <CalendarPlus size={16} /> פתיחת חודש
          </button>
          <button className="btn-outline py-2" onClick={() => setLetters({})}>
            <Mail size={16} /> מכתבים להורים
          </button>
          <button className="btn-outline py-2" onClick={exportExcel} disabled={exporting}>
            <FileSpreadsheet size={16} /> {exporting ? 'מכין...' : 'ייצוא לאקסל'}
          </button>
          <button className="btn-outline py-2" onClick={() => setBillingFor('new')}>
            <Plus size={16} /> תלמידה
          </button>
        </div>
      </div>

      {notice && <div className="mb-3 text-sm bg-blue-50 text-blue-900 rounded-xl px-4 py-2">{notice}</div>}

      {/* טבלה שנתית */}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50 text-slate-600">
              <th className="sticky right-0 bg-slate-50 text-right px-3 py-2 min-w-[180px] z-10">תלמידה</th>
              {columns.map((c) => (
                <th key={c.key} className={`px-1 py-2 font-medium min-w-[72px] ${c.key === nowColumn.key ? 'text-navy font-bold' : ''}`}>
                  {c.month}
                  <span className="block text-[10px] text-slate-400 font-normal">{c.year}</span>
                </th>
              ))}
              <th className="px-3 py-2 min-w-[90px]">יתרת חוב</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const debt = debtByStudent.get(s.name) || 0;
              return (
                <tr key={s.name} className={`border-t ${s.active ? '' : 'opacity-60'}`}>
                  <td className="sticky right-0 bg-white px-3 py-1.5 z-10">
                    <div className="flex items-center gap-1">
                      <span className="font-semibold text-navy">{s.name}</span>
                      <button title="הגדרות תשלום (סכום קבוע, מלגה)" className="text-slate-400 hover:text-navy" onClick={() => setBillingFor(s)}>
                        <Settings2 size={14} />
                      </button>
                      <button title="מכתב להורים" className="text-slate-400 hover:text-navy" onClick={() => setLetters({ student: s })}>
                        <Mail size={14} />
                      </button>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {s.tracks.join(', ')}
                      {s.monthlyScholarship > 0 && <span className="text-blue-700"> · מלגה {shekel(s.monthlyScholarship)}</span>}
                      {!s.active && ' · לא מחויבת'}
                    </div>
                  </td>
                  {columns.map((c) => {
                    const p = paymentAt.get(`${s.name}|${c.key}`);
                    if (!p) {
                      return (
                        <td key={c.key} className="px-1 py-1 text-center">
                          <button
                            className="w-full rounded-lg py-2 text-slate-300 hover:bg-slate-100 hover:text-slate-500 text-xs"
                            title="אין חיוב לחודש הזה — לחיצה ליצירת חיוב"
                            onClick={() => setNewCharge({ student: s, column: c })}
                          >
                            —
                          </button>
                        </td>
                      );
                    }
                    return (
                      <td key={c.key} className="px-1 py-1 text-center">
                        <button
                          className={`w-full rounded-lg py-1.5 text-xs font-semibold ${CELL_STYLE[p.status]}`}
                          title={`${STATUS_HE[p.status]} · לתשלום ${shekel(p.owed)} · שולם ${shekel(p.amountPaid)}${p.scholarship ? ` · מלגה ${shekel(p.scholarship)}` : ''}`}
                          onClick={() => setOpenPayment(p)}
                        >
                          {p.status === 'Paid' ? '✓' : shekel(p.balance)}
                          {p.scholarship > 0 && <span className="block text-[9px] font-normal text-blue-700">מלגה</span>}
                        </button>
                      </td>
                    );
                  })}
                  <td className={`px-3 py-1.5 text-center font-bold ${debt > 0 ? 'text-red-700' : 'text-green-700'}`}>
                    {debt > 0 ? shekel(debt) : '✓'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="text-center text-slate-400 py-8">אין תלמידות להצגה</p>}
      </div>
      <p className="text-xs text-slate-500 mt-2">
        ירוק — שולם · כתום — שולם חלקית (מוצגת היתרה) · אדום — לא שולם · לחיצה על חודש לרישום תשלום
      </p>

      {openPayment && (
        <PaymentModal
          payment={openPayment}
          methods={data.methods}
          defaultMethod={lastMethod(openPayment.fullName)}
          onClose={() => setOpenPayment(null)}
          onSaved={() => {
            setOpenPayment(null);
            load();
          }}
        />
      )}
      {newCharge && (
        <NewChargeModal
          student={newCharge.student}
          column={newCharge.column}
          onClose={() => setNewCharge(null)}
          onSaved={() => {
            setNewCharge(null);
            load();
          }}
        />
      )}
      {billingFor && (
        <BillingModal
          student={billingFor === 'new' ? null : billingFor}
          allStudentNames={data.allStudentNames}
          existingNames={data.students.map((s) => s.name)}
          onClose={() => setBillingFor(null)}
          onSaved={() => {
            setBillingFor(null);
            load();
          }}
        />
      )}
      {showGenerate && (
        <GenerateMonthModal
          defaultMonth={nowColumn}
          onClose={() => setShowGenerate(false)}
          onDone={(message) => {
            setShowGenerate(false);
            setNotice(message);
            load();
          }}
        />
      )}
      {letters && (
        <LettersModal
          students={data.students}
          payments={data.payments}
          columns={columns}
          onlyStudent={letters.student}
          onClose={() => setLetters(null)}
        />
      )}
    </Layout>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' }) {
  const color = tone === 'green' ? 'text-green-700' : tone === 'red' ? 'text-red-700' : 'text-navy';
  return (
    <div className="card py-3 text-center">
      <p className="text-slate-500 text-xs mb-1">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}
