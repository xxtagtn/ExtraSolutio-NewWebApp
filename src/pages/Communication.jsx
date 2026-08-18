import {
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  Eye,
  ExternalLink,
  MessageSquareText,
  Phone,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  Send,
  UserCheck,
  UserX,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Badge from '../components/UI/Badge.jsx';
import EmptyState from '../components/UI/EmptyState.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../utils/api.js';
import { hasPermission, PERMISSIONS } from '../utils/accessPermissions.js';
import { buildCommunicationCenter, communicationSummary } from '../utils/communicationCenter.js';
import { withCommunicationMessageDraft } from '../utils/communicationMessageDrafts.js';
import { date } from '../utils/formatters.js';

const stateLabels = {
  scheduled: 'Agendado',
  pending_contact: 'Por contactar',
  ready: 'Pronto',
  prepared: 'Preparado',
  sending: 'A enviar',
  sent: 'Enviado',
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
  sent: 'info',
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

function taskMatchesSearch(task, search) {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return [
    task.collaboratorName,
    task.eventName,
    task.clientName,
    task.role,
    task.rawPhone,
    task.phone,
  ].join(' ').toLowerCase().includes(q);
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

function QrCodesPanel({ services, canManageQrCodes }) {
  const eventOptions = useMemo(() => (Array.isArray(services) ? services : [])
    .filter((service) => (service.assignments || []).some((assignment) => assignment.collaboratorId))
    .map((service) => ({
      id: String(service.id),
      name: service.name,
      clientName: service.client?.name || service.clientName || '',
      date: service.date,
    }))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || a.name.localeCompare(b.name, 'pt')), [services]);

  const [eventId, setEventId] = useState('');
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedQr, setSelectedQr] = useState(null);
  const [qrImage, setQrImage] = useState('');

  useEffect(() => {
    if (!eventId && eventOptions[0]?.id) setEventId(eventOptions[0].id);
  }, [eventId, eventOptions]);

  const loadQrCodes = useCallback(async ({ background = false } = {}) => {
    if (!eventId || !canManageQrCodes) return;
    if (!background) setLoading(true);
    setError('');
    try {
      setPayload(await api(`/qr-codes/events/${eventId}`));
    } catch (err) {
      setError(err.message || 'Não foi possível carregar os QR Codes.');
    } finally {
      if (!background) setLoading(false);
    }
  }, [canManageQrCodes, eventId]);

  useEffect(() => {
    loadQrCodes();
  }, [loadQrCodes]);

  useEffect(() => {
    if (!eventId || !canManageQrCodes) return undefined;
    const timer = window.setInterval(() => loadQrCodes({ background: true }), 15000);
    return () => window.clearInterval(timer);
  }, [canManageQrCodes, eventId, loadQrCodes]);

  async function qrDataUrl(row) {
    return QRCode.toDataURL(row.qrUrl, {
      width: 900,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#041012',
        light: '#ffffff',
      },
    });
  }

  async function openQr(row) {
    setSelectedQr(row);
    setQrImage(await qrDataUrl(row));
  }

  async function downloadQr(row) {
    const dataUrl = await qrDataUrl(row);
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `qr-${row.collaboratorName || 'colaborador'}-${row.assignmentId}.png`;
    link.click();
  }

  async function printQr(row) {
    const dataUrl = await qrDataUrl(row);
    const printWindow = window.open('', '_blank', 'noopener,noreferrer');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>QR Code - ${row.collaboratorName}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 32px; color: #111; }
            .card { max-width: 420px; margin: 0 auto; text-align: center; border: 1px solid #ddd; border-radius: 14px; padding: 24px; }
            img { width: 280px; height: 280px; }
            h1 { font-size: 22px; margin: 16px 0 8px; }
            p { margin: 4px 0; color: #444; }
          </style>
        </head>
        <body>
          <div class="card">
            <img src="${dataUrl}" alt="QR Code" />
            <h1>${row.collaboratorName}</h1>
            <p>${payload?.event?.name || ''}</p>
            <p>${formatTaskDate(row.assignmentDate)} · ${row.role || ''}</p>
          </div>
          <script>window.onload = () => { window.print(); window.close(); };</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

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
          <select value={eventId} onChange={(event) => setEventId(event.target.value)}>
            {eventOptions.length ? eventOptions.map((item) => (
              <option key={item.id} value={item.id}>{item.name} · {item.clientName}</option>
            )) : <option value="">Sem eventos com colaboradores</option>}
          </select>
        </label>
        <button type="button" className="secondary-button" onClick={() => loadQrCodes()} disabled={!eventId || loading}>
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>

      {error ? <p className="notice">{error}</p> : null}

      <div className="communication-qr-summary">
        <article>
          <small>Evento</small>
          <strong>{payload?.event?.name || 'Seleciona um evento'}</strong>
          <span>{payload?.event?.clientName || ''}</span>
        </article>
        <article>
          <small>QR gerados</small>
          <strong>{payload?.rows?.length || 0}</strong>
          <span>colaboradores atribuídos</span>
        </article>
        <article>
          <small>Entradas</small>
          <strong>{(payload?.rows || []).filter((row) => row.checkIn).length}</strong>
          <span>registadas</span>
        </article>
        <article>
          <small>Concluídos</small>
          <strong>{(payload?.rows || []).filter((row) => row.checkIn && row.checkOut).length}</strong>
          <span>com entrada e saída</span>
        </article>
      </div>

      <div className="communication-qr-table-wrap">
        <table className="data-table communication-qr-table">
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Estado</th>
              <th>Entrada</th>
              <th>Saída</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="5">A carregar QR Codes...</td></tr>
            ) : (payload?.rows || []).length ? payload.rows.map((row) => (
              <tr key={row.assignmentId}>
                <td data-label="Colaborador">
                  <strong>{row.collaboratorName}</strong>
                  <small>{row.role || 'Sem função'} · {formatTaskDate(row.assignmentDate)}</small>
                </td>
                <td data-label="Estado"><Badge tone={qrStateTones[row.state?.key] || 'neutral'}>{row.state?.label || 'QR Gerado'}</Badge></td>
                <td data-label="Entrada">{row.checkIn || '-'}</td>
                <td data-label="Saída">{row.checkOut || '-'}</td>
                <td data-label="Ações">
                  <div className="communication-qr-actions">
                    <button type="button" className="icon-button" title="Ver QR" onClick={() => openQr(row)}><Eye size={16} /></button>
                    <button type="button" className="icon-button" title="Imprimir" onClick={() => printQr(row)}><Printer size={16} /></button>
                    <button type="button" className="icon-button" title="Download" onClick={() => downloadQr(row)}><Download size={16} /></button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr><td colSpan="5">Sem colaboradores atribuídos neste evento.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedQr ? (
        <div className="qr-modal-backdrop" role="presentation" onClick={() => setSelectedQr(null)}>
          <section className="qr-modal" role="dialog" aria-modal="true" aria-label="QR Code" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="icon-button qr-modal-close" onClick={() => setSelectedQr(null)}>×</button>
            <h2>{selectedQr.collaboratorName}</h2>
            <p>{payload?.event?.name} · {formatTaskDate(selectedQr.assignmentDate)}</p>
            {qrImage ? <img src={qrImage} alt={`QR Code de ${selectedQr.collaboratorName}`} /> : null}
            <code>{selectedQr.qrUrl}</code>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => printQr(selectedQr)}><Printer size={16} /> Imprimir</button>
              <button type="button" className="command-button" onClick={() => downloadQr(selectedQr)}><Download size={16} /> Download</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

export default function Communication() {
  const { user } = useAuth();
  const { data: services, loading: loadingServices, error: servicesError, reload: reloadServices } = useApi('/services', []);
  const {
    data: communicationLogs,
    loading: loadingLogs,
    error: logsError,
    reload: reloadLogs,
  } = useApi('/communication-logs', []);

  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('open');
  const [kindFilter, setKindFilter] = useState('all');
  const [eventFilter, setEventFilter] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [messageDrafts, setMessageDrafts] = useState({});
  const [whatsappOverrides, setWhatsappOverrides] = useState({});
  const [updatingWhatsappId, setUpdatingWhatsappId] = useState(null);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('messages');
  const canManageQrCodes = hasPermission(user, PERMISSIONS.COMMUNICATION_MANAGE_QR_CODES);

  const tasks = useMemo(
    () => buildCommunicationCenter({ services, communicationLogs }),
    [communicationLogs, services],
  );

  const summary = useMemo(() => communicationSummary(tasks), [tasks]);

  const eventOptions = useMemo(() => {
    const options = new Map();
    for (const task of tasks) {
      if (task.serviceId) options.set(String(task.serviceId), task.eventName);
    }
    return [...options.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt'));
  }, [tasks]);

  const filteredTasks = useMemo(() => tasks.filter((task) => {
    if (!taskMatchesSearch(task, search)) return false;
    if (kindFilter !== 'all' && task.kind !== kindFilter) return false;
    if (eventFilter !== 'all' && String(task.serviceId) !== eventFilter) return false;
    if (stateFilter === 'open') return !['confirmed', 'unavailable'].includes(task.state);
    if (stateFilter !== 'all') return task.state === stateFilter;
    return true;
  }), [eventFilter, kindFilter, search, stateFilter, tasks]);

  const selectedTask = useMemo(() => (
    filteredTasks.find((task) => task.id === selectedId) || filteredTasks[0] || null
  ), [filteredTasks, selectedId]);

  const selectedTaskWithDraft = useMemo(
    () => withCommunicationMessageDraft(selectedTask, messageDrafts),
    [messageDrafts, selectedTask],
  );

  useEffect(() => {
    if (selectedTask && selectedTask.id !== selectedId) {
      setSelectedId(selectedTask.id);
    }
  }, [selectedId, selectedTask]);

  function updateSelectedMessage(value) {
    if (!selectedTask) return;
    setMessageDrafts((current) => ({
      ...current,
      [selectedTask.id]: value,
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
        reloadServices();
      }

      reloadLogs();
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
      reloadServices();
    } catch (error) {
      setWhatsappOverrides((current) => ({ ...current, [assignmentId]: previous }));
      setNotice(error.message || 'Não foi possível guardar a preferência de WhatsApp.');
    } finally {
      setUpdatingWhatsappId(null);
    }
  }

  const loading = loadingServices || loadingLogs;
  const error = servicesError || logsError;

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
          <QrCode size={16} /> QR Codes
        </button>
      </nav>

      {activeTab === 'qr' ? (
        <QrCodesPanel services={services} canManageQrCodes={canManageQrCodes} />
      ) : (
        <>

      <section className="communication-summary-grid" aria-label="Resumo de comunicação">
        <SummaryCard icon={MessageSquareText} label="Total em lista" value={summary.total} />
        <SummaryCard icon={Clock3} label="Agendados" value={summary.scheduled} />
        <SummaryCard icon={Clock3} label="Por contactar" value={summary.pendingContact} tone="warning" />
        <SummaryCard icon={Send} label="Enviados" value={summary.sent} tone="info" />
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
        <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
          <option value="open">Apenas por resolver</option>
          <option value="all">Todos os estados</option>
          <option value="pending_contact">Por contactar</option>
          <option value="scheduled">Agendado</option>
          <option value="ready">Pronto</option>
          <option value="sending">A enviar</option>
          <option value="sent">Enviado</option>
          <option value="failed">Falhou</option>
          <option value="responded">Respondeu</option>
          <option value="confirmed">Confirmado</option>
          <option value="unavailable">Não disponível</option>
        </select>
        <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
          <option value="all">Todos os tipos</option>
          <option value="confirmation">Confirmações</option>
          <option value="reminder_24h">Lembretes 24h</option>
        </select>
        <select value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}>
          <option value="all">Todos os eventos</option>
          {eventOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </section>

      <section className="communication-workspace">
        <div className="communication-list" aria-label="Lista de contactos">
          {filteredTasks.length ? filteredTasks.map((task) => {
            const whatsappEnabled = whatsappEnabledFor(task);
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
                  onClick={() => setSelectedId(task.id)}
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
                </button>
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

        <aside className="communication-preview">
          {selectedTaskWithDraft ? (
            <>
              <header>
                <div>
                  <span>{kindLabels[selectedTaskWithDraft.kind] || selectedTaskWithDraft.kind}</span>
                  <h2>{selectedTaskWithDraft.collaboratorName}</h2>
                  <p>{selectedTaskWithDraft.eventName} · {formatTaskDate(selectedTaskWithDraft.date)}</p>
                </div>
                <Badge tone={stateTones[selectedTaskWithDraft.state] || 'neutral'}>
                  {stateLabels[selectedTaskWithDraft.state] || selectedTaskWithDraft.state}
                </Badge>
              </header>

              <dl className="communication-detail-grid">
                <div>
                  <dt>Cliente</dt>
                  <dd>{selectedTaskWithDraft.clientName}</dd>
                </div>
                <div>
                  <dt>Função</dt>
                  <dd>{selectedTaskWithDraft.role || '-'}</dd>
                </div>
                <div>
                  <dt>Horário</dt>
                  <dd>{[selectedTaskWithDraft.startTime, selectedTaskWithDraft.endTime].filter(Boolean).join(' → ') || '-'}</dd>
                </div>
                <div>
                  <dt>Telefone</dt>
                  <dd>{selectedTaskWithDraft.rawPhone || '-'}</dd>
                </div>
              </dl>

              <label className="communication-message-box">
                <span>Mensagem editável</span>
                <textarea
                  value={selectedTaskWithDraft.message}
                  onChange={(event) => updateSelectedMessage(event.target.value)}
                  rows={10}
                />
              </label>

              <div className="communication-action-grid">
                <button type="button" className="secondary-button" onClick={() => copyMessage(selectedTaskWithDraft)}>
                  <Copy size={16} /> Copiar
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => openWhatsapp(selectedTaskWithDraft)}
                  disabled={!selectedTaskWithDraft.whatsappUrl || !whatsappEnabledFor(selectedTaskWithDraft)}
                >
                  <ExternalLink size={16} /> Abrir WhatsApp
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => createLog(selectedTaskWithDraft, 'sent', { sentAt: new Date().toISOString() })}
                  disabled={saving}
                >
                  <Send size={16} /> Marcar enviado
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => createLog(selectedTaskWithDraft, 'responded', { respondedAt: new Date().toISOString() })}
                  disabled={saving}
                >
                  <Phone size={16} /> Respondeu
                </button>
                <button
                  type="button"
                  className="command-button"
                  onClick={() => createLog(selectedTaskWithDraft, 'confirmed', { respondedAt: new Date().toISOString(), response: 'Confirmado manualmente' })}
                  disabled={saving}
                >
                  <CheckCircle2 size={16} /> Confirmado
                </button>
                <button
                  type="button"
                  className="secondary-button secondary-button--danger"
                  onClick={() => createLog(selectedTaskWithDraft, 'unavailable', { respondedAt: new Date().toISOString(), response: 'Não disponível' })}
                  disabled={saving}
                >
                  <UserX size={16} /> Não disponível
                </button>
              </div>
            </>
          ) : (
            <EmptyState
              icon={MessageSquareText}
              title="Seleciona um contacto"
              description="Escolhe um colaborador na lista para copiar a mensagem, abrir WhatsApp ou registar o estado."
            />
          )}
        </aside>
      </section>
        </>
      )}
    </div>
  );
}
