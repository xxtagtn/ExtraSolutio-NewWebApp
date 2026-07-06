import { invalidateApiCache } from './apiCache.js';

function resolveApiUrl() {
  const configured = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
  if (typeof window === 'undefined') return configured;
  const host = window.location.hostname;
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';
  if (!isLocalHost && /^https?:\/\/(localhost|127\.0\.0\.1):3001\/api$/i.test(configured)) {
    return `${window.location.protocol}//${host}:3001/api`;
  }
  return configured;
}

export const API_URL = resolveApiUrl();
const AUTH_KEY = 'extrasolutio.auth';
const REFRESH_MARGIN_SECONDS = 10 * 60;

export function getStoredAuth() {
  const raw = localStorage.getItem(AUTH_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    clearStoredAuth();
    return null;
  }
}

export function setStoredAuth(auth) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

export function clearStoredAuth() {
  localStorage.removeItem(AUTH_KEY);
}

function tokenPayload(token) {
  try {
    const [, payload] = String(token || '').split('.');
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(globalThis.atob(normalized));
  } catch {
    return null;
  }
}

function tokenNeedsRefresh(token) {
  const payload = tokenPayload(token);
  if (!payload?.exp) return false;
  const secondsLeft = payload.exp - Math.floor(Date.now() / 1000);
  return secondsLeft > 0 && secondsLeft <= REFRESH_MARGIN_SECONDS;
}

async function refreshStoredAuth(auth) {
  const response = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
    },
  });
  if (!response.ok) throw new Error('Login Expirado');
  const refreshed = await response.json();
  setStoredAuth(refreshed);
  return refreshed;
}

export async function api(path, options = {}) {
  let auth = getStoredAuth();
  if (auth?.token && !path.startsWith('/auth/') && tokenNeedsRefresh(auth.token)) {
    try {
      auth = await refreshStoredAuth(auth);
    } catch {
      clearStoredAuth();
      throw new Error('Login Expirado');
    }
  }
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(auth?.token ? { Authorization: `Bearer ${auth.token}` } : {}),
      ...options.headers,
    },
    ...options,
  });

  const method = String(options.method || 'GET').toUpperCase();
  if (response.ok && method !== 'GET') {
    invalidateApiCache();
  }

  if (!response.ok) {
    if (response.status === 401) clearStoredAuth();
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Pedido falhou.');
  }
  if (response.status === 204) return null;
  return response.json();
}
