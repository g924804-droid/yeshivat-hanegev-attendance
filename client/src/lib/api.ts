const BASE = '/api';

async function request<T>(method: string, path: string, body?: any, isFormData = false): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: isFormData ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* אין גוף תגובה */
  }

  if (!res.ok) {
    throw new Error(data?.error || `שגיאה (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Record<string, any>) => {
    const qs = query
      ? '?' +
        Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&')
      : '';
    return request<T>('GET', `${path}${qs}`);
  },
  post: <T>(path: string, body?: any) => request<T>('POST', path, body),
  put: <T>(path: string, body?: any) => request<T>('PUT', path, body),
  delete: <T>(path: string, query?: Record<string, any>) => {
    const qs = query
      ? '?' +
        Object.entries(query)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&')
      : '';
    return request<T>('DELETE', `${path}${qs}`);
  },
  postForm: <T>(path: string, formData: FormData) => request<T>('POST', path, formData, true),
};
