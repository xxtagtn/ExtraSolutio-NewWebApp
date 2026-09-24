import { createContext, useContext, useEffect, useState } from 'react';
import { api, clearStoredAuth, getStoredAuth, refreshStoredAuth, setStoredAuth } from '../utils/api.js';
import { startSessionMonitor, subscribeAuth, validStoredAuth } from '../utils/authSession.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => validStoredAuth());

  useEffect(() => {
    const synchronize = () => setAuth(getStoredAuth());
    const unsubscribe = subscribeAuth(synchronize);
    const stop = startSessionMonitor(refreshStoredAuth);
    synchronize();
    return () => { stop(); unsubscribe(); };
  }, []);

  async function login(email, password) {
    const result = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setStoredAuth(result);
    return result.user;
  }

  function logout() {
    clearStoredAuth();
    setAuth(null);
  }

  function updateUser(user) {
    const current = validStoredAuth();
    if (!current) return;
    const nextAuth = { ...current, user };
    setStoredAuth(nextAuth);
  }

  const value = {
    token: auth?.token || '',
    user: auth?.user || null,
    authenticated: Boolean(auth?.token),
    login,
    logout,
    updateUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider.');
  }
  return context;
}
