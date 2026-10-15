import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../utils/api.js';
import { invalidateApiCache, readApiCache, writeApiCache } from '../utils/apiCache.js';
import { isSameApiData } from '../utils/apiDataEquality.js';

export { invalidateApiCache };

export function useApi(path, fallback = [], { enabled = true, revalidateOnFocus = false } = {}) {
  const cached = readApiCache(path);
  const [data, setData] = useState(cached === undefined ? fallback : cached);
  const [loading, setLoading] = useState(cached === undefined);
  const [error, setError] = useState('');
  const activeRef = useRef(true);
  const requestRef = useRef(0);

  const load = useCallback(({ background = false } = {}) => {
    if (!enabled) return () => {};
    let active = true;
    const requestId = ++requestRef.current;
    if (!background) {
      setLoading(readApiCache(path) === undefined);
    }
    setError('');

    const cancel = () => { active = false; };
    cancel.done = api(path)
      .then((result) => {
        if (active && activeRef.current && requestId === requestRef.current) {
          writeApiCache(path, result);
          setData((current) => (isSameApiData(current, result) ? current : result));
        }
        return result;
      })
      .catch((err) => {
        if (active && activeRef.current && requestId === requestRef.current) setError(err.message);
      })
      .finally(() => {
        if (active && activeRef.current && requestId === requestRef.current) setLoading(false);
      });
    return cancel;
  }, [path, enabled]);

  useEffect(() => {
    if (!enabled) {
      activeRef.current = false;
      return undefined;
    }
    activeRef.current = true;
    const fresh = readApiCache(path);
    if (fresh !== undefined) {
      setData(fresh);
      setLoading(false);
    }
    const cancel = load({ background: fresh !== undefined });
    return () => {
      activeRef.current = false;
      cancel();
    };
  }, [load, path, enabled]);

  const reload = useCallback(({ background = false } = {}) => {
    if (!background) invalidateApiCache(path);
    return load({ background }).done;
  }, [load, path]);

  useEffect(() => {
    if (!enabled || !revalidateOnFocus) return undefined;
    const refresh = () => { if (document.visibilityState === 'visible') reload({ background: true }); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [enabled, reload, revalidateOnFocus]);

  return { data: enabled ? data : fallback, loading: enabled && loading, error: enabled ? error : '', reload };
}
