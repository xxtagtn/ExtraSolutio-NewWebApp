import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function CommunicationPagination({ payload, page, pageSize, loading, onPageChange, onPageSizeChange }) {
  const total = payload?.total || 0;
  const totalPages = payload?.totalPages || 1;
  const current = payload?.page || page;
  const start = Math.max(1, Math.min(current - 2, totalPages - 4));
  const numbers = Array.from({ length: Math.min(5, totalPages) }, (_, index) => start + index);
  return (
    <div className="collab-pagination">
      <span className="collab-pagination__summary" aria-live="polite">
        A mostrar {total ? (current - 1) * pageSize + 1 : 0}-{Math.min(current * pageSize, total)} de {total}
      </span>
      <label className="collab-pagination__size">
        <span>Por página</span>
        <select className="form-control" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <nav className="collab-pagination__pages" aria-label="Paginação da Comunicação">
        <button type="button" className="icon-button" aria-label="Página anterior" title="Página anterior" disabled={loading || current <= 1} onClick={() => onPageChange(current - 1)}>
          <ChevronLeft size={17} />
        </button>
        {numbers.map((number) => (
          <button key={number} type="button" className={`collab-pagination__page${number === current ? ' is-active' : ''}`} aria-label={`Página ${number}`} aria-current={number === current ? 'page' : undefined} disabled={loading} onClick={() => onPageChange(number)}>{number}</button>
        ))}
        <button type="button" className="icon-button" aria-label="Página seguinte" title="Página seguinte" disabled={loading || current >= totalPages} onClick={() => onPageChange(current + 1)}>
          <ChevronRight size={17} />
        </button>
      </nav>
    </div>
  );
}
