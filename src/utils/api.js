const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const AUTH_KEY = 'extrasolutio.auth';

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

export async function api(path, options = {}) {
  const auth = getStoredAuth();
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(auth?.token ? { Authorization: `Bearer ${auth.token}` } : {}),
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    if (response.status === 401) clearStoredAuth();
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Pedido falhou.');
  }
  if (response.status === 204) return null;
  return response.json();
}
