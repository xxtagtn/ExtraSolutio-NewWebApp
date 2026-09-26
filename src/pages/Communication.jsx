import {
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  ExternalLink,
  MessageSquareText,
  Phone,
  QrCode,
  RefreshCw,
  Search,
  Send,
  UserCheck,
  UserX,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Badge from '../components/UI/Badge.jsx';
import EmptyState from '../components/UI/EmptyState.jsx';
import CommunicationPagination from '../components/UI/CommunicationPagination.jsx';
import { CommunicationQrActions, CommunicationQrDialog, useCommunicationQrTools } from '../components/Communication/CommunicationQrTools.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { useCommunicationData } from '../hooks/useCommunicationData.js';
import { api } from '../utils/api.js';
import { hasPermission, PERMISSIONS } from '../utils/accessPermissions.js';
import { communicationSummary } from '../utils/communicationCenter.js';
import { groupQrRowsByCollaboratorDay } from '../utils/communicationQrGroups.js';
import { withCommunicationMessageDraft } from '../utils/communicationMessageDrafts.js';
import { date } from '../utils/formatters.js';

const stateLabels = {
  scheduled: 'Agendado',
  pending_contact: 'Por contactar',
  ready: 'Pronto',
  prepared: 'Preparado',
  sending: 'A enviar',
  accepted: 'Aceite pela Meta',
  sent: 'Enviado pela Meta',
  delivered: 'Entregue',
  read: 'Lido',
  failed: 'Falhou',
  responded: 'Respondeu',
  confirmed: 'Confirmado',
  unavailable: 'Não disponível',
};

const stateTones = {
  scheduled: 'neutral',
  pending_contact: 'warning',
  ready: 'warning',
  prepared: 'info',
  sending: 'info',
  accepted: 'info',
  sent: 'info',
  delivered: 'success',
  read: 'success',
  failed: 'danger',
  responded: 'warning',
  confirmed: 'success',
  unavailable: 'danger',
};

const kindLabels = {
  confirmation: 'Confirmação',
  reminder_24h: 'Lembrete 24h',
};

function formatTaskDate(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return date.format(parsed);
}

function SummaryCard({ icon: Icon, label, value, tone = 'accent' }) {
  return (
    <article className={`communication-summary-card communication-summary-card--${tone}`}>
      <span><Icon size={20} /></span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

const qrStateTones = {
  qr_generated: 'info',
  entrada_registada: 'warning',
  servico_concluido: 'success',
};

function QrCodesPanel({ canManageQrCodes, qrTools }) {
  const [eventId, setEventId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const { data: eventOptions, error: optionsError, reload: reloadEvents } = useCommunicationData(canManageQrCodes ? '/qr-codes/events' : null, { poll: true });
  const { data: payload, loading, error, reload: loadQrCodes } = useCommunicationData(
    canManageQrCodes && eventId ? `/qr-codes/events/${eventId}?page=${page}&pageSize=${pageSize}&groupBy=collaboratorDay` : null,
    { poll: true },
  );

  useEffect(() => {
    if (eventOptions && !eventOptions.some((event) => String(event.id) === String(eventId))) {
      setEventId(eventOptions[0]?.id || '');
      setPage(1);
    }
  }, [eventId, eventOptions]);

  if (!canManageQrCodes) {
    return (
      <EmptyState
        icon={QrCode}
        title="Sem acesso aos QR Codes"
        description="Este utilizador não tem permissão para gerir QR Codes de check-in/check-out."
      />
    );
  }

  return (
    <section className="communication-qr-panel">
      <div className="communication-qr-toolbar">
        <label>
          <span>Evento/Serviço</span>
          <select value={eventId} onChange={(event) => { setEventId(event.target.value); setPage(1); }}>
            {eventOptions?.length ? eventOptions.map((item) => (
              <option key={item.id} value={item.id}>{item.name} · {item.clientName} · {formatTaskDate(item.date)}</option>
            )) : <option value="">Sem serviços nesta janela</option>}
          </select>
        </label>
        <button type="button" className="secondary-button" onClick={() => { reloadEvents(); loadQrCodes(); }} disabled={loading}>
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>

      {error || optionsError ? <p className="notice">{error || optionsError}</p> : null}

      <div className="communication-qr-summary">
        <article>
          <small>Evento</small>
          <strong>{payload?.event?.name || 'Seleciona um evento'}</strong>
          <span>{payload?.event?.clientName || ''}</span>
        </article>
        <article>
          <small>QR gerados</small>
          <strong>{payload?.summary?.total || 0}</strong>
          <span>colaboradores atribuídos</span>
        </article>
        <article>
          <small>Entradas</small>
          <strong>{payload?.summary?.entries || 0}</strong>
          <span>registadas</span>
        </article>
        <article>
          <small>Concluídos</small>
          <strong>{payload?.summary?.completed || 0}</strong>
          <span>com entrada e saída</span>
        </article>
      </div>

      <div className="communication-qr-table-wrap">
        <table className="data-table communication-qr-table">
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Serviços / Picagens</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="3">A carregar QR Codes...</td></tr>
            ) : (payload?.rows || []).length ? groupQrRowsByCollaboratorDay(payload.rows, payload.event?.date).map((group) => (
              <tr key={group.key}>
                <td data-label="Colaborador">
                  <strong>{group.rows[0].collaboratorName}</strong>
                  <small>{formatTaskDate(group.rows[0].assignmentDate)}</small>
                </td>
                <td data-label="Serviços / Picagens">
                  <div className="communication-qr-services">
                    {[...group.rows].sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')) || a.assignmentId - b.assignmentId).map((row) => (
                      <div className="communication-qr-service" key={row.assignmentId}>
                        <div className="communication-qr-service__header">
                          <span className="communication-qr-service__schedule"><Clock3 size={15} aria-hidden="true" />{[row.startTime, row.endTime].filter(Boolean).join(' → ') || 'Sem horário'}</span>
                          <Badge tone={qrStateTones[row.state?.key] || 'neutral'}>{row.state?.label || 'QR Gerado'}</Badge>
                        </div>
                        <small>{row.role || 'Sem função'}</small>
                        <small>Entrada: {row.checkIn || '-'} · Saída: {row.checkOut || '-'}</small>
                      </div>
                    ))}
                  </div>
                </td>
                <td data-label="Ações">
                  <CommunicationQrActions row={group.rows[0]} tools={qrTools} compact />
                </td>
              </tr>
            )) : (
              <tr><td colSpan="3">Sem serviços dentro da janela de 24 horas.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <CommunicationPagination payload={payload} page={page} pageSize={pageSize} loading={loading} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />

    </section>
  );
}

function ReminderQrTools({ task, tools }) {
  const { data, loading, error, reload } = useCommunicationData(`/qr-codes/assignments/${task.assignmentId}`, { poll: true });
  return (
    <div className="communication-reminder-qr" aria-label="Picagem do colaborador" aria-busy={loading}>
      <CommunicationQrActions row={data} tools={tools} />
      {error && <p className="notice">{error} <button type="button" className="icon-button" title="Tentar novamente" onClick={() => reload()}><RefreshCw size={16} /></button></p>}
    </div>
  );
}

function CommunicationTaskPreview({ task, mobile, canManageQrCodes, qrTools, onMessageChange, onCopy, onWhatsapp, onLog, whatsappEnabled, saving }) {
  const [messageOpen, setMessageOpen] = useState(false);
  const qrActions = canManageQrCodes && task.kind === 'reminder_24h'
    ? <ReminderQrTools key={task.assignmentId} task={task} tools={qrTools} />
    : null;
  const messageId = `communication-message-${task.id}`;

  return (
    <>
      {mobile ? (
        <div className="communication-inline-tools">
          <button type="button" className="secondary-button" aria-expanded={messageOpen} aria-controls={messageId} onClick={() => setMessageOpen((open) => !open)}>
            <MessageSquareText size={18} /> Mensagem
          </button>
          {qrActions}
        </div>
      ) : (
        <header>
          <div>
            <span>{kindLabels[task.kind] || task.kind}</span>
            <h2>{task.collaboratorName}</h2>
            <p>{task.eventName} · {formatTaskDate(task.date)}</p>
          </div>
          <Badge tone={stateTones[task.state] || 'neutral'}>{stateLabels[task.state] || task.state}</Badge>
        </header>
      )}

      <div id={messageId} className="communication-message-content" hidden={mobile && !messageOpen}>
        <dl className="communication-detail-grid">
          <div><dt>Cliente</dt><dd>{task.clientName}</dd></div>
          <div><dt>Função</dt><dd>{task.role || '-'}</dd></div>
          <div><dt>Horário</dt><dd>{[task.startTime, task.endTime].filter(Boolean).join(' → ') || '-'}</dd></div>
          <div><dt>Telefone</dt><dd>{task.rawPhone || '-'}</dd></div>
        </dl>

        <label className="communication-message-box">
          <span>Mensagem editável</span>
          <textarea value={task.message} onChange={(event) => onMessageChange(task.id, event.target.value)} rows={10} />
        </label>

        {!mobile && qrActions}

        <div className="communication-action-grid">
          <button type="button" className="secondary-button" onClick={() => onCopy(task)}><Copy size={16} /> Copiar</button>
          <button type="button" className="secondary-button" onClick={() => onWhatsapp(task)} disabled={!task.whatsappUrl || !whatsappEnabled}>
            <ExternalLink size={16} /> Abrir WhatsApp
          </button>
          <button type="button" className="secondary-button" onClick={() => onLog(task, 'sent', { sentAt: new Date().toISOString() })} disabled={saving}>
            <Send size={16} /> Marcar enviado
          </button>
          <button type="button" className="secondary-button" onClick={() => onLog(task, 'responded', { respondedAt: new Date().toISOString() })} disabled={saving}>
            <Phone size={16} /> Respondeu
          </button>
          <button type="button" className="command-button" onClick={() => onLog(task, 'confirmed', { respondedAt: new Date().toISOString(), response: 'Confirmado manualmente' })} disabled={saving}>
            <CheckCircle2 size={16} /> Confirmado
          </button>
          <button type="button" className="secondary-button secondary-button--danger" onClick={() => onLog(task, 'unavailable', { respondedAt: new Date().toISOString(), response: 'Não disponível' })} disabled={saving}>
            <UserX size={16} /> Não disponível
          </button>
        </div>
      </div>
    </>
  );
}

function useMobileCommunication() {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)');
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}

export default function Communication() {
  const { user } = useAuth();
  const qrTools = useCommunicationQrTools();
  const mobile = useMobileCommunication();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [stateFilter, setStateFilter] = useState('open');
  const [kindFilter, setKindFilter] = useState('all');
  const [eventFilter, setEventFilter] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const expansionAnchor = useRef(null);
  const [messageDrafts, setMessageDrafts] = useState({});
  const [whatsappOverrides, setWhatsappOverrides] = useState({});
  const [updatingWhatsappId, setUpdatingWhatsappId] = useState(null);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('messages');
  const canManageQrCodes = hasPermission(user, PERMISSIONS.COMMUNICATION_MANAGE_QR_CODES);
  const query = new window.URLSearchParams({ page: String(page), pageSize: String(pageSize), search: debouncedSearch, state: stateFilter, kind: kindFilter, eventId: eventFilter }).toString();
  const { data: payload, previousData, loading, error, reload } = useCommunicationData(
    activeTab === 'messages' ? `/communication/tasks?${query}` : null,
    { poll: true },
  );

  useEffect(() => {
    if (search === debouncedSearch) return undefined;
    const timer = window.setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [search, debouncedSearch]);

  const tasks = payload?.items || [];
  const summary = (payload || previousData)?.summary || communicationSummary([]);
  const eventOptions = (payload || previousData)?.events || [];
  const selectedTask = mobile
    ? tasks.find((task) => task.id === expandedId) || null
    : tasks.find((task) => task.id === selectedId) || tasks[0] || null;

  const selectedTaskWithDraft = withCommunicationMessageDraft(selectedTask, messageDrafts);

  useEffect(() => {
    if (selectedTask && selectedTask.id !== selectedId) {
      setSelectedId(selectedTask.id);
    }
  }, [selectedId, selectedTask]);

  useEffect(() => { setExpandedId(''); }, [query, activeTab, mobile]);

  useLayoutEffect(() => {
    const anchor = expansionAnchor.current;
    expansionAnchor.current = null;
    if (!anchor?.button.isConnected) return;
    // Collapsing an earlier row must not move the newly tapped row out of view.
    const offset = anchor.button.getBoundingClientRect().top - anchor.top;
    if (Math.abs(offset) > 1) window.scrollBy({ top: offset, behavior: 'instant' });
  }, [expandedId]);

  useEffect(() => {
    if (payload && !payload.items.some((task) => task.id === expandedId)) setExpandedId('');
  }, [payload, expandedId]);

  function updateSelectedMessage(taskId, value) {
    setMessageDrafts((current) => ({
      ...current,
      [taskId]: value,
    }));
  }

  async function copyMessage(task) {
    if (!task) return;
    try {
      await window.navigator.clipboard.writeText(task.message);
      setNotice('Mensagem copiada.');
    } catch {
      window.prompt('Copiar mensagem:', task.message);
      setNotice('Copia a mensagem da janela aberta pelo browser.');
    }
  }

  async function createLog(task, status, extra = {}) {
    if (!task) return;
    setSaving(true);
    setNotice('');
    try {
      await api('/communication-logs', {
        method: 'POST',
        body: JSON.stringify({
          eventId: task.serviceId,
          assignmentId: task.assignmentId,
          collaboratorId: task.collaboratorId,
          type: task.kind,
          channel: 'manual_whatsapp',
          status,
          message: task.message,
          ...extra,
        }),
      });

      if (status === 'confirmed') {
        await api(`/assignments/${task.assignmentId}`, {
          method: 'PUT',
          body: JSON.stringify({ status: 'confirmed' }),
        });
      }

      reload();
      setNotice(status === 'confirmed' ? 'Colaborador marcado como confirmado.' : 'Estado atualizado.');
    } catch (error) {
      setNotice(error.message || 'Não foi possível atualizar o estado.');
    } finally {
      setSaving(false);
    }
  }

  function openWhatsapp(task) {
    if (!task?.whatsappUrl || !whatsappEnabledFor(task)) return;
    window.open(task.whatsappUrl, '_blank', 'noopener,noreferrer');
  }

  function whatsappEnabledFor(task) {
    if (!task) return false;
    return whatsappOverrides[task.assignmentId] ?? task.whatsappEnabled !== false;
  }

  async function updateWhatsappPreference(task, enabled) {
    if (!task?.assignmentId) return;
    const assignmentId = task.assignmentId;
    const previous = whatsappEnabledFor(task);
    setWhatsappOverrides((current) => ({ ...current, [assignmentId]: enabled }));
    setUpdatingWhatsappId(assignmentId);
    setNotice('');
    try {
      await api(`/assignments/${assignmentId}`, {
        method: 'PUT',
        body: JSON.stringify({ whatsappEnabled: enabled }),
      });
      reload();
    } catch (error) {
      setWhatsappOverrides((current) => ({ ...current, [assignmentId]: previous }));
      setNotice(error.message || 'Não foi possível guardar a preferência de WhatsApp.');
    } finally {
      setUpdatingWhatsappId(null);
    }
  }

  const taskPreview = selectedTaskWithDraft ? (
    <CommunicationTaskPreview
      key={selectedTaskWithDraft.id}
      task={selectedTaskWithDraft}
      mobile={mobile}
      canManageQrCodes={canManageQrCodes}
      qrTools={qrTools}
      onMessageChange={updateSelectedMessage}
      onCopy={copyMessage}
      onWhatsapp={openWhatsapp}
      onLog={createLog}
      whatsappEnabled={whatsappEnabledFor(selectedTaskWithDraft)}
      saving={saving}
    />
  ) : null;

  return (
    <div className="page communication-page">
      <div className="communication-head">
        <div>
          <h1>Comunicação</h1>
          <p>Confirmações manuais e lembretes WhatsApp automáticos dos serviços confirmados.</p>
        </div>
      </div>

      {error ? <p className="notice">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}

      <nav className="communication-tabs" aria-label="Áreas de comunicação">
        <button type="button" className={activeTab === 'messages' ? 'active' : ''} onClick={() => setActiveTab('messages')}>
          <MessageSquareText size={16} /> Mensagens
        </button>
        <button type="button" className={activeTab === 'qr' ? 'active' : ''} onClick={() => setActiveTab('qr')}>
          <QrCode size={16} /> QR Codes / Link
        </button>
      </nav>
      {!qrTools.selected && <span className="communication-copy-notice" role="status" aria-live="polite">{qrTools.notice}</span>}
      <CommunicationQrDialog tools={qrTools} />

      {activeTab === 'qr' ? (
        <QrCodesPanel canManageQrCodes={canManageQrCodes} qrTools={qrTools} />
      ) : (
        <>

      <section className="communication-summary-grid" aria-label="Resumo de comunicação">
        <SummaryCard icon={MessageSquareText} label="Total em lista" value={summary.total} />
        <SummaryCard icon={Clock3} label="Agendados" value={summary.scheduled} />
        <SummaryCard icon={Clock3} label="Por contactar" value={summary.pendingContact} tone="warning" />
        <SummaryCard icon={Send} label="Aceites pela Meta" value={summary.accepted + summary.sent} tone="info" />
        <SummaryCard icon={CheckCircle2} label="Entregues" value={summary.delivered} tone="success" />
        <SummaryCard icon={UserCheck} label="Confirmados" value={summary.confirmed} tone="success" />
      </section>

      <section className="communication-filters" aria-label="Filtros de comunicação">
        <label className="communication-search">
          <Search size={16} />
          <input
            value={search}
            placeholder="Pesquisar colaborador, evento, função ou telefone"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select aria-label="Estado da comunicação" value={stateFilter} onChange={(event) => { setStateFilter(event.target.value); setPage(1); }}>
          <option value="open">Apenas por resolver</option>
          <option value="all">Todos os estados</option>
          <option value="pending_contact">Por contactar</option>
          <option value="scheduled">Agendado</option>
          <option value="ready">Pronto</option>
          <option value="sending">A enviar</option>
          <option value="accepted">Aceite pela Meta</option>
          <option value="sent">Enviado pela Meta</option>
          <option value="delivered">Entregue</option>
          <option value="read">Lido</option>
          <option value="failed">Falhou</option>
          <option value="responded">Respondeu</option>
          <option value="confirmed">Confirmado</option>
          <option value="unavailable">Não disponível</option>
        </select>
        <select aria-label="Tipo de mensagem" value={kindFilter} onChange={(event) => { setKindFilter(event.target.value); setPage(1); }}>
          <option value="all">Todos os tipos</option>
          <option value="confirmation">Confirmações</option>
          <option value="reminder_24h">Lembretes 24h</option>
        </select>
        <select aria-label="Evento da comunicação" value={eventFilter} onChange={(event) => { setEventFilter(event.target.value); setPage(1); }}>
          <option value="all">Todos os eventos</option>
          {eventOptions.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select>
      </section>

      <section className="communication-workspace">
        <div className="communication-list" aria-label="Lista de contactos">
          {tasks.length ? tasks.map((task) => {
            const whatsappEnabled = whatsappEnabledFor(task);
            const expanded = mobile && expandedId === task.id;
            const panelId = `communication-contact-${task.id}`;
            return (
              <div
                key={task.id}
                className={`communication-task-row ${selectedTask?.id === task.id ? 'communication-task-row--active' : ''}`}
              >
                <label
                  className="communication-whatsapp-toggle"
                  title={whatsappEnabled ? 'Enviar lembrete WhatsApp automaticamente' : 'Não enviar lembrete WhatsApp'}
                >
                  <input
                    type="checkbox"
                    checked={whatsappEnabled}
                    disabled={updatingWhatsappId === task.assignmentId}
                    aria-label={`Enviar mensagem WhatsApp a ${task.collaboratorName}`}
                    onChange={(event) => updateWhatsappPreference(task, event.target.checked)}
                  />
                </label>
                <button
                  type="button"
                  className="communication-task"
                  id={`${panelId}-toggle`}
                  aria-expanded={mobile ? expanded : undefined}
                  aria-controls={mobile ? panelId : undefined}
                  onClick={(event) => {
                    if (mobile && expandedId && expandedId !== task.id) {
                      expansionAnchor.current = { button: event.currentTarget, top: event.currentTarget.getBoundingClientRect().top };
                    }
                    setSelectedId(task.id);
                    if (mobile) setExpandedId((current) => current === task.id ? '' : task.id);
                  }}
                >
                  <span>
                    <strong>{task.collaboratorName}</strong>
                    <small>{task.role || 'Sem função'} · {task.rawPhone || 'Sem telefone'}</small>
                  </span>
                  <span>
                    <b>{task.eventName}</b>
                    <small>{task.clientName} · {formatTaskDate(task.date)} · {[task.startTime, task.endTime].filter(Boolean).join(' → ')}</small>
                  </span>
                  <Badge tone={stateTones[task.state] || 'neutral'}>{stateLabels[task.state] || task.state}</Badge>
                  {mobile && <ChevronDown size={18} className="communication-task-chevron" aria-hidden="true" />}
                </button>
                {expanded && (
                  <section id={panelId} className="communication-preview communication-preview--inline" aria-labelledby={`${panelId}-toggle`}>
                    {taskPreview}
                  </section>
                )}
              </div>
            );
          }) : (
            <EmptyState
              compact
              icon={loading ? Clock3 : MessageSquareText}
              title={loading ? 'A carregar contactos' : 'Sem contactos para estes filtros'}
              description={loading ? 'A preparar a lista de comunicação.' : 'Altera os filtros ou confirma se existem colaboradores atribuídos aos eventos.'}
            />
          )}
        </div>

        {!mobile && <aside className="communication-preview">
          {taskPreview || (
            <EmptyState
              icon={MessageSquareText}
              title="Seleciona um contacto"
              description="Escolhe um colaborador na lista para copiar a mensagem, abrir WhatsApp ou registar o estado."
            />
          )}
        </aside>}
      </section>
      <CommunicationPagination payload={payload} page={page} pageSize={pageSize} loading={loading} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
        </>
      )}
    </div>
  );
}
