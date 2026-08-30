import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, CheckCircle } from 'lucide-react';
import { Layout } from '../components/Layout';
import { api } from '../lib/api';

type Track = { id: string; name: string; description: string; studentCount: number; presentToday: number };

export function StudentTracks() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get<{ tracks: Track[] }>('/students/getTracks')
      .then((r) => setTracks(r.tracks))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <Layout title="מסלולי תלמידות">
      {error && <div className="mb-4 text-sm bg-red-50 text-red-700 rounded-xl px-4 py-2">{error}</div>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tracks.map((t) => (
          <button
            key={t.id}
            onClick={() => navigate(`/students/${t.id}`)}
            className="card text-right hover:shadow-md hover:-translate-y-0.5 transition-all"
          >
            <div className="flex items-center justify-between mb-2">
              <Users className="text-gold-dark" size={22} />
              <span className="font-bold text-navy">{t.name}</span>
            </div>
            {t.description && <p className="text-slate-500 text-sm mb-3">{t.description}</p>}
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">{t.studentCount} תלמידות</span>
              <span className="flex items-center gap-1 text-green-700">
                <CheckCircle size={14} /> {t.presentToday} נוכחות היום
              </span>
            </div>
          </button>
        ))}
      </div>
      {tracks.length === 0 && !error && <p className="text-slate-400 text-center py-10">אין מסלולים זמינים</p>}
    </Layout>
  );
}
