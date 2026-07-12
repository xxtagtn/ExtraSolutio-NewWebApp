import {
  ArrowLeft,
  CalendarClock,
  CarFront,
  CheckCircle2,
  ClipboardList,
  Clock,
  Edit3,
  Euro,
  FileClock,
  History,
  MapPin,
  Plus,
  Save,
  Trash2,
  Users,
  WalletCards,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Badge from '../components/UI/Badge.jsx';
import Card from '../components/UI/Card.jsx';
import EmptyState from '../components/UI/EmptyState.jsx';
import TimeInput from '../components/UI/TimeInput.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../utils/api.js';
import { filterCollaboratorOptions } from '../utils/collaboratorSearch.js';
import { serviceDetailTabFromQuery } from '../utils/deepLinks.js';
import { date, durationHours, money } from '../utils/formatters.js';
import {
  assignmentWorkDate,
  buildEditableTeamRows,
  createManualTeamRow,
  dateKey,
  editableTeamRowsToAssignmentDrafts,
  editableTeamRowsToAssignmentPayloads,
  groupAssignmentsByRole,
  MANUAL_TEAM_ROLE,
  resolveSelectedTeamDay,
  safeJsonArray,
  serviceAssignmentDays,
  serviceChecklist,
  serviceDetailMetrics,
} from '../utils/serviceDetail.js';
import {
  statusLabel,
} from '../utils/serviceStatus.js';

const tabs = [
  { id: 'summary', label: 'Resumo', icon: ClipboardList },
  { id: 'team', label: 'Colaboradores', icon: Users },
  { id: 'validation', label: 'Validação', icon: CheckCircle2 },
  { id: 'costs', label: 'Custos', icon: Euro },
  { id: 'history', label: 'Histórico', icon: History },
];

function parseNumber(value) {
  const parsed = Number(String(value ?? 0).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '-' : date.format(parsed);
}

function formatDateRange(service) {
  if (!service?.date) return '-';
  const start = formatDate(service.date);
  const endValue = service.isContinuous && service.endDate ? service.endDate : service.date;
  const end = formatDate(endValue);
  return dateKey(service.date) === dateKey(endValue) ? start : `${start} - ${end}`;
}

function fieldValue(value) {
  return value || '-';
}

function collaboratorHasRole(collaborator, role) {
  if (!role || role === MANUAL_TEAM_ROLE) return true;
  const roles = Array.isArray(collaborator?.roles) ? collaborator.roles : [];
  return roles.includes(role) || String(collaborator?.category || '') === String(role);
}

function collaboratorOptionLabel(collaborator) {
  return `${collaborator.shortName || collaborator.name || `Colaborador ${collaborator.id}`} | ${collaborator.nif || '-'}`;
}

function timeToMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return (hours * 60) + minutes;
}

function rowDurationHours(row, service) {
  const start = timeToMinutes(row.plannedCheckIn || row.checkIn || service?.startTime);
  const end = timeToMinutes(row.plannedCheckOut || row.checkOut || service?.endTime);
  if (start === null || end === null) return 0;
  const minutes = end >= start ? end - start : (24 * 60) - start + end;
  return minutes / 60;
}

function rowInitials(row) {
  const value = String(row?.collaborator?.shortName || row?.collaborator?.name || '').trim();
  if (!value) return '?';
  return value.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function rowDisplayName(row, collaborators) {
  return row.collaborator?.shortName
    || row.collaborator?.name
    || collaborators.find((item) => String(item.id) === String(row.collaboratorId))?.shortName
    || collaborators.find((item) => String(item.id) === String(row.collaboratorId))?.name
    || 'Colaborador por atribuir';
}

function CollaboratorAvatar({ row }) {
  return (
    <span className="service-detail-person-avatar" aria-hidden="true">
      {rowInitials(row)}
    </span>
  );
}

function InfoItem({ label, value }) {
  return (
    <div className="service-detail-info-item">
      <span>{label}</span>
      <strong>{value || '-'}</strong>
    </div>
  );
}

function ProgressStat({ label, value, detail, tone = 'neutral' }) {
  return (
    <div className={`service-detail-progress service-detail-progress--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export default function ServiceDetail() {
  const { serviceId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: services, loading, error, reload } = useApi('/services', []);
  const { data: collaborators } = useApi('/collaborators?light=1', []);
  const [activeTab, setActiveTab] = useState('summary');
  const [teamRows, setTeamRows] = useState([]);
  const [savingTeam, setSavingTeam] = useState(false);
  const [teamError, setTeamError] = useState('');
  const [billingDraft, setBillingDraft] = useState({
    billingStatus: 'pending',
    signaledAmount: '',
    signaledAt: '',
    remainingPaymentDate: '',
  });
  const [savingBilling, setSavingBilling] = useState(false);
  const [billingError, setBillingError] = useState('');
  const service = useMemo(
    () => services.find((item) => String(item.id) === String(serviceId)),
    [serviceId, services],
  );
  const metrics = useMemo(() => serviceDetailMetrics(service || {}), [service]);
  const checklist = useMemo(() => serviceChecklist(service || {}), [service]);
  const displayAssignments = useMemo(
    () => (teamRows.length || service ? teamRows : []),
    [service, teamRows],
  );
  const days = useMemo(() => serviceAssignmentDays({ ...(service || {}), assignments: displayAssignments }), [displayAssignments, service]);
  const [selectedDay, setSelectedDay] = useState('');
  const [activeTeamCollaboratorPickerKey, setActiveTeamCollaboratorPickerKey] = useState(null);
  const [teamCollaboratorPickerPlacement, setTeamCollaboratorPickerPlacement] = useState(null);
  const teamCollaboratorSearchRef = useRef(null);
  const currentDay = selectedDay && days.includes(selectedDay) ? selectedDay : days[0] || '';
  const assignmentGroups = useMemo(
    () => groupAssignmentsByRole(displayAssignments, service || {}, currentDay),
    [currentDay, displayAssignments, service],
  );
  const teamTotals = useMemo(() => {
    const rows = assignmentGroups.flatMap((group) => group.rows);
    const assignedRows = rows.filter((row) => row.collaboratorId);
    const billableRows = assignedRows.filter((row) => !['missed_justified', 'missed_unjustified', 'cancelled'].includes(String(row.status || '').toLowerCase()));
    const hours = billableRows.reduce((sum, row) => sum + rowDurationHours(row, service), 0);
    const amount = billableRows.reduce((sum, row) => sum + (rowDurationHours(row, service) * parseNumber(row.hourlyRate || row.collaborator?.hourlyRate)), 0);
    return {
      collaborators: assignedRows.length,
      hours,
      amount,
    };
  }, [assignmentGroups, service]);
  const externalCosts = useMemo(() => safeJsonArray(service?.externalCosts), [service]);
  const totalRevenue = parseNumber(service?.totalRevenue);
  const totalCost = parseNumber(service?.totalCost);
  const travelAmount = service?.travelExpenseEnabled ? parseNumber(service.travelExpenseAmount) : 0;
  const profit = totalRevenue - totalCost;
  const signalAmount = Math.min(totalRevenue, Math.max(0, parseNumber(billingDraft.signaledAmount)));
  const clientPaidAmount = billingDraft.billingStatus === 'paid'
    ? totalRevenue
    : billingDraft.billingStatus === 'partial70'
      ? signalAmount
      : 0;
  const clientRemainingAmount = Math.max(0, totalRevenue - clientPaidAmount);
  const activeCollaborators = useMemo(
    () => (collaborators || [])
      .filter((collaborator) => collaborator.status !== 'inactive')
      .sort((a, b) => String(a.shortName || a.name || '').localeCompare(String(b.shortName || b.name || ''), 'pt')),
    [collaborators],
  );

  useEffect(() => {
    const requestedTab = serviceDetailTabFromQuery(searchParams.get('tab'));
    if (!requestedTab) return;
    setActiveTab(requestedTab);
    const nextParams = new window.URLSearchParams(searchParams);
    nextParams.delete('tab');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!service) return;
    setTeamRows(buildEditableTeamRows(service));
    setTeamError('');
    setBillingDraft({
      billingStatus: service.billingStatus || 'pending',
      signaledAmount: service.signaledAmount ? String(service.signaledAmount).replace('.', ',') : '',
      signaledAt: service.signaledAt ? String(service.signaledAt).slice(0, 10) : '',
      remainingPaymentDate: service.remainingPaymentDate ? String(service.remainingPaymentDate).slice(0, 10) : '',
    });
    setBillingError('');
    setActiveTeamCollaboratorPickerKey(null);
    setTeamCollaboratorPickerPlacement(null);
  }, [service]);

  function updateBillingDraft(patch) {
    setBillingDraft((current) => ({ ...current, ...patch }));
    setBillingError('');
  }

  async function saveClientPayment() {
    if (!service || savingBilling) return;
    const status = billingDraft.billingStatus || 'pending';
    const signal = Number(signalAmount.toFixed(2));
    if (status === 'partial70' && signal <= 0) {
      setBillingError('Indica o valor sinalizado pelo cliente.');
      return;
    }
    if (status === 'partial70' && !billingDraft.signaledAt) {
      setBillingError('Indica a data da sinalização.');
      return;
    }

    setSavingBilling(true);
    setBillingError('');
    try {
      const today = new Date();
      const todayInput = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      await api(`/services/${service.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          billingStatus: status,
          signaledAmount: status === 'partial70' || status === 'paid' ? signal : 0,
          paidAmount: status === 'paid' ? totalRevenue : status === 'partial70' ? signal : 0,
          signaledAt: billingDraft.signaledAt || null,
          billingPaymentDate: status === 'paid' ? todayInput : null,
          remainingPaymentDate: status === 'partial70' ? (billingDraft.remainingPaymentDate || null) : null,
        }),
      });
      await reload();
    } catch (err) {
      setBillingError(err.message || 'Não foi possível guardar o pagamento.');
    } finally {
      setSavingBilling(false);
    }
  }

  useEffect(() => {
    const nextDay = resolveSelectedTeamDay({
      isContinuous: Boolean(service?.isContinuous),
      days,
      selectedDay,
    });
    if (nextDay !== selectedDay) setSelectedDay(nextDay);
  }, [days, selectedDay, service?.isContinuous]);

  useEffect(() => {
    if (activeTeamCollaboratorPickerKey === null) return undefined;

    function closePickerFromOutside(event) {
      if (event.target?.closest?.('.service-collab-picker')) return;
      setActiveTeamCollaboratorPickerKey(null);
      setTeamCollaboratorPickerPlacement(null);
    }

    function closePickerOnEscape(event) {
      if (event.key !== 'Escape') return;
      setActiveTeamCollaboratorPickerKey(null);
      setTeamCollaboratorPickerPlacement(null);
    }

    document.addEventListener('pointerdown', closePickerFromOutside);
    document.addEventListener('keydown', closePickerOnEscape);
    window.addEventListener('resize', closePickerFromOutside);
    window.addEventListener('scroll', closePickerFromOutside, true);
    return () => {
      document.removeEventListener('pointerdown', closePickerFromOutside);
      document.removeEventListener('keydown', closePickerOnEscape);
      window.removeEventListener('resize', closePickerFromOutside);
      window.removeEventListener('scroll', closePickerFromOutside, true);
    };
  }, [activeTeamCollaboratorPickerKey]);

  useEffect(() => {
    if (activeTeamCollaboratorPickerKey === null) return undefined;
    const frameId = window.requestAnimationFrame(() => {
      teamCollaboratorSearchRef.current?.focus();
      teamCollaboratorSearchRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeTeamCollaboratorPickerKey]);

  function updateTeamRow(rowKey, patch) {
    setTeamRows((current) => current.map((row) => (row.rowKey === rowKey ? { ...row, ...patch } : row)));
  }

  function updateTeamCollaborator(row, collaboratorId) {
    const collaborator = (collaborators || []).find((item) => String(item.id) === String(collaboratorId));
    updateTeamRow(row.rowKey, {
      collaboratorId,
      collaborator: collaborator || null,
      hourlyRate: collaboratorId ? (collaborator?.hourlyRate || row.hourlyRate || '') : '',
    });
  }

  function toggleTeamCollaboratorPicker(event, rowKey) {
    if (activeTeamCollaboratorPickerKey === rowKey) {
      setActiveTeamCollaboratorPickerKey(null);
      setTeamCollaboratorPickerPlacement(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const viewportHeight = window.innerHeight || 720;
    const gap = 6;
    const edgePadding = 16;
    const spaceBelow = viewportHeight - rect.bottom - edgePadding;
    const spaceAbove = rect.top - edgePadding;
    const openAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
    const availableSpace = Math.max(160, (openAbove ? spaceAbove : spaceBelow) - gap);

    setTeamCollaboratorPickerPlacement({
      left: Math.max(edgePadding, rect.left),
      top: openAbove ? undefined : rect.bottom + gap,
      bottom: openAbove ? viewportHeight - rect.top + gap : undefined,
      width: rect.width,
      maxHeight: Math.min(320, availableSpace),
    });
    setActiveTeamCollaboratorPickerKey(rowKey);
  }

  function addTeamRow(role = MANUAL_TEAM_ROLE) {
    setTeamRows((current) => ([
      ...current,
      createManualTeamRow(service || {}, {
        role,
        selectedDay: currentDay,
        rowKey: `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      }),
    ]));
  }

  function removeTeamRow(rowKey) {
    setTeamRows((current) => current.filter((row) => row.rowKey !== rowKey));
  }

  async function saveTeamRows() {
    if (!service || savingTeam) return;
    const assignmentPayloads = editableTeamRowsToAssignmentPayloads(teamRows, service);
    const assignmentDrafts = editableTeamRowsToAssignmentDrafts(teamRows);
    const keptIds = new Set(assignmentPayloads.filter((row) => row.id).map((row) => Number(row.id)));
    const removedIds = (service.assignments || [])
      .map((assignment) => Number(assignment.id))
      .filter((id) => !keptIds.has(id));

    setSavingTeam(true);
    setTeamError('');
    try {
      for (const id of removedIds) {
        await api(`/assignments/${id}`, { method: 'DELETE' });
      }
      for (const payload of assignmentPayloads) {
        const { id, ...body } = payload;
        await api(id ? `/assignments/${id}` : '/assignments', {
          method: id ? 'PUT' : 'POST',
          body: JSON.stringify(body),
        });
      }
      await api(`/services/${service.id}`, {
        method: 'PUT',
        body: JSON.stringify({ assignmentDrafts }),
      });
      await reload();
    } catch (err) {
      setTeamError(err?.message || 'Não foi possível guardar os colaboradores.');
    } finally {
      setSavingTeam(false);
    }
  }

  async function deleteEvent() {
    if (!service) return;
    if (!window.confirm('Eliminar este Evento/Serviço? Esta ação não pode ser anulada.')) return;
    try {
      await api(`/services/${service.id}`, { method: 'DELETE' });
      navigate('/services');
    } catch (err) {
      setTeamError(err?.message || 'Não foi possível eliminar o Evento/Serviço.');
    }
  }

  async function saveCurrentTab() {
    if (activeTab === 'costs') {
      await saveClientPayment();
      return;
    }
    await saveTeamRows();
  }

  if (loading) {
    return <div className="page"><p className="muted">A carregar Evento/Serviço...</p></div>;
  }

  if (error) {
    return <div className="page"><p className="notice">{error}</p></div>;
  }

  if (!service) {
    return (
      <div className="page service-detail-page">
        <Link className="secondary-button service-detail-back" to="/services"><ArrowLeft size={16} /> Voltar</Link>
        <Card title="Evento/Serviço não encontrado">
          <p className="muted">Não foi possível encontrar o evento selecionado.</p>
        </Card>
      </div>
    );
  }

  const financeArea = service.clientId ? 'clients' : 'overview';

  return (
    <div className="page service-detail-page">
      <div className="service-detail-hero">
        <div className="service-detail-hero__top">
          <Link className="secondary-button service-detail-back" to="/services">
            <ArrowLeft size={16} />
            Eventos/Serviços
          </Link>
          <div className="service-detail-actions">
            <Link className="command-button" to={`/services?serviceId=${service.id}`}>
              <Edit3 size={16} />
              Editar dados
            </Link>
            <Link className="secondary-button" to={`/time-validation?eventId=${service.id}`}>
              <Clock size={16} />
              Validação de Horas
            </Link>
            <Link className="secondary-button" to={`/finance?area=${financeArea}&eventId=${service.id}`}>
              <WalletCards size={16} />
              Financeiro
            </Link>
            <button className="secondary-button secondary-button--danger" type="button" onClick={deleteEvent}>
              <Trash2 size={16} />
              Eliminar evento
            </button>
            <button className="command-button" type="button" onClick={saveCurrentTab} disabled={savingTeam || savingBilling}>
              <Save size={16} />
              Guardar alterações
            </button>
          </div>
        </div>

        <div className="service-detail-title-row">
          <div>
            <span className="eyebrow">Ficha do Evento/Serviço</span>
            <h1>{service.name}</h1>
            <p>{service.client?.name || service.clientName || 'Cliente por associar'} · {formatDateRange(service)}</p>
          </div>
          <Badge tone={service.status === 'finalized' ? 'success' : 'info'}>{statusLabel(service.status)}</Badge>
        </div>

        <div className="service-detail-progress-grid">
          <ProgressStat label="Equipa" value={`${metrics.confirmed}/${metrics.requested || metrics.assigned}`} detail="confirmados" tone={metrics.teamComplete ? 'success' : 'warning'} />
          <ProgressStat label="Staff" value={`${metrics.staffFilled}/${metrics.assigned}`} detail={metrics.staffAcceptedComplete ? 'horários aceites' : 'horários guardados'} tone={metrics.staffHoursComplete ? 'success' : 'warning'} />
          <ProgressStat label="Cliente" value={`${metrics.clientFilled}/${metrics.assigned}`} detail="horários preenchidos" tone={metrics.clientHoursComplete ? 'success' : 'warning'} />
          <ProgressStat label="Valor" value={money.format(totalRevenue)} detail="previsto/validado" tone="info" />
        </div>
      </div>

      <div className="service-detail-tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} type="button" className={`service-tab ${activeTab === tab.id ? 'service-tab--active' : ''}`} onClick={() => setActiveTab(tab.id)}>
              <Icon size={15} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'summary' ? (
        <div className="service-detail-grid">
          <Card title="Dados principais" className="service-detail-card">
            <div className="service-detail-info-grid">
              <InfoItem label="Tipo de evento" value={fieldValue(service.eventType)} />
              <InfoItem label="Data" value={formatDateRange(service)} />
              <InfoItem label="Convidados/Participantes" value={service.guestsCount || '-'} />
              <InfoItem label="Estado operacional" value={statusLabel(service.status)} />
            </div>
          </Card>

          <Card title="Cliente e local" className="service-detail-card">
            <div className="service-detail-info-grid">
              <InfoItem label="Cliente" value={service.client?.name || service.clientName || '-'} />
              <InfoItem label="Local" value={service.location || service.client?.address || '-'} />
              <InfoItem label="Ponto de encontro" value={service.meetingPoint || '-'} />
              <InfoItem label="Contacto no local" value={[service.onsiteContactName, service.onsiteContactPhone].filter(Boolean).join(' · ') || '-'} />
            </div>
          </Card>

          <Card title="Horário e uniforme" className="service-detail-card">
            <div className="service-detail-info-grid">
              <InfoItem label="Entrada prevista" value={fieldValue(service.startTime)} />
              <InfoItem label="Saída prevista" value={fieldValue(service.endTime)} />
              <InfoItem label="Uniforme" value={fieldValue(service.uniform)} />
              <InfoItem label="Horas mínimas" value={parseNumber(service.minimumHoursSnapshot) > 0 ? `${service.minimumHoursSnapshot} h por colaborador/turno` : 'Sem mínimo'} />
            </div>
          </Card>

          <Card title="Checklist de fecho" className="service-detail-card">
            <div className="service-detail-checklist">
              {checklist.map((item) => (
                <div key={item.id} className={`service-detail-check ${item.done ? 'service-detail-check--done' : ''}`}>
                  <CheckCircle2 size={17} />
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      {activeTab === 'team' ? (
        <>
        <Card
          title="Colaboradores"
          className="service-detail-card"
        >
          {days.length > 1 ? (
            <div className="service-day-tabs service-detail-day-tabs">
              {days.map((day) => (
                <button key={day} type="button" className={`service-tab ${currentDay === day ? 'service-tab--active' : ''}`} onClick={() => setSelectedDay(day)}>
                  {formatDate(day).slice(0, 5)}
                </button>
              ))}
            </div>
          ) : null}
          {teamError ? <p className="notice">{teamError}</p> : null}
          <div className="service-detail-team">
            {assignmentGroups.map((group) => (
              <section key={group.role} className="service-detail-role">
                <header>
                  <div className="service-detail-role-title">
                    <strong>{group.role}</strong>
                    <span className="service-detail-role-count">{group.rows.length}</span>
                  </div>
                  <span className={`service-detail-role-sync-status${group.rows.length && group.rows.every((row) => row.clientSynced) ? ' service-detail-role-sync-status--complete' : ''}`}>
                    <CheckCircle2 size={14} />
                    Sincronizado {group.rows.filter((row) => row.clientSynced).length}/{group.rows.length}
                  </span>
                  <div className="service-detail-role-actions">
                    <span>{group.rows.length} linha(s)</span>
                    <button className="secondary-button" type="button" onClick={() => addTeamRow(group.role)}>
                      <Plus size={15} />
                      Adicionar Colaborador
                    </button>
                  </div>
                </header>
                <div className="service-detail-team-table">
                  <div className="service-detail-team-columns" aria-hidden="true">
                    <span>Colaborador</span>
                    <span>Data</span>
                    <span>Entrada</span>
                    <span>Saída</span>
                    <span>Valor / hora</span>
                    <span>Estado</span>
                    <span>Sincronizado</span>
                    <span>Condutor</span>
                    <span>Adiantamentos</span>
                    <span>Ações</span>
                  </div>
                  {group.rows.map((assignment) => {
                    const selectedCollaborator = (collaborators || []).find(
                      (collaborator) => String(collaborator.id) === String(assignment.collaboratorId),
                    ) || assignment.collaborator;
                    const collaboratorName = rowDisplayName(assignment, activeCollaborators);
                    const collaboratorNif = selectedCollaborator?.nif || '-';
                    const rowHours = rowDurationHours(assignment, service);
                    const rowClasses = [
                      'service-detail-team-row',
                      assignment.isDraft ? 'service-detail-team-row--empty' : '',
                      assignment.status === 'confirmed' ? 'service-detail-team-row--confirmed' : '',
                    ].filter(Boolean).join(' ');
                    return (
                      <div key={assignment.rowKey || `${assignment.id}-${assignmentWorkDate(assignment, service)}`} className={rowClasses}>
                        <div className="service-detail-team-collaborator">
                          <span className="service-detail-field-label">Colaborador</span>
                          <div className="service-collab-picker">
                            <button
                              type="button"
                              className={`service-collab-trigger ${assignment.clientSynced ? 'service-collab-trigger--synced' : ''}`}
                              onClick={(event) => toggleTeamCollaboratorPicker(event, assignment.rowKey)}
                            >
                              <CollaboratorAvatar row={assignment} />
                              <span>{assignment.collaboratorId ? collaboratorName : 'Por atribuir'}</span>
                            </button>
                            {assignment.collaboratorId ? <small className="service-detail-team-nif">NIF: {collaboratorNif}</small> : null}
                          {activeTeamCollaboratorPickerKey === assignment.rowKey ? (
                            <div
                              className="service-collab-menu"
                              style={teamCollaboratorPickerPlacement ? {
                                left: teamCollaboratorPickerPlacement.left,
                                top: teamCollaboratorPickerPlacement.top,
                                bottom: teamCollaboratorPickerPlacement.bottom,
                                width: teamCollaboratorPickerPlacement.width,
                                maxHeight: teamCollaboratorPickerPlacement.maxHeight,
                              } : undefined}
                            >
                              <input
                                ref={teamCollaboratorSearchRef}
                                autoFocus
                                type="text"
                                placeholder="Filtrar por nome"
                                value={assignment.collaboratorSearch || ''}
                                onChange={(event) => updateTeamRow(assignment.rowKey, { collaboratorSearch: event.target.value })}
                              />
                              <div className="service-collab-options">
                                <button
                                  type="button"
                                  className="service-collab-option"
                                  onClick={() => {
                                    updateTeamCollaborator(assignment, '');
                                    setActiveTeamCollaboratorPickerKey(null);
                                    setTeamCollaboratorPickerPlacement(null);
                                  }}
                                >
                                  <span>Por atribuir</span>
                                </button>
                                {(() => {
                                  const roleCollaborators = activeCollaborators.filter((collaborator) => collaboratorHasRole(collaborator, group.role));
                                  const selectedCollaborator = assignment.collaborator
                                    || activeCollaborators.find((collaborator) => String(collaborator.id) === String(assignment.collaboratorId));
                                  return filterCollaboratorOptions([
                                    ...roleCollaborators,
                                    ...(selectedCollaborator && !roleCollaborators.some((collaborator) => String(collaborator.id) === String(selectedCollaborator.id)) ? [selectedCollaborator] : []),
                                  ]
                                    .filter((collaborator, index, list) => list.findIndex((item) => String(item.id) === String(collaborator.id)) === index)
                                    .filter(Boolean), assignment.collaboratorSearch)
                                    .map((collaborator) => (
                                      <button
                                        type="button"
                                        key={collaborator.id}
                                        className="service-collab-option"
                                        onClick={() => {
                                          updateTeamCollaborator(assignment, String(collaborator.id));
                                          setActiveTeamCollaboratorPickerKey(null);
                                          setTeamCollaboratorPickerPlacement(null);
                                        }}
                                      >
                                        <span>{collaboratorOptionLabel(collaborator)}</span>
                                        {collaborator.hasOwnCar ? <span className="service-collab-car-badge">Carro</span> : null}
                                      </button>
                                    ));
                                })()}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      {service.isContinuous ? (
                        <label>
                          <span>Data</span>
                          <input type="date" value={assignment.assignmentDate || currentDay || ''} onChange={(event) => updateTeamRow(assignment.rowKey, { assignmentDate: event.target.value })} />
                        </label>
                      ) : (
                        <div className="service-detail-date-lock">
                          <span>Data</span>
                          <strong>{formatDate(service.date)}</strong>
                        </div>
                      )}
                      <label>
                        <span>Entrada prevista</span>
                        <TimeInput value={assignment.plannedCheckIn || ''} placeholder="HH:MM" onChange={(value) => updateTeamRow(assignment.rowKey, { plannedCheckIn: value })} />
                      </label>
                      <label>
                        <span>Saída prevista</span>
                        <TimeInput value={assignment.plannedCheckOut || ''} placeholder="HH:MM" onChange={(value) => updateTeamRow(assignment.rowKey, { plannedCheckOut: value })} />
                        <small className="service-detail-hours-value">{rowHours > 0 ? durationHours(rowHours) : '—'}</small>
                      </label>
                      <label>
                        <span>Valor/h</span>
                        <input value={assignment.hourlyRate || ''} placeholder="Ex: 8,50" onChange={(event) => updateTeamRow(assignment.rowKey, { hourlyRate: event.target.value })} />
                      </label>
                      <label>
                        <span>Estado</span>
                        <select value={assignment.status || 'pending_confirmation'} onChange={(event) => updateTeamRow(assignment.rowKey, { status: event.target.value })}>
                          <option value="confirmed">Confirmado</option>
                          <option value="pending_confirmation">Aguardar confirmação</option>
                          <option value="missed_justified">Faltou c/justificação</option>
                          <option value="missed_unjustified">Faltou s/justificação</option>
                          <option value="cancelled">Cancelado</option>
                        </select>
                      </label>
                      <div className="service-detail-team-flags">
                        <label title="Sincronizado com o cliente">
                          <input type="checkbox" checked={Boolean(assignment.clientSynced)} onChange={(event) => updateTeamRow(assignment.rowKey, { clientSynced: event.target.checked })} />
                          <span>Cliente</span>
                        </label>
                        <button
                          type="button"
                          className={assignment.isDriver ? 'service-driver-toggle service-driver-toggle--active' : 'service-driver-toggle'}
                          aria-label={assignment.isDriver ? 'Remover condutor' : 'Marcar como condutor'}
                          title={assignment.isDriver ? 'Condutor' : 'Marcar como condutor'}
                          onClick={() => updateTeamRow(assignment.rowKey, { isDriver: !assignment.isDriver })}
                        >
                          <CarFront size={15} />
                        </button>
                        <Link className="secondary-button service-detail-advance-button" to={`/services?serviceId=${service.id}`} title="Abrir adiantamentos do colaborador">
                          Adiantamentos
                        </Link>
                        <button type="button" className="icon-button icon-button--danger" onClick={() => removeTeamRow(assignment.rowKey)} title="Remover linha" aria-label="Remover linha">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </section>
            ))}
            {!assignmentGroups.length ? (
              <div className="service-detail-empty-team">
                <EmptyState
                  icon={Users}
                  title="Sem funções necessárias definidas"
                  description="Podes adicionar colaboradores diretamente nesta ficha ou definir funções necessárias se quiseres planear por cargo."
                  action={<Link className="secondary-button" to={`/services?serviceId=${service.id}`}>Definir funções</Link>}
                />
              </div>
            ) : null}
          </div>
        </Card>
        <div className="service-detail-team-footer">
          <div className="service-detail-team-total">
            <Users size={25} />
            <span>Total colaboradores<strong>{teamTotals.collaborators}</strong></span>
          </div>
          <div className="service-detail-team-total">
            <Clock size={25} />
            <span>Total horas<strong>{durationHours(teamTotals.hours)}</strong></span>
          </div>
          <div className="service-detail-team-total">
            <Euro size={25} />
            <span>Total a pagar<strong>{money.format(teamTotals.amount)}</strong></span>
          </div>
          <Link className="service-detail-cost-link" to={`/finance?area=staff&eventId=${service.id}`}>
          Ver resumo de custos
          </Link>
        </div>
        </>
      ) : null}

      {activeTab === 'validation' ? (
        <div className="service-detail-grid">
          <Card title="Estado da validação" className="service-detail-card">
            <div className="service-detail-validation-grid">
              <ProgressStat label="Staff" value={`${metrics.staffFilled}/${metrics.assigned}`} detail={metrics.staffAcceptedComplete ? 'horários aceites' : 'horários guardados'} tone={metrics.staffHoursComplete ? 'success' : 'warning'} />
              <ProgressStat label="Cliente" value={`${metrics.clientFilled}/${metrics.assigned}`} detail="horários preenchidos" tone={metrics.clientHoursComplete ? 'success' : 'warning'} />
              <ProgressStat label="Validados" value={`${metrics.validated}/${metrics.assigned}`} detail="linhas aceites" tone={metrics.validationComplete ? 'success' : 'warning'} />
            </div>
            <div className="service-detail-card-actions">
              <Link className="command-button" to={`/time-validation?eventId=${service.id}`}>Abrir Validação de Horas</Link>
            </div>
          </Card>
          <Card title="Resumo operacional" className="service-detail-card">
            <p className="muted">Esta área mostra o estado da validação sem duplicar a grelha completa. A validação detalhada continua no módulo próprio.</p>
            <div className="service-detail-info-grid">
              <InfoItem label="Estado atual" value={statusLabel(service.status)} />
              <InfoItem label="Última atualização" value={formatDate(service.updatedAt)} />
            </div>
          </Card>
        </div>
      ) : null}

      {activeTab === 'costs' ? (
        <div className="service-detail-grid">
          <Card title="Resumo financeiro" className="service-detail-card">
            <div className="service-detail-finance-grid">
              <div><span>Valor total</span><strong>{money.format(totalRevenue)}</strong></div>
              <div><span>Custo total</span><strong>{money.format(totalCost)}</strong></div>
              <div><span>Deslocação</span><strong>{money.format(travelAmount)}</strong></div>
              <div className={profit >= 0 ? 'service-detail-profit--positive' : 'service-detail-profit--negative'}><span>Margem</span><strong>{money.format(profit)}</strong></div>
            </div>
          </Card>
          <Card title="Pagamento do cliente" className="service-detail-card service-detail-payment-card">
            <div className="service-detail-payment-summary">
              <div>
                <span>Valor em falta</span>
                <strong className={clientRemainingAmount > 0 ? 'service-detail-payment-due' : 'service-detail-payment-paid'}>
                  {money.format(clientRemainingAmount)}
                </strong>
              </div>
              <Badge tone={billingDraft.billingStatus === 'paid' ? 'success' : billingDraft.billingStatus === 'partial70' ? 'warning' : 'neutral'}>
                {billingDraft.billingStatus === 'partial70' ? 'Sinalização' : billingDraft.billingStatus === 'paid' ? 'Pago' : billingDraft.billingStatus === 'invoiced' ? 'Faturado' : 'Pendente'}
              </Badge>
            </div>
            <div className="service-detail-payment-grid">
              <label>Estado do pagamento
                <select value={billingDraft.billingStatus} onChange={(event) => updateBillingDraft({ billingStatus: event.target.value })}>
                  <option value="pending">Pendente</option>
                  <option value="partial70">Sinalização</option>
                  <option value="invoiced">Faturado</option>
                  <option value="paid">Pago</option>
                </select>
              </label>
              <label>Valor total
                <input value={money.format(totalRevenue)} readOnly />
              </label>
              <label>Valor sinalizado
                <input
                  inputMode="decimal"
                  value={billingDraft.signaledAmount}
                  placeholder="Ex: 700,00"
                  onChange={(event) => updateBillingDraft({ signaledAmount: event.target.value })}
                />
              </label>
              <label>Valor em falta
                <input value={money.format(clientRemainingAmount)} readOnly />
              </label>
              {billingDraft.billingStatus === 'partial70' || signalAmount > 0 ? (
                <label>Data da sinalização
                  <input type="date" value={billingDraft.signaledAt} onChange={(event) => updateBillingDraft({ signaledAt: event.target.value })} />
                </label>
              ) : null}
              {billingDraft.billingStatus === 'partial70' ? (
                <label>Data do restante pagamento
                  <input type="date" value={billingDraft.remainingPaymentDate} onChange={(event) => updateBillingDraft({ remainingPaymentDate: event.target.value })} />
                </label>
              ) : null}
            </div>
            {billingError ? <p className="form-error">{billingError}</p> : null}
            <div className="service-detail-card-actions service-detail-payment-actions">
              <span className="muted">Regista aqui a sinalização recebida e o valor que ainda falta cobrar.</span>
              <button className="command-button" type="button" onClick={saveClientPayment} disabled={savingBilling}>
                <Save size={15} />
                {savingBilling ? 'A guardar...' : 'Guardar pagamento'}
              </button>
            </div>
          </Card>
          <Card title="Custos externos/parceiros" className="service-detail-card">
            {externalCosts.length ? (
              <div className="service-detail-external-list">
                {externalCosts.map((item, index) => (
                  <div key={`${item.type || 'custo'}-${index}`}>
                    <div>
                      <strong>{item.supplier || item.type || 'Custo externo'}</strong>
                      <span>{item.description || '-'}</span>
                    </div>
                    <strong>{money.format(parseNumber(item.chargeAmount || item.costAmount))}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                compact
                icon={WalletCards}
                title="Sem custos externos registados"
                description="Quando existirem parceiros, catering ou material externo, ficam aqui para consulta."
              />
            )}
          </Card>
        </div>
      ) : null}

      {activeTab === 'history' ? (
        <Card title="Histórico" className="service-detail-card">
          <div className="service-detail-history">
            <div>
              <CalendarClock size={16} />
              <div>
                <strong>Evento criado</strong>
                <span>{formatDate(service.createdAt)}</span>
              </div>
            </div>
            <div>
              <FileClock size={16} />
              <div>
                <strong>Última atualização</strong>
                <span>{formatDate(service.updatedAt)}</span>
              </div>
            </div>
            <div>
              <MapPin size={16} />
              <div>
                <strong>Estado atual</strong>
                <span>{statusLabel(service.status)}</span>
              </div>
            </div>
          </div>
          <p className="muted">Numa fase seguinte, este separador pode passar a guardar alterações detalhadas por utilizador, estado, horários e pagamentos.</p>
        </Card>
      ) : null}

    </div>
  );
}
