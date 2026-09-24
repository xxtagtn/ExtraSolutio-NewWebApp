import { invalidateApiCache } from './apiCache.js';

export const AUTH_KEY = 'extrasolutio.auth';
export const ACTIVITY_KEY = `${AUTH_KEY}.activity`;
export const IDLE_TIMEOUT_MS = 60 * 60 * 1000;
const listeners = new Set();

function sessionId() {
  return globalThis.crypto.randomUUID?.()
    || Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, '0')).join('');
}

export class SessionExpiredError extends Error {
  constructor() {
    super('Sessão terminada.');
    this.name = 'SessionExpiredError';
  }
}

export const isSessionExpiredError = (error) => error?.name === 'SessionExpiredError';

export function tokenTimes(token) {
  try {
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(globalThis.atob(encoded));
    const expiresAt = Number(payload.exp) * 1000;
    if (!Number.isFinite(expiresAt)) return { expiresAt: Infinity, refreshAt: Infinity };
    const lifetime = expiresAt - Number(payload.iat) * 1000;
    const margin = Math.min(10 * 60 * 1000, lifetime > 0 ? lifetime / 4 : 10 * 60 * 1000);
    return { expiresAt, refreshAt: expiresAt - margin };
  } catch {
    return { expiresAt: Infinity, refreshAt: Infinity };
  }
}

export function getStoredAuth() {
  try {
    const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    if (!auth?.token) return null;
    // Existing installations have no activity timestamp yet. Initialize it only once.
    if (!auth.sessionId || !Number.isFinite(auth.lastActivityAt)) {
      auth.sessionId = sessionId();
      auth.lastActivityAt = Date.now();
      localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    }
    return auth;
  } catch {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(ACTIVITY_KEY);
    return null;
  }
}

export function subscribeAuth(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setStoredAuth(auth) {
  const next = { ...auth, sessionId: auth.sessionId || sessionId(), lastActivityAt: auth.lastActivityAt ?? Date.now() };
  localStorage.setItem(AUTH_KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
  return next;
}

export function clearStoredAuth(expectedToken, expectedSessionId) {
  const current = getStoredAuth();
  if (expectedToken && current?.token !== expectedToken) return false;
  if (expectedSessionId && current?.sessionId !== expectedSessionId) return false;
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(ACTIVITY_KEY);
  invalidateApiCache();
  if (current) for (const listener of listeners) listener();
  return true;
}

export function lastActivityAt(auth) {
  try {
    const activity = JSON.parse(localStorage.getItem(ACTIVITY_KEY) || 'null');
    if (activity?.sessionId === auth.sessionId && Number.isFinite(activity.at)) return Math.max(auth.lastActivityAt, activity.at);
  } catch { /* A malformed activity record must not extend the session. */ }
  return auth.lastActivityAt;
}

export function sessionExpired(auth, now = Date.now()) {
  return !auth?.token || now >= lastActivityAt(auth) + IDLE_TIMEOUT_MS || now >= tokenTimes(auth.token).expiresAt;
}

export function validStoredAuth() {
  const auth = getStoredAuth();
  if (auth && sessionExpired(auth)) {
    clearStoredAuth(auth.token);
    return null;
  }
  return auth;
}

export function startSessionMonitor(refresh) {
  let timer;
  let refreshing = false;
  let retryAt = 0;
  let stopped = false;

  function check() {
    window.clearTimeout(timer);
    if (stopped) return;
    const auth = validStoredAuth();
    if (!auth) return;
    const now = Date.now();
    const { expiresAt, refreshAt } = tokenTimes(auth.token);
    if (!refreshing && now >= Math.max(refreshAt, retryAt)) {
      refreshing = true;
      // Reuse the API refresh endpoint. Network failures are not authentication failures.
      refresh().catch(() => {}).finally(() => {
        refreshing = false;
        retryAt = Date.now() + 30000;
        check();
      });
    }
    const nextRefresh = refreshing ? now + 30000 : Math.max(refreshAt, retryAt);
    timer = window.setTimeout(check, Math.max(1, Math.min(lastActivityAt(auth) + IDLE_TIMEOUT_MS, expiresAt, nextRefresh) - now));
  }

  function activity(event) {
    if (!event.isTrusted) return;
    const auth = validStoredAuth();
    if (!auth) return;
    // Keep activity separate from the auth snapshot: typing must not re-render the app.
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify({ sessionId: auth.sessionId, at: Date.now() }));
    check();
  }

  function storage(event) {
    if (event.key !== AUTH_KEY && event.key !== ACTIVITY_KEY && event.key !== null) return;
    if (event.key !== ACTIVITY_KEY) {
      invalidateApiCache();
      for (const listener of listeners) listener();
    }
    check();
  }

  const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'input', 'wheel', 'touchstart', 'touchmove'];
  const options = { passive: true, capture: true };
  for (const type of activityEvents) window.addEventListener(type, activity, options);
  window.addEventListener('storage', storage);
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', check);
  const unsubscribe = subscribeAuth(check);
  check();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    unsubscribe();
    for (const type of activityEvents) window.removeEventListener(type, activity, options);
    window.removeEventListener('storage', storage);
    window.removeEventListener('focus', check);
    document.removeEventListener('visibilitychange', check);
  };
}
