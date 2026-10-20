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
  Copy,
  Edit3,
  Euro,
  FileClock,
  FileSpreadsheet,
  History,
  MapPin,
  MoreHorizontal,
  Plus,
  ReceiptText,
  Save,
  Settings2,
  Trash2,
  Users,
  WalletCards,
  RotateCcw,
} from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Badge from '../components/UI/Badge.jsx';
import Card from '../components/UI/Card.jsx';
import ClientPaymentReference from '../components/UI/ClientPaymentReference.jsx';
import ClientPaymentAdjustment from '../components/UI/ClientPaymentAdjustment.jsx';
import ClientReceiptEditor from '../components/Finance/ClientReceiptEditor.jsx';
import ClientReceiptAllocation, { receiptAllocationInput } from '../components/Finance/ClientReceiptAllocation.jsx';
import ClientPaymentTax from '../components/UI/ClientPaymentTax.jsx';
import { receiptMovements, receiptCanDelete, receiptTypeLabels } from '../utils/clientReceiptMovements.js';
import { clientReceiptTaxSummary } from '../utils/clientReceiptTax.js';
import { clientPaymentAdjustment, paymentFinancialSnapshot } from '../utils/clientPaymentAdjustment.js';
import Modal from '../components/UI/Modal.jsx';
import ExternalCostsEditor from '../components/Finance/ExternalCostsEditor.jsx';
import EmptyState from '../components/UI/EmptyState.jsx';
import TimeInput from '../components/UI/TimeInput.jsx';
import { useToast } from '../components/UI/ToastProvider.jsx';
import { useApi } from '../hooks/useApi.js';
import { useServiceTeamDraft } from '../hooks/useServiceTeamDraft.js';
import { useCollaboratorPickerPosition } from '../hooks/useCollaboratorPickerPosition.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { hasPermission, PERMISSIONS } from '../utils/accessPermissions.js';
import { isExternalOnlyService } from '../utils/externalServiceWorkflow.js';
import { buildClientPaymentPayload, clientPaymentDraft, clientPaymentSummary, clientReceiptInvoiceBlocker, clientReceiptReversalBlocker, clientSignalReversalBlocker } from '../utils/clientPayment.js';
import { clientPaymentAssessment, readClientPaymentRecord } from '../utils/clientPaymentRecord.js';
import { buildClientFinanceSnapshot } from '../utils/clientFinanceSnapshot.js';
import ClientBillingPeriods from '../components/Finance/ClientBillingPeriods.jsx';
import { api } from '../utils/api.js';
import { filterCollaboratorOptions } from '../utils/collaboratorSearch.js';
import { collaboratorRoleOptions } from '../utils/collaboratorRoles.js';
import { serviceDetailTabFromQuery } from '../utils/deepLinks.js';
import { eventFinancialWarnings } from '../utils/eventFinancialRules.js';
import { eventCostSummary } from '../utils/eventCostSummary.js';
import { createEmptyExternalCost, normalizeExternalCosts } from '../utils/externalCosts.js';
import { externalCostRowsForEditing, validateExternalCostDraft } from '../utils/externalCostEditing.js';
import { isEventDayCancelled } from '../utils/eventCancelledDays.js';
import { eventFinancialImpactMessage } from '../utils/eventFinancialImpact.js';
import { downloadEventAttendanceExcel } from '../utils/eventAttendanceExcel.js';
import { date, durationHours, money } from '../utils/formatters.js';
import {
  assignmentWorkDate,
  createManualTeamRow,
  dateKey,
  editableTeamRowsToAssignmentDrafts,
  editableTeamRowsToAssignmentPayloads,
  groupAssignmentsByRole,
  MANUAL_TEAM_ROLE,
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
import { decimalValue, roundedBillableHours } from '../utils/serviceFinance.js';

const tabs = [
  { id: 'summary', label: 'Resumo', icon: ClipboardList },
  { id: 'team', label: 'Colaboradores', icon: Users },
  { id: 'validation', label: 'Validação', icon: CheckCircle2 },
  { id: 'costs', label: 'Custos', icon: Euro },
  { id: 'history', label: 'Histórico', icon: History },
];

const weekdayFormatter = new Intl.DateTimeFormat('pt-PT', { weekday: 'long' });

function parseNumber(value) {
  const parsed = Number(String(value ?? 0).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function RoleCombobox({ defaultValue = '', value, options, placeholder, onChange, onCommit, onKeyDown }) {
  const isControlled = value !== undefined;
  const [draft, setDraft] = useState(isControlled ? value : defaultValue);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isControlled) setDraft(value ?? '');
  }, [isControlled, value]);

  useEffect(() => {
    if (!open) return undefined;
    function closeOnOutsideClick(event) {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);

  const normalizedDraft = String(draft || '').trim().toLocaleLowerCase('pt-PT');
  const filteredOptions = options.filter((option) => (
    !normalizedDraft || option.toLocaleLowerCase('pt-PT').includes(normalizedDraft)
  ));

  function updateValue(nextValue) {
    setDraft(nextValue);
    onChange?.(nextValue);
    setOpen(true);
  }

  function commitValue(nextValue = draft) {
    const result = onCommit?.(nextValue, inputRef.current);
    if (result === false && !isControlled) setDraft(defaultValue);
  }

  function selectOption(option) {
    setDraft(option);
    onChange?.(option);
    setOpen(false);
    commitValue(option);
  }

  return (
    <div className="service-detail-role-combobox" ref={wrapperRef}>
      <input
        ref={inputRef}
        value={draft ?? ''}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(event) => updateValue(event.target.value)}
        onBlur={() => {
          commitValue();
          window.setTimeout(() => setOpen(false), 0);
        }}
        onKeyDown={onKeyDown}
      />
      {open && filteredOptions.length ? (
        <div className="service-detail-role-combobox__options" role="listbox">
          {filteredOptions.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === draft}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOption(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
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

function formatWeekday(value) {
  const day = String(value || '').slice(0, 10);
  if (!day) return '';
  const parsed = new Date(`${day}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  const label = weekdayFormatter.format(parsed);
  return label.charAt(0).toLocaleUpperCase('pt-PT') + label.slice(1);
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
  const toast = useToast();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: services, loading, error, reload } = useApi('/services', [], { revalidateOnFocus: true });
  const { data: collaborators } = useApi('/collaborators?light=1', []);
  const service = useMemo(
    () => services.find((item) => String(item.id) === String(serviceId)),
    [serviceId, services],
  );
  const [activeTab, setActiveTab] = useState('summary');
  const { teamRows, setTeamRows, teamRoles, setTeamRoles, acceptSavedTeam } = useServiceTeamDraft(service);
  const [roleManagerOpen, setRoleManagerOpen] = useState(false);
  const [workLocationManagerOpen, setWorkLocationManagerOpen] = useState(false);
  const [workLocationFilter, setWorkLocationFilter] = useState('all');
  const [newWorkLocationName, setNewWorkLocationName] = useState('');
  const [workLocationBusy, setWorkLocationBusy] = useState(false);
  const [workLocationError, setWorkLocationError] = useState('');
  const [collapsedRoles, setCollapsedRoles] = useState(() => new Set());
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleQty, setNewRoleQty] = useState('1');
  const [savingTeam, setSavingTeam] = useState(false);
  const [teamError, setTeamError] = useState('');
  const [attendanceExportBusy, setAttendanceExportBusy] = useState(false);
  const [attendanceExportError, setAttendanceExportError] = useState('');
  const [activeAdvanceRowKey, setActiveAdvanceRowKey] = useState(null);
  const [dayActionBusy, setDayActionBusy] = useState(false);
  const [dayActionError, setDayActionError] = useState('');
  const [billingDraft, setBillingDraft] = useState({
    billingStatus: 'pending',
    signaledAmount: '',
    signaledAt: '',
    remainingPaymentDate: '',
    remainingReceived: '',
    billingPaymentDate: '',
  });
  const [savingBilling, setSavingBilling] = useState(false);
  const [reversingSignal, setReversingSignal] = useState(false);
  const billingReversalRef = useRef(false);
  const paymentScrollRef = useRef(null);
  const [billingError, setBillingError] = useState('');
  const [paymentEditor, setPaymentEditor] = useState(null);
  const [receiptAction, setReceiptAction] = useState(null);
  const [receiptAllocation, setReceiptAllocation] = useState({ enabled: false, amounts: {} });
  const [additionalPayment, setAdditionalPayment] = useState(null);
  const [additionalPaymentError, setAdditionalPaymentError] = useState('');
  const [externalCostEdit, setExternalCostEdit] = useState(null);
  const [externalCostRemoval, setExternalCostRemoval] = useState(null);
  const [externalCostError, setExternalCostError] = useState('');
  const [savingExternalCost, setSavingExternalCost] = useState(false);
  const externalCostSavingRef = useRef(false);
  const metrics = useMemo(() => serviceDetailMetrics(service || {}), [service]);
  const checklist = useMemo(() => serviceChecklist(service || {}), [service]);
  const externalOnly = isExternalOnlyService(service || {});
  const displayAssignments = useMemo(
    () => (teamRows.length || service ? teamRows : []),
    [service, teamRows],
  );
  const days = useMemo(() => serviceAssignmentDays({ ...(service || {}), assignments: displayAssignments }), [displayAssignments, service]);
  const [selectedDay, setSelectedDay] = useState('');
  const [activeTeamCollaboratorPickerKey, setActiveTeamCollaboratorPickerKey] = useState(null);
  const [teamCollaboratorPickerPlacement, setTeamCollaboratorPickerPlacement] = useState(null);
  const positionTeamCollaboratorPicker = useCollaboratorPickerPosition(activeTeamCollaboratorPickerKey !== null, setTeamCollaboratorPickerPlacement);
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
  const workLocations = useMemo(
    () => (service?.workLocationsEnabled ? [...(service.workLocations || [])] : [])
      .sort((left, right) => (
        Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
        || String(left.name || '').localeCompare(String(right.name || ''), 'pt')
      )),
    [service],
  );
  const currentDayAssignedRows = useMemo(
    () => assignmentGroups.flatMap((group) => group.rows).filter((row) => row.collaboratorId),
    [assignmentGroups],
  );
  const validWorkLocationIds = useMemo(
    () => new Set(workLocations.map((item) => String(item.id))),
    [workLocations],
  );
  const workLocationCounts = useMemo(() => {
    const counts = new Map();
    currentDayAssignedRows.forEach((row) => {
      const locationId = row.workLocationId ? String(row.workLocationId) : '';
      const key = locationId && validWorkLocationIds.has(locationId) ? locationId : 'unassigned';
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [currentDayAssignedRows, validWorkLocationIds]);
  const visibleAssignmentGroups = useMemo(() => {
    if (!service?.workLocationsEnabled || workLocationFilter === 'all') return assignmentGroups;
    return assignmentGroups
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) => (
          workLocationFilter === 'unassigned'
            ? !row.workLocationId || !validWorkLocationIds.has(String(row.workLocationId))
            : String(row.workLocationId || '') === workLocationFilter
        )),
      }))
      .filter((group) => group.rows.length);
  }, [assignmentGroups, service?.workLocationsEnabled, validWorkLocationIds, workLocationFilter]);
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
  const externalCostItems = useMemo(() => {
    try { return { rows: externalCostRowsForEditing(service?.externalCosts), error: '' }; }
    catch (err) { return { rows: [], error: err.message }; }
  }, [service]);
  const canEditExternalCosts = hasPermission(user, PERMISSIONS.SERVICES_UPDATE);
  const totalRevenue = parseNumber(service?.totalRevenue);
  const clientPaymentTotal = clientPaymentSummary(service || {}).total;
  const costs = useMemo(() => eventCostSummary(service || {}), [service]);
  const { staffCost } = costs;
  const profit = costs.margin;
  const financialWarnings = eventFinancialWarnings(
    service || {},
    service?.assignments || [],
    { revenue: totalRevenue, staff: costs.staffInclusiveCost },
  );
  const rateHistory = useMemo(() => safeJsonArray(service?.rateHistory), [service?.rateHistory]);
  const signalAmount = Math.max(0, decimalValue(billingDraft.signaledAmount) || 0);
  const clientPaidAmount = billingDraft.billingStatus === 'paid'
    ? signalAmount + Math.max(0, decimalValue(billingDraft.remainingReceived) || 0)
    : billingDraft.billingStatus === 'partial70'
      ? signalAmount + clientPaymentSummary(service || {}).remainingReceived
      : clientPaymentSummary(service || {}).received;
  const clientRemainingAmount = Number(Math.max(0, clientPaymentTotal - clientPaidAmount).toFixed(2));
  const signalReversalBlocker = clientSignalReversalBlocker(service || {});
  const receiptReversalBlocker = clientReceiptReversalBlocker(service || {});
  const receiptActionBlocker = clientReceiptInvoiceBlocker(service || {});
  const recordedClientPayment = clientPaymentSummary(service || {});
  const hasPriorSettlement = recordedClientPayment.remainingReceived > 0
    || (service?.billingStatus === 'paid' && recordedClientPayment.received > 0);
  const paymentAssessment = clientPaymentAssessment(service || {}, {
    total: clientPaymentTotal, received: clientPaidAmount, outstanding: clientRemainingAmount,
  });
  const paymentRecord = readClientPaymentRecord(service?.clientPaymentRecord);
  const clientFinance = service?.clientFinance || buildClientFinanceSnapshot(service || {});
  const originalAssessment = clientPaymentAssessment(service || {}, recordedClientPayment);
  const recordedAssessment = { ...originalAssessment, assessed: clientFinance.completed,
    label: originalAssessment.excess > 0 ? originalAssessment.label : clientFinance.paymentLabel };
  const receivedPercent = clientPaymentTotal > 0 ? Math.round(recordedClientPayment.received / clientPaymentTotal * 100) : 0;
  const receiptProjection = receiptMovements(paymentRecord);
  const receiptsManaged = Boolean(paymentRecord?.entries.some((entry) => entry.operation));
  const receiptTax = clientReceiptTaxSummary(service || {}, recordedClientPayment.received);
  const receiptSalesSnapshot = paymentFinancialSnapshot(service || {});
  const displayedReceipts = (paymentRecord?.entries.length ? receiptProjection.reliable ? receiptProjection.rows : paymentRecord.entries : [
    ...(recordedClientPayment.signal > 0 && recordedClientPayment.received > 0 ? [{ id: 'legacy-signal', type: 'signal',
      amount: Math.min(recordedClientPayment.signal, recordedClientPayment.received), receivedAt: service?.signaledAt }] : []),
    ...(recordedClientPayment.remainingReceived > 0 ? [{ id: 'legacy-remaining', type: 'remaining',
      amount: recordedClientPayment.remainingReceived, receivedAt: service?.billingPaymentDate }] : []),
  ]).filter((entry) => entry.voided !== 'delete');
  const originalAdditionalBreakdown = clientPaymentAdjustment(service || {}, recordedClientPayment.received);
  const additionalBreakdown = hasPriorSettlement && recordedClientPayment.outstanding > 0
    ? receiptTax.outstanding ? { available: true, ...receiptTax.outstanding, receivedTowards: 0, outstanding: recordedClientPayment.outstanding,
      components: originalAdditionalBreakdown?.base === receiptTax.outstanding.base && originalAdditionalBreakdown?.tax === receiptTax.outstanding.tax
        ? originalAdditionalBreakdown?.components || [] : [] }
      : paymentRecord?.entries.some((entry) => entry.operation) ? { available: false }
        : clientPaymentAdjustment(service || {}, recordedClientPayment.received) : null;
  const canReverseClientReceipts = hasPermission(user, PERMISSIONS.SERVICES_UPDATE)
    && hasPermission(user, PERMISSIONS.FINANCE_UPDATE_PAYMENTS);
  useLayoutEffect(() => {
    if (paymentEditor || additionalPayment || receiptAction || !paymentScrollRef.current) return;
    const position = paymentScrollRef.current;
    paymentScrollRef.current = null;
    window.scrollTo({ ...position, behavior: 'instant' });
  }, [paymentEditor, additionalPayment, receiptAction]);
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
    if (!service?.id) return;
    setTeamError('');
    setRoleManagerOpen(false);
    setWorkLocationManagerOpen(false);
    setWorkLocationFilter('all');
    setNewWorkLocationName('');
    setWorkLocationError('');
    setCollapsedRoles(new Set());
    setNewRoleName('');
    setNewRoleQty('1');
    setActiveTeamCollaboratorPickerKey(null);
    setTeamCollaboratorPickerPlacement(null);
    setActiveAdvanceRowKey(null);
  }, [service?.id]);

  useEffect(() => {
    if (!service) return;
    setBillingDraft(clientPaymentDraft(service));
    setBillingError('');
  }, [service]);

  function updateBillingDraft(patch) {
    setBillingDraft((current) => ({ ...current,
      ...(patch.billingStatus === 'paid' && current.billingStatus !== 'paid' ? {
        remainingReceived: String(Number(Math.max(0, clientPaymentTotal - (decimalValue(current.signaledAmount) || 0)).toFixed(2))).replace('.', ','),
      } : {}), ...patch }));
    setBillingError('');
  }

  function openPaymentEditor(mode = 'settings') {
    if (savingBilling || reversingSignal) return;
    const draft = clientPaymentDraft(service);
    if (mode === 'receipt') {
      draft.billingStatus = recordedClientPayment.signal > 0 ? 'paid' : 'partial70';
      if (draft.billingStatus === 'paid') draft.remainingReceived = String(recordedClientPayment.outstanding).replace('.', ',');
    }
    setBillingDraft(draft);
    setBillingError('');
    setPaymentEditor(mode);
    setReceiptAllocation({ enabled: false, amounts: {} });
  }

  function closePaymentEditor() {
    if (savingBilling || billingReversalRef.current) return;
    setPaymentEditor(null);
    setBillingDraft(clientPaymentDraft(service));
    setBillingError('');
  }

  function registerClientReceipt() {
    setReceiptAllocation({ enabled: false, amounts: {} });
    if (hasPriorSettlement) {
      setAdditionalPaymentError('');
      setAdditionalPayment({ amount: String(recordedClientPayment.outstanding).replace('.', ','),
        receivedAt: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
        updatedAt: service.updatedAt });
    } else openPaymentEditor('receipt');
  }

  async function saveClientPayment() {
    if (!service || savingBilling || reversingSignal || billingReversalRef.current) return;
    let payload;
    try {
      payload = buildClientPaymentPayload(billingDraft, service);
      if (receiptAllocation.enabled) {
        payload.receiptAllocations = receiptAllocationInput(receiptSalesSnapshot, receiptAllocation);
        payload.receiptAllocationUpdatedAt = service.updatedAt;
      }
    } catch (err) {
      setBillingError(err.message);
      return;
    }

    setSavingBilling(true);
    billingReversalRef.current = true;
    paymentScrollRef.current = { left: window.scrollX, top: window.scrollY };
    setBillingError('');
    try {
      await api(`/services/${service.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      await reload({ background: true });
      setPaymentEditor(null);
      toast.success('Pagamento guardado.');
      window.dispatchEvent(new window.Event('extrasolutio:client-payment-changed'));
    } catch (err) {
      paymentScrollRef.current = null;
      setBillingError(err.message || 'Não foi possível guardar o pagamento.');
    } finally {
      setSavingBilling(false);
      billingReversalRef.current = false;
    }
  }

  async function saveAdditionalClientPayment(event) {
    event.preventDefault();
    if (savingBilling || billingReversalRef.current || !additionalPayment) return;
    billingReversalRef.current = true;
    paymentScrollRef.current = { left: window.scrollX, top: window.scrollY };
    setSavingBilling(true); setAdditionalPaymentError('');
    try {
      await api(`/services/${service.id}/client-payment/receive-additional`, {
        method: 'POST', body: JSON.stringify({ ...additionalPayment,
          ...(receiptAllocation.enabled ? { receiptAllocations: receiptAllocationInput(receiptSalesSnapshot, receiptAllocation) } : {}) }),
      });
      await reload({ background: true }); setAdditionalPayment(null);
      window.dispatchEvent(new window.Event('extrasolutio:client-payment-changed'));
      toast.success('Recebimento adicional registado. Os pagamentos anteriores foram mantidos.');
    } catch (err) { paymentScrollRef.current = null; setAdditionalPaymentError(err.message || 'Não foi possível registar o recebimento.'); }
    finally { billingReversalRef.current = false; setSavingBilling(false); }
  }

  async function saveReceiptMovement(payload) {
    if (!receiptAction || billingReversalRef.current) return;
    billingReversalRef.current = true; setSavingBilling(true);
    paymentScrollRef.current = { left: window.scrollX, top: window.scrollY };
    try {
      await api(`/services/${service.id}/client-payment/movements/${encodeURIComponent(receiptAction.movement.id)}`, {
        method: 'POST', body: JSON.stringify({ ...payload, updatedAt: receiptAction.updatedAt, revision: receiptAction.revision,
          confirmedAmount: receiptAction.movement.amount }),
      });
      await reload({ background: true }); setReceiptAction(null);
      window.dispatchEvent(new window.Event('extrasolutio:client-payment-changed'));
      toast.success('Recebimento atualizado. Os restantes movimentos foram mantidos.');
    } catch (err) { paymentScrollRef.current = null; throw err; }
    finally { billingReversalRef.current = false; setSavingBilling(false); }
  }

  async function revertClientSignal(allReceipts = false) {
    if (!service || savingBilling || reversingSignal || billingReversalRef.current) return;
    const blocker = allReceipts ? receiptReversalBlocker : signalReversalBlocker;
    if (blocker) { setBillingError(blocker); return; }
    if (allReceipts && !canReverseClientReceipts) return;
    const confirmation = allReceipts
      ? `Reverter todos os recebimentos de ${service.name}?\nEsta ação irá reverter TODOS os recebimentos registados neste evento. Pretende continuar?\nSinalização: ${money.format(recordedClientPayment.signal)}\nRecebimentos posteriores: ${money.format(recordedClientPayment.remainingReceived)}\nTotal recebido a anular: ${money.format(recordedClientPayment.received)}\n\nO serviço ficará Pendente, com ${money.format(totalRevenue)} por receber. O valor do serviço não muda. Esta ação corrige os registos; não efetua um reembolso. Confirma que foram registados por engano ou em simulação?`
      : 'Tem a certeza de que pretende reverter esta sinalização? Os valores do pagamento serão recalculados.';
    if (!window.confirm(confirmation)) return;
    billingReversalRef.current = true;
    setReversingSignal(true);
    setBillingError('');
    try {
      await api(`/services/${service.id}/client-payment/${allReceipts ? 'reverse-receipts' : 'reverse-signal'}`, {
        method: 'POST', body: JSON.stringify({ updatedAt: service.updatedAt || null,
          ...(allReceipts ? { confirmedReceived: recordedClientPayment.received, confirmedSignal: recordedClientPayment.signal } : {}) }),
      });
      await reload();
      toast.success(allReceipts ? 'Recebimentos revertidos. O serviço ficou pendente de pagamento.' : 'Sinalização revertida.');
      window.dispatchEvent(new window.Event('extrasolutio:client-payment-changed'));
    } catch (err) {
      setBillingError(err.message || 'Não foi possível reverter a sinalização.');
    } finally {
      billingReversalRef.current = false;
      setReversingSignal(false);
    }
  }

  function openExternalCost(item = null) {
    if (!service || savingExternalCost) return;
    const id = item?.id || (globalThis.crypto?.randomUUID?.() || `external-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const normalized = item ? normalizeExternalCosts([item])[0] || {} : null;
    const draft = item ? { ...normalized, id, costAmount: String(normalized.costAmount ?? '') }
      : { ...createEmptyExternalCost(), id };
    setExternalCostEdit({ costId: item?.id || null, draft, updatedAt: service.updatedAt });
    setExternalCostError('');
  }

  function closeExternalCost() {
    if (!externalCostSavingRef.current) { setExternalCostEdit(null); setExternalCostError(''); }
  }

  function closeExternalCostRemoval() {
    if (!externalCostSavingRef.current) { setExternalCostRemoval(null); setExternalCostError(''); }
  }

  async function confirmExternalCostRemoval() {
    if (!externalCostRemoval || !service || externalCostSavingRef.current) return;
    externalCostSavingRef.current = true;
    setSavingExternalCost(true);
    setExternalCostError('');
    try {
      await api(`/services/${service.id}/external-costs/${encodeURIComponent(externalCostRemoval.item.id)}`, {
        method: 'DELETE', body: JSON.stringify({ updatedAt: externalCostRemoval.updatedAt }),
      });
      await reload();
      setExternalCostRemoval(null);
      toast.success('Custo externo eliminado. Totais do evento atualizados.');
    } catch (err) {
      setExternalCostError(err.message || 'Não foi possível eliminar o custo externo.');
    } finally {
      externalCostSavingRef.current = false;
      setSavingExternalCost(false);
    }
  }

  async function saveExternalCost(event) {
    event.preventDefault();
    if (!externalCostEdit || !service || externalCostSavingRef.current) return;
    let cost;
    try { cost = validateExternalCostDraft(externalCostEdit.draft); }
    catch (err) { setExternalCostError(err.message); return; }
    externalCostSavingRef.current = true;
    setSavingExternalCost(true);
    setExternalCostError('');
    try {
      const suffix = externalCostEdit.costId ? `/${encodeURIComponent(externalCostEdit.costId)}` : '';
      await api(`/services/${service.id}/external-costs${suffix}`, {
        method: externalCostEdit.costId ? 'PUT' : 'POST',
        body: JSON.stringify({ cost, updatedAt: externalCostEdit.updatedAt }),
      });
      await reload();
      setExternalCostEdit(null);
      toast.success('Custo externo guardado. Totais do evento atualizados.');
    } catch (err) {
      setExternalCostError(err.message || 'Não foi possível guardar o custo externo.');
    } finally {
      externalCostSavingRef.current = false;
      setSavingExternalCost(false);
    }
  }

  useEffect(() => {
    const requestedDay = searchParams.get('day');
    if (requestedDay && days.includes(requestedDay)) {
      if (selectedDay !== requestedDay) setSelectedDay(requestedDay);
      const nextParams = new window.URLSearchParams(searchParams);
      nextParams.delete('day');
      nextParams.delete('push');
      setSearchParams(nextParams, { replace: true });
      return;
    }
    const nextDay = resolveSelectedTeamDay({
      isContinuous: Boolean(service?.isContinuous),
      days,
      selectedDay,
    });
    if (nextDay !== selectedDay) setSelectedDay(nextDay);
  }, [days, selectedDay, service?.isContinuous, searchParams, setSearchParams]);

  useEffect(() => {
    setDayActionError('');
    setRoleManagerOpen(false);
    setWorkLocationFilter('all');
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
    return () => {
      document.removeEventListener('pointerdown', closePickerFromOutside);
      document.removeEventListener('keydown', closePickerOnEscape);
    };
  }, [activeTeamCollaboratorPickerKey]);

  useEffect(() => {
    if (activeTeamCollaboratorPickerKey === null) return undefined;
    const frameId = window.requestAnimationFrame(() => {
      teamCollaboratorSearchRef.current?.focus({ preventScroll: true });
      teamCollaboratorSearchRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeTeamCollaboratorPickerKey]);

  function updateTeamRow(rowKey, patch) {
    setTeamRows((current) => current.map((row) => (row.rowKey === rowKey ? { ...row, ...patch } : row)));
  }

  async function activateWorkLocations() {
    if (!service || workLocationBusy) return;
    setWorkLocationBusy(true);
    setWorkLocationError('');
    try {
      await api(`/services/${service.id}`, {
        method: 'PUT',
        body: JSON.stringify({ workLocationsEnabled: true }),
      });
      setWorkLocationManagerOpen(true);
      await reload();
    } catch (err) {
      setWorkLocationError(err?.message || 'Não foi possível ativar os Locais/Áreas de Trabalho.');
    } finally {
      setWorkLocationBusy(false);
    }
  }

  async function addWorkLocation() {
    const name = String(newWorkLocationName || '').trim();
    if (!service || !name || workLocationBusy) return;
    setWorkLocationBusy(true);
    setWorkLocationError('');
    try {
      await api(`/services/${service.id}/work-locations`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setNewWorkLocationName('');
      await reload();
    } catch (err) {
      setWorkLocationError(err?.message || 'Não foi possível adicionar o Local de Trabalho.');
    } finally {
      setWorkLocationBusy(false);
    }
  }

  async function renameWorkLocation(workLocation, nextName, inputElement) {
    const name = String(nextName || '').trim();
    if (!name || name === workLocation.name || workLocationBusy) {
      if (!name && inputElement) inputElement.value = workLocation.name;
      return;
    }
    setWorkLocationBusy(true);
    setWorkLocationError('');
    try {
      await api(`/work-locations/${workLocation.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      });
      await reload();
    } catch (err) {
      if (inputElement) inputElement.value = workLocation.name;
      setWorkLocationError(err?.message || 'Não foi possível alterar o Local de Trabalho.');
    } finally {
      setWorkLocationBusy(false);
    }
  }

  async function removeWorkLocation(workLocation) {
    if (!workLocation || workLocationBusy) return;
    const confirmed = window.confirm(`Remover o Local de Trabalho "${workLocation.name}" deste evento?`);
    if (!confirmed) return;
    setWorkLocationBusy(true);
    setWorkLocationError('');
    try {
      await api(`/work-locations/${workLocation.id}`, { method: 'DELETE' });
      if (workLocationFilter === String(workLocation.id)) setWorkLocationFilter('all');
      await reload();
    } catch (err) {
      setWorkLocationError(err?.message || 'Não foi possível remover o Local de Trabalho.');
    } finally {
      setWorkLocationBusy(false);
    }
  }

  async function moveWorkLocation(workLocation, direction) {
    const currentIndex = workLocations.findIndex((item) => item.id === workLocation.id);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= workLocations.length || workLocationBusy) return;
    const reordered = [...workLocations];
    [reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]];
    setWorkLocationBusy(true);
    setWorkLocationError('');
    try {
      await api(`/services/${service.id}/work-locations/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ ids: reordered.map((item) => item.id) }),
      });
      await reload();
    } catch (err) {
      setWorkLocationError(err?.message || 'Não foi possível reordenar os Locais de Trabalho.');
    } finally {
      setWorkLocationBusy(false);
    }
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

    positionTeamCollaboratorPicker(event.currentTarget);
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
      return false;
    }
    if (normalizedRoleKey(nextRole) === normalizedRoleKey(currentRole)) return true;
    if (currentDayRoles.some((item) => normalizedRoleKey(item.role) === normalizedRoleKey(nextRole))) {
      setTeamError(`A função "${nextRole}" já existe neste dia.`);
      if (inputElement) inputElement.value = currentRole;
      return false;
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
    return true;
  }

  async function exportCurrentDayAttendance() {
    if (!service || !currentDay || attendanceExportBusy) return;
    setAttendanceExportError('');
    if (currentDayCancelled) {
      setAttendanceExportError('Reativa este dia antes de gerar a folha de registo de horas.');
      return;
    }
    if (!currentDayAssignedRows.length) {
      setAttendanceExportError('Não existem colaboradores atribuídos ao dia selecionado.');
      return;
    }

    setAttendanceExportBusy(true);
    try {
      await downloadEventAttendanceExcel({
        event: service,
        selectedDay: currentDay,
        assignments: currentDayAssignedRows,
        collaborators: activeCollaborators,
        workLocations,
      });
    } catch (err) {
      setAttendanceExportError(err?.message || 'Não foi possível gerar a folha de registo de horas.');
    } finally {
      setAttendanceExportBusy(false);
    }
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
      const refreshedEvent = await api(`/services/${service.id}`);
      const impactMessage = eventFinancialImpactMessage(service, refreshedEvent);
      if (impactMessage) toast.info(impactMessage);
      acceptSavedTeam(refreshedEvent);
      await reload({ background: true });
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
      openPaymentEditor();
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
            <Link className="secondary-button" to={`/services?duplicateServiceId=${service.id}`}>
              <Copy size={16} />
              Duplicar evento
            </Link>
            {!externalOnly && <Link className="secondary-button" to={`/time-validation?eventId=${service.id}`}>
              <Clock size={16} />
              Validação de Horas
            </Link>}
            <Link className="secondary-button" to={`/finance?area=${financeArea}&eventId=${service.id}`}>
              <WalletCards size={16} />
              Financeiro
            </Link>
            <button className="secondary-button secondary-button--danger" type="button" onClick={deleteEvent}>
              <Trash2 size={16} />
              Eliminar evento
            </button>
            {activeTab !== 'costs' ? <button
              className="command-button"
              type="button"
              onClick={saveCurrentTab}
              disabled={savingTeam || savingBilling || savingExternalCost || (activeTab === 'team' && currentDayCancelled)}
            >
              <Save size={16} />
              Guardar alterações
            </button> : null}
          </div>
        </div>

        <div className="service-detail-title-row">
          <div>
            <span className="eyebrow">Ficha do Evento/Serviço</span>
            <h1>{service.name}</h1>
            <p>{service.client?.name || service.clientName || 'Cliente por associar'} · {formatDateRange(service)}</p>
            {service.serviceReference ? (
              <span className="service-detail-reference">Ref. interna: {service.serviceReference}</span>
            ) : null}
          </div>
          <Badge tone={service.status === 'finalized' ? 'success' : 'info'}>{statusLabel(service.status)}</Badge>
        </div>

        <div className="service-detail-progress-grid">
          {externalOnly ? <>
            <ProgressStat label="Operação" value="Parceiro externo" detail="Sem Staff próprio" tone="info" />
            <ProgressStat label="Execução" value={service.status === 'finalized' ? 'Concluída' : 'Por concluir'}
              detail={service.status === 'finalized' ? 'Serviço realizado' : 'Serviço ainda não finalizado'}
              tone={service.status === 'finalized' ? 'success' : 'warning'} />
          </> : <>
            <ProgressStat label="Equipa" value={`${metrics.confirmed}/${metrics.requested || metrics.assigned}`} detail="confirmados" tone={metrics.teamComplete ? 'success' : 'warning'} />
            <ProgressStat label="Staff" value={`${metrics.staffFilled}/${metrics.assigned}`} detail={metrics.staffAcceptedComplete ? 'horários aceites' : 'horários guardados'} tone={metrics.staffHoursComplete ? 'success' : 'warning'} />
            <ProgressStat label="Cliente" value={`${metrics.clientFilled}/${metrics.assigned}`} detail="horários preenchidos" tone={metrics.clientHoursComplete ? 'success' : 'warning'} />
          </>}
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
              {service.serviceReference ? <InfoItem label="Referência interna" value={service.serviceReference} /> : null}
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
        <fieldset className="service-detail-team-editor" disabled={savingTeam}>
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
                  <span className="service-detail-day-tab__content">
                    <span>{formatDate(day).slice(0, 5)}</span>
                    {currentDay === day ? <small>{formatWeekday(day)}</small> : null}
                  </span>
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
            <div className="service-detail-role-toolbar__actions">
              {!service.workLocationsEnabled ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={activateWorkLocations}
                  disabled={workLocationBusy}
                >
                  <MapPin size={16} />
                  {workLocationBusy ? 'A ativar...' : 'Ativar Locais/Áreas'}
                </button>
              ) : (
                <button
                  className={`secondary-button${workLocationManagerOpen ? ' secondary-button--active' : ''}`}
                  type="button"
                  onClick={() => setWorkLocationManagerOpen((current) => !current)}
                  aria-expanded={workLocationManagerOpen}
                >
                  <MapPin size={16} />
                  {workLocationManagerOpen ? 'Fechar locais' : 'Gerir locais'}
                </button>
              )}
              <button
                className={`secondary-button${roleManagerOpen ? ' secondary-button--active' : ''}`}
                type="button"
                onClick={() => setRoleManagerOpen((current) => !current)}
                aria-expanded={roleManagerOpen}
              >
                <Settings2 size={16} />
                {roleManagerOpen ? 'Fechar gestão' : 'Gerir o dia'}
              </button>
              <button
                className="secondary-button service-detail-attendance-export__button"
                type="button"
                disabled={attendanceExportBusy || !currentDayAssignedRows.length}
                title={currentDayAssignedRows.length
                  ? `Gerar folha de registo de horas de ${formatDate(currentDay)}`
                  : 'Adiciona colaboradores a este dia antes de gerar a folha'}
                onClick={exportCurrentDayAttendance}
              >
                <FileSpreadsheet size={16} />
                {attendanceExportBusy ? 'A gerar...' : 'Folha de Registo de Horas'}
              </button>
            </div>
          </div>
          {attendanceExportError ? <p className="notice">{attendanceExportError}</p> : null}
          {workLocationError ? <p className="notice">{workLocationError}</p> : null}
          {service.workLocationsEnabled && workLocationManagerOpen ? (
            <div className="service-detail-work-location-manager">
              <div className="service-detail-role-manager__heading">
                <div>
                  <strong>Locais / Áreas de Trabalho</strong>
                  <span>Configuração deste evento. A atribuição pode variar em cada dia.</span>
                </div>
              </div>
              <div className="service-detail-work-location-manager__list">
                {workLocations.map((workLocation, index) => (
                  <div className="service-detail-work-location-manager__row" key={workLocation.id}>
                    <div className="service-detail-work-location-manager__identity">
                      <MapPin size={15} aria-hidden="true" />
                      <input
                        defaultValue={workLocation.name}
                        aria-label={`Nome do local ${workLocation.name}`}
                        onBlur={(event) => renameWorkLocation(workLocation, event.target.value, event.target)}
                      />
                    </div>
                    <span>{workLocationCounts.get(String(workLocation.id)) || 0} neste dia</span>
                    <div className="service-detail-work-location-manager__actions">
                      <button className="icon-button" type="button" title="Mover para cima" aria-label={`Mover ${workLocation.name} para cima`} disabled={index === 0 || workLocationBusy} onClick={() => moveWorkLocation(workLocation, -1)}>
                        <ChevronUp size={16} />
                      </button>
                      <button className="icon-button" type="button" title="Mover para baixo" aria-label={`Mover ${workLocation.name} para baixo`} disabled={index === workLocations.length - 1 || workLocationBusy} onClick={() => moveWorkLocation(workLocation, 1)}>
                        <ChevronDown size={16} />
                      </button>
                      <button className="icon-button icon-button--danger" type="button" title="Eliminar local" aria-label={`Eliminar ${workLocation.name}`} disabled={workLocationBusy} onClick={() => removeWorkLocation(workLocation)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
                {!workLocations.length ? <p className="muted">Ainda não existem locais definidos para este evento.</p> : null}
              </div>
              <div className="service-detail-work-location-manager__add">
                <label>
                  <span>Novo local / área</span>
                  <input
                    value={newWorkLocationName}
                    placeholder="Ex.: Lounge A, VIP, Backstage"
                    onChange={(event) => setNewWorkLocationName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      addWorkLocation();
                    }}
                  />
                </label>
                <button className="command-button" type="button" onClick={addWorkLocation} disabled={workLocationBusy || !newWorkLocationName.trim()}>
                  <Plus size={16} />
                  Adicionar local
                </button>
              </div>
            </div>
          ) : null}
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
                      <RoleCombobox
                        defaultValue={requirement.role}
                        options={collaboratorRoleOptions}
                        onCommit={(nextValue, inputElement) => renameDailyRole(requirement.role, nextValue, inputElement)}
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
                  <RoleCombobox
                    value={newRoleName}
                    options={collaboratorRoleOptions}
                    placeholder="Selecionar ou escrever"
                    onChange={setNewRoleName}
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
            </div>
          ) : null}
          </> : null}
          {teamError ? <p className="notice">{teamError}</p> : null}
          {service.workLocationsEnabled && !currentDayCancelled ? (
            <div className="service-detail-work-location-summary">
              <div className="service-detail-work-location-summary__counts">
                {workLocations.map((workLocation) => (
                  <span key={workLocation.id}>
                    <MapPin size={13} />
                    {workLocation.name}
                    <strong>{workLocationCounts.get(String(workLocation.id)) || 0}</strong>
                  </span>
                ))}
                <span className={(workLocationCounts.get('unassigned') || 0) > 0 ? 'service-detail-work-location-summary__warning' : ''}>
                  Sem local
                  <strong>{workLocationCounts.get('unassigned') || 0}</strong>
                </span>
              </div>
              <label className="service-detail-work-location-filter">
                <span>Filtrar por local</span>
                <select value={workLocationFilter} onChange={(event) => setWorkLocationFilter(event.target.value)}>
                  <option value="all">Todos os locais</option>
                  {workLocations.map((workLocation) => (
                    <option key={workLocation.id} value={String(workLocation.id)}>{workLocation.name}</option>
                  ))}
                  <option value="unassigned">Sem local atribuído</option>
                </select>
              </label>
              {(workLocationCounts.get('unassigned') || 0) > 0 ? (
                <p className="service-detail-work-location-warning">
                  <MapPin size={15} />
                  Existem colaboradores sem Local de Trabalho atribuído. Podes guardar e completar mais tarde.
                </p>
              ) : null}
            </div>
          ) : null}
          {currentDayCancelled ? null : <div className="service-detail-team">
            {visibleAssignmentGroups.map((group) => {
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
                  <div className={`service-detail-team-columns${service.workLocationsEnabled ? ' service-detail-team-columns--work-locations' : ''}`} aria-hidden="true">
                    <span>Colaborador</span>
                    {service.workLocationsEnabled ? <span>Local de Trabalho</span> : null}
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
                      service.workLocationsEnabled ? 'service-detail-team-row--work-locations' : '',
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
                                type="text"
                                aria-label="Pesquisar colaborador para alocar"
                                autoComplete="off"
                                autoCapitalize="none"
                                spellCheck={false}
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
                      {service.workLocationsEnabled ? (
                        <label className="service-detail-work-location-field">
                          <span>Local de Trabalho</span>
                          <select
                            value={validWorkLocationIds.has(String(assignment.workLocationId || '')) ? String(assignment.workLocationId) : ''}
                            onChange={(event) => updateTeamRow(assignment.rowKey, { workLocationId: event.target.value })}
                          >
                            <option value="">Por atribuir</option>
                            {workLocations.map((workLocation) => (
                              <option key={workLocation.id} value={String(workLocation.id)}>{workLocation.name}</option>
                            ))}
                          </select>
                        </label>
                      ) : null}
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
            {assignmentGroups.length && !visibleAssignmentGroups.length ? (
              <div className="service-detail-empty-team">
                <EmptyState
                  icon={MapPin}
                  title="Sem colaboradores neste local"
                  description="Nao existem colaboradores atribuidos ao local selecionado neste dia."
                  action={<button className="secondary-button" type="button" onClick={() => setWorkLocationFilter('all')}>Ver todos os locais</button>}
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
        </fieldset>
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
          <Card title="Resumo financeiro" className="service-detail-card service-detail-cost-summary">
            <div className="event-finance-hours">
              <div><Clock size={20} aria-hidden="true" /><span>Horas Reais<strong data-finance-metric="Horas Reais">{durationHours(parseNumber(service?.realHours))}</strong></span></div>
              <div><Clock size={20} aria-hidden="true" /><span>Horas Faturáveis<strong data-finance-metric="Horas Faturáveis">{durationHours(parseNumber(service?.billableHours))}</strong></span></div>
            </div>
            <table className="event-finance-comparison" aria-label="Comparação de custos internos e valores cobrados ao cliente">
              <thead><tr>
                <th scope="col">Componente</th>
                <th scope="col"><WalletCards size={16} aria-hidden="true" />Custos internos</th>
                <th scope="col"><ReceiptText size={16} aria-hidden="true" />Cobrado ao cliente<small>Sem IVA de venda</small></th>
              </tr></thead>
              <tbody>
                <tr><th scope="row">{costs.costBreakdownComplete ? 'Staff' : 'Staff e deslocação'}{!costs.costBreakdownComplete ? <small>Por discriminar no total guardado</small> : null}</th>
                  <td><strong data-finance-metric="Custo Staff">{money.format(staffCost)}</strong></td>
                  <td><strong data-finance-metric="Staff cobrado ao cliente">{costs.staffSale === null ? 'Por discriminar' : money.format(costs.staffSale)}</strong></td>
                </tr>
                <tr><th scope="row">Parceiros</th>
                  <td><strong data-finance-metric="Custo Real Parceiros">{money.format(costs.partnerCost)}</strong></td>
                  <td><strong data-finance-metric="Parceiros cobrados ao cliente">{money.format(costs.partnerSale)}</strong></td>
                </tr>
                {costs.travelSale !== 0 || costs.travelCost !== 0 ? <tr><th scope="row">Deslocação</th>
                  <td><strong data-finance-metric="Custo Deslocação">{costs.costBreakdownComplete ? money.format(costs.travelCost) : 'Por discriminar'}</strong></td>
                  <td><strong data-finance-metric="Deslocação cobrada ao cliente">{money.format(costs.travelSale)}</strong></td>
                </tr> : null}
                {Math.abs(costs.undiscriminated) >= 0.01 ? <tr><th scope="row">Valor por discriminar<small>No total guardado</small></th>
                  <td><span className="muted">—</span></td>
                  <td><strong data-finance-metric="Valor por discriminar no total guardado">{money.format(costs.undiscriminated)}</strong></td>
                </tr> : null}
              </tbody>
              <tfoot><tr><th scope="row">Totais</th>
                <td><strong data-finance-metric="Despesas">{money.format(costs.expenses)}</strong></td>
                <td><strong>{money.format(costs.netSale)}</strong></td>
              </tr></tfoot>
            </table>
            {costs.travelSale !== 0 || costs.travelCost !== 0 ? <details className="event-finance-travel-detail">
              <summary>Detalhe da deslocação</summary>
              <table className="event-finance-comparison" aria-label="Detalhe dos custos e venda de deslocação">
                <thead><tr><th scope="col">Componente</th><th scope="col">Custos internos</th><th scope="col">Cliente · sem IVA</th></tr></thead>
                <tbody>
                  <tr><th scope="row">Carro / Km</th><td>{costs.costBreakdownComplete ? money.format(costs.travelCarCost) : 'Por discriminar'}</td><td>{money.format(costs.travelSaleBreakdown.kilometers)}</td></tr>
                  <tr><th scope="row">Tempo de trajeto</th><td>{costs.costBreakdownComplete ? money.format(costs.travelTimeCost) : 'Por discriminar'}</td><td>{money.format(costs.travelSaleBreakdown.time)}</td></tr>
                  {costs.travelSaleBreakdown.other !== 0 ? <tr><th scope="row">Outras deslocações / valor guardado</th><td>—</td><td>{money.format(costs.travelSaleBreakdown.other)}</td></tr> : null}
                </tbody>
                <tfoot><tr><th scope="row">Total deslocação</th><td>{costs.costBreakdownComplete ? money.format(costs.travelCost) : 'Por discriminar'}</td><td>{money.format(costs.travelSale)}</td></tr></tfoot>
              </table>
              {costs.travelMargin !== null ? <p>Margem da deslocação <strong data-finance-metric="Margem da deslocação">{money.format(costs.travelMargin)}</strong></p> : null}
            </details> : null}
            <dl className="event-finance-invoice">
              <div><dt>Venda sem IVA</dt><dd><strong data-finance-metric="Venda sem IVA">{money.format(costs.netSale)}</strong></dd></div>
              <div><dt>+ IVA de venda</dt><dd><strong data-finance-metric="IVA de venda">{money.format(costs.tax)}</strong></dd>
                {costs.taxBreakdown ? <dd className="service-detail-vat-breakdown">
                  <span>Staff: {money.format(costs.taxBreakdown.staffTax)}</span>
                  <span>Parceiros: {money.format(costs.taxBreakdown.partnerTax)}</span>
                  {costs.taxBreakdown.travelTax !== 0 ? <span>Deslocações: {money.format(costs.taxBreakdown.travelTax)}</span> : null}
                </dd> : null}
              </div>
              <div className="event-finance-invoice-total"><dt>Total a cobrar ao cliente</dt><dd><strong data-finance-metric="Receita com IVA">{money.format(totalRevenue)}</strong></dd></div>
            </dl>
            <div className={`event-finance-result ${profit >= 0 ? 'service-detail-profit--positive' : 'service-detail-profit--negative'}`}>
              <div><span>Margem do evento</span><strong data-finance-metric="Margem €">{money.format(profit)}</strong>
                <small>{money.format(costs.netSale)} − {money.format(costs.expenses)}</small>
              </div>
              <div><strong data-finance-metric="Margem %">{costs.marginPct.toFixed(1).replace('.', ',')}%</strong><small>Sobre receita com IVA</small></div>
            </div>
            {financialWarnings.length ? (
              <div className="service-financial-warnings" role="status">
                {financialWarnings.map((warning) => <p key={warning.code}>{warning.message}</p>)}
              </div>
            ) : null}
          </Card>
          <Card title="Pagamento do cliente" className="service-detail-card service-detail-payment-card payment-overview"
            action={<div className="payment-overview-heading-actions">
              <Badge tone={recordedAssessment.fullyReceived && !recordedAssessment.excess ? 'success' : recordedClientPayment.received > 0 ? 'warning' : 'neutral'}>{recordedAssessment.label}</Badge>
              {canEditExternalCosts ? <button className="icon-button" type="button" title="Editar pagamento" aria-label="Editar pagamento"
                disabled={savingBilling || reversingSignal} onClick={() => openPaymentEditor()}><Edit3 size={16} /></button> : null}
            </div>}>
            <p className="payment-overview-caption">{recordedAssessment.assessed ? 'Total final apurado' : 'Total previsto · sujeito a validação'}</p>
            <ClientBillingPeriods finance={clientFinance} />
            <dl className="payment-overview-totals">
              <div data-payment-metric="total"><dt>Total do evento</dt><ClientPaymentTax value={receiptTax.total} total={clientPaymentTotal} /></div>
              <div data-payment-metric="received"><dt>Recebido</dt><ClientPaymentTax value={receiptTax.received} total={recordedClientPayment.received} /></div>
              <div data-payment-metric="outstanding"><dt>Por receber</dt><ClientPaymentTax value={receiptTax.outstanding} total={recordedClientPayment.outstanding} /></div>
            </dl>
            <div className="payment-overview-progress">
              <progress max="100" value={Math.min(100, Math.max(0, receivedPercent))} aria-label="Percentagem recebida" />
              <span>{receivedPercent}% recebido</span>
            </div>
            {recordedAssessment.excess > 0 ? <p className="payment-overview-excess" role="status">Recebido em excesso: <strong>{money.format(recordedAssessment.excess)}</strong></p> : null}
            {additionalBreakdown ? <div className="service-detail-payment-summary">
              <div><span>Valor adicional em falta</span><ClientPaymentAdjustment breakdown={additionalBreakdown} />
                <span className="client-adjustment-total-label">Total a receber · com IVA aplicável</span>
                <strong className="service-detail-payment-due">{money.format(recordedClientPayment.outstanding)}</strong>
              </div>
            </div> : null}
            {recordedClientPayment.outstanding > 0 ? <section className="payment-overview-next" aria-label="Próximo recebimento">
              <div><h3>Próximo recebimento</h3><strong>{money.format(recordedClientPayment.outstanding)}</strong>
                <span><CalendarClock size={15} />{service.remainingPaymentDate ? `Previsto: ${formatDate(service.remainingPaymentDate)}` : 'Sem data prevista'}</span></div>
              {canEditExternalCosts && (!hasPriorSettlement || canReverseClientReceipts) ? <button className="command-button" type="button"
                onClick={registerClientReceipt} disabled={savingBilling || reversingSignal}><Plus size={16} />Registar recebimento</button> : null}
            </section> : null}
            <details className="event-payment-history payment-overview-receipts" aria-label="Recebimentos registados">
              <summary>Recebimentos registados</summary>
              {displayedReceipts.length ? <ul>{displayedReceipts.map((entry) => <li key={entry.id}>
                <span className="payment-receipt-icon" aria-hidden="true">{entry.voided || entry.amount < 0 ? <RotateCcw size={16} /> : <CheckCircle2 size={16} />}</span>
                <span className="payment-receipt-description">{receiptTypeLabels[entry.type] || 'Recebimento'}
                  <small>{entry.receivedAt ? formatDate(entry.receivedAt) : 'Data não registada'}</small>
                  {entry.description ? <small>{entry.description}</small> : null}
                  {entry.voided ? <small>{entry.voided === 'delete' ? 'Eliminado' : 'Revertido'}{entry.voidedAt ? ` em ${formatDate(entry.voidedAt)}` : ''}</small> : null}</span>
                <strong className={entry.voided || entry.amount < 0 ? 'payment-receipt-reversed' : ''}>{money.format(entry.amount)}</strong>
                {canReverseClientReceipts && entry.voided !== 'delete' && entry.amount > 0 && (receiptProjection.reliable || !paymentRecord) ? <details className="receipt-actions">
                  <summary aria-label={`Ações de ${receiptTypeLabels[entry.type] || 'recebimento'}`} title="Ações do recebimento"><MoreHorizontal size={17} /></summary>
                  <div>{[...(entry.voided ? [] : ['edit', 'reverse']), ...(receiptCanDelete(paymentRecord, entry) ? ['delete'] : [])].map((action) => <button type="button" key={action}
                    disabled={savingBilling || Boolean(receiptActionBlocker)} title={receiptActionBlocker || undefined}
                    onClick={(event) => {
                      event.currentTarget.closest('details').removeAttribute('open');
                      setReceiptAction({ movement: entry, action, updatedAt: service.updatedAt, revision: paymentRecord?.entries.length || 0 });
                    }}>{action === 'edit' ? <Edit3 size={14} /> : action === 'delete' ? <Trash2 size={14} /> : <RotateCcw size={14} />}
                    {action === 'edit' ? 'Editar' : action === 'delete' ? 'Eliminar' : 'Reverter'}</button>)}</div>
                </details> : null}
                {entry.financialAdjustment ? <details className="client-adjustment-history"><summary>Detalhe do acerto{entry.amount !== entry.financialAdjustment.total ? ' de referência' : ''}</summary>
                  <ClientPaymentAdjustment breakdown={entry.financialAdjustment} history />
                </details> : null}
              </li>)}</ul> : <p className="muted">Sem recebimentos registados.</p>}
            </details>
            <details className="payment-overview-reference"><summary>Referência 70% / 30%</summary><ClientPaymentReference total={clientPaymentTotal} /></details>
            <details className="payment-overview-corrections"><summary>Histórico e correções</summary>
              {paymentRecord?.entries.length ? <ol className="receipt-audit">{paymentRecord.entries.map((entry) => <li key={entry.id}>
                <span>{formatDate(entry.recordedAt || entry.receivedAt)}{entry.actor?.name ? ` · ${entry.actor.name}` : ''}</span>
                <strong>{entry.operation === 'edit' ? 'Recebimento corrigido' : entry.operation === 'reverse' ? 'Recebimento revertido' : entry.operation === 'delete' ? 'Recebimento eliminado'
                  : entry.type === 'reversal' ? 'Recebimentos revertidos' : `${receiptTypeLabels[entry.type] || 'Correção'} registado`}</strong>
                <span>{entry.operation === 'edit' ? `${money.format(entry.before?.amount || 0)} → ${money.format(entry.replacement.amount)}` : money.format(entry.amount)}</span>
                {entry.operation === 'delete' && entry.before?.voided === 'reverse' ? <small>Registo já revertido removido da lista · {money.format(entry.before.amount)} · sem alteração dos totais</small> : null}
                {entry.operation === 'edit' ? <small>{entry.before?.receivedAt ? formatDate(entry.before.receivedAt) : 'Sem data'} → {formatDate(entry.replacement.receivedAt)}</small> : null}
                {entry.operation === 'edit' && entry.before?.type !== entry.replacement.type ? <small>{receiptTypeLabels[entry.before?.type] || 'Recebimento'} → {receiptTypeLabels[entry.replacement.type]}</small> : null}
                {entry.operation === 'edit' && (entry.before?.description || '') !== (entry.replacement.description || '') ? <small>Descrição: {entry.before?.description || 'Sem descrição'} → {entry.replacement.description || 'Sem descrição'}</small> : null}
              </li>)}</ol> : null}
              <dl className="event-payment-balance">
                {recordedAssessment.expectedTotal !== null && Math.abs(recordedAssessment.expectedTotal - totalRevenue) >= 0.01 ? (
                  <div><dt>Total de referência preservado</dt><dd>{money.format(recordedAssessment.expectedTotal)}</dd></div>
                ) : null}
                {service.signaledAt ? <div><dt>Data da sinalização</dt><dd>{formatDate(service.signaledAt)}</dd></div> : null}
                {service.billingPaymentDate ? <div><dt>Data do último recebimento</dt><dd>{formatDate(service.billingPaymentDate)}</dd></div> : null}
              </dl>
              {parseNumber(service.signaledAmount) > 0 && signalReversalBlocker ? <p className="muted">{signalReversalBlocker}</p> : null}
              <div className="service-detail-card-actions service-detail-payment-actions">
                {canEditExternalCosts ? <button className="secondary-button" type="button" onClick={() => openPaymentEditor()} disabled={savingBilling || reversingSignal}><Edit3 size={15} />Editar dados do pagamento</button> : null}
                {canEditExternalCosts && parseNumber(service.signaledAmount) > 0 ? <button className="secondary-button" type="button" onClick={() => revertClientSignal()}
                  disabled={savingBilling || reversingSignal || Boolean(signalReversalBlocker)} title={signalReversalBlocker || 'Anular a sinalização registada'}>
                  <RotateCcw size={15} />{reversingSignal ? 'A reverter...' : 'Reverter sinalização'}</button> : null}
                {canReverseClientReceipts && signalReversalBlocker && !receiptReversalBlocker ? <button className="secondary-button" type="button" onClick={() => revertClientSignal(true)}
                  disabled={savingBilling || reversingSignal}><RotateCcw size={15} />{reversingSignal ? 'A reverter...' : 'Reverter todos os recebimentos'}</button> : null}
              </div>
            </details>
            {billingError && !paymentEditor ? <p className="form-error" role="alert">{billingError}</p> : null}
            {paymentEditor ? <Modal title={paymentEditor === 'receipt' ? 'Registar recebimento' : 'Editar pagamento'} onClose={closePaymentEditor} preventFocusScroll>
              <form className="event-additional-payment-form" onSubmit={(event) => { event.preventDefault(); saveClientPayment(); }}>
                <p className="payment-editor-balance">Total: <strong>{money.format(clientPaymentTotal)}</strong> · Por receber: <strong>{money.format(recordedClientPayment.outstanding)}</strong></p>
                <div className="service-detail-payment-grid">
                  <label>{paymentEditor === 'receipt' ? 'Tipo de recebimento' : 'Estado do pagamento'}
                    <select value={billingDraft.billingStatus} disabled={savingBilling || (paymentEditor === 'settings' && receiptsManaged)} onChange={(event) => updateBillingDraft({ billingStatus: event.target.value })}>
                      {paymentEditor === 'settings' ? <option value="pending">Pendente</option> : null}
                      <option value="partial70">Sinalização</option>
                      {paymentEditor === 'settings' ? <option value="invoiced">Faturado</option> : null}
                      <option value="paid">{paymentEditor === 'receipt' ? recordedClientPayment.signal > 0 ? 'Pagamento restante' : 'Pagamento integral' : clientRemainingAmount > 0 ? 'Recebido antecipadamente' : paymentAssessment.assessed ? 'Pago' : 'Previsto totalmente recebido'}</option>
                    </select>
                  </label>
                  {paymentEditor === 'settings' ? <label>Valor total<input value={money.format(clientPaymentTotal)} readOnly /></label> : null}
                  {paymentEditor === 'settings' || billingDraft.billingStatus === 'partial70' ? <label>Valor sinalizado
                    <input inputMode="decimal" value={billingDraft.signaledAmount} disabled={savingBilling} readOnly={paymentEditor === 'settings' && receiptsManaged} placeholder="Ex: 700,00" onChange={(event) => updateBillingDraft({ signaledAmount: event.target.value })} />
                  </label> : null}
                  {paymentEditor === 'settings' ? <label>Valor em falta<input value={money.format(clientRemainingAmount)} readOnly /></label> : null}
                  {(paymentEditor === 'settings' && signalAmount > 0) || billingDraft.billingStatus === 'partial70' ? <label>Data da sinalização
                    <input type="date" value={billingDraft.signaledAt} disabled={savingBilling} readOnly={paymentEditor === 'settings' && receiptsManaged} onChange={(event) => updateBillingDraft({ signaledAt: event.target.value })} /></label> : null}
                  {paymentEditor === 'settings' || billingDraft.billingStatus === 'partial70' ? <label>Data prevista do restante pagamento
                    <input type="date" value={billingDraft.remainingPaymentDate} disabled={savingBilling} onChange={(event) => updateBillingDraft({ remainingPaymentDate: event.target.value })} /></label> : null}
                  {billingDraft.billingStatus === 'paid' ? <>
                    <label>{signalAmount > 0 ? paymentRecord?.entries.some((entry) => entry.type === 'adjustment') ? 'Recebido após sinalização' : 'Valor restante recebido' : 'Valor recebido'}
                      <input inputMode="decimal" value={billingDraft.remainingReceived} disabled={savingBilling} readOnly={paymentEditor === 'settings' && receiptsManaged} placeholder="Ex: 94,50" onChange={(event) => updateBillingDraft({ remainingReceived: event.target.value })} /></label>
                    <label>{paymentRecord?.entries.some((entry) => entry.type === 'adjustment') ? 'Data do último recebimento' : 'Data efetiva do recebimento'}
                      <input type="date" value={billingDraft.billingPaymentDate} disabled={savingBilling} readOnly={paymentEditor === 'settings' && receiptsManaged} onChange={(event) => updateBillingDraft({ billingPaymentDate: event.target.value })} /></label>
                    {paymentEditor === 'settings' ? <label>Total recebido<input value={money.format(clientPaidAmount)} readOnly /></label> : null}
                  </> : null}
                </div>
                {paymentEditor === 'receipt' ? <ClientReceiptAllocation snapshot={receiptSalesSnapshot} value={receiptAllocation} onChange={setReceiptAllocation} disabled={savingBilling} /> : null}
                {billingError ? <p className="form-error" role="alert">{billingError}</p> : null}
                <div className="form-actions service-detail-payment-actions">
                  <button className="secondary-button" type="button" disabled={savingBilling} onClick={closePaymentEditor}>Cancelar</button>
                  <button className="command-button" type="submit" disabled={savingBilling}><Save size={15} />{savingBilling ? 'A guardar...' : 'Guardar pagamento'}</button>
                </div>
              </form>
            </Modal> : null}
          </Card>
          {receiptAction ? <ClientReceiptEditor event={service} movement={receiptAction.movement} action={receiptAction.action} saving={savingBilling}
            onSubmit={saveReceiptMovement} onClose={() => { if (!savingBilling) setReceiptAction(null); }} /> : null}
          <Card title="Custos externos/parceiros" className="service-detail-card service-detail-external-card"
            action={canEditExternalCosts ? <button className="secondary-button" type="button"
              onClick={() => openExternalCost()} disabled={savingExternalCost || Boolean(externalCostItems.error)}>
              <Plus size={15} />Adicionar custo externo/parceiro
            </button> : null}>
            {externalCostItems.error ? <p className="form-error">{externalCostItems.error}</p> : null}
            {externalCostItems.rows.length ? (
              <div className="service-detail-external-list">
                {externalCostItems.rows.map((item) => {
                  const calculated = normalizeExternalCosts([item])[0] || {};
                  return <article className="service-detail-external-item" key={item.id}>
                    <header>
                      <div><strong>{item.supplier || item.type || 'Custo externo'}</strong><small>{item.type} · {item.description || 'Sem descrição'}</small></div>
                      {canEditExternalCosts ? <div className="service-detail-external-actions"><button className="secondary-button" type="button"
                        aria-label={`Editar custo externo ${item.supplier || item.type || item.id}`}
                        onClick={() => openExternalCost(item)} disabled={savingExternalCost}>
                        <Edit3 size={15} />Editar
                      </button><button className="icon-button icon-button--danger" type="button"
                        title="Eliminar custo externo/parceiro" aria-label={`Eliminar custo externo ${item.supplier || item.type || item.id}`}
                        disabled={savingExternalCost} onClick={() => {
                          setExternalCostError(''); setExternalCostRemoval({ item, updatedAt: service.updatedAt });
                        }}><Trash2 size={16} /></button></div> : null}
                    </header>
                    <dl>
                      <div><dt>Custo parceiro</dt><dd>{money.format(calculated.costAmount || 0)}</dd></div>
                      <div><dt>Margem ({calculated.marginPercent || 0}%)</dt><dd>{money.format(calculated.marginAmount || 0)}</dd></div>
                      <div><dt>Venda sem IVA</dt><dd>{money.format(calculated.chargeAmount || 0)}</dd></div>
                      <div><dt>IVA</dt><dd>{money.format(calculated.taxAmount || 0)}</dd></div>
                      <div><dt>Total com IVA</dt><dd>{money.format(calculated.grossAmount || 0)}</dd></div>
                    </dl>
                  </article>;
                })}
              </div>
            ) : (
              <EmptyState
                compact
                icon={WalletCards}
                title="Sem custos externos registados"
                description="Não existem parceiros ou serviços externos associados."
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

      {additionalPayment ? <Modal title="Registar pagamento adicional" onClose={() => { if (!savingBilling) setAdditionalPayment(null); }} preventFocusScroll>
        <form className="event-additional-payment-form" onSubmit={saveAdditionalClientPayment}>
          <p>Já recebido: <strong>{money.format(recordedClientPayment.received)}</strong>. Em falta: <strong>{money.format(recordedClientPayment.outstanding)}</strong>.</p>
          {additionalBreakdown ? <ClientPaymentAdjustment breakdown={additionalBreakdown} /> : null}
          <ClientReceiptAllocation snapshot={receiptSalesSnapshot} value={receiptAllocation} onChange={setReceiptAllocation} disabled={savingBilling} />
          <div className="form-grid">
            <label>Valor adicional recebido<input inputMode="decimal" value={additionalPayment.amount} disabled={savingBilling}
              onChange={(event) => setAdditionalPayment({ ...additionalPayment, amount: event.target.value })} /></label>
            <label>Data do novo recebimento<input type="date" value={additionalPayment.receivedAt} disabled={savingBilling}
              onChange={(event) => setAdditionalPayment({ ...additionalPayment, receivedAt: event.target.value })} /></label>
          </div>
          {additionalPaymentError ? <p className="form-error" role="alert">{additionalPaymentError}</p> : null}
          <div className="form-actions">
            <button className="secondary-button" type="button" disabled={savingBilling} onClick={() => setAdditionalPayment(null)}>Cancelar</button>
            <button className="command-button" type="submit" disabled={savingBilling}><Save size={15} />{savingBilling ? 'A guardar...' : 'Registar recebimento'}</button>
          </div>
        </form>
      </Modal> : null}

      {externalCostRemoval ? <Modal title="Eliminar custo externo/parceiro?" onClose={closeExternalCostRemoval}>
        <p>Tem a certeza de que pretende eliminar este custo externo/parceiro? Esta ação irá atualizar os cálculos financeiros do evento.</p>
        <p><strong>{externalCostRemoval.item.supplier || externalCostRemoval.item.type || 'Custo externo'}</strong></p>
        {externalCostError ? <p className="form-error" role="alert">{externalCostError}</p> : null}
        <div className="form-actions">
          <button className="secondary-button" type="button" onClick={closeExternalCostRemoval} disabled={savingExternalCost}>Cancelar</button>
          <button className="secondary-button secondary-button--danger" type="button" onClick={confirmExternalCostRemoval} disabled={savingExternalCost}>
            <Trash2 size={15} />{savingExternalCost ? 'A eliminar...' : 'Eliminar'}
          </button>
        </div>
      </Modal> : null}

      {externalCostEdit ? <Modal title={externalCostEdit.costId ? 'Editar custo externo/parceiro' : 'Adicionar custo externo/parceiro'}
        onClose={closeExternalCost}>
        <form className="service-detail-external-form" onSubmit={saveExternalCost} noValidate>
          <fieldset disabled={savingExternalCost}>
            <ExternalCostsEditor value={[externalCostEdit.draft]} allowAdd={false} allowRemove={false} showGrossTotal
              onChange={(rows) => { setExternalCostEdit((current) => ({ ...current, draft: rows[0] })); setExternalCostError(''); }} />
          </fieldset>
          {externalCostError ? <p className="form-error" role="alert">{externalCostError}</p> : null}
          <div className="form-actions">
            <button className="secondary-button" type="button" onClick={closeExternalCost} disabled={savingExternalCost}>Cancelar</button>
            <button className="command-button" type="submit" disabled={savingExternalCost}>
              <Save size={15} />{savingExternalCost ? 'A guardar...' : 'Guardar custo'}
            </button>
          </div>
        </form>
      </Modal> : null}

      {activeTab !== 'costs' && !paymentEditor && !additionalPayment && !externalCostEdit && !externalCostRemoval ? <div className="service-detail-mobile-actions" aria-label="Ações do Evento/Serviço">
        <button className="secondary-button" type="button" onClick={() => navigate('/services')}>
          Voltar
        </button>
        <button className="command-button" type="button" onClick={saveCurrentTab} disabled={savingTeam || savingBilling || savingExternalCost}>
          <Save size={16} />
          {savingTeam || savingBilling ? 'A guardar...' : 'Guardar alterações'}
        </button>
      </div> : null}

    </div>
  );
}
