import { useCallback, useEffect, useRef } from 'react';
import { collaboratorPickerPlacement } from '../utils/collaboratorPickerPlacement.js';

export function useCollaboratorPickerPosition(open, setPlacement) {
  const anchor = useRef(null);
  const update = useCallback(() => {
    if (!anchor.current?.isConnected) return;
    const viewport = window.visualViewport;
    const next = collaboratorPickerPlacement(anchor.current.getBoundingClientRect(), {
      width: viewport?.width ?? window.innerWidth,
      height: viewport?.height ?? window.innerHeight,
      offsetTop: viewport?.offsetTop ?? 0,
      offsetLeft: viewport?.offsetLeft ?? 0,
      layoutWidth: window.innerWidth,
      layoutHeight: window.innerHeight,
    });
    setPlacement((current) => current && Object.keys(next).every((key) => current[key] === next[key]) ? current : next);
  }, [setPlacement]);

  useEffect(() => {
    if (!open) return undefined;
    const viewport = window.visualViewport;
    let frame;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, true);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, true);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
    };
  }, [open, update]);

  return useCallback((element) => { anchor.current = element; update(); }, [update]);
}
