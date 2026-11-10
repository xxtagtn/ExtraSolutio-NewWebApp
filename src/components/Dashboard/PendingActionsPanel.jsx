import { CalendarClock, ChevronLeft, ChevronRight, Clock, Inbox, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DOCUMENT_SNOOZE_DAYS } from '../../../shared/dashboardDocumentSnooze.js';
import { paginateItems } from '../../utils/pagination.js';
import Badge from '../UI/Badge.jsx';
import EmptyState from '../UI/EmptyState.jsx';
import IconButton from '../UI/IconButton.jsx';
import Modal from '../UI/Modal.jsx';
import './PendingActionsPanel.css';

const priorities = { critical: ['Crítica', 'danger'], high: ['Alta', 'warning'], medium: ['Média', 'warning'], low: ['Baixa', 'info'] };
const labels = { Staff: 'Enviar', Orçamentos: 'Registar', Documentos: 'Ver' };
const formatUntil = new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

function relativeDueDate(value) {
  if (!value) return '-';
  const target = new Date(value), today = new Date();
  if (Number.isNaN(target.getTime())) return '-';
  const days = Math.round((target.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return 'Hoje';
  if (days === 1) return 'Amanhã';
  if (days === -1) return 'Ontem';
  return days > 1 ? `${days} dias` : `Há ${Math.abs(days)} dias`;
}

function SnoozeDialog({ action, busy, error, onSave, onClose }) {
  const [option, setOption] = useState('7');
  const [custom, setCustom] = useState('');
  const [validation, setValidation] = useState('');
  function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (option !== 'custom') { onSave({ days: Number(option) }); return; }
    const until = new Date(custom);
    if (!Number.isFinite(until.getTime()) || until.getTime() <= Date.now()) {
      setValidation('Escolhe uma data e hora futuras.');
      return;
    }
    onSave({ until: until.toISOString() });
  }
  return (
    <Modal title="Adiar alerta" onClose={() => !busy && onClose()} preventFocusScroll>
      <form className="command-snooze-form" onSubmit={submit}>
        <strong>{action.origin || action.title}</strong>
        <label><span id="command-snooze-duration-label">Adiar por</span>
          <select aria-labelledby="command-snooze-duration-label" value={option} disabled={busy} onChange={(event) => { setOption(event.target.value); setValidation(''); }}>
            {DOCUMENT_SNOOZE_DAYS.map((days) => <option key={days} value={days}>{days === 1 ? '1 dia' : `${days} dias`}</option>)}
            <option value="custom">Escolher data e hora</option>
          </select>
        </label>
        {option === 'custom' && <label>Data e hora
          <input type="datetime-local" value={custom} required disabled={busy} onChange={(event) => { setCustom(event.target.value); setValidation(''); }} />
        </label>}
        {(validation || error) && <p className="notice" role="alert">{validation || error}</p>}
        <div className="command-snooze-buttons">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="submit" className="command-button" disabled={busy}><Clock size={16} />{busy ? 'A guardar…' : 'Adiar'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function PendingActionsPanel({ pending, search, loading, canSnooze, snoozeError, snoozeReady, onSnooze }) {
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [feedback, setFeedback] = useState('');
  const query = normalize(search);
  const actions = query ? pending.filter((action) => normalize([
      action.category, action.title, action.description, action.origin,
      ...(action.details || []).flatMap(({ label, value }) => [label, value]), ...(action.meta || []),
    ].join(' ')).includes(query)) : pending;
  const pagination = paginateItems(actions, page, 10);
  const blocked = busy || !snoozeReady;

  useEffect(() => { setPage(1); }, [search]);
  useEffect(() => { if (page > pagination.totalPages) setPage(pagination.totalPages); }, [page, pagination.totalPages]);
  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(''), 6000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  function openSnooze(action) {
    setFailure(''); setFeedback(''); setDialog(action);
  }
  async function saveSnooze(duration) {
    if (blocked) return;
    setBusy(true); setFailure(''); setFeedback('');
    try {
      const until = await onSnooze(dialog.snoozeKey, duration);
      setDialog(null);
      setFeedback(`Alerta adiado até ${formatUntil.format(new Date(until))}.`);
    } catch (error) { setFailure(error.message); }
    finally { setBusy(false); }
  }

  return (
    <section className="command-panel command-actions-panel" aria-labelledby="command-actions-title">
      <header><div><CalendarClock size={18} /><h2 id="command-actions-title">Ações Pendentes</h2></div></header>
      {snoozeError && <p className="command-snooze-status notice" role="alert">Não foi possível consultar os adiamentos. {snoozeError}</p>}
      {feedback && <p className="command-snooze-status success-note" role="status">{feedback}</p>}
      <div className="command-actions-table" role="table" aria-label="Ações pendentes">
        {pagination.items.length > 0 && <div className="command-actions-header" role="row">
          {['Prioridade', 'Ação', 'Origem', 'Prazo', 'Tipo', 'Opções'].map((label) => <span key={label} role="columnheader">{label}</span>)}
        </div>}
        {pagination.items.map((action) => {
          const [priority, tone] = priorities[action.priority] || [action.priority, 'neutral'];
          const details = action.details?.filter((item) => !action.snoozeKey || item.label !== 'Colaborador');
          const name = action.origin || action.title;
          return <div key={action.id} className="command-actions-row" role="row">
            <div role="cell"><Badge tone={tone}>{priority}</Badge></div>
            <div className="command-action-detail" role="cell">
              <strong>{action.title}</strong>
              {details?.length ? <dl>{details.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl> : <small>{action.description}</small>}
            </div>
            <span role="cell">{action.origin || action.meta?.[0] || action.category}</span>
            <span role="cell">{relativeDueDate(action.dueDate)}</span>
            <span role="cell"><Badge tone={action.tone || 'neutral'}>{action.category}</Badge></span>
            <div className="command-snooze-buttons" role="cell">
              <Link className="secondary-button" to={action.to}>{action.buttonLabel || labels[action.category] || 'Abrir'}</Link>
              {canSnooze && action.snoozeKey && <button type="button" className="secondary-button" aria-label={`Adiar alerta de ${name}`}
                disabled={blocked} onClick={() => openSnooze(action)}><Clock size={15} />Adiar</button>}
            </div>
          </div>;
        })}
      </div>
      {!pagination.totalItems && <div className="command-actions-empty"><EmptyState compact icon={query ? Search : Inbox}
        title={loading ? 'A carregar ações' : query ? 'Nenhum resultado encontrado' : 'Sem ações pendentes'} /></div>}
      {pagination.totalItems > 0 && <footer className="command-snooze-pagination">
        <span>{pagination.startItem}–{pagination.endItem} de {pagination.totalItems} ações</span>
        {pagination.totalPages > 1 && <nav aria-label="Paginação das ações pendentes">
          <IconButton label="Página anterior de ações" disabled={busy || pagination.currentPage <= 1} onClick={() => setPage(pagination.currentPage - 1)}><ChevronLeft size={17} /></IconButton>
          {pagination.pageNumbers.map((number) => <button key={number} type="button" className="icon-button"
            aria-label={`Página ${number} de ações`} aria-current={number === pagination.currentPage ? 'page' : undefined}
            disabled={busy} onClick={() => setPage(number)}>{number}</button>)}
          <IconButton label="Página seguinte de ações" disabled={busy || pagination.currentPage >= pagination.totalPages} onClick={() => setPage(pagination.currentPage + 1)}><ChevronRight size={17} /></IconButton>
        </nav>}
      </footer>}
      {dialog && <SnoozeDialog action={dialog} busy={busy} error={failure} onSave={saveSnooze} onClose={() => { setDialog(null); setFailure(''); }} />}
    </section>
  );
}
