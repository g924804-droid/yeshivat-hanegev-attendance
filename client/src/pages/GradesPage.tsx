import { useEffect, useMemo, useState } from 'react';
import { Search, Save } from 'lucide-react';
import { Layout } from '../components/Layout';
import { api } from '../lib/api';

type Grade = {
  id: string;
  studentName: string;
  testName: string;
  score: number;
  date: string;
  notes: string;
};

export function GradesPage() {
  const [grades, setGrades] = useState<Grade[]>([]);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editScore, setEditScore] = useState<number>(0);

  async function load() {
    const data = await api.get<{ grades: Grade[] }>('/grades/getGrades');
    setGrades(data.grades);
  }
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(
    () => grades.filter((g) => g.studentName?.toLowerCase().includes(search.toLowerCase())),
    [grades, search]
  );

  async function save(id: string) {
    await api.put('/grades/updateGrade', { id, score: editScore });
    setEditingId(null);
    await load();
  }

  return (
    <Layout title="ציונים">
      <div className="relative mb-4 max-w-xs">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input className="input pr-9" placeholder="חיפוש לפי שם תלמידה" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm text-center">
          <thead>
            <tr className="text-slate-500 border-b">
              <th className="py-2">תלמידה</th>
              <th>מבחן/מטלה</th>
              <th>ציון</th>
              <th>תאריך</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((g) => (
              <tr key={g.id} className="border-b last:border-0 hover:bg-slate-50">
                <td className="py-2">{g.studentName}</td>
                <td>{g.testName}</td>
                <td>
                  {editingId === g.id ? (
                    <input
                      type="number"
                      className="input w-20 py-1 mx-auto"
                      value={editScore}
                      onChange={(e) => setEditScore(Number(e.target.value))}
                    />
                  ) : (
                    <span className="font-semibold text-navy">{g.score}</span>
                  )}
                </td>
                <td>{g.date}</td>
                <td>
                  {editingId === g.id ? (
                    <button onClick={() => save(g.id)} className="p-1.5 rounded-lg hover:bg-green-100 text-green-700">
                      <Save size={14} />
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setEditingId(g.id);
                        setEditScore(g.score);
                      }}
                      className="text-xs text-navy underline"
                    >
                      עריכה
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="text-center text-slate-400 py-6">אין ציונים להצגה</p>}
      </div>
    </Layout>
  );
}
