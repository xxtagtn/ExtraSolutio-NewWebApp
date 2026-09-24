import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../utils/api.js';

export function useCommunicationData(path, { poll = false } = {}) {
  const [result, setResult] = useState({ path: null, data: null, error: '', loading: false });
  const activeRequest = useRef(null);
  const reload = useCallback(({ background = false } = {}) => {
    if (!path) return;
    if (background && activeRequest.current) return;
    activeRequest.current?.abort();
    const controller = new window.AbortController();
    activeRequest.current = controller;
    setResult((current) => ({ ...current, error: '', loading: !background || current.path !== path }));
    api(path, { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setResult({ path, data, error: '', loading: false });
    }).catch((error) => {
      if (!controller.signal.aborted) setResult((current) => ({ path, data: current.path === path ? current.data : null, error: error.message, loading: false }));
    }).finally(() => {
      if (activeRequest.current === controller) activeRequest.current = null;
    });
  }, [path]);

  useEffect(() => {
    reload();
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') reload({ background: true });
    };
    const timer = path && poll ? window.setInterval(refreshVisible, 15000) : null;
    if (path && poll) {
      window.addEventListener('focus', refreshVisible);
      document.addEventListener('visibilitychange', refreshVisible);
    }
    return () => {
      if (timer) window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [path, poll, reload]);

  return {
    data: path && result.path === path ? result.data : null,
    previousData: result.data,
    error: path && result.path === path ? result.error : '',
    loading: Boolean(path && (result.path !== path || result.loading)),
    reload,
  };
}
