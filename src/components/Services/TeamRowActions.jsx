import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';

export default function TeamRowActions({ name, released, disabled, onSlot, onRemove }) {
  const [position, setPosition] = useState(null);
  const trigger = useRef(null), menu = useRef(null);
  const id = useId();

  function close(returnFocus = false) {
    setPosition(null);
    if (returnFocus) trigger.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!position) return undefined;
    menu.current?.querySelector('button')?.focus({ preventScroll: true });
    const outside = (event) => {
      if (!menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) setPosition(null);
    };
    const dismiss = () => setPosition(null);
    const scroll = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect || Math.abs(rect.top - position.anchorTop) > 1 || Math.abs(rect.left - position.anchorLeft) > 1) dismiss();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [position]);

  function toggle() {
    if (position) return close();
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(264, window.innerWidth - 16), height = 102;
    setPosition({ width, anchorTop: rect.top, anchorLeft: rect.left, left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      top: Math.max(8, rect.bottom + height + 6 <= window.innerHeight ? rect.bottom + 6 : rect.top - height - 6) });
  }

  return <div className="service-detail-row-actions">
    <button type="button" ref={trigger} className="icon-button" disabled={disabled}
      title="Ações do colaborador" aria-label={`Ações de ${name}`} aria-haspopup="menu"
      aria-expanded={Boolean(position)} aria-controls={position ? id : undefined} onClick={toggle}
      onKeyDown={(event) => { if (event.key === 'ArrowDown' && !position) { event.preventDefault(); toggle(); } }}>
      <MoreHorizontal size={17} aria-hidden="true" />
    </button>
    {position && createPortal(<div id={id} ref={menu} role="menu" aria-label={`Ações de ${name}`}
      className="service-team-actions-menu" style={{ width: position.width, top: position.top, left: position.left }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
        const items = [...event.currentTarget.querySelectorAll('button')];
        const current = items.indexOf(document.activeElement);
        const next = event.key === 'ArrowDown' ? (current + 1) % items.length
          : event.key === 'ArrowUp' ? (current + items.length - 1) % items.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); items[next].focus({ preventScroll: true }); }
      }}>
      <button type="button" role="menuitem" disabled={disabled} onClick={() => { close(true); onSlot(); }}>
        {released ? <RotateCcw size={16} /> : <Ban size={16} />}
        {released ? 'Repor lugar na equipa' : 'Retirar lugar da equipa necessária'}
      </button>
      <button type="button" role="menuitem" className="service-team-actions-menu__danger" disabled={disabled}
        onClick={() => { close(true); onRemove(); }}><Trash2 size={16} />Remover linha</button>
    </div>, document.body)}
  </div>;
}
