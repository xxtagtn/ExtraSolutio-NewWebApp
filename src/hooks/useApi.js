import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../utils/api.js';
import { invalidateApiCache, readApiCache, writeApiCache } from '../utils/apiCache.js';

export { invalidateApiCache };

export function useApi(path, fallback = []) {
  const cached = readApiCache(path);
  const [data, setData] = useState(cached === undefined ? fallback : cached);
  const [loading, setLoading] = useState(cached === undefined);
  const [error, setError] = useState('');
  const activeRef = useRef(true);

  const load = useCallback(({ background = false } = {}) => {
    let active = true;
    if (!background) {
      setLoading(readApiCache(path) === undefined);
    }
    setError('');

    api(path)
      .then((result) => {
        writeApiCache(path, result);
        if (active && activeRef.current) setData(result);
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
  }, [path]);

  useEffect(() => {
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
  }, [load, path]);

  const reload = useCallback(() => {
    invalidateApiCache(path);
    return load();
  }, [load, path]);

  return { data, loading, error, reload };
}
