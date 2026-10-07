import { useState } from 'react';
import { Save, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { DOW_HE } from '../lib/utils';
import { SickNoteUpload, TYPE_OPTIONS } from '../pages/Dashboard';

export type DayRecord = {
  id: string;
  type: string;
  clockIn: string | null;
  clockOut: string | null;
  clockIn2: string | null;
  clockOut2: string | null;
  lessonsCount: number;
  notes: string | null;
  sickNoteUrl: string | null;
  hasSpecialRate: boolean;
};

const EMPTY: DayRecord = {
  id: '',
  type: 'רגיל',
  clockIn: null,
  clockOut: null,
  clockIn2: null,
  clockOut2: null,
  lessonsCount: 0,
  notes: null,
  sickNoteUrl: null,
  hasSpecialRate: false,
};

const TIME_FIELDS = [
  ['clockIn', 'כניסה 1'],
  ['clockOut', 'יציאה 1'],
  ['clockIn2', 'כניסה 2'],
  ['clockOut2', 'יציאה 2'],
] as const;

/** עריכת יום אחד בדוח של עובדת — להנהלה ולמזכירת הנוכחות, מתוך דף הדוח החודשי. */
export function DayEditModal({
  date,
  record,
  employeeId,
  onClose,
  onSaved,
}: {
  date: string;
  record: DayRecord | null;
  employeeId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<DayRecord>(record || EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isWorkDay = form.type === 'רגיל' || form.type === 'חצי יום';

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.put('/attendance/updateAttendance', {
        recordId: record?.id || undefined,
        date,
        userId: employeeId,
        type: form.type,
        // ביום שאינו יום עבודה (מחלה/חופשה/חג) מנקים שעות, שלא ייספרו בטעות
        clockIn: isWorkDay ? form.clockIn || '' : '',
        clockOut: isWorkDay ? form.clockOut || '' : '',
        clockIn2: isWorkDay ? form.clockIn2 || '' : '',
        clockOut2: isWorkDay ? form.clockOut2 || '' : '',
        lessonsCount: form.lessonsCount || 0,
        notes: form.notes || '',
        sickNoteUrl: form.sickNoteUrl || '',
        hasSpecialRate: isWorkDay && form.hasSpecialRate,
      });
      onSaved();
    } catch (err: any) {
      setError(err.message || 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!record?.id) return;
    setSaving(true);
    setError(null);
    try {
      await api.delete('/attendance/deleteAttendance', { recordId: record.id });
      onSaved();
    } catch (err: any) {
      setError(err.message || 'שגיאה במחיקה');
      setSaving(false);
    }
  }

  const [y, m, d] = date.split('-');
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-navy text-lg">
            עריכת יום {DOW_HE[new Date(`${date}T00:00:00`).getDay()]} {Number(d)}/{Number(m)}/{y}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <label className="block text-sm">
          סוג יום
          <select className="input mt-1" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {TYPE_OPTIONS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>

        {isWorkDay && (
          <div className="grid grid-cols-2 gap-2">
            {TIME_FIELDS.map(([key, label]) => (
              <label key={key} className="text-sm">
                {label}
                <input
                  type="time"
                  className="input mt-1"
                  value={form[key] || ''}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ))}
          </div>
        )}

        <label className="block text-sm">
          מספר שיעורים
          <input
            type="number"
            min={0}
            className="input mt-1 w-28"
            value={form.lessonsCount}
            onChange={(e) => setForm({ ...form, lessonsCount: Number(e.target.value) })}
          />
        </label>

        {form.type === 'מחלה' && (
          <div className="border rounded-lg px-3 py-2">
            <p className="text-sm font-semibold mb-1">אישור מחלה</p>
            <SickNoteUpload
              value={form.sickNoteUrl || ''}
              onChange={(url) => setForm({ ...form, sickNoteUrl: url })}
              employeeId={employeeId}
            />
          </div>
        )}

        {isWorkDay && (
          <label className="flex items-center gap-2 text-sm cursor-pointer bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
            <input
              type="checkbox"
              checked={form.hasSpecialRate}
              onChange={(e) => setForm({ ...form, hasSpecialRate: e.target.checked })}
            />
            שכר שונה מהרגיל ביום הזה
          </label>
        )}

        <label className="block text-sm">
          הערות {form.hasSpecialRate && isWorkDay && <span className="text-amber-700">(פירוט השכר השונה)</span>}
          <textarea
            className="input mt-1"
            rows={2}
            value={form.notes || ''}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </label>

        {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          <button className="btn-primary" onClick={save} disabled={saving}>
            <Save size={16} /> {saving ? 'שומר...' : 'שמירה'}
          </button>
          <button className="btn-outline" onClick={onClose} disabled={saving}>
            ביטול
          </button>
          {record?.id && (
            <button className="mr-auto text-red-600 text-sm inline-flex items-center gap-1 hover:underline" onClick={remove} disabled={saving}>
              <Trash2 size={14} /> מחיקת היום
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
