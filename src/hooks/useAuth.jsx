import { createContext, useContext, useState } from 'react';
import { api, clearStoredAuth, getStoredAuth, setStoredAuth } from '../utils/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => getStoredAuth());

  async function login(email, password) {
    const result = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setStoredAuth(result);
    setAuth(result);
    return result.user;
  }

  function logout() {
    clearStoredAuth();
    setAuth(null);
  }

  function updateUser(user) {
    const nextAuth = { ...auth, user };
    setStoredAuth(nextAuth);
    setAuth(nextAuth);
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
