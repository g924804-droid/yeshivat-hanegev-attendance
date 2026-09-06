import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Search, Save, GraduationCap } from 'lucide-react';
import { Layout } from '../components/Layout';
import { api } from '../lib/api';
import { todayStr } from '../lib/utils';

type Subject = { lessonId: string; subject: string };
type StudentGrade = {
  id: string;
  name: string;
  gradeId: string | null;
  score: number | null;
  testName: string | null;
  date: string | null;
};

export function GradesPage() {
  const { trackId } = useParams();
  const navigate = useNavigate();
  const [trackName, setTrackName] = useState('');
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentGrade[]>([]);
  const [testName, setTestName] = useState('');
  const [date, setDate] = useState(todayStr());
  const [search, setSearch] = useState('');
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ tracks: { id: string; name: string }[] }>('/grades/getTracks')
      .then((r) => setTrackName(r.tracks.find((t) => t.id === trackId)?.name || ''))
      .catch(() => {});
  }, [trackId]);

  useEffect(() => {
    api
      .get<{ subjects: Subject[] }>('/grades/getTrackSubjects', { trackId })
      .then((r) => {
        setSubjects(r.subjects);
        if (r.subjects.length && !activeLessonId) setActiveLessonId(r.subjects[0].lessonId);
      })
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  async function loadStudents() {
    try {
      const data = await api.get<{ students: StudentGrade[] }>('/grades/getStudentsForGrading', {
        trackId,
        lessonId: activeLessonId || undefined,
      });
      setStudents(data.students);
      // ברירת מחדל: אם לתלמידה כבר יש ציון וטופס עוד לא נגעו בו, מציגים אותו; אם יש לה
      // מבחן/תאריך קיימים ואין עדיין ערך בטופס העליון, ממלאים מהם (נוח כשעורכים ציון קיים).
      const withExisting = data.students.find((s) => s.testName || s.date);
      if (withExisting) {
        setTestName((prev) => prev || withExisting.testName || '');
        setDate((prev) => (prev === todayStr() && withExisting.date ? withExisting.date : prev));
      }
      setScoreDrafts(
        Object.fromEntries(data.students.map((s) => [s.id, s.score !== null ? String(s.score) : '']))
      );
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => {
    if (activeLessonId) loadStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, activeLessonId]);

  async function saveScore(student: StudentGrade) {
    const raw = scoreDrafts[student.id];
    const score = Number(raw);
    if (raw === '' || raw === undefined || Number.isNaN(score)) return;
    setError(null);
    setSavingId(student.id);
    try {
      await api.post('/grades/saveGrade', {
        gradeId: student.gradeId || undefined,
        studentId: student.id,
        lessonId: activeLessonId || undefined,
        testName,
        date,
        score,
      });
      await loadStudents();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  }

  const filteredStudents = useMemo(
    () => students.filter((s) => s.name.includes(search.trim())),
    [students, search]
  );

  return (
    <Layout title={trackName ? `ציונים — ${trackName}` : 'ציונים'}>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate('/grades')} className="btn-outline text-sm py-2">
          <ArrowRight size={16} /> חזרה למסלולים
        </button>
      </div>

      {error && <div className="mb-4 text-sm bg-red-50 text-red-700 rounded-xl px-4 py-2">{error}</div>}

      <div className="card mb-4">
        <h3 className="font-bold text-navy mb-2 flex items-center gap-2">
          <GraduationCap size={18} /> מקצוע
        </h3>
        {subjects.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {subjects.map((s) => (
              <button
                key={s.lessonId}
                onClick={() => setActiveLessonId(s.lessonId)}
                className={`badge cursor-pointer transition-colors ${
                  s.lessonId === activeLessonId ? 'bg-navy text-white' : 'bg-navy-50 text-navy hover:bg-navy-100'
                }`}
              >
                {s.subject}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-slate-400 text-sm">אין מקצועות מוגדרים למסלול הזה במערכת השעות</p>
        )}
      </div>

      <div className="card mb-4 grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">שם המבחן/מטלה</label>
          <input
            className="input"
            placeholder="לדוגמה: מבחן אמצע"
            value={testName}
            onChange={(e) => setTestName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">תאריך</label>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div className="relative mb-4 max-w-xs">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input className="input pr-9" placeholder="חיפוש לפי שם" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm text-center">
          <thead>
            <tr className="text-slate-500 border-b">
              <th className="py-2">תלמידה</th>
              <th>ציון</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredStudents.map((s) => (
              <tr key={s.id} className="border-b last:border-0 hover:bg-slate-50">
                <td className="py-2">{s.name}</td>
                <td>
                  <input
                    type="number"
                    className="input w-20 py-1 mx-auto text-center"
                    value={scoreDrafts[s.id] ?? ''}
                    onChange={(e) => setScoreDrafts((prev) => ({ ...prev, [s.id]: e.target.value }))}
                  />
                </td>
                <td>
                  <button
                    onClick={() => saveScore(s)}
                    disabled={savingId === s.id}
                    className={`p-1.5 rounded-lg hover:bg-green-100 text-green-700 ${
                      savingId === s.id ? 'opacity-40' : ''
                    }`}
                  >
                    <Save size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredStudents.length === 0 && <p className="text-center text-slate-400 py-6">אין תלמידות להצגה</p>}
      </div>
    </Layout>
  );
}
