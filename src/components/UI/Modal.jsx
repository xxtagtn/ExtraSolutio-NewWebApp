import { X } from 'lucide-react';
import IconButton from './IconButton.jsx';

export default function Modal({ title, children, onClose, size = 'default' }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className={`modal ${size === 'wide' ? 'modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
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
