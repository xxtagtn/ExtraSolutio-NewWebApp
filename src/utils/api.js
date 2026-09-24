import { invalidateApiCache } from './apiCache.js';
import { clearStoredAuth, getStoredAuth, setStoredAuth, sessionExpired, SessionExpiredError, tokenTimes } from './authSession.js';
export { clearStoredAuth, getStoredAuth, setStoredAuth, isSessionExpiredError } from './authSession.js';

function resolveApiUrl() {
  const configured = import.meta.env?.VITE_API_URL || 'http://localhost:3001/api';
  if (typeof window === 'undefined') return configured;
  const host = window.location.hostname;
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';
  if (!isLocalHost && /^https?:\/\/(localhost|127\.0\.0\.1):3001\/api$/i.test(configured)) {
    return `${window.location.protocol}//${host}:3001/api`;
  }
  return configured;
}

export const API_URL = resolveApiUrl();
let refreshRequest = null;

function expire(auth) {
  if (auth) clearStoredAuth(auth.token, auth.sessionId);
  return new SessionExpiredError();
}

export async function refreshStoredAuth() {
  const auth = getStoredAuth();
  if (!auth || sessionExpired(auth)) throw expire(auth);
  if (refreshRequest?.token === auth.token && refreshRequest.sessionId === auth.sessionId) return refreshRequest.promise;
  const request = { token: auth.token, sessionId: auth.sessionId };
  request.promise = (async () => {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
    });
    if (response.status === 401) throw expire(auth);
    if (!response.ok) throw new Error('Não foi possível renovar a sessão.');
    const refreshed = await response.json();
    const current = getStoredAuth();
    // A late response cannot resurrect logout or overwrite a subsequent login/refresh.
    if (!current || current.sessionId !== auth.sessionId) throw new SessionExpiredError();
    if (sessionExpired(current)) throw expire(current);
    if (current.token !== auth.token) return current;
    if (!refreshed.token) throw new Error('Resposta de renovação inválida.');
    return setStoredAuth({ ...current, ...refreshed });
  })().finally(() => { if (refreshRequest === request) refreshRequest = null; });
  refreshRequest = request;
  return request.promise;
}

export async function api(path, options = {}) {
  const isLogin = path === '/auth/login';
  let auth = isLogin ? null : getStoredAuth();
  if (auth && sessionExpired(auth)) throw expire(auth);
  if (auth && Date.now() >= tokenTimes(auth.token).refreshAt && path !== '/auth/refresh') {
    auth = await refreshStoredAuth();
  }
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(auth?.token ? { Authorization: `Bearer ${auth.token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    // The password form also uses 401 for an incorrect current password, not a lost session.
    const passwordRejected = path === '/auth/password' && error.message === 'Password atual invalida.';
    if (response.status === 401 && !isLogin && !passwordRejected) throw expire(auth);
    throw new Error(error.message || 'Pedido falhou.');
  }
  if (auth && getStoredAuth()?.sessionId !== auth.sessionId) throw new SessionExpiredError();
  const method = String(options.method || 'GET').toUpperCase();
  if (method !== 'GET') invalidateApiCache();
  if (response.status === 204) return null;
  return response.json();
}
