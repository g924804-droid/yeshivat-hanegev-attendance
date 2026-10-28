import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Square } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/permissions';

type TimerStatus = { date: string; running: { since: string; shift: number } | null };

/** אחרי הפעלה/עצירה של הטיימר במסך הנוכחות — כדי שהפס יתעדכן מיד בלי לחכות לרענון */
export const TIMER_CHANGED_EVENT = 'attendance-timer-changed';
export const notifyTimerChanged = () => window.dispatchEvent(new Event(TIMER_CHANGED_EVENT));

function elapsed(since: string, now: Date): string {
  const [h, m] = since.split(':').map(Number);
  const mins = Math.max(0, now.getHours() * 60 + now.getMinutes() - (h * 60 + m));
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}

/**
 * פס קטן בראש כל המסכים כשהטיימר של הנוכחות דולק (נכנסה ועוד לא יצאה) — כדי שבכל מקום
 * במערכת יראו שהוא פועל ולא ישכחו לעצור אותו בסוף השיעור.
 */
export function TimerStrip() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<TimerStatus | null>(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = () =>
      api
        .get<TimerStatus>('/attendance/timerStatus')
        .then((s) => alive && setStatus(s))
        .catch(() => {});
    load();
    const poll = setInterval(load, 5 * 60 * 1000);
    window.addEventListener(TIMER_CHANGED_EVENT, load);
    return () => {
      alive = false;
      clearInterval(poll);
      window.removeEventListener(TIMER_CHANGED_EVENT, load);
    };
  }, [user?.id]);

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(tick);
  }, []);

  const running = status?.running;
  if (!running) return null;

  return (
    <div className="bg-green-600 text-white text-sm">
      <div className="max-w-[1800px] mx-auto px-4 py-1.5 flex items-center justify-center gap-3 flex-wrap">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
        </span>
        <span>
          הטיימר פועל{running.shift === 2 ? ' (משמרת 2)' : ''} מ-<b>{running.since}</b> · עברו <b className="tabular-nums">{elapsed(running.since, now)}</b> שעות
        </span>
        {location.pathname !== '/attendance' && (
          <button
            onClick={() => navigate('/attendance')}
            className="inline-flex items-center gap-1 rounded-lg bg-white/20 hover:bg-white/30 px-2.5 py-0.5 font-medium"
          >
            <Square size={12} fill="currentColor" /> לעצירת הטיימר
          </button>
        )}
      </div>
    </div>
  );
}
