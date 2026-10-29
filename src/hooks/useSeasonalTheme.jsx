import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { normalizeThemePreference, readThemePreference, resolveSeasonalTheme, saveThemePreference, themePreferenceKey } from '../utils/seasonalTheme.js';
import { api } from '../utils/api.js';

const SeasonalThemeContext = createContext(null);

export function SeasonalThemeProvider({ userId, children }) {
  const [preference, setPreference] = useState(() => readThemePreference(userId));
  const [now, setNow] = useState(() => new Date());
  const [saveStatus, setSaveStatus] = useState('');
  const [serverState, setServerState] = useState(null);
  const [saving, setSaving] = useState(false);
  const revision = useRef(0);
  const queue = useRef(Promise.resolve());
  const pendingWrites = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function refreshPreference() {
      if (pendingWrites.current) return;
      const before = revision.current;
      try {
        const result = await api('/auth/appearance', { cache: 'no-store' });
        if (cancelled || pendingWrites.current || before !== revision.current || typeof result?.configured !== 'boolean') return;
        setServerState(result);
        if (result.configured) {
          const selected = normalizeThemePreference(result.preference);
          setPreference(selected);
          saveThemePreference(userId, selected);
        }
      } catch { /* Local appearance remains usable if the server is unavailable. */ }
    }
    refreshPreference();
    window.addEventListener('focus', refreshPreference);
    return () => { cancelled = true; window.removeEventListener('focus', refreshPreference); };
  }, [userId]);

  useEffect(() => {
    const refreshTime = () => setNow(new Date());
    const onVisibility = () => { if (!document.hidden) refreshTime(); };
    const synchronize = (event) => {
      if (event.key !== null && event.key !== themePreferenceKey(userId)) return;
      setPreference(readThemePreference(userId));
      setSaveStatus('');
      refreshTime();
    };
    const timer = window.setInterval(refreshTime, 60000);
    window.addEventListener('storage', synchronize);
    window.addEventListener('focus', refreshTime);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('storage', synchronize);
      window.removeEventListener('focus', refreshTime);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [userId]);

  function selectTheme(value, { publishToQr = false } = {}) {
    const selected = normalizeThemePreference(value);
    const request = ++revision.current;
    setPreference(selected);
    setNow(new Date());
    saveThemePreference(userId, selected);
    setSaving(true);
    pendingWrites.current++;
    setSaveStatus('A guardar tema...');
    const write = queue.current.catch(() => {}).then(() => api('/auth/appearance', {
      method: 'PUT', body: JSON.stringify({ preference: selected, publishToQr }),
    }));
    queue.current = write;
    return write.then((result) => {
      if (typeof result?.configured !== 'boolean') throw new Error('Resposta de aparência inválida.');
      if (request !== revision.current) return;
      setServerState(result);
      setSaveStatus(result.controlsPublicQr ? 'Tema guardado na conta e aplicado aos links de picagem.' : 'Tema guardado na conta.');
    }).catch(() => {
      if (request === revision.current) setSaveStatus('Tema aplicado apenas neste navegador. Não foi possível atualizar a conta nem os links de picagem.');
    }).finally(() => { pendingWrites.current--; if (request === revision.current) setSaving(false); });
  }

  return (
    <SeasonalThemeContext.Provider value={{ preference, theme: resolveSeasonalTheme(preference, now), selectTheme, saveStatus, serverState, saving }}>
      {children}
    </SeasonalThemeContext.Provider>
  );
}

export function useSeasonalTheme() {
  const value = useContext(SeasonalThemeContext);
  if (!value) throw new Error('useSeasonalTheme deve ser usado dentro de SeasonalThemeProvider.');
  return value;
}
