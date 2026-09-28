# Shared UI Components

Reusable React primitives used across pages. Source is included in full.

### `src/components/UI/Modal.jsx`

```jsx
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import IconButton from './IconButton.jsx';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export default function Modal({ title, children, onClose, size = 'default', stableDesktop = false }) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    const dialog = dialogRef.current;
    const firstField = dialog?.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
    (firstField || dialog?.querySelector(FOCUSABLE_SELECTOR))?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocusRef.current instanceof window.HTMLElement) {
        previousFocusRef.current.focus();
      }
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
        return;
      }

      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)]
        .filter((element) => element.offsetParent !== null || element === document.activeElement);
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  function onBackdropMouseDown(event) {
    if (event.target === event.currentTarget) {
      onClose?.();
    }
  }

  return (
    <div className={`modal-backdrop${stableDesktop ? ' modal-backdrop--stable-desktop' : ''}`} role="presentation" onMouseDown={onBackdropMouseDown}>
      <section
        ref={dialogRef}
        className={`modal ${size === 'wide' ? 'modal--wide' : ''}${stableDesktop ? ' modal--stable-desktop' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal__header">
          <h2>{title}</h2>
          <IconButton label="Fechar" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}

```

### `src/components/UI/Badge.jsx`

```jsx
export default function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

```

### `src/components/UI/Card.jsx`

```jsx
export default function Card({ title, action, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card__header">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

```

### `src/components/UI/Stats.jsx`

```jsx
export default function Stats({ items, className = '' }) {
  return (
    <div className={`stats-grid ${className}`.trim()}>
      {items.map((item) => (
        <div
          className={`stat ${item.tone ? `stat--${item.tone}` : ''} ${item.featured ? 'stat--featured' : ''}`.trim()}
          key={item.label}
        >
          <div className="stat__body">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            {item.detail && <small>{item.detail}</small>}
          </div>
          {item.icon ? <span className="stat__icon">{item.icon}</span> : null}
        </div>
      ))}
    </div>
  );
}

```

### `src/components/UI/IconButton.jsx`

```jsx
export default function IconButton({ children, label, tone = 'neutral', ...props }) {
  return (
    <button className={`icon-button icon-button--${tone}`} type="button" title={label} aria-label={label} {...props}>
      {children}
    </button>
  );
}

```

### `src/components/UI/Table.jsx`

```jsx
export default function Table({ columns, rows, empty = 'Sem dados para apresentar.' }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="table-empty">{empty}</td>
            </tr>
          ) : rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td key={column.key} data-label={column.label}>{column.render ? column.render(row) : row[column.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

```

### `src/components/UI/EmptyState.jsx`

```jsx
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
}) {
  return (
    <div className={`empty-state ${compact ? 'empty-state--compact' : ''}`}>
      {Icon ? (
        <span className="empty-state__icon" aria-hidden="true">
          <Icon size={compact ? 17 : 22} />
        </span>
      ) : null}
      <div className="empty-state__content">
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

```