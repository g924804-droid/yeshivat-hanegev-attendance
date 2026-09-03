import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * מכווצת את התוכן שבתוכה (transform: scale) בדיוק כמה שצריך כדי שהכל ייכנס בגובה המיכל
 * החיצוני בלי גלילה — במקום לנחש גודל טקסט לפי כמות תוכן, מודדים בפועל את הגובה שהתוכן
 * תופס בגודל מלא ומכווצים לפי היחס. נולד למסך התצוגה בבניין (שלא ניתן לגלילה), ומשמש גם
 * למסכי ניהול שרוצים "להיראות בדיוק כמו שהבנות רואות" בלי לגלול.
 */
export function FitScale({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const measure = () => {
      const outerH = outer.clientHeight;
      const innerH = inner.scrollHeight;
      if (outerH > 0 && innerH > 0) {
        const next = Math.min(1, outerH / innerH);
        setScale((prev) => (Math.abs(prev - next) > 0.01 ? next : prev));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(inner);
    ro.observe(outer);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={outerRef} className={className} style={{ ...style, overflow: 'hidden' }}>
      <div
        ref={innerRef}
        style={{ transform: `scale(${scale})`, transformOrigin: 'top right', width: scale < 1 ? `${100 / scale}%` : '100%' }}
      >
        {children}
      </div>
    </div>
  );
}
