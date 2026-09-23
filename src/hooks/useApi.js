import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../utils/api.js';
import { invalidateApiCache, readApiCache, writeApiCache } from '../utils/apiCache.js';
import { isSameApiData } from '../utils/apiDataEquality.js';

export { invalidateApiCache };

export function useApi(path, fallback = [], { enabled = true } = {}) {
  const cached = readApiCache(path);
  const [data, setData] = useState(cached === undefined ? fallback : cached);
  const [loading, setLoading] = useState(cached === undefined);
  const [error, setError] = useState('');
  const activeRef = useRef(true);

  const load = useCallback(({ background = false } = {}) => {
    if (!enabled) return () => {};
    let active = true;
    if (!background) {
      setLoading(readApiCache(path) === undefined);
    }
    setError('');

    api(path)
      .then((result) => {
        writeApiCache(path, result);
        if (active && activeRef.current) {
          setData((current) => (isSameApiData(current, result) ? current : result));
        }
      })
      .catch((err) => {
        if (active && activeRef.current) setError(err.message);
      })
      .finally(() => {
        if (active && activeRef.current) setLoading(false);
      });

    return () => {
      active = false;
    };
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
    return load({ background });
  }, [load, path]);

  return { data: enabled ? data : fallback, loading: enabled && loading, error: enabled ? error : '', reload };
}
