import { useSearchParams } from 'react-router-dom';

/**
 * ערך שנשמר בכתובת הדף (?key=value) במקום ב-state רגיל — כך שכשנכנסים מהדף לדף אחר (למשל לדוח
 * של מורה) וחוזרים אחורה, חוזרים בדיוק לחודש/לשונית/עובדת שהיו, ולא לברירת המחדל.
 * replace — כדי שכל שינוי חודש לא יוסיף עוד צעד להיסטוריה של כפתור "אחורה".
 */
export function useUrlState(key: string, defaultValue: string): [string, (value: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const value = searchParams.get(key) || defaultValue;

  function setValue(next: string) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next && next !== defaultValue) params.set(key, next);
        else params.delete(key);
        return params;
      },
      { replace: true }
    );
  }

  return [value, setValue];
}
