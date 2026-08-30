import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, CalendarClock } from 'lucide-react';
import { Layout } from '../components/Layout';
import { api } from '../lib/api';
import { todayStr } from '../lib/utils';

type Student = {
  id: string;
  name: string;
  className: string;
  phone: string;
  attendanceId: string | null;
  status: string | null;
  avgGrade: number | null;
};
type Lesson = { id: string; className: string; time: string; room: string };

const STATUS_OPTIONS = ['נוכחת', 'חסרה', 'איחור'];
const STATUS_COLOR: Record<string, string> = {
  נוכחת: 'bg-green-100 text-green-800',
  חסרה: 'bg-red-100 text-red-700',
  איחור: 'bg-amber-100 text-amber-800',
};

export function StudentsList() {
  const { trackId } = useParams();
  const navigate = useNavigate();
  const [students, setStudents] = useState<Student[]>([]);
  const [schedule, setSchedule] = useState<Lesson[]>([]);
  const [trackName, setTrackName] = useState('');
  const [date] = useState(todayStr());
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api.get<{ track: { name: string }; students: Student[]; schedule: Lesson[] }>(
        '/students/getStudentsByTrack',
        { trackId, date }
      );
      setTrackName(data.track.name);
      setStudents(data.students);
      setSchedule(data.schedule);
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  async function mark(student: Student, status: string) {
    try {
      await api.post('/students/markStudentAttendance', {
        studentId: student.id,
        status,
        date,
        existingAttendanceId: student.attendanceId || undefined,
      });
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <Layout title={trackName || 'תלמידות'}>
      <button onClick={() => navigate('/students')} className="btn-outline text-sm py-2 mb-4">
        <ArrowRight size={16} /> חזרה למסלולים
      </button>

      {error && <div className="mb-4 text-sm bg-red-50 text-red-700 rounded-xl px-4 py-2">{error}</div>}

      {schedule.length > 0 && (
        <div className="card mb-4">
          <h3 className="font-bold text-navy mb-2 flex items-center gap-2">
            <CalendarClock size={18} /> מערכת שעות היום
          </h3>
          <div className="flex flex-wrap gap-2">
            {schedule.map((l) => (
              <span key={l.id} className="badge bg-navy-50 text-navy">
                {l.className} · {l.time} {l.room ? `· חדר ${l.room}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm text-center">
          <thead>
            <tr className="text-slate-500 border-b">
              <th className="py-2">שם</th>
              <th>כיתה</th>
              <th>ממוצע ציונים</th>
              <th>נוכחות היום</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id} className="border-b last:border-0 hover:bg-slate-50">
                <td className="py-2">{s.name}</td>
                <td>{s.className || '—'}</td>
                <td>{s.avgGrade ?? '—'}</td>
                <td>
                  <div className="flex gap-1.5 justify-center">
                    {STATUS_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => mark(s, opt)}
                        className={`badge cursor-pointer transition-transform hover:scale-105 ${
                          s.status === opt ? STATUS_COLOR[opt] : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {students.length === 0 && <p className="text-center text-slate-400 py-6">אין תלמידות במסלול</p>}
      </div>
    </Layout>
  );
}
