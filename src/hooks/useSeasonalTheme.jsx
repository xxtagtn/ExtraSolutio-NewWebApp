import { createContext, useContext, useEffect, useState } from 'react';
import { normalizeThemePreference, readThemePreference, resolveSeasonalTheme, saveThemePreference, themePreferenceKey } from '../utils/seasonalTheme.js';

const SeasonalThemeContext = createContext(null);

export function SeasonalThemeProvider({ userId, children }) {
  const [preference, setPreference] = useState(() => readThemePreference(userId));
  const [now, setNow] = useState(() => new Date());
  const [saveStatus, setSaveStatus] = useState('');

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

  function selectTheme(value) {
    const selected = normalizeThemePreference(value);
    setPreference(selected);
    setNow(new Date());
    setSaveStatus(saveThemePreference(userId, selected) ? 'Tema guardado neste navegador.' : 'Tema aplicado apenas nesta sessão. Não foi possível guardar a preferência.');
  }

  return (
    <SeasonalThemeContext.Provider value={{ preference, theme: resolveSeasonalTheme(preference, now), selectTheme, saveStatus }}>
      {children}
    </SeasonalThemeContext.Provider>
  );
}

export function useSeasonalTheme() {
  const value = useContext(SeasonalThemeContext);
  if (!value) throw new Error('useSeasonalTheme deve ser usado dentro de SeasonalThemeProvider.');
  return value;
}
