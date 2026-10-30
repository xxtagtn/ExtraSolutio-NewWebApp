import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../utils/api.js';
import { emptyServiceOrder, validServiceOrder } from '../utils/serviceOrder.js';

const defaults = () => ({ active: emptyServiceOrder(), archive: emptyServiceOrder() });
export function useServiceOrder(userId) {
  const [state, setState] = useState(() => ({ userId, preferences: defaults(), ready: false, saving: false, error: '', saved: false }));
  const alive = useRef(null), pending = useRef(false), reads = useRef(0);
  const current = useRef(state);
  current.current = state;

  const refresh = useCallback(async () => {
    if (pending.current || alive.current !== userId) return;
    const request = ++reads.current;
    try {
      const preferences = await api('/auth/service-order', { cache: 'no-store' });
      if (!validServiceOrder(preferences?.active) || !validServiceOrder(preferences?.archive)) throw new Error('Resposta de ordenação inválida.');
      if (alive.current === userId && !pending.current && request === reads.current) {
        setState((old) => ({ ...old, userId, preferences, ready: true, error: '' }));
      }
    } catch (error) {
      if (alive.current === userId && request === reads.current) setState((old) => ({ ...old, error: error.message }));
    }
  }, [userId]);

  useEffect(() => {
    alive.current = userId;
    pending.current = false;
    setState({ userId, preferences: defaults(), ready: false, saving: false, error: '', saved: false });
    refresh();
    window.addEventListener('focus', refresh);
    const visibility = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { alive.current = null; window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visibility); };
  }, [userId, refresh]);

  async function save(scope, value) {
    const old = current.current;
    if (pending.current || !old.ready || old.userId !== userId) return;
    pending.current = true;
    reads.current++;
    const preference = { ...value, version: old.preferences[scope].version };
    setState({ ...old, saving: true, error: '', saved: false, preferences: { ...old.preferences, [scope]: preference } });
    try {
      const result = await api(`/auth/service-order/${scope}`, { method: 'PUT', body: JSON.stringify(preference) });
      if (!validServiceOrder(result)) throw new Error('Não foi possível confirmar a ordem guardada.');
      if (alive.current === userId) setState((latest) => ({ ...latest, saving: false, saved: true, savedScope: scope, preferences: { ...latest.preferences, [scope]: result } }));
    } catch (error) {
      if (alive.current === userId) {
        setState({ ...old, saving: true, saved: false, error: error.message });
        const request = ++reads.current;
        // Resolve concurrent edits and ambiguous network failures from the server.
        try {
          const preferences = await api('/auth/service-order', { cache: 'no-store' });
          if (alive.current === userId && request === reads.current && validServiceOrder(preferences?.active) && validServiceOrder(preferences?.archive)) {
            setState((latest) => ({ ...latest, preferences }));
          }
        } catch { /* Keep the last confirmed preference and the visible save error. */ }
      }
    } finally {
      if (alive.current === userId) { pending.current = false; setState((latest) => ({ ...latest, saving: false })); }
    }
  }

  const own = state.userId === userId ? state : { preferences: defaults(), ready: false, saving: false, error: '', saved: false };
  return { ...own, save, refresh };
}
