import axios from 'axios';

const KEY = 'foreman.token';

export const tokenStore = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (t) => { try { localStorage.setItem(KEY, t); } catch { /* storage unavailable */ } },
  clear: () => { try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ } },
};

export const http = axios.create({ baseURL: '/api', timeout: 20_000 });

http.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// The store registers a callback here so this file never imports it (avoids a circular import).
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

/** Every failure becomes { status, code, message, details } so UI code never touches axios errors. */
export function normalizeError(err) {
  if (err.response) {
    const e = err.response.data?.error;
    return { status: err.response.status, code: e?.code, message: e?.message || 'Request failed', details: e?.details };
  }
  return { status: 0, code: 'NETWORK', message: 'Cannot reach the server. Check your connection.' };
}

http.interceptors.response.use(
  (res) => res,
  (err) => {
    const norm = normalizeError(err);
    if (norm.status === 401 && !err.config?.url?.includes('/auth/login')) onUnauthorized();
    return Promise.reject(norm);
  },
);
