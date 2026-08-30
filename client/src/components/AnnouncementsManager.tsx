import { useEffect, useState } from 'react';
import { Megaphone, Monitor, Plus, ArrowUp, ArrowDown, Trash2, Image as ImageIcon, Save } from 'lucide-react';
import { api } from '../lib/api';

type AnnouncementRow = {
  id: string;
  text: string | null;
  fileName: string | null;
  fileMime: string | null;
  isActive: boolean;
  order: number;
};

/** ניהול מסך התצוגה הגדול (מערכת שעות + הודעות/קבצים) — נגיש לכל מי שיש לו הרשאת "system", לא רק למנהל. */
export function AnnouncementsManager() {
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await api.get<{ announcements: AnnouncementRow[] }>('/announcements');
    setAnnouncements(data.announcements);
  }
  useEffect(() => {
    load();
  }, []);

  async function add() {
    if (!text.trim() && !file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      if (text.trim()) fd.append('text', text.trim());
      if (file) fd.append('file', file);
      await api.postForm('/announcements', fd);
      setText('');
      setFile(null);
      setFileInputKey((k) => k + 1);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(a: AnnouncementRow) {
    await api.put(`/announcements/${a.id}`, { isActive: !a.isActive });
    await load();
  }

  async function move(a: AnnouncementRow, direction: 'up' | 'down') {
    await api.post(`/announcements/${a.id}/move`, { direction });
    await load();
  }

  async function remove(id: string) {
    if (!confirm('למחוק הודעה?')) return;
    await api.delete(`/announcements/${id}`);
    await load();
  }

  return (
    <div className="space-y-6">
      <SiteSettingsCard />

      <div className="card">
        <h3 className="font-bold text-navy mb-3 flex items-center gap-2">
          <Monitor size={18} className="text-gold-dark" /> מסך התצוגה
        </h3>
        <p className="text-sm text-slate-500 mb-3">
          פתחו את הכתובת הבאה במסך הגדול — היא מציגה מערכת שעות והודעות, ומתעדכנת לבד, בלי צורך בהתחברות:
        </p>
        <a href="/display" target="_blank" rel="noreferrer" className="text-navy underline font-mono text-sm break-all">
          {window.location.origin}/display
        </a>
      </div>

      <div className="card">
        <h3 className="font-bold text-navy mb-3 flex items-center gap-2">
          <Megaphone size={18} className="text-gold-dark" /> הודעות
        </h3>
        <p className="text-xs text-slate-400 mb-2">אפשר טקסט, קובץ (תמונה/PDF/כל קובץ אחר), או שניהם יחד</p>
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <input
            className="input"
            placeholder="טקסט ההודעה שתופיע במסך (אופציונלי אם מצרפים קובץ)..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <input
            key={fileInputKey}
            type="file"
            className="input sm:w-56"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <button className="btn-primary shrink-0" onClick={add} disabled={busy || (!text.trim() && !file)}>
            <Plus size={16} /> הוספה
          </button>
        </div>

        <div className="space-y-2">
          {announcements.map((a, i) => (
            <div key={a.id} className="flex items-center gap-2 border rounded-xl px-3 py-2">
              <div className="flex flex-col">
                <button
                  disabled={i === 0}
                  onClick={() => move(a, 'up')}
                  className="p-0.5 text-slate-400 hover:text-navy disabled:opacity-30"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  disabled={i === announcements.length - 1}
                  onClick={() => move(a, 'down')}
                  className="p-0.5 text-slate-400 hover:text-navy disabled:opacity-30"
                >
                  <ArrowDown size={14} />
                </button>
              </div>
              <div className={`flex-1 text-sm ${a.isActive ? '' : 'text-slate-400 line-through'}`}>
                {a.text}
                {a.fileName && (
                  <>
                    {a.text ? ' · ' : ''}
                    <a href={`/announcements/${a.id}/file`} target="_blank" rel="noreferrer" className="text-navy underline">
                      📎 {a.fileName}
                    </a>
                  </>
                )}
              </div>
              <button
                onClick={() => toggleActive(a)}
                className={`badge ${a.isActive ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-500'}`}
              >
                {a.isActive ? 'פעיל' : 'מוסתר'}
              </button>
              <button onClick={() => remove(a.id)} className="p-1.5 rounded-lg hover:bg-red-100 text-red-600">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {announcements.length === 0 && <p className="text-slate-400 text-sm text-center py-4">אין הודעות עדיין</p>}
        </div>
      </div>
    </div>
  );
}

function SiteSettingsCard() {
  const [siteName, setSiteName] = useState('');
  const [hasLogo, setHasLogo] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoInputKey, setLogoInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    const data = await api.get<{ siteName: string | null; hasLogo: boolean }>('/settings');
    setSiteName(data.siteName || '');
    setHasLogo(data.hasLogo);
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('siteName', siteName);
      if (logoFile) fd.append('logo', logoFile);
      await api.postForm('/settings', fd);
      setLogoFile(null);
      setLogoInputKey((k) => k + 1);
      await load();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 className="font-bold text-navy mb-3 flex items-center gap-2">
        <ImageIcon size={18} className="text-gold-dark" /> שם המוסד והלוגו (מוצג במסך התצוגה)
      </h3>
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
        <div className="flex-1 w-full">
          <label className="label">שם המוסד</label>
          <input className="input" placeholder="לדוגמה: סמינר הרב מאיר" value={siteName} onChange={(e) => setSiteName(e.target.value)} />
        </div>
        <div className="w-full sm:w-auto">
          <label className="label">לוגו {hasLogo && <span className="text-green-600">(קיים לוגו)</span>}</label>
          <input key={logoInputKey} type="file" accept="image/*" className="input" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} />
        </div>
        <button className="btn-primary shrink-0" onClick={save} disabled={busy}>
          <Save size={16} /> שמירה
        </button>
      </div>
      {hasLogo && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-slate-400">תצוגה מקדימה:</span>
          <img src={`/api/display/logo?t=${logoInputKey}`} className="h-12 w-12 object-contain rounded-lg border" alt="לוגו" />
        </div>
      )}
      {saved && <p className="text-green-600 text-sm mt-2">נשמר בהצלחה</p>}
    </div>
  );
}
