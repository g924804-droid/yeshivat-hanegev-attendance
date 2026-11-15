import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowUp } from 'lucide-react';

/** כפתור "חזרה למעלה" — מופיע בפינה הימנית התחתונה אחרי גלילה למטה */
export function ScrollToTop() {
  const [visible, setVisible] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // לא במסך התצוגה (טלוויזיה)
  if (!visible || location.pathname === '/display') return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      title="חזרה למעלה"
      aria-label="חזרה למעלה"
      className="fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full bg-navy text-white shadow-lg flex items-center justify-center hover:opacity-90 print:hidden"
    >
      <ArrowUp size={22} />
    </button>
  );
}
