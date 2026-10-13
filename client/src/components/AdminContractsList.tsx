import { Fragment, useEffect, useMemo, useState } from 'react';
import { FileText, Pencil, Search, Trash2, Check, X } from 'lucide-react';
import { api } from '../lib/api';
import { compareByFamilyName, familyName, givenName } from '../lib/utils';
import { confirmAndDeleteContract } from '../lib/deleteContract';

export type AdminContract = {
  id: string;
  title: string;
  status: 'ממתין לחתימה' | 'נחתם' | 'בוטל';
  fileName: string | null;
  employee: { id: string; name: string; lastName?: string | null };
  uploadedAt: string;
  signedAt: string | null;
  amount: number | null;
  amountUnit: string | null;
};
type Employee = { id: string; name: string; lastName: string | null; isActive: boolean };

export const AMOUNT_UNITS = ['לשעה', 'לשיעור', 'לחודש', 'סה"כ'];

const STATUS_STYLE: Record<AdminContract['status'], string> = {
  'ממתין לחתימה': 'bg-amber-100 text-amber-800',
  נחתם: 'bg-green-100 text-green-800',
  בוטל: 'bg-slate-100 text-slate-500',
};

export function formatAmount(c: { amount: number | null; amountUnit: string | null }): string {
  if (c.amount == null) return '';
  return `${c.amount.toLocaleString('he-IL')} ₪${c.amountUnit ? ` ${c.amountUnit}` : ''}`;
}

function heDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('he-IL') : '';
}

type Filter = 'הכל' | 'ממתין לחתימה' | 'נחתם' | 'בלי חוזה';

/**
 * רשימת החוזים למנהלת: שורה לכל עובד/ת לפי א'-ב' של שם המשפחה, עם החוזה העדכני והסכום שלו
 * גלויים מבחוץ. חוזים קודמים של אותו עובד/ת מופיעים מתחת, בצבע חלש יותר.
 */
export function AdminContractsList({ contracts, onChanged }: { contracts: AdminContract[]; onChanged: () => void }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('הכל');
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ employees: Employee[] }>('/employees/getEmployees')
      .then((r) => setEmployees(r.employees))
      .catch(() => setEmployees([]));
  }, [contracts]);

  const rows = useMemo(() => {
    const byEmployee = new Map<string, AdminContract[]>();
    for (const c of contracts) byEmployee.set(c.employee.id, [...(byEmployee.get(c.employee.id) || []), c]);
    const people = new Map<string, { id: string; name: string; lastName: string | null }>();
    for (const e of employees.filter((e) => e.isActive)) people.set(e.id, e);
    for (const c of contracts) if (!people.has(c.employee.id)) people.set(c.employee.id, { ...c.employee, lastName: c.employee.lastName ?? null });
    return Array.from(people.values())
      .map((p) => ({
        ...p,
        lastName: employees.find((e) => e.id === p.id)?.lastName ?? p.lastName,
        contracts: (byEmployee.get(p.id) || []).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
      }))
      .sort(compareByFamilyName);
  }, [contracts, employees]);

  const shown = rows.filter((r) => {
    if (!r.name.includes(search.trim())) return false;
    if (filter === 'בלי חוזה') return r.contracts.length === 0;
    if (filter === 'הכל') return true;
    return r.contracts.some((c) => c.status === filter);
  });
  const count = (f: Filter) =>
    f === 'הכל'
      ? rows.length
      : f === 'בלי חוזה'
      ? rows.filter((r) => !r.contracts.length).length
      : rows.filter((r) => r.contracts.some((c) => c.status === f)).length;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pr-9" placeholder="חיפוש לפי שם..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {(['הכל', 'ממתין לחתימה', 'נחתם', 'בלי חוזה'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`badge cursor-pointer px-3 py-1.5 text-xs border ${
              filter === f ? 'bg-navy text-white border-navy' : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            {f} ({count(f)})
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 border-b bg-slate-50 text-right">
              <th className="py-2.5 pr-4">שם</th>
              <th>חוזה</th>
              <th>סכום</th>
              <th className="text-center">סטטוס</th>
              <th className="text-center">הועלה</th>
              <th className="text-center">נחתם</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const letter = familyName(r.name, r.lastName).charAt(0);
              const showLetter = i === 0 || familyName(shown[i - 1].name, shown[i - 1].lastName).charAt(0) !== letter;
              const nameCell = (
                <td className="py-2 pr-4" rowSpan={Math.max(1, r.contracts.length)}>
                  <span className="font-bold text-navy">{familyName(r.name, r.lastName)}</span>{' '}
                  <span className="text-slate-600">{givenName(r.name, r.lastName)}</span>
                </td>
              );
              return (
                <Fragment key={r.id}>
                  {showLetter && (
                    <tr>
                      <td colSpan={7} className="pt-3 pb-1 pr-3">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gold/20 text-navy font-bold">
                          {letter}
                        </span>
                      </td>
                    </tr>
                  )}
                  {r.contracts.length === 0 ? (
                    <tr className="border-b">
                      {nameCell}
                      <td colSpan={6} className="text-slate-400">אין חוזה</td>
                    </tr>
                  ) : (
                    r.contracts.map((c, idx) => (
                      <ContractRow
                        key={c.id}
                        contract={c}
                        older={idx > 0}
                        nameCell={idx === 0 ? nameCell : null}
                        last={idx === r.contracts.length - 1}
                        editing={editingId === c.id}
                        onEdit={() => setEditingId(c.id)}
                        onDoneEdit={(changed) => {
                          setEditingId(null);
                          if (changed) onChanged();
                        }}
                        onDeleted={onChanged}
                      />
                    ))
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="text-center text-slate-400 py-6">אין מה להציג</p>}
      </div>
    </div>
  );
}

function ContractRow({
  contract: c,
  older,
  nameCell,
  last,
  editing,
  onEdit,
  onDoneEdit,
  onDeleted,
}: {
  contract: AdminContract;
  older: boolean;
  nameCell: JSX.Element | null;
  last: boolean;
  editing: boolean;
  onEdit: () => void;
  onDoneEdit: (changed: boolean) => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(c.title);
  const [amount, setAmount] = useState(c.amount != null ? String(c.amount) : '');
  const [unit, setUnit] = useState(c.amountUnit || 'לשעה');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.put(`/contracts/${c.id}`, { title, amount, amountUnit: amount.trim() ? unit : null });
      onDoneEdit(true);
    } catch (err: any) {
      alert(err.message || 'שגיאה בשמירה');
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className={`${last ? 'border-b' : ''} hover:bg-slate-50 ${older ? 'text-slate-400' : ''}`}>
      {nameCell}
      {editing ? (
        <>
          <td className="py-1.5">
            <input className="input py-1 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} />
          </td>
          <td className="py-1.5">
            <div className="flex gap-1">
              <input
                className="input py-1 text-sm w-24"
                placeholder="סכום"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <select className="input py-1 text-sm w-auto" value={unit} onChange={(e) => setUnit(e.target.value)}>
                {AMOUNT_UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>
          </td>
        </>
      ) : (
        <>
          <td className="py-2">
            {c.fileName ? (
              <a href={`/api/contracts/${c.id}/file`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                <FileText size={14} className={older ? '' : 'text-gold-dark'} /> {c.title}
              </a>
            ) : (
              c.title
            )}
            {older && <span className="text-[11px] mr-1">(קודם)</span>}
          </td>
          <td className={`font-bold ${older ? '' : 'text-navy'}`}>{formatAmount(c) || <span className="font-normal text-slate-300">—</span>}</td>
        </>
      )}
      <td className="text-center">
        <span className={`badge ${older ? 'bg-slate-100 text-slate-400' : STATUS_STYLE[c.status]}`}>{c.status}</span>
      </td>
      <td className="text-center text-xs">{heDate(c.uploadedAt)}</td>
      <td className="text-center text-xs">{heDate(c.signedAt)}</td>
      <td className="pl-2">
        <div className="flex gap-1 justify-end">
          {editing ? (
            <>
              <button className="p-1.5 rounded-lg hover:bg-green-100 text-green-700" title="שמירה" onClick={save} disabled={busy}>
                <Check size={15} />
              </button>
              <button className="p-1.5 rounded-lg hover:bg-slate-200" title="ביטול" onClick={() => onDoneEdit(false)}>
                <X size={15} />
              </button>
            </>
          ) : (
            <>
              <button className="p-1.5 rounded-lg hover:bg-slate-200 text-navy" title="עריכת כותרת וסכום" onClick={onEdit}>
                <Pencil size={14} />
              </button>
              <button
                className="p-1.5 rounded-lg hover:bg-red-50 text-red-600"
                title="מחיקת החוזה"
                onClick={async () => {
                  if (await confirmAndDeleteContract(c)) onDeleted();
                }}
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
