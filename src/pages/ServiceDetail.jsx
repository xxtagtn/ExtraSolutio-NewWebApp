import {
  ArrowLeft,
  Ban,
  CalendarClock,
  CarFront,
  ChevronDown,
  ChevronUp,
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
  Settings2,
  Trash2,
  Users,
  WalletCards,
  RotateCcw,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Badge from '../components/UI/Badge.jsx';
import Card from '../components/UI/Card.jsx';
import EmptyState from '../components/UI/EmptyState.jsx';
import TimeInput from '../components/UI/TimeInput.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../utils/api.js';
import { filterCollaboratorOptions } from '../utils/collaboratorSearch.js';
import { collaboratorRoleOptions } from '../utils/collaboratorRoles.js';
import { serviceDetailTabFromQuery } from '../utils/deepLinks.js';
import { calculateFinancialMargin, eventFinancialWarnings } from '../utils/eventFinancialRules.js';
import { externalCostsTotals } from '../utils/externalCosts.js';
import { isEventDayCancelled } from '../utils/eventCancelledDays.js';
import { eventTaxAmount, expensesIncludingEventTax } from '../utils/eventTax.js';
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
  normalizeDailyRoleRequirements,
  removeEditableTeamRow,
  resolveSelectedTeamDay,
  roleRequirementsForDay,
  safeJsonArray,
  serviceAssignmentDays,
  serviceChecklist,
  serviceDetailMetrics,
} from '../utils/serviceDetail.js';
import {
  statusLabel,
} from '../utils/serviceStatus.js';
import { staffAdvancesTotal, staffCarAdvancesTotal } from '../utils/staffAdvances.js';
import { roundedBillableHours } from '../utils/serviceFinance.js';

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

function advanceRows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function todayInputValue() {
  const current = new Date();
  return `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
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

function dayActionErrorMessage(error, fallback) {
  const message = String(error?.message || '').trim();
  if (!message || message.includes('não pertence a este evento')) return fallback;
  return message;
}

function collaboratorHasRole(collaborator, role) {
  if (!role || role === MANUAL_TEAM_ROLE) return true;
  const roles = Array.isArray(collaborator?.roles) ? collaborator.roles : [];
  return roles.includes(role) || String(collaborator?.category || '') === String(role);
}

function normalizedRoleKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function collaboratorOptionLabel(collaborator) {
  return `${collaborator.shortName || collaborator.name || `Colaborador ${collaborator.id}`} | ${collaborator.nif || '-'}`;
}

function rowDurationHours(row, service) {
  return roundedBillableHours(
    row.plannedCheckIn || row.checkIn || service?.startTime,
    row.plannedCheckOut || row.checkOut || service?.endTime,
  );
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
  const [teamRoles, setTeamRoles] = useState([]);
  const [roleManagerOpen, setRoleManagerOpen] = useState(false);
  const [collapsedRoles, setCollapsedRoles] = useState(() => new Set());
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleQty, setNewRoleQty] = useState('1');
  const [savingTeam, setSavingTeam] = useState(false);
  const [teamError, setTeamError] = useState('');
  const [activeAdvanceRowKey, setActiveAdvanceRowKey] = useState(null);
  const [dayActionBusy, setDayActionBusy] = useState(false);
  const [dayActionError, setDayActionError] = useState('');
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
  const currentDayCancelled = useMemo(
    () => isEventDayCancelled(service || {}, currentDay),
    [currentDay, service],
  );
  const teamService = useMemo(
    () => ({ ...(service || {}), requiredRoles: teamRoles }),
    [service, teamRoles],
  );
  const currentDayRoles = useMemo(
    () => roleRequirementsForDay(teamService, currentDay, teamRoles),
    [currentDay, teamRoles, teamService],
  );
  const assignmentGroups = useMemo(
    () => groupAssignmentsByRole(displayAssignments, teamService, currentDay),
    [currentDay, displayAssignments, teamService],
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
  const externalTotals = useMemo(() => externalCostsTotals(externalCosts), [externalCosts]);
  const totalRevenue = parseNumber(service?.totalRevenue);
  const totalCost = parseNumber(service?.totalCost);
  const staffCost = Math.max(0, totalCost - externalTotals.costAmount);
  const taxAmount = eventTaxAmount(service);
  const nonStaffExpenses = expensesIncludingEventTax(service, externalTotals.costAmount);
  const expenses = staffCost + nonStaffExpenses;
  const financialMargin = calculateFinancialMargin(totalRevenue, staffCost, nonStaffExpenses);
  const profit = financialMargin.margin;
  const financialWarnings = eventFinancialWarnings(
    service || {},
    service?.assignments || [],
    { revenue: totalRevenue, staff: staffCost },
  );
  const rateHistory = useMemo(() => safeJsonArray(service?.rateHistory), [service?.rateHistory]);
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
    const normalizedRoles = normalizeDailyRoleRequirements(service);
    setTeamRoles(normalizedRoles);
    setTeamRows(buildEditableTeamRows({ ...service, requiredRoles: normalizedRoles }));
    setTeamError('');
    setRoleManagerOpen(false);
    setCollapsedRoles(new Set());
    setNewRoleName('');
    setNewRoleQty('1');
    setBillingDraft({
      billingStatus: service.billingStatus || 'pending',
      signaledAmount: service.signaledAmount ? String(service.signaledAmount).replace('.', ',') : '',
      signaledAt: service.signaledAt ? String(service.signaledAt).slice(0, 10) : '',
      remainingPaymentDate: service.remainingPaymentDate ? String(service.remainingPaymentDate).slice(0, 10) : '',
    });
    setBillingError('');
    setActiveTeamCollaboratorPickerKey(null);
    setTeamCollaboratorPickerPlacement(null);
    setActiveAdvanceRowKey(null);
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
    setDayActionError('');
    setRoleManagerOpen(false);
  }, [currentDay]);

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

  function updateTeamAdvances(rowKey, updater) {
    setTeamRows((current) => current.map((row) => (
      row.rowKey === rowKey
        ? { ...row, advancePayments: updater(advanceRows(row.advancePayments)) }
        : row
    )));
    setTeamError('');
    setDayActionError('');
  }

  function addTeamAdvance(rowKey) {
    updateTeamAdvances(rowKey, (current) => ([
      ...current,
      {
        id: `advance-${Date.now()}-${current.length + 1}`,
        date: todayInputValue(),
        amount: '',
        note: '',
        car: false,
      },
    ]));
  }

  function updateTeamAdvance(rowKey, advanceId, patch) {
    updateTeamAdvances(rowKey, (current) => current.map((advance) => (
      String(advance.id) === String(advanceId) ? { ...advance, ...patch } : advance
    )));
  }

  function removeTeamAdvance(rowKey, advanceId) {
    updateTeamAdvances(rowKey, (current) => current.filter(
      (advance) => String(advance.id) !== String(advanceId),
    ));
  }

  function toggleRoleCollapsed(role) {
    setCollapsedRoles((current) => {
      const next = new Set(current);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
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

  function rowMatchesCurrentRole(row, role) {
    const sameRole = normalizedRoleKey(row.role) === normalizedRoleKey(role);
    if (!sameRole) return false;
    if (!service?.isContinuous) return true;
    return assignmentWorkDate(row, service) === currentDay;
  }

  function appendRoleRows(role, count = 1) {
    setTeamRows((current) => ([
      ...current,
      ...Array.from({ length: Math.max(0, count) }, (_, index) => createManualTeamRow(teamService, {
        role,
        selectedDay: currentDay,
        rowKey: `manual-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
      })),
    ]));
  }

  function addRoleRequirement(roleValue, quantity = 1) {
    const role = String(roleValue || '').trim();
    const qty = Math.max(1, Math.trunc(Number(quantity) || 1));
    if (!role || normalizedRoleKey(role) === normalizedRoleKey(MANUAL_TEAM_ROLE)) {
      setTeamError('Indica uma função válida.');
      return false;
    }
    if (currentDayRoles.some((item) => normalizedRoleKey(item.role) === normalizedRoleKey(role))) {
      setTeamError(`A função "${role}" já existe neste dia.`);
      return false;
    }
    const inheritedRate = teamRoles.find((item) => normalizedRoleKey(item.role) === normalizedRoleKey(role))?.agreedRate ?? null;
    const requirement = {
      role,
      qty,
      agreedRate: inheritedRate,
      ...(service?.isContinuous ? { day: currentDay } : {}),
      order: currentDayRoles.length,
    };
    setTeamRoles((current) => [...current, requirement]);
    appendRoleRows(role, qty);
    setTeamError('');
    return true;
  }

  function addNewDailyRole() {
    if (!addRoleRequirement(newRoleName, newRoleQty)) return;
    setNewRoleName('');
    setNewRoleQty('1');
  }

  function renameDailyRole(currentRole, nextValue, inputElement) {
    const nextRole = String(nextValue || '').trim();
    if (!nextRole) {
      setTeamError('O nome da função não pode ficar vazio.');
      if (inputElement) inputElement.value = currentRole;
      return;
    }
    if (normalizedRoleKey(nextRole) === normalizedRoleKey(currentRole)) return;
    if (currentDayRoles.some((item) => normalizedRoleKey(item.role) === normalizedRoleKey(nextRole))) {
      setTeamError(`A função "${nextRole}" já existe neste dia.`);
      if (inputElement) inputElement.value = currentRole;
      return;
    }
    setTeamRoles((current) => current.map((item) => (
      roleRequirementsForDay(teamService, currentDay, [item]).length
      && normalizedRoleKey(item.role) === normalizedRoleKey(currentRole)
        ? { ...item, role: nextRole }
        : item
    )));
    setTeamRows((current) => current.map((row) => (
      rowMatchesCurrentRole(row, currentRole) ? { ...row, role: nextRole } : row
    )));
    setTeamError('');
  }

  function updateDailyRoleQuantity(role, nextValue, inputElement) {
    const qty = Math.max(1, Math.trunc(Number(nextValue) || 0));
    const currentRequirement = currentDayRoles.find((item) => normalizedRoleKey(item.role) === normalizedRoleKey(role));
    if (!currentRequirement || !Number.isFinite(qty)) {
      if (inputElement) inputElement.value = String(currentRequirement?.qty || 1);
      return;
    }
    const roleRows = teamRows.filter((row) => rowMatchesCurrentRole(row, role));
    const assignedRows = roleRows.filter((row) => row.collaboratorId);
    if (qty < assignedRows.length && !window.confirm(
      `A função "${role}" tem ${assignedRows.length} colaborador(es) atribuído(s). Reduzir para ${qty} irá remover atribuições. Pretende continuar?`,
    )) {
      if (inputElement) inputElement.value = String(currentRequirement.qty);
      return;
    }

    setTeamRoles((current) => current.map((item) => (
      roleRequirementsForDay(teamService, currentDay, [item]).length
      && normalizedRoleKey(item.role) === normalizedRoleKey(role)
        ? { ...item, qty }
        : item
    )));
    if (qty > roleRows.length) {
      appendRoleRows(role, qty - roleRows.length);
    } else if (qty < roleRows.length) {
      let toRemove = roleRows.length - qty;
      const removableKeys = [];
      for (const row of [...roleRows].sort((a, b) => Number(Boolean(a.collaboratorId)) - Number(Boolean(b.collaboratorId)))) {
        if (toRemove <= 0) break;
        removableKeys.push(row.rowKey);
        toRemove -= 1;
      }
      setTeamRows((current) => current.filter((row) => !removableKeys.includes(row.rowKey)));
    }
    setTeamError('');
  }

  function removeDailyRole(role) {
    const roleRows = teamRows.filter((row) => rowMatchesCurrentRole(row, role));
    const assignedCount = roleRows.filter((row) => row.collaboratorId).length;
    if (assignedCount > 0 && !window.confirm(
      `A função "${role}" tem ${assignedCount} colaborador(es) atribuído(s). Eliminar a função irá remover essas atribuições. Pretende continuar?`,
    )) return;
    setTeamRoles((current) => current
      .filter((item) => !(
        roleRequirementsForDay(teamService, currentDay, [item]).length
        && normalizedRoleKey(item.role) === normalizedRoleKey(role)
      ))
      .map((item) => ({ ...item })));
    setTeamRows((current) => current.filter((row) => !rowMatchesCurrentRole(row, role)));
    setTeamError('');
  }

  function moveDailyRole(role, direction) {
    const ordered = [...currentDayRoles];
    const index = ordered.findIndex((item) => normalizedRoleKey(item.role) === normalizedRoleKey(role));
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
    [ordered[index], ordered[nextIndex]] = [ordered[nextIndex], ordered[index]];
    const orderByRole = new Map(ordered.map((item, order) => [normalizedRoleKey(item.role), order]));
    setTeamRoles((current) => current.map((item) => {
      if (!roleRequirementsForDay(teamService, currentDay, [item]).length) return item;
      return { ...item, order: orderByRole.get(normalizedRoleKey(item.role)) ?? item.order };
    }));
  }

  function addTeamRow(role = MANUAL_TEAM_ROLE) {
    if (normalizedRoleKey(role) === normalizedRoleKey(MANUAL_TEAM_ROLE)) {
      setRoleManagerOpen(true);
      setTeamError('Adiciona primeiro a função necessária para este dia.');
      return;
    }
    const requirement = currentDayRoles.find((item) => normalizedRoleKey(item.role) === normalizedRoleKey(role));
    if (!requirement) {
      const shouldAdd = window.confirm(
        `A função "${role}" não está definida nas funções necessárias deste evento. Pretende adicioná-la?`,
      );
      if (!shouldAdd) return;
      addRoleRequirement(role, 1);
      setRoleManagerOpen(true);
      return;
    }
    setTeamRoles((current) => current.map((item) => (
      roleRequirementsForDay(teamService, currentDay, [item]).length
      && normalizedRoleKey(item.role) === normalizedRoleKey(role)
        ? { ...item, qty: Number(item.qty || 0) + 1 }
        : item
    )));
    appendRoleRows(role, 1);
  }

  function removeTeamRow(rowKey) {
    const next = removeEditableTeamRow(teamRows, teamRoles, teamService, rowKey);
    setTeamRows(next.rows);
    setTeamRoles(next.requirements);
    setTeamError('');
  }

  async function saveTeamRows() {
    if (!service || savingTeam) return;
    if (currentDayCancelled) {
      setTeamError('Reativa este dia antes de alterar a equipa.');
      return;
    }
    const roleKeysByDay = new Set();
    for (const requirement of teamRoles) {
      const role = String(requirement.role || '').trim();
      if (!role || normalizedRoleKey(role) === normalizedRoleKey(MANUAL_TEAM_ROLE)) {
        setTeamError('Corrige as funções vazias antes de guardar.');
        return;
      }
      const key = `${service.isContinuous ? dateKey(requirement.day) : 'single'}|${normalizedRoleKey(role)}`;
      if (roleKeysByDay.has(key)) {
        setTeamError(`A função "${role}" está duplicada no mesmo dia.`);
        return;
      }
      roleKeysByDay.add(key);
    }
    if (teamRows.some((row) => normalizedRoleKey(row.role) === normalizedRoleKey(MANUAL_TEAM_ROLE))) {
      setTeamError('Existem linhas sem função. Define a função do respetivo dia antes de guardar.');
      setRoleManagerOpen(true);
      return;
    }
    const allAssignmentPayloads = editableTeamRowsToAssignmentPayloads(teamRows, service);
    const assignmentPayloads = allAssignmentPayloads.filter(
      (row) => !isEventDayCancelled(service, assignmentWorkDate(row, service)),
    );
    const assignmentDrafts = editableTeamRowsToAssignmentDrafts(teamRows);
    const cancelledAssignmentIds = (service.assignments || [])
      .filter((assignment) => isEventDayCancelled(service, assignmentWorkDate(assignment, service)))
      .map((assignment) => Number(assignment.id));
    const keptIds = new Set([
      ...assignmentPayloads.filter((row) => row.id).map((row) => Number(row.id)),
      ...cancelledAssignmentIds,
    ]);
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
        body: JSON.stringify({
          requiredRoles: teamRoles,
          assignmentDrafts,
        }),
      });
      await reload();
    } catch (err) {
      setTeamError(err?.message || 'Não foi possível guardar os colaboradores.');
    } finally {
      setSavingTeam(false);
    }
  }

  async function cancelCurrentDay() {
    if (!service?.isContinuous || !currentDay || currentDayCancelled || dayActionBusy) return;
    const dayAssignments = (service.assignments || []).filter(
      (assignment) => assignmentWorkDate(assignment, service) === currentDay
        && String(assignment.status || '').toLowerCase() !== 'cancelled',
    );
    const hasHours = dayAssignments.some((assignment) => (
      assignment.plannedCheckIn
      || assignment.plannedCheckOut
      || assignment.checkIn
      || assignment.checkOut
      || assignment.staffCheckIn
      || assignment.staffCheckOut
      || assignment.clientCheckIn
      || assignment.clientCheckOut
      || assignment.validatedCheckIn
      || assignment.validatedCheckOut
    ));
    const warnings = [];
    if (dayAssignments.some((assignment) => assignment.collaboratorId)) {
      warnings.push(`Este dia possui ${dayAssignments.filter((assignment) => assignment.collaboratorId).length} colaborador(es) atribuído(s).`);
    }
    if (hasHours) {
      warnings.push('Este dia já possui horários registados. Esses registos deixarão de ser considerados para validações, pagamentos e faturação.');
    }
    const confirmed = window.confirm([
      `Pretende cancelar apenas o dia ${formatDate(currentDay)} deste evento contínuo?`,
      'Esta ação não irá cancelar os restantes dias.',
      ...warnings,
    ].join('\n\n'));
    if (!confirmed) return;

    setDayActionBusy(true);
    setDayActionError('');
    setTeamError('');
    try {
      await api(`/services/${service.id}/days/${currentDay}/cancel`, { method: 'POST' });
      setRoleManagerOpen(false);
      setActiveAdvanceRowKey(null);
      await reload();
    } catch (err) {
      setDayActionError(dayActionErrorMessage(err, 'Não foi possível cancelar este dia.'));
    } finally {
      setDayActionBusy(false);
    }
  }

  async function reactivateCurrentDay() {
    if (!service?.isContinuous || !currentDay || !currentDayCancelled || dayActionBusy) return;
    if (!window.confirm(`Pretende reativar o dia ${formatDate(currentDay)}?`)) return;

    setDayActionBusy(true);
    setDayActionError('');
    setTeamError('');
    try {
      await api(`/services/${service.id}/days/${currentDay}/reactivate`, { method: 'POST' });
      await reload();
    } catch (err) {
      setDayActionError(dayActionErrorMessage(err, 'Não foi possível reativar este dia.'));
    } finally {
      setDayActionBusy(false);
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
            <button
              className="command-button"
              type="button"
              onClick={saveCurrentTab}
              disabled={savingTeam || savingBilling || (activeTab === 'team' && currentDayCancelled)}
            >
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
                <button
                  key={day}
                  type="button"
                  className={[
                    'service-tab',
                    currentDay === day ? 'service-tab--active' : '',
                    isEventDayCancelled(service, day) ? 'service-tab--cancelled' : '',
                  ].filter(Boolean).join(' ')}
                  title={isEventDayCancelled(service, day) ? `${formatDate(day)} - Cancelado` : formatDate(day)}
                  onClick={() => setSelectedDay(day)}
                >
                  {isEventDayCancelled(service, day) ? <Ban size={13} aria-hidden="true" /> : null}
                  <span>{formatDate(day).slice(0, 5)}</span>
                </button>
              ))}
            </div>
          ) : null}
          {dayActionError ? <p className="notice">{dayActionError}</p> : null}
          {currentDayCancelled ? (
            <div className="service-detail-cancelled-day service-detail-cancelled-day--notice">
              <span className="service-detail-cancelled-day__icon"><Ban size={22} /></span>
              <div>
                <h3>Dia cancelado</h3>
                <p>Este dia não será considerado para equipa, validações, financeiro ou faturação.</p>
              </div>
              <button
                className="secondary-button"
                type="button"
                disabled={dayActionBusy}
                onClick={reactivateCurrentDay}
              >
                <RotateCcw size={16} />
                {dayActionBusy ? 'A processar...' : 'Reativar dia'}
              </button>
            </div>
          ) : null}
          {!currentDayCancelled ? <>
          <div className="service-detail-role-toolbar">
            <div>
              <strong>{currentDayCancelled ? 'Dia cancelado' : 'Funções deste dia'}</strong>
              <span>
                {currentDayCancelled
                  ? `${formatDate(currentDay)} · Excluído do planeamento`
                  : `${currentDayRoles.length} função(ões) · ${currentDayRoles.reduce((sum, item) => sum + Number(item.qty || 0), 0)} lugar(es)`}
              </span>
            </div>
            <button
              className={`secondary-button${roleManagerOpen ? ' secondary-button--active' : ''}`}
              type="button"
              onClick={() => setRoleManagerOpen((current) => !current)}
              aria-expanded={roleManagerOpen}
            >
              <Settings2 size={16} />
              {roleManagerOpen ? 'Fechar gestão' : 'Gerir o dia'}
            </button>
          </div>
          {roleManagerOpen ? (
            <div className="service-detail-role-manager">
              <div className="service-detail-role-manager__heading">
                <div>
                  <strong>Gestão do dia</strong>
                  <span>{service.isContinuous ? `Configuração independente para ${formatDate(currentDay)}` : 'Configuração deste evento/serviço'}</span>
                </div>
              </div>
              {!currentDayCancelled ? <div className="service-detail-role-manager__list">
                {currentDayRoles.map((requirement, index) => (
                  <div className="service-detail-role-manager__row" key={`${currentDay || 'single'}-${requirement.role}`}>
                    <label>
                      <span>Função</span>
                      <input
                        defaultValue={requirement.role}
                        list="service-detail-role-options"
                        onBlur={(event) => renameDailyRole(requirement.role, event.target.value, event.target)}
                      />
                    </label>
                    <label className="service-detail-role-manager__qty">
                      <span>N.º</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        defaultValue={requirement.qty}
                        onBlur={(event) => updateDailyRoleQuantity(requirement.role, event.target.value, event.target)}
                      />
                    </label>
                    <div className="service-detail-role-manager__actions">
                      <button className="icon-button" type="button" title="Mover para cima" aria-label={`Mover ${requirement.role} para cima`} disabled={index === 0} onClick={() => moveDailyRole(requirement.role, -1)}>
                        <ChevronUp size={16} />
                      </button>
                      <button className="icon-button" type="button" title="Mover para baixo" aria-label={`Mover ${requirement.role} para baixo`} disabled={index === currentDayRoles.length - 1} onClick={() => moveDailyRole(requirement.role, 1)}>
                        <ChevronDown size={16} />
                      </button>
                      <button className="icon-button icon-button--danger" type="button" title="Eliminar função" aria-label={`Eliminar ${requirement.role}`} onClick={() => removeDailyRole(requirement.role)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
                {!currentDayRoles.length ? <p className="muted">Ainda não existem funções definidas para este dia.</p> : null}
              </div> : null}
              {!currentDayCancelled ? <div className="service-detail-role-manager__add">
                <label>
                  <span>Nova função</span>
                  <input
                    value={newRoleName}
                    list="service-detail-role-options"
                    placeholder="Selecionar ou escrever"
                    onChange={(event) => setNewRoleName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      addNewDailyRole();
                    }}
                  />
                </label>
                <label className="service-detail-role-manager__qty">
                  <span>N.º</span>
                  <input type="number" min="1" step="1" value={newRoleQty} onChange={(event) => setNewRoleQty(event.target.value)} />
                </label>
                <button className="command-button" type="button" onClick={addNewDailyRole}>
                  <Plus size={16} /> Adicionar função
                </button>
              </div> : null}
              {service.isContinuous && currentDay ? (
                <div className={`service-detail-day-manager${currentDayCancelled ? ' service-detail-day-manager--cancelled' : ''}`}>
                  <div className="service-detail-day-status">
                    {currentDayCancelled ? <Ban size={17} /> : <CalendarClock size={17} />}
                    <div>
                      <strong>{currentDayCancelled ? 'Dia cancelado' : 'Cancelar apenas este dia'}</strong>
                      <span>
                        {currentDayCancelled
                          ? 'Este dia está excluído da equipa, validação, financeiro e relatórios.'
                          : 'Os restantes dias do evento contínuo não serão alterados.'}
                      </span>
                    </div>
                  </div>
                  <button
                    className={currentDayCancelled ? 'secondary-button' : 'secondary-button secondary-button--danger'}
                    type="button"
                    disabled={dayActionBusy}
                    onClick={currentDayCancelled ? reactivateCurrentDay : cancelCurrentDay}
                  >
                    {currentDayCancelled ? <RotateCcw size={16} /> : <Ban size={16} />}
                    {dayActionBusy ? 'A processar...' : currentDayCancelled ? 'Reativar dia' : 'Cancelar dia'}
                  </button>
                </div>
              ) : null}
              <datalist id="service-detail-role-options">
                {collaboratorRoleOptions.map((role) => <option key={role} value={role} />)}
              </datalist>
            </div>
          ) : null}
          </> : null}
          {teamError ? <p className="notice">{teamError}</p> : null}
          {currentDayCancelled ? null : <div className="service-detail-team">
            {assignmentGroups.map((group) => {
              const roleCollapsed = collapsedRoles.has(group.role);
              return (
              <section key={group.role} className={`service-detail-role${roleCollapsed ? ' service-detail-role--collapsed' : ''}`}>
                <header>
                  <div className="service-detail-role-title">
                    <button
                      type="button"
                      className="service-detail-role-toggle"
                      aria-expanded={!roleCollapsed}
                      aria-label={`${roleCollapsed ? 'Expandir' : 'Recolher'} função ${group.role}`}
                      onClick={() => toggleRoleCollapsed(group.role)}
                    >
                      <span className="service-detail-role-toggle__label">
                        <strong>{group.role}</strong>
                        <span className="service-detail-role-count">{group.rows.length}</span>
                      </span>
                      {roleCollapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
                    </button>
                  </div>
                  <span className={`service-detail-role-sync-status${group.rows.length && group.rows.every((row) => row.clientSynced) ? ' service-detail-role-sync-status--complete' : ''}`}>
                    <CheckCircle2 size={14} />
                    Sincronizado {group.rows.filter((row) => row.clientSynced).length}/{group.rows.length}
                  </span>
                  <div className="service-detail-role-actions">
                    <span>{group.rows.length} linha(s)</span>
                    <button
                      className="secondary-button"
                      type="button"
                      aria-label="Adicionar colaborador"
                      title="Adicionar colaborador"
                      onClick={() => addTeamRow(group.role)}
                    >
                      <Plus size={15} />
                      Adicionar Colaborador
                    </button>
                  </div>
                </header>
                {!roleCollapsed ? <div className="service-detail-team-table">
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
                    const advances = advanceRows(assignment.advancePayments);
                    const salaryAdvanceTotal = staffAdvancesTotal(advances);
                    const carAdvanceTotal = staffCarAdvancesTotal(advances);
                    const advancesOpen = activeAdvanceRowKey === assignment.rowKey;
                    const rowKey = assignment.rowKey || `${assignment.id}-${assignmentWorkDate(assignment, service)}`;
                    const rowClasses = [
                      'service-detail-team-row',
                      assignment.isDraft ? 'service-detail-team-row--empty' : '',
                      assignment.status === 'confirmed' ? 'service-detail-team-row--confirmed' : '',
                    ].filter(Boolean).join(' ');
                    return (
                      <Fragment key={rowKey}>
                      <div className={rowClasses}>
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
                        <button
                          type="button"
                          className={`secondary-button service-detail-advance-button${advancesOpen ? ' service-detail-advance-button--active' : ''}`}
                          title={advancesOpen ? 'Fechar adiantamentos do colaborador' : 'Abrir adiantamentos do colaborador'}
                          aria-expanded={advancesOpen}
                          onClick={() => setActiveAdvanceRowKey(advancesOpen ? null : assignment.rowKey)}
                        >
                          Adiantamentos
                        </button>
                        <button type="button" className="icon-button icon-button--danger" onClick={() => removeTeamRow(assignment.rowKey)} title="Remover linha" aria-label="Remover linha">
                          <Trash2 size={15} />
                        </button>
                      </div>
                      </div>
                      {advancesOpen ? (
                        <div className="service-advance-panel service-detail-advance-panel">
                          <header>
                            <strong>Adiantamentos de {collaboratorName}</strong>
                            <span>Descontar: {money.format(salaryAdvanceTotal)}</span>
                            <span>Carro: {money.format(carAdvanceTotal)}</span>
                            <button type="button" className="secondary-button" onClick={() => addTeamAdvance(assignment.rowKey)}>
                              <Plus size={15} /> Adicionar adiantamento
                            </button>
                          </header>
                          {advances.map((advance) => (
                            <div key={advance.id} className="service-advance-row">
                              <input
                                type="date"
                                aria-label="Data do adiantamento"
                                value={advance.date || ''}
                                onChange={(event) => updateTeamAdvance(assignment.rowKey, advance.id, { date: event.target.value })}
                              />
                              <input
                                type="text"
                                inputMode="decimal"
                                aria-label="Valor do adiantamento"
                                placeholder="Valor"
                                value={advance.amount ?? ''}
                                onChange={(event) => updateTeamAdvance(assignment.rowKey, advance.id, { amount: event.target.value })}
                              />
                              <input
                                type="text"
                                aria-label="Motivo ou observação do adiantamento"
                                placeholder="Motivo/observação"
                                value={advance.note || ''}
                                onChange={(event) => updateTeamAdvance(assignment.rowKey, advance.id, { note: event.target.value })}
                              />
                              <label className="service-advance-car-check">
                                <input
                                  type="checkbox"
                                  checked={Boolean(advance.car)}
                                  onChange={(event) => updateTeamAdvance(assignment.rowKey, advance.id, { car: event.target.checked })}
                                />
                                <span>Carro</span>
                              </label>
                              <button
                                type="button"
                                className="icon-button icon-button--danger"
                                onClick={() => removeTeamAdvance(assignment.rowKey, advance.id)}
                                title="Remover adiantamento"
                                aria-label="Remover adiantamento"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          ))}
                          {!advances.length ? <p className="muted">Sem adiantamentos registados.</p> : null}
                        </div>
                      ) : null}
                      </Fragment>
                    );
                  })}
                </div> : null}
              </section>
              );
            })}
            {!assignmentGroups.length ? (
              <div className="service-detail-empty-team">
                <EmptyState
                  icon={Users}
                  title="Sem funções necessárias definidas"
                  description="Podes adicionar colaboradores diretamente nesta ficha ou definir funções necessárias se quiseres planear por cargo."
                  action={<button className="command-button" type="button" onClick={() => setRoleManagerOpen(true)}><Plus size={16} /> Adicionar função</button>}
                />
              </div>
            ) : null}
          </div>}
        </Card>
        {!currentDayCancelled ? <div className="service-detail-team-footer">
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
        </div> : null}
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
              <div><span>Horas Reais</span><strong>{durationHours(parseNumber(service?.realHours))}</strong></div>
              <div><span>Horas Faturáveis</span><strong>{durationHours(parseNumber(service?.billableHours))}</strong></div>
              <div><span>Staff</span><strong>{money.format(staffCost)}</strong></div>
              <div><span>Custo Real Parceiros</span><strong>{money.format(externalTotals.costAmount)}</strong></div>
              <div className={profit >= 0 ? 'service-detail-profit--positive' : 'service-detail-profit--negative'}><span>Margem %</span><strong>{financialMargin.marginPct.toFixed(1).replace('.', ',')}%</strong></div>
              <div className={profit >= 0 ? 'service-detail-profit--positive' : 'service-detail-profit--negative'}><span>Margem €</span><strong>{money.format(profit)}</strong></div>
              <div><span>Parceiros cobrados ao cliente</span><strong>{money.format(externalTotals.chargeAmount)}</strong></div>
              <div><span>Receita</span><strong>{money.format(totalRevenue)}</strong></div>
              <div><span>Despesas</span><strong>{money.format(expenses)}</strong><small>Inclui IVA: {money.format(taxAmount)}</small></div>
            </div>
            {financialWarnings.length ? (
              <div className="service-financial-warnings" role="status">
                {financialWarnings.map((warning) => <p key={warning.code}>{warning.message}</p>)}
              </div>
            ) : null}
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
            {rateHistory.map((entry, entryIndex) => (
              <div key={`${entry.at || 'rate'}-${entryIndex}`}>
                <Euro size={16} />
                <div>
                  <strong>{entry.type === 'snapshot' ? 'Valores/h registados no evento' : 'Valores/h do evento alterados'}</strong>
                  <span>{formatDate(entry.at)}</span>
                  {(entry.changes || []).map((change) => (
                    <span key={`${change.role}-${change.from}-${change.to}`}>
                      {change.role}: {money.format(parseNumber(change.from))} → {money.format(parseNumber(change.to))}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {!rateHistory.length ? <p className="muted">Sem alterações históricas de valores/h registadas.</p> : null}
        </Card>
      ) : null}

      <div className="service-detail-mobile-actions" aria-label="Ações do Evento/Serviço">
        <button className="secondary-button" type="button" onClick={() => navigate('/services')}>
          Voltar
        </button>
        <button className="command-button" type="button" onClick={saveCurrentTab} disabled={savingTeam || savingBilling}>
          <Save size={16} />
          {savingTeam || savingBilling ? 'A guardar...' : 'Guardar alterações'}
        </button>
      </div>

    </div>
  );
}
