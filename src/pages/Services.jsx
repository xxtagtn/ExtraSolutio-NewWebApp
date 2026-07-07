import { ChevronDown, ChevronRight, LayoutTemplate, Plus, Save, Trash2, Users } from 'lucide-react';
import { CarFront } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Badge from '../components/UI/Badge.jsx';
import Card from '../components/UI/Card.jsx';
import Modal from '../components/UI/Modal.jsx';
import SourceBadge from '../components/UI/SourceBadge.jsx';
import TimeInput from '../components/UI/TimeInput.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../utils/api.js';
import {
  ASSIGNMENT_OVERLAP_MESSAGE,
  assignmentScheduleChanged,
  findOverlappingAssignment,
} from '../utils/assignmentOverlap.js';
import { resolveEventRevenue } from '../utils/eventRevenue.js';
import { externalCostsTotals, normalizeExternalCosts } from '../utils/externalCosts.js';
import { date, durationHours } from '../utils/formatters.js';
import {
  buildPrepaymentSummary,
  shouldBlockPrepaidStaffAllocation,
} from '../utils/prepaymentPolicy.js';
import {
  applyClientRulesToServiceForm,
  clientPrepaymentRule,
  clientRuleRate,
} from '../utils/clientRules.js';
import { filterCollaboratorOptions } from '../utils/collaboratorSearch.js';
import { confirmDiscardChanges, formHasChanges } from '../utils/formDirty.js';
import {
  assignmentDraftsFromRows,
  normalizeAssignmentDrafts,
} from '../utils/serviceAssignmentDrafts.js';
import { resolveSelectedTeamDay } from '../utils/serviceDetail.js';
import {
  assignmentStaffCost,
  assignmentStaffRate,
  clientChargeHours,
  clientRealHours,
  collaboratorHourlyRate,
  decimalValue,
} from '../utils/serviceFinance.js';
import { normalizeStaffAdvances, staffAdvancesTotal, staffCarAdvancesTotal } from '../utils/staffAdvances.js';
import {
  isArchivedService,
  nextAutomaticServiceStatus,
  operationalStatusOptions,
  SERVICE_STATUS,
  statusLabel,
} from '../utils/serviceStatus.js';
import {
  applyServiceTemplateToForm,
  cleanTravelCarsForPayload,
  templatePayloadFromForm,
  travelCarsFromSource,
} from '../utils/serviceTemplateForm.js';
import { calculateTravelAmount } from '../utils/travelCalculator.js';

const eventTypeOptions = [
  'Restaurante',
  'Catering',
  'Casamento',
  'Corporate',
  'Particular',
  'Embaixada',
  'Estádio',
  'Hotel',
  'Reforço Operacional',
  'Serviço Protocolar',
];

const uniformOptions = [
  'Polo ExtraSolutio',
  'Camisa Branca',
  'Camisa Preta',
  'Fato',
  'Definido pelo cliente',
  'Outros',
];

const billingMethodLabels = {
  prepaid: 'Pré-pagamento',
  per_event: 'Por evento',
  biweekly: 'Quinzenal',
  monthly: 'Mensal',
  custom: 'Personalizado',
};

const paymentTermLabels = {
  immediate: 'Pronto pagamento',
  days_15: '15 dias',
  days_30: '30 dias',
  days_45: '45 dias',
  custom: 'Personalizado',
};

const assignmentStatusOptions = [
  { value: 'confirmed', label: 'Confirmado' },
  { value: 'pending_confirmation', label: 'Aguardar Confirmação' },
  { value: 'missed_justified', label: 'Faltou c/Justificação' },
  { value: 'missed_unjustified', label: 'Faltou s/Justificação' },
  { value: 'cancelled', label: 'Cancelado' },
];

const nonBillableStatuses = new Set(['missed_justified', 'missed_unjustified', 'cancelled']);

function emptyTravelCar(index = 0) {
  return {
    id: `car-${Date.now()}-${index}`,
    label: index ? `Carro ${index + 1}` : 'Carro 1',
    km: '',
    kmRate: 0.4,
    durationHours: '',
    travelPeople: 1,
    travelStaffHourlyRate: '',
  };
}

function normalizeAssignmentStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'pending_confirmation';
  if (raw === 'confirmed' || raw === 'confirmado') return 'confirmed';
  if (raw === 'pending_confirmation' || raw === 'aguardar confirmacao' || raw === 'aguardar confirmação') return 'pending_confirmation';
  if (raw === 'missed_justified' || raw === 'faltou c/justificacao' || raw === 'faltou c/justificação') return 'missed_justified';
  if (raw === 'missed_unjustified' || raw === 'faltou s/justificacao' || raw === 'faltou s/justificação') return 'missed_unjustified';
  if (raw === 'cancelled' || raw === 'cancelado') return 'cancelled';
  return raw;
}

function emptyForm() {
  return {
    name: '',
    eventType: '',
    date: '',
    endDate: '',
    isContinuous: false,
    clientId: '',
    useDefaultLocation: true,
    location: '',
    guestsCount: '',
    startTime: '',
    endTime: '',
    uniform: '',
    uniformOther: '',
    meetingPoint: '',
    onsiteContactName: '',
    onsiteContactPhone: '',
    travelExpenseEnabled: false,
    travelExpenseAmount: '',
    travelType: 'none',
    travelPeople: 1,
    km: 0,
    kmRate: 0.4,
    durationHours: 0,
    travelStaffHourlyRate: '',
    travelCars: [emptyTravelCar()],
    split5050: false,
    travelManualAmount: '',
    description: '',
    status: 'drafting',
    billingStatus: 'pending',
    signaledAmount: '',
    paidAmount: '',
    remainingPaymentDate: '',
    totalRevenue: '',
    externalCosts: [],
    realHours: 0,
    billableHours: 0,
    minimumHoursSnapshot: 0,
    requiredRoles: [],
    assignments: [],
  };
}

function parseMoney(value) {
  return decimalValue(value);
}

function formatMoneyInline(value) {
  const parsed = parseMoney(value);
  if (parsed === null) return '';
  return `${parsed.toFixed(2).replace('.', ',')}€`;
}

function euro(value) {
  const amount = Number(value || 0);
  return `${amount.toFixed(2).replace('.', ',')}€`;
}

function formatHours(value) {
  return durationHours(value);
}

function todayInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function toMinutes(time) {
  if (!time) return null;
  const [h, m] = String(time).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return (h * 60) + m;
}

function roundTimeForBilling(time) {
  const minutes = toMinutes(time);
  if (minutes === null) return null;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  if (minute <= 14) return hour * 60;
  if (minute <= 44) return (hour * 60) + 30;
  return (hour + 1) * 60;
}

function calcRoundedBillableHours(start, end) {
  const roundedStart = roundTimeForBilling(start);
  const roundedEnd = roundTimeForBilling(end);
  if (roundedStart === null || roundedEnd === null) return 0;
  let s = roundedStart;
  let e = roundedEnd;
  if (e < s) e += 24 * 60;
  return Number(((e - s) / 60).toFixed(2));
}

function assignmentClientHours(assignment, fallbackStart, fallbackEnd, minimumHours = 0) {
  return clientChargeHours(assignment, fallbackStart, fallbackEnd, minimumHours);
}

function isPastEvent(eventDate) {
  if (!eventDate) return false;
  const d = new Date(eventDate);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const eventDayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return eventDayStart.getTime() < todayStart.getTime();
}

function dateOnly(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function parseDateOnly(value) {
  if (!value) return null;
  const d = new Date(`${dateOnly(value)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function eventRangeEnd(item) {
  return item?.isContinuous && item.endDate ? item.endDate : item?.date;
}

function inclusiveDayCount(startValue, endValue) {
  const start = parseDateOnly(startValue);
  const end = parseDateOnly(endValue || startValue);
  if (!start || !end || end < start) return 1;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function formatEventDateRange(item) {
  if (!item?.date) return '-';
  const start = date.format(new Date(item.date));
  const endValue = eventRangeEnd(item);
  if (!item.isContinuous || !endValue || dateOnly(endValue) === dateOnly(item.date)) return start;
  return `${start} - ${date.format(new Date(endValue))}`;
}

function safeArrayJson(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clientRateForRole(client, role) {
  const value = clientRuleRate(client, role);
  return value === null ? '' : formatMoneyInline(value);
}

function paymentTermText(client) {
  if (!client) return '-';
  if (client.paymentTerm === 'custom') return `${client.paymentTermDays || '-'} dias`;
  return paymentTermLabels[client.paymentTerm] || '-';
}

function prepaymentRuleText(client) {
  const rule = clientPrepaymentRule(client);
  if (!rule.enabled) return 'Não aplicável';
  return `${rule.percent}% + restante ${rule.remainingDaysBefore} dias antes`;
}

function extractBudgetReference(text) {
  const raw = String(text || '');
  const tagged = raw.match(/\[BUDGET_REF:([^\]]+)\]/i);
  if (tagged?.[1]) return tagged[1].trim();
  const fallback = raw.match(/\bORC-\d+\b/i);
  return fallback ? fallback[0].toUpperCase() : '';
}

function removeValidatedMarker(notes) {
  return String(notes || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => !line.includes('[EVENT_VALIDATED_HOURS]'))
    .join('\n')
    .trim();
}

function collaboratorHasRole(collab, role) {
  if (!role) return true;
  const roles = Array.isArray(collab?.roles) ? collab.roles : [];
  return roles.includes(role) || String(collab?.category || '') === String(role);
}

function emptyAssignmentForRole(role, assignmentDate = '') {
  return {
    role,
    collaboratorId: '',
    assignmentDate,
    collaboratorSearch: '',
    plannedCheckIn: '',
    plannedCheckOut: '',
    checkIn: '',
    checkOut: '',
    clientCheckIn: '',
    clientCheckOut: '',
    validatedCheckIn: '',
    validatedCheckOut: '',
    hoursWorked: 0,
    clientBillableHours: 0,
    staffPayableHours: 0,
    hourlyRate: '',
    validationStatus: 'pending',
    validationNotes: '',
    clientSynced: false,
    isDriver: false,
    advancePayments: [],
    status: 'pending_confirmation',
  };
}

function withAssignmentPlaceholders(nextForm) {
  const assignments = [...(nextForm.assignments || [])];
  for (const required of nextForm.requiredRoles || []) {
    const target = Number(required.qty || 0);
    if (!required.role || target <= 0) continue;
    const targetDay = nextForm.isContinuous ? (required.day || '') : '';
    if (nextForm.isContinuous && !targetDay) continue;
    const count = assignments.filter((assignment) => (
      assignment.role === required.role
      && (!nextForm.isContinuous || (assignment.assignmentDate || '') === targetDay)
    )).length;
    for (let i = count; i < target; i += 1) {
      assignments.push(emptyAssignmentForRole(required.role, targetDay));
    }
  }
  return { ...nextForm, assignments };
}

function toForm(row) {
  const parsedRequiredRoles = safeArrayJson(row.requiredRoles);
  const savedUniform = row.uniform || '';
  const isKnownUniform = uniformOptions.includes(savedUniform) && savedUniform !== 'Outros';
  const isOtherUniform = savedUniform === 'Outros';
  const savedTravelAmount = Number(row.travelExpenseAmount || 0);
  const savedTravelType = row.travelType && row.travelType !== 'none'
    ? row.travelType
    : row.travelExpenseEnabled && savedTravelAmount > 0
      ? 'manual'
      : 'none';
  const savedAssignments = (row.assignments || []).map((item) => {
    const validationStatus = item.validationStatus || 'pending';
    const legacyTimesArePlanned = !item.plannedCheckIn
      && !item.plannedCheckOut
      && ['pending', 'reopened'].includes(validationStatus)
      && !item.clientCheckIn
      && !item.clientCheckOut
      && !item.validatedCheckIn
      && !item.validatedCheckOut
      && !['to_validate_client', 'finalized'].includes(row.status);
    return {
      id: item.id,
      role: item.role || '',
      collaboratorId: item.collaboratorId ? String(item.collaboratorId) : '',
      assignmentDate: item.assignmentDate ? dateOnly(item.assignmentDate) : '',
      collaboratorSearch: '',
      isDriver: Boolean(item.isDriver),
      plannedCheckIn: item.plannedCheckIn || (legacyTimesArePlanned ? item.checkIn || '' : ''),
      plannedCheckOut: item.plannedCheckOut || (legacyTimesArePlanned ? item.checkOut || '' : ''),
      checkIn: legacyTimesArePlanned ? '' : item.checkIn || '',
      checkOut: legacyTimesArePlanned ? '' : item.checkOut || '',
      clientCheckIn: item.clientCheckIn || '',
      clientCheckOut: item.clientCheckOut || '',
      validatedCheckIn: item.validatedCheckIn || '',
      validatedCheckOut: item.validatedCheckOut || '',
      hoursWorked: legacyTimesArePlanned ? 0 : Number(item.hoursWorked || 0),
      clientRealHours: legacyTimesArePlanned ? 0 : Number(item.clientRealHours || 0),
      clientBillableHours: legacyTimesArePlanned ? 0 : Number(item.clientBillableHours || 0),
      staffPayableHours: legacyTimesArePlanned ? 0 : Number(item.staffPayableHours || 0),
      hourlyRate: formatMoneyInline(item.hourlyRate),
      validationStatus,
      validationNotes: item.validationNotes || '',
      clientSynced: Boolean(item.clientSynced),
      advancePayments: normalizeStaffAdvances(item.advancePayments).map((advance) => ({
        ...advance,
        amount: formatMoneyInline(advance.amount),
      })),
      status: normalizeAssignmentStatus(item.status),
    };
  });
  const draftAssignments = normalizeAssignmentDrafts(row.assignmentDrafts).map((item) => ({
    ...emptyAssignmentForRole(item.role, item.assignmentDate),
    draftId: item.draftId,
    plannedCheckIn: item.plannedCheckIn,
    plannedCheckOut: item.plannedCheckOut,
    hourlyRate: item.hourlyRate,
    validationNotes: item.validationNotes,
    clientSynced: item.clientSynced,
    isDriver: item.isDriver,
    status: normalizeAssignmentStatus(item.status),
  }));
  return {
    name: row.name || '',
    eventType: row.eventType || '',
    date: dateOnly(row.date),
    endDate: row.endDate ? dateOnly(row.endDate) : '',
    isContinuous: Boolean(row.isContinuous),
    clientId: row.clientId ? String(row.clientId) : '',
    useDefaultLocation: row.useDefaultLocation !== false,
    location: row.location || '',
    guestsCount: row.guestsCount ?? '',
    startTime: row.startTime || '',
    endTime: row.endTime || '',
    uniform: isKnownUniform ? savedUniform : (savedUniform ? 'Outros' : ''),
    uniformOther: isKnownUniform || isOtherUniform ? '' : savedUniform,
    meetingPoint: row.meetingPoint || '',
    onsiteContactName: row.onsiteContactName || '',
    onsiteContactPhone: row.onsiteContactPhone || '',
    travelExpenseEnabled: Boolean(row.travelExpenseEnabled),
    travelExpenseAmount: row.travelExpenseAmount === undefined || row.travelExpenseAmount === null ? '' : formatMoneyInline(row.travelExpenseAmount),
    travelType: savedTravelType,
    travelPeople: row.travelPeople ?? 1,
    km: row.km ?? 0,
    kmRate: row.kmRate ?? 0.4,
    durationHours: row.durationHours ?? 0,
    travelStaffHourlyRate: row.travelStaffHourlyRate === undefined || row.travelStaffHourlyRate === null
      ? ''
      : formatMoneyInline(row.travelStaffHourlyRate),
    travelCars: travelCarsFromSource(row),
    split5050: Boolean(row.split5050),
    travelManualAmount: savedTravelType === 'manual' ? formatMoneyInline(row.travelManualAmount || savedTravelAmount) : '',
    description: row.description || '',
    status: row.status || 'drafting',
    billingStatus: row.billingStatus || 'pending',
    signaledAmount: row.signaledAmount === undefined || row.signaledAmount === null ? '' : formatMoneyInline(row.signaledAmount),
    paidAmount: row.paidAmount === undefined || row.paidAmount === null ? '' : formatMoneyInline(row.paidAmount),
    remainingPaymentDate: row.remainingPaymentDate ? String(row.remainingPaymentDate).slice(0, 10) : '',
    totalRevenue: row.totalRevenue === undefined || row.totalRevenue === null ? '' : formatMoneyInline(row.totalRevenue),
    externalCosts: normalizeExternalCosts(row.externalCosts),
    realHours: Number(row.realHours || 0),
    billableHours: Number(row.billableHours || 0),
    minimumHoursSnapshot: Number(row.minimumHoursSnapshot || 0),
    requiredRoles: parsedRequiredRoles.map((item) => ({
      ...item,
      agreedRate: formatMoneyInline(item.agreedRate),
    })),
    assignments: [...savedAssignments, ...draftAssignments],
  };
}

function getRoleForecast(requiredRoles, expectedHours) {
  return requiredRoles.reduce((sum, item) => {
    const qty = Number(item.qty || 0);
    const rate = parseMoney(item.agreedRate) || 0;
    return sum + (qty * expectedHours * rate);
  }, 0);
}

function getRowForecast(row) {
  const requiredRoles = safeArrayJson(row.requiredRoles);
  const roleRateMap = new Map(requiredRoles.map((item) => [item.role, parseMoney(item.agreedRate) || 0]));
  const travel = Number(row.travelExpenseEnabled ? row.travelExpenseAmount || 0 : 0);
  const externalCharge = externalCostsTotals(row.externalCosts).chargeAmount;
  const assignments = (row.assignments || []).filter((item) => item.role && item.collaboratorId);
  if (assignments.length) {
    const billable = assignments.filter((item) => !nonBillableStatuses.has(normalizeAssignmentStatus(item.status)));
    const total = billable.reduce((sum, item) => {
      const hours = assignmentClientHours(item, row.startTime, row.endTime, row.minimumHoursSnapshot);
      const rate = roleRateMap.get(item.role) || 0;
      return sum + (hours * rate);
    }, 0);
    return Number((total + travel + externalCharge).toFixed(2));
  }
  const expectedHours = calcRoundedBillableHours(row.startTime, row.endTime) * inclusiveDayCount(row.date, eventRangeEnd(row));
  const forecast = getRoleForecast(requiredRoles, expectedHours);
  return Number((forecast + travel + externalCharge).toFixed(2));
}

export default function Services() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, loading, error, reload } = useApi('/services', []);
  const { data: clients } = useApi('/clients', []);
  const { data: collaborators } = useApi('/collaborators?light=1', []);
  const { data: budgets, reload: reloadBudgets } = useApi('/budgets', []);
  const { data: roleCatalog } = useApi('/collaborators/roles', []);
  const { data: serviceTemplates, reload: reloadTemplates } = useApi('/service-templates', []);
  const [fromDate, setFromDate] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [listScope, setListScope] = useState('active');
  const [formOpen, setFormOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('summary');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [formBaseline, setFormBaseline] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [formError, setFormError] = useState('');
  const [openedFromQuery, setOpenedFromQuery] = useState(false);
  const [statusManualOverride, setStatusManualOverride] = useState(false);
  const [activeCollaboratorPickerIndex, setActiveCollaboratorPickerIndex] = useState(null);
  const [collaboratorPickerPlacement, setCollaboratorPickerPlacement] = useState(null);
  const collaboratorSearchRef = useRef(null);
  const [activeAdvanceIndex, setActiveAdvanceIndex] = useState(null);
  const [selectedTeamDay, setSelectedTeamDay] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [statusSyncing, setStatusSyncing] = useState(false);

  const rows = useMemo(() => data.filter((row) => {
    const byArchive = listScope === 'archive' ? isArchivedService(row) : !isArchivedService(row);
    const byDate = fromDate ? dateOnly(eventRangeEnd(row)) >= fromDate : true;
    const byClient = clientFilter ? String(row.clientId) === clientFilter : true;
    const byStatus = statusFilter ? nextAutomaticServiceStatus(row) === statusFilter : true;
    return byArchive && byDate && byClient && byStatus;
  }), [data, listScope, fromDate, clientFilter, statusFilter]);

  const activeCount = useMemo(() => data.filter((row) => !isArchivedService(row)).length, [data]);
  const archiveCount = useMemo(() => data.filter((row) => isArchivedService(row)).length, [data]);

  const availableRoles = useMemo(
    () => [...new Set((roleCatalog || []).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt')),
    [roleCatalog],
  );
  const sortedTemplates = useMemo(
    () => [...(serviceTemplates || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt')),
    [serviceTemplates],
  );
  const selectedTemplate = useMemo(
    () => sortedTemplates.find((item) => String(item.id) === String(selectedTemplateId)),
    [selectedTemplateId, sortedTemplates],
  );
  const activeCollaborators = useMemo(
    () => (collaborators || [])
      .filter((collab) => collab.status !== 'inactive')
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt')),
    [collaborators],
  );
  const collaboratorsById = useMemo(
    () => new Map((collaborators || []).map((collab) => [String(collab.id), collab])),
    [collaborators],
  );

  const selectedClient = useMemo(
    () => clients.find((client) => String(client.id) === String(form.clientId)),
    [clients, form.clientId],
  );
  const canShowInactiveAssignments = isPastEvent(form.isContinuous && form.endDate ? form.endDate : form.date);

  function collaboratorOptionLabel(collab) {
    return `${collab.shortName || collab.name || `Colaborador ${collab.id}`} | ${collab.nif || '-'}`;
  }

  const eventDays = inclusiveDayCount(form.date, form.isContinuous ? form.endDate : form.date);
  const teamDays = useMemo(() => {
    if (!form.isContinuous || !form.date) return [];
    const start = parseDateOnly(form.date);
    const end = parseDateOnly(form.endDate || form.date);
    if (!start || !end || end < start) return [];
    const days = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      days.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`);
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }, [form.isContinuous, form.date, form.endDate]);
  const expectedDailyHours = calcRoundedBillableHours(form.startTime, form.endTime);
  const minimumHoursSnapshot = Number(form.minimumHoursSnapshot || 0);
  const expectedBillableHours = Number((Math.max(expectedDailyHours, minimumHoursSnapshot) * eventDays).toFixed(2));
  const travelExpenseAmount = calculateTravelAmount(form);

  const formAssignmentClientRealHours = useCallback((assignment) => {
    return clientRealHours(assignment);
  }, []);

  const formAssignmentClientHours = useCallback((assignment) => {
    return clientChargeHours(assignment, form.startTime, form.endTime, minimumHoursSnapshot);
  }, [form.endTime, form.startTime, minimumHoursSnapshot]);

  const formAssignmentPlannedHours = useCallback((assignment) => {
    return calcRoundedBillableHours(assignment.plannedCheckIn || form.startTime, assignment.plannedCheckOut || form.endTime);
  }, [form.endTime, form.startTime]);

  const formAssignmentStaffHours = useCallback((assignment) => {
    const validated = calcRoundedBillableHours(assignment.validatedCheckIn, assignment.validatedCheckOut);
    if (validated > 0) return validated;
    const checked = calcRoundedBillableHours(assignment.checkIn, assignment.checkOut);
    if (checked > 0) return checked;
    const explicit = Number(assignment.staffPayableHours || 0);
    if (explicit > 0) return explicit;
    return Number(assignment.hoursWorked || 0);
  }, []);

  const financials = useMemo(() => {
    const roleRateMap = new Map(form.requiredRoles.map((item) => [item.role, parseMoney(item.agreedRate) || 0]));
    const expectedRevenueByRoles = getRoleForecast(form.requiredRoles, expectedBillableHours);
    const externalTotals = externalCostsTotals(form.externalCosts);
    const assignments = (form.assignments || []).filter((assignment) => assignment.role && assignment.collaboratorId);
    let totalRevenue = 0;
    let totalCost = 0;
    let expectedRevenue = 0;
    let realHours = 0;
    let billableHours = 0;
    for (const assignment of assignments) {
      if (nonBillableStatuses.has(normalizeAssignmentStatus(assignment.status))) continue;
      const realClientHours = formAssignmentClientRealHours(assignment);
      const clientHours = formAssignmentClientHours(assignment);
      const staffHours = formAssignmentStaffHours(assignment);
      if (!assignment.role || (!clientHours && !staffHours)) continue;
      const clientRate = roleRateMap.get(assignment.role) || 0;
      const collaboratorRate = assignmentStaffRate(assignment, collaboratorsById, clientRate);
      expectedRevenue += clientHours * clientRate;
      totalRevenue += clientHours * clientRate;
      totalCost += (staffHours * collaboratorRate) + staffCarAdvancesTotal(assignment.advancePayments);
      realHours += realClientHours;
      billableHours += clientHours;
    }
    const hasAssignments = assignments.length > 0;
    const revenueWithoutTravel = hasAssignments ? totalRevenue : expectedRevenueByRoles;
    const expectedWithoutTravel = hasAssignments ? expectedRevenue : expectedRevenueByRoles;
    const calculatedExpectedRevenue = expectedWithoutTravel + travelExpenseAmount + externalTotals.chargeAmount;
    const calculatedTotalRevenue = revenueWithoutTravel + travelExpenseAmount + externalTotals.chargeAmount;
    const resolvedTotalRevenue = resolveEventRevenue({
      calculatedTotalRevenue,
      calculatedExpectedRevenue,
      storedTotalRevenue: form.totalRevenue,
    });
    const resolvedExpectedRevenue = resolveEventRevenue({
      calculatedTotalRevenue: calculatedExpectedRevenue,
      calculatedExpectedRevenue,
      storedTotalRevenue: form.totalRevenue,
    });
    return {
      expectedRevenue: resolvedExpectedRevenue,
      totalRevenue: resolvedTotalRevenue,
      totalCost: Number((totalCost + externalTotals.costAmount).toFixed(2)),
      externalCostAmount: externalTotals.costAmount,
      externalChargeAmount: externalTotals.chargeAmount,
      externalMarginAmount: externalTotals.marginAmount,
      profit: Number((resolvedTotalRevenue - totalCost - externalTotals.costAmount).toFixed(2)),
      realHours: Number(realHours.toFixed(2)),
      billableHours: Number(billableHours.toFixed(2)),
    };
  }, [form.requiredRoles, form.assignments, form.externalCosts, expectedBillableHours, travelExpenseAmount, formAssignmentClientHours, formAssignmentClientRealHours, formAssignmentStaffHours, collaboratorsById, form.totalRevenue]);
  const prepaymentSummary = buildPrepaymentSummary({
    total: financials.totalRevenue || financials.expectedRevenue || 0,
    serviceDate: form.date,
    billingStatus: form.billingStatus,
    client: selectedClient,
  });
  const prepaidPaymentBlocked = shouldBlockPrepaidStaffAllocation(
    selectedClient,
    form.billingStatus,
    form.billingStatus === 'partial70' ? prepaymentSummary.signaledAmount : form.signaledAmount,
  );

  function updatePrepaymentStatus(billingStatus) {
    const nextSummary = buildPrepaymentSummary({
      total: financials.totalRevenue || financials.expectedRevenue || 0,
      serviceDate: form.date,
      billingStatus,
      client: selectedClient,
    });

    setForm({
      ...form,
      billingStatus,
      signaledAmount: billingStatus === 'pending' ? '' : formatMoneyInline(nextSummary.signaledAmount),
      paidAmount: billingStatus === 'pending' ? '' : formatMoneyInline(nextSummary.paidAmount),
      remainingPaymentDate: billingStatus === 'partial70' ? nextSummary.remainingPaymentDate : '',
    });
  }

  function markPrepaymentSignal() {
    updatePrepaymentStatus('partial70');
  }

  useEffect(() => {
    if (!formOpen || statusManualOverride) return;
    const autoStatus = nextAutomaticServiceStatus(form);
    if (form.status !== autoStatus) setForm((prev) => ({ ...prev, status: autoStatus }));
  }, [formOpen, statusManualOverride, form]);

  useEffect(() => {
    if (!formOpen) {
      setActiveCollaboratorPickerIndex(null);
      setCollaboratorPickerPlacement(null);
    }
  }, [formOpen]);

  useEffect(() => {
    if (activeCollaboratorPickerIndex === null) return undefined;

    function closePickerFromOutside(event) {
      if (event.target?.closest?.('.service-collab-picker')) return;
      setActiveCollaboratorPickerIndex(null);
      setCollaboratorPickerPlacement(null);
    }

    function closePickerOnEscape(event) {
      if (event.key !== 'Escape') return;
      setActiveCollaboratorPickerIndex(null);
      setCollaboratorPickerPlacement(null);
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
  }, [activeCollaboratorPickerIndex]);

  useEffect(() => {
    if (activeCollaboratorPickerIndex === null) return undefined;
    const frameId = window.requestAnimationFrame(() => {
      collaboratorSearchRef.current?.focus();
      collaboratorSearchRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeCollaboratorPickerIndex]);

  useEffect(() => {
    if (loading || statusSyncing || formOpen || !data.length) return;
    const updates = data
      .map((row) => ({ row, nextStatus: nextAutomaticServiceStatus(row) }))
      .filter(({ row, nextStatus }) => nextStatus && nextStatus !== row.status);
    if (!updates.length) return;

    let cancelled = false;
    setStatusSyncing(true);
    Promise.all(updates.map(({ row, nextStatus }) => api(`/services/${row.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: nextStatus }),
    })))
      .then(() => {
        if (!cancelled) reload();
      })
      .catch((err) => {
        console.warn('Falha ao sincronizar estados dos eventos/serviços:', err);
      })
      .finally(() => {
        if (!cancelled) setStatusSyncing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [data, loading, reload, statusSyncing, formOpen]);

  useEffect(() => {
    if (!formOpen) return;
    const nextDay = resolveSelectedTeamDay({
      isContinuous: form.isContinuous,
      days: teamDays,
      selectedDay: selectedTeamDay,
    });
    if (nextDay !== selectedTeamDay) setSelectedTeamDay(nextDay);
  }, [formOpen, form.isContinuous, teamDays, selectedTeamDay]);

  function openCreate() {
    const initial = emptyForm();
    setEditing(null);
    setForm(initial);
    setFormBaseline(initial);
    setActiveTab('summary');
    setFormOpen(true);
    setFormError('');
    setTemplateError('');
    setTemplateName('');
    setSelectedTemplateId('');
    setStatusManualOverride(false);
    setSelectedTeamDay('');
    setActiveCollaboratorPickerIndex(null);
    setCollaboratorPickerPlacement(null);
    setActiveAdvanceIndex(null);
  }

  const formWithStaffRates = useCallback((nextForm) => {
    const roleRateMap = new Map(nextForm.requiredRoles.map((item) => [item.role, parseMoney(item.agreedRate) || 0]));
    return {
      ...nextForm,
      assignments: nextForm.assignments.map((assignment) => {
        const rate = assignmentStaffRate(assignment, collaboratorsById, roleRateMap.get(assignment.role) || 0);
        return rate > 0 ? { ...assignment, hourlyRate: formatMoneyInline(rate) } : assignment;
      }),
    };
  }, [collaboratorsById]);

  const openEdit = useCallback((row) => {
    const nextForm = formWithStaffRates(withAssignmentPlaceholders(toForm(row)));
    setEditing(row);
    setForm(nextForm);
    setFormBaseline(nextForm);
    setActiveTab('summary');
    setFormOpen(true);
    setFormError('');
    setTemplateError('');
    setTemplateName('');
    setSelectedTemplateId('');
    setStatusManualOverride(false);
    setSelectedTeamDay('');
    setActiveCollaboratorPickerIndex(null);
    setCollaboratorPickerPlacement(null);
    setActiveAdvanceIndex(null);
  }, [formWithStaffRates]);

  function closeForm(force = false) {
    if (!force && !confirmDiscardChanges(formHasChanges(formBaseline, form))) return;
    setFormOpen(false);
    setEditing(null);
    setForm(emptyForm());
    setFormBaseline(emptyForm());
    setFormError('');
    setTemplateError('');
    setTemplateName('');
    setSelectedTemplateId('');
    setStatusManualOverride(false);
    setSelectedTeamDay('');
    setActiveCollaboratorPickerIndex(null);
    setCollaboratorPickerPlacement(null);
    setActiveAdvanceIndex(null);
  }

  function toggleCollaboratorPicker(event, index) {
    if (activeCollaboratorPickerIndex === index) {
      setActiveCollaboratorPickerIndex(null);
      setCollaboratorPickerPlacement(null);
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

    setCollaboratorPickerPlacement({
      left: Math.max(edgePadding, rect.left),
      top: openAbove ? undefined : rect.bottom + gap,
      bottom: openAbove ? viewportHeight - rect.top + gap : undefined,
      width: rect.width,
      maxHeight: Math.min(320, availableSpace),
    });
    setActiveCollaboratorPickerIndex(index);
  }

  useEffect(() => {
    const idParam = searchParams.get('serviceId');
    if (!idParam || loading || openedFromQuery) return;
    const targetId = Number(idParam);
    if (!Number.isInteger(targetId)) return;
    const target = data.find((row) => row.id === targetId);
    if (target) {
      openEdit(target);
      setOpenedFromQuery(true);
      const nextParams = new window.URLSearchParams(searchParams);
      nextParams.delete('serviceId');
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams, loading, openedFromQuery, data, openEdit]);

  function applyTemplate(templateId) {
    const template = sortedTemplates.find((item) => String(item.id) === String(templateId));
    setSelectedTemplateId(templateId);
    setTemplateError('');
    if (!template) return;
    setTemplateName(template.name || '');
    setForm((prev) => applyServiceTemplateToForm(prev, template, {
      uniformOptions,
      selectedClient,
    }));
  }

  async function saveCurrentTemplate() {
    const name = (templateName || form.name || form.eventType || 'Template de Evento').trim();
    if (!name) {
      setTemplateError('Indica um nome para o template.');
      return;
    }
    const existing = sortedTemplates.find((item) => String(item.name || '').trim().toLowerCase() === name.toLowerCase());
    if (existing && !window.confirm('Já existe um template com este nome. Queres atualizar esse template?')) return;
    setSavingTemplate(true);
    setTemplateError('');
    try {
      const payload = templatePayloadFromForm(form);
      const saved = await api(`/service-templates${existing ? `/${existing.id}` : ''}`, {
        method: existing ? 'PUT' : 'POST',
        body: JSON.stringify({
          name,
          eventType: form.eventType || null,
          description: form.description || null,
          payload,
        }),
      });
      setTemplateName(saved.name || name);
      setSelectedTemplateId(String(saved.id));
      reloadTemplates();
    } catch (err) {
      setTemplateError(err.message || 'Não foi possível guardar o template.');
    } finally {
      setSavingTemplate(false);
    }
  }

  async function deleteSelectedTemplate(templateId = selectedTemplateId) {
    if (!templateId) {
      setTemplateError('Seleciona um template para apagar.');
      return;
    }
    const template = sortedTemplates.find((item) => String(item.id) === String(templateId));
    const confirmed = window.confirm(`Queres apagar o template "${template?.name || 'selecionado'}"?`);
    if (!confirmed) return;
    setTemplateError('');
    try {
      await api(`/service-templates/${templateId}`, { method: 'DELETE' });
      if (String(templateId) === String(selectedTemplateId)) {
        setSelectedTemplateId('');
        setTemplateName('');
      }
      setTemplateDropdownOpen(false);
      reloadTemplates();
    } catch (err) {
      setTemplateError(err.message || 'Não foi possível apagar o template.');
    }
  }

  function setTravelType(value) {
    setForm((prev) => ({
      ...prev,
      travelType: value,
      travelCars: value === 'kilometers' && !(prev.travelCars || []).length
        ? [emptyTravelCar()]
        : prev.travelCars,
    }));
  }

  function updateTravelCar(index, patch) {
    setForm((prev) => {
      const currentCars = (prev.travelCars || []).length ? prev.travelCars : [emptyTravelCar()];
      return {
        ...prev,
        travelCars: currentCars.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
      };
    });
  }

  function addTravelCar() {
    setForm((prev) => {
      const currentCars = (prev.travelCars || []).length ? prev.travelCars : [emptyTravelCar()];
      return {
        ...prev,
        travelCars: [...currentCars, emptyTravelCar(currentCars.length)],
      };
    });
  }

  function removeTravelCar(index) {
    setForm((prev) => {
      const currentCars = (prev.travelCars || []).length ? prev.travelCars : [emptyTravelCar()];
      const nextCars = currentCars.filter((_, itemIndex) => itemIndex !== index);
      return {
        ...prev,
        travelCars: nextCars.length ? nextCars : [emptyTravelCar()],
      };
    });
  }

  function updateClient(clientId) {
    const client = clients.find((item) => String(item.id) === String(clientId));
    setForm((prev) => applyClientRulesToServiceForm(
      { ...prev, clientId },
      client,
      { uniformOptions },
    ));
  }

  function updateRoleRequirement(role, patch) {
    const clientDefaultRate = clientRateForRole(selectedClient, role);
    const current = form.requiredRoles.find((item) => item.role === role) || { role, qty: '', agreedRate: '' };
    const nextItem = {
      ...current,
      ...patch,
      agreedRate: patch.agreedRate !== undefined ? patch.agreedRate : (current.agreedRate || clientDefaultRate),
    };
    const qty = Number(nextItem.qty || 0);
    const nextRoles = form.requiredRoles.filter((item) => item.role !== role);
    if (qty > 0) {
      nextRoles.push({ ...nextItem, qty });
      nextRoles.sort((a, b) => a.role.localeCompare(b.role, 'pt'));
      setForm({ ...form, requiredRoles: nextRoles });
      return;
    }
    setForm({
      ...form,
      requiredRoles: nextRoles,
      assignments: form.assignments.filter((item) => item.role !== role),
    });
  }

  function addAssignment(role) {
    if (prepaidPaymentBlocked) {
      window.alert('Cliente com pré-pagamento: regista a sinalização antes de alocar staff.');
      return;
    }
    setForm({
      ...form,
      assignments: [
        ...form.assignments,
        {
          ...emptyAssignmentForRole(role, form.isContinuous ? (selectedTeamDay || form.date || '') : ''),
          hoursWorked: expectedDailyHours,
        },
      ],
    });
  }

  function updateAssignment(index, patch) {
    const next = form.assignments.map((item, i) => {
      if (i !== index) return item;
      const merged = { ...item, ...patch };
      const plannedTimesTouched = patch.plannedCheckIn !== undefined || patch.plannedCheckOut !== undefined;
      const timesTouched = patch.checkIn !== undefined || patch.checkOut !== undefined;
      const updated = { ...merged };
      if (plannedTimesTouched) {
        updated.plannedHours = calcRoundedBillableHours(merged.plannedCheckIn, merged.plannedCheckOut);
      }
      if (timesTouched) {
        const workedHours = calcRoundedBillableHours(merged.checkIn, merged.checkOut);
        updated.timesTouched = true;
        updated.hoursWorked = workedHours;
        updated.staffPayableHours = workedHours;
        if (!merged.clientCheckIn && !merged.clientCheckOut && !merged.validatedCheckIn && !merged.validatedCheckOut) {
          updated.clientBillableHours = workedHours;
        }
      }
      return updated;
    });

    const scheduleChanged = [
      'collaboratorId',
      'assignmentDate',
      'plannedCheckIn',
      'plannedCheckOut',
      'checkIn',
      'checkOut',
    ].some((field) => patch[field] !== undefined);
    if (scheduleChanged) {
      const selected = next[index];
      const hasExplicitSchedule = Boolean(
        (selected.plannedCheckIn && selected.plannedCheckOut)
        || (selected.checkIn && selected.checkOut),
      );
      if (selected.collaboratorId && hasExplicitSchedule) {
        const currentEntries = next
          .filter((_, itemIndex) => itemIndex !== index)
          .map((assignment) => ({ assignment, event: form }));
        const externalEntries = data
          .filter((service) => !editing || service.id !== editing.id)
          .flatMap((service) => (service.assignments || [])
            .map((assignment) => ({ assignment, event: service })));
        const conflict = findOverlappingAssignment(
          { assignment: selected, event: form },
          [...currentEntries, ...externalEntries],
        );
        if (conflict) {
          window.alert(ASSIGNMENT_OVERLAP_MESSAGE);
          next[index] = form.assignments[index];
        }
      }
    }
    setForm({ ...form, assignments: next });
  }

  function removeAssignment(index) {
    setForm({ ...form, assignments: form.assignments.filter((_, i) => i !== index) });
    setActiveAdvanceIndex(null);
  }

  function updateAssignmentAdvances(index, nextAdvances) {
    updateAssignment(index, { advancePayments: nextAdvances });
  }

  function addAssignmentAdvance(index) {
    const assignment = form.assignments[index];
    if (!assignment) return;
    const current = Array.isArray(assignment.advancePayments) ? assignment.advancePayments : [];
    updateAssignmentAdvances(index, [
      ...current,
      {
        id: `advance-${Date.now()}-${current.length + 1}`,
        date: todayInputValue(),
        amount: '',
        note: '',
        car: false,
      },
    ]);
    setActiveAdvanceIndex(index);
  }

  function updateAssignmentAdvance(index, advanceId, patch) {
    const assignment = form.assignments[index];
    if (!assignment) return;
    const current = Array.isArray(assignment.advancePayments) ? assignment.advancePayments : [];
    updateAssignmentAdvances(index, current.map((advance) => (
      String(advance.id) === String(advanceId) ? { ...advance, ...patch } : advance
    )));
  }

  function removeAssignmentAdvance(index, advanceId) {
    const assignment = form.assignments[index];
    if (!assignment) return;
    const current = Array.isArray(assignment.advancePayments) ? assignment.advancePayments : [];
    updateAssignmentAdvances(index, current.filter((advance) => String(advance.id) !== String(advanceId)));
  }

  async function submit(event) {
    event.preventDefault();
    if (form.isContinuous && form.endDate && form.date && parseDateOnly(form.endDate) < parseDateOnly(form.date)) {
      setFormError('A data de fim nao pode ser anterior a data de inicio.');
      setActiveTab('summary');
      return;
    }
    if (form.isContinuous) {
      const missingDate = form.assignments.some((item) => item.role && item.collaboratorId && !item.assignmentDate);
      if (missingDate) {
        setFormError('Nos eventos continuos, cada colaborador tem de ter a data de trabalho preenchida.');
        setActiveTab('team');
        return;
      }
    }
    const scheduledAssignments = form.assignments.filter((item) => item.role && item.collaboratorId);
    const originalAssignmentsById = new Map(
      (editing?.assignments || []).map((assignment) => [String(assignment.id), assignment]),
    );
    const assignmentsToValidate = scheduledAssignments.filter((assignment) => (
      !assignment.id
      || assignmentScheduleChanged(
        assignment,
        originalAssignmentsById.get(String(assignment.id)),
      )
    ));
    const externalAssignments = data
      .filter((service) => !editing || service.id !== editing.id)
      .flatMap((service) => (service.assignments || [])
        .map((assignment) => ({ assignment, event: service })));
    for (const current of assignmentsToValidate) {
      const currentFormEntries = scheduledAssignments
        .filter((assignment) => assignment !== current)
        .map((assignment) => ({ assignment, event: form }));
      const conflict = findOverlappingAssignment(
        { assignment: current, event: form },
        [...currentFormEntries, ...externalAssignments],
      );
      if (conflict) {
        setFormError(ASSIGNMENT_OVERLAP_MESSAGE);
        setActiveTab('team');
        return;
      }
    }
    setSaving(true);
    setFormError('');
    try {
      const effectiveLocation = form.useDefaultLocation ? (selectedClient?.address || form.location) : form.location;
      const prepaymentForPayload = buildPrepaymentSummary({
        total: financials.totalRevenue,
        serviceDate: form.date,
        billingStatus: form.billingStatus,
        client: selectedClient,
      });
      const travelCars = form.travelType === 'kilometers' ? cleanTravelCarsForPayload(form.travelCars) : [];
      const firstTravelCar = travelCars[0] || {};
      const payload = {
        ...form,
        status: statusManualOverride ? form.status : nextAutomaticServiceStatus(form),
        assignmentDrafts: assignmentDraftsFromRows(form.assignments),
        endDate: form.isContinuous && form.endDate ? form.endDate : null,
        location: effectiveLocation,
        uniform: form.uniform === 'Outros' ? form.uniformOther : form.uniform,
        clientId: Number(form.clientId),
        guestsCount: form.guestsCount === '' ? null : Number(form.guestsCount),
        requiredRoles: form.requiredRoles,
        realHours: financials.realHours,
        billableHours: financials.billableHours,
        minimumHoursSnapshot,
        totalRevenue: financials.totalRevenue,
        totalCost: financials.totalCost,
        externalCosts: normalizeExternalCosts(form.externalCosts),
        travelExpenseEnabled: travelExpenseAmount > 0,
        travelExpenseAmount: travelExpenseAmount || 0,
        travelType: form.travelType || 'none',
        travelPeople: form.travelType === 'kilometers' ? (firstTravelCar.travelPeople || null) : (form.travelPeople || null),
        km: form.travelType === 'kilometers' ? (firstTravelCar.km || null) : (form.km || null),
        kmRate: form.travelType === 'kilometers' ? (firstTravelCar.kmRate || null) : (form.kmRate || null),
        durationHours: form.travelType === 'kilometers' ? (firstTravelCar.durationHours || null) : (form.durationHours || null),
        travelStaffHourlyRate: form.travelType === 'kilometers' ? (firstTravelCar.travelStaffHourlyRate || 0) : (parseMoney(form.travelStaffHourlyRate) || 0),
        travelCars,
        split5050: Boolean(form.split5050),
        travelManualAmount: form.travelType === 'manual' ? (parseMoney(form.travelManualAmount) || 0) : 0,
        signaledAmount: ['partial70', 'paid'].includes(form.billingStatus) ? prepaymentForPayload.signaledAmount : 0,
        paidAmount: form.billingStatus === 'paid'
          ? prepaymentForPayload.total
          : form.billingStatus === 'partial70'
            ? prepaymentForPayload.paidAmount
            : 0,
        remainingPaymentDate: form.billingStatus === 'partial70' ? prepaymentForPayload.remainingPaymentDate : null,
      };
      const saved = await api(`/services${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      const eventId = editing ? editing.id : saved.id;
      if (editing) {
        const existingIds = new Set((editing.assignments || []).map((item) => item.id));
        const keptIds = new Set(form.assignments.filter((item) => item.id).map((item) => item.id));
        const toDelete = [...existingIds].filter((id) => !keptIds.has(id));
        await Promise.all(toDelete.map((id) => api(`/assignments/${id}`, { method: 'DELETE' })));
      }
      for (const item of form.assignments.filter((assignment) => assignment.role && assignment.collaboratorId)) {
        const staffHours = formAssignmentStaffHours(item);
        const hasManualStaffTimes = Boolean(item.checkIn && item.checkOut);
        const hasManualClientTimes = Boolean(
          (item.clientCheckIn && item.clientCheckOut)
          || (item.validatedCheckIn && item.validatedCheckOut),
        );
        const clientReal = hasManualClientTimes ? formAssignmentClientRealHours(item) : 0;
        const clientHours = hasManualClientTimes ? formAssignmentClientHours(item) : 0;
        const payableStaffHours = hasManualStaffTimes ? staffHours : 0;
        const roleConfig = form.requiredRoles.find((required) => required.role === item.role);
        const clientRoleRate = parseMoney(roleConfig?.agreedRate) || 0;
        const hourlyRate = assignmentStaffRate(item, collaboratorsById, clientRoleRate);
        const body = {
          eventId,
          collaboratorId: Number(item.collaboratorId),
          assignmentDate: form.isContinuous ? (item.assignmentDate || null) : null,
          role: item.role,
          plannedCheckIn: item.plannedCheckIn || null,
          plannedCheckOut: item.plannedCheckOut || null,
          checkIn: item.checkIn || null,
          checkOut: item.checkOut || null,
          clientCheckIn: item.clientCheckIn || null,
          clientCheckOut: item.clientCheckOut || null,
          validatedCheckIn: item.validatedCheckIn || null,
          validatedCheckOut: item.validatedCheckOut || null,
          hoursWorked: payableStaffHours,
          clientRealHours: clientReal,
          clientBillableHours: clientHours,
          staffPayableHours: payableStaffHours,
          hourlyRate,
          totalPay: Number((payableStaffHours * hourlyRate).toFixed(2)),
          validationStatus: item.validationStatus || 'pending',
          validationNotes: item.validationNotes || null,
          clientSynced: Boolean(item.clientSynced),
          isDriver: Boolean(item.isDriver),
          advancePayments: item.advancePayments || [],
          status: item.status || 'pending_confirmation',
        };
        if (item.id) {
          await api(`/assignments/${item.id}`, { method: 'PUT', body: JSON.stringify(body) });
        } else {
          await api('/assignments', { method: 'POST', body: JSON.stringify(body) });
        }
      }
      if (payload.billingStatus === 'paid') {
        const budgetReference = extractBudgetReference([
          payload.notes || '',
          payload.description || '',
          payload.name || '',
          editing?.notes || '',
          editing?.description || '',
          editing?.name || '',
        ].join(' '));
        if (budgetReference) {
          const linkedBudget = (budgets || []).find((budget) => String(budget.reference || '').trim().toUpperCase() === budgetReference.toUpperCase());
          if (linkedBudget && linkedBudget.paymentStatus !== 'paid') {
            await api(`/budgets/${linkedBudget.id}`, {
              method: 'PUT',
              body: JSON.stringify({ paymentStatus: 'paid' }),
            });
            reloadBudgets();
          }
        }
      }
      closeForm(true);
      reload();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeEvent() {
    if (!editing?.id || removing) return;
    const confirmed = window.confirm('Queres eliminar este evento/serviço? Esta ação não pode ser desfeita.');
    if (!confirmed) return;
    setRemoving(true);
    setFormError('');
    try {
      await api(`/services/${editing.id}`, { method: 'DELETE' });
      closeForm(true);
      reload();
    } catch (err) {
      setFormError(err.message || 'Não foi possível eliminar o evento/serviço.');
    } finally {
      setRemoving(false);
    }
  }

  async function restoreEventFromArchive() {
    if (!editing?.id || saving) return;
    setSaving(true);
    setFormError('');
    try {
      const nextNotes = removeValidatedMarker(editing.notes) || null;
      await api(`/services/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          status: SERVICE_STATUS.toValidateStaff,
          notes: nextNotes,
        }),
      });
      const restoredForm = { ...form, status: SERVICE_STATUS.toValidateStaff, notes: nextNotes || '' };
      setForm(restoredForm);
      setFormBaseline(restoredForm);
      setEditing((prev) => (prev ? { ...prev, status: SERVICE_STATUS.toValidateStaff, notes: nextNotes } : prev));
      setListScope('active');
      reload();
    } catch (err) {
      setFormError(err.message || 'Não foi possível retirar o evento/serviço do arquivo.');
    } finally {
      setSaving(false);
    }
  }

  function renderPrepaymentPanel() {
    if (selectedClient?.billingMethod !== 'prepaid') return null;
    const rule = clientPrepaymentRule(selectedClient);

    return (
      <section className="service-form-section">
        <h3>Pré-pagamento</h3>
        <div className="service-prepayment-panel">
          <div className="service-prepayment-summary">
            <strong>Pré-pagamento do cliente</strong>
            <span>Regra do cliente: {rule.percent}% na sinalização e restante {rule.remainingDaysBefore} dias antes do evento.</span>
          </div>
          <div className="service-prepayment-grid">
            <label>Estado do pagamento
              <select value={form.billingStatus || 'pending'} onChange={(event) => updatePrepaymentStatus(event.target.value)}>
                <option value="pending">Aguardar sinalização</option>
                <option value="partial70">Sinalização</option>
                <option value="paid">Pago</option>
              </select>
            </label>
            <label>Valor sinalizado
              <input value={euro(prepaymentSummary.signaledAmount)} readOnly />
            </label>
            <label>Valor total do Evento/Serviço
              <input value={euro(prepaymentSummary.total)} readOnly />
            </label>
            <label>Valor restante
              <input value={euro(prepaymentSummary.remainingAmount)} readOnly />
            </label>
            <label>Alerta do restante pagamento
              <input value={prepaymentSummary.remainingPaymentDate || 'A definir após escolher a data'} readOnly />
            </label>
          </div>
          {prepaidPaymentBlocked ? (
            <div className="service-prepayment-actions">
              <p className="notice">Regista a sinalização de 70% antes de alocar novos colaboradores.</p>
              <button type="button" className="secondary-button" onClick={markPrepaymentSignal}>
                Registar sinalização 70%
              </button>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  const tabs = editing
    ? [
        { id: 'summary', label: 'Evento/Serviço' },
        { id: 'team', label: 'Colaboradores' },
        { id: 'finance', label: 'Financeiro' },
      ]
    : [{ id: 'summary', label: 'Evento/Serviço' }];

  return (
    <div className="page">
      <Card
        title="Eventos/Serviços"
        action={(
          <button className="command-button" type="button" onClick={openCreate}>
            <Plus size={17} />
            Novo Evento/Serviço
          </button>
        )}
      >
        <div className="service-tabs budget-tabs">
          <button
            type="button"
            className={`service-tab ${listScope === 'active' ? 'service-tab--active' : ''}`}
            onClick={() => setListScope('active')}
          >
            Ativos ({activeCount})
          </button>
          <button
            type="button"
            className={`service-tab ${listScope === 'archive' ? 'service-tab--active' : ''}`}
            onClick={() => setListScope('archive')}
          >
            Arquivo ({archiveCount})
          </button>
        </div>
        <div className="filters">
          <input className="form-control" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          <select className="form-control" value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}>
            <option value="">Todos os clientes</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
          <select className="form-control" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">Todos os estados</option>
            {operationalStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        {error ? <p className="notice">{error}</p> : null}
        {loading ? <p className="muted">A carregar...</p> : null}
        {!loading && !rows.length ? <p className="muted">Nenhum evento/serviço encontrado.</p> : null}
        <div className="service-card-list">
          {rows.map((row) => {
            const requiredRoles = safeArrayJson(row.requiredRoles);
            const requestedTotal = row.isContinuous
              ? (row.assignments || []).filter((item) => item.role && item.collaboratorId && item.assignmentDate).length
              : requiredRoles.reduce((sum, item) => sum + Number(item.qty || 0), 0);
            const confirmedTotal = (row.assignments || []).filter((item) => normalizeAssignmentStatus(item.status) === 'confirmed').length;
            const pendingTotal = (row.assignments || []).filter((item) => normalizeAssignmentStatus(item.status) === 'pending_confirmation').length;
            return (
              <button key={row.id} type="button" className="service-card" onClick={() => navigate(`/services/${row.id}`)}>
                <div className="service-card__main">
                  <div className="service-card__field">
                    <small>Nome do Evento</small>
                    <strong>{row.name}</strong>
                  </div>
                  <div className="service-card__field">
                    <small>Cliente</small>
                    <strong>{row.client?.name || '-'}</strong>
                  </div>
                  <div className="service-card__field">
                    <small>Data</small>
                    <strong>{formatEventDateRange(row)}</strong>
                  </div>
                </div>
                <div className="service-card__meta">
                  <span className="service-assigned"><Users size={14} /> Solicitados: {requestedTotal}</span>
                  <span className="service-status-count service-status-count--confirmed">Confirmados: {confirmedTotal}</span>
                  {pendingTotal > 0 ? <span className="service-status-count service-status-count--pending">A aguardar: {pendingTotal}</span> : null}
                  <span className="service-status-count">Valor: {euro(getRowForecast(row))}</span>
                  <Badge tone={isArchivedService(row) ? 'success' : 'info'}>{statusLabel(row.status)}</Badge>
                  <ChevronRight size={16} />
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {formOpen ? (
        <Modal title={editing ? form.name || 'Editar Evento/Serviço' : 'Novo Evento/Serviço'} onClose={() => closeForm()} size="wide">
          <form className="resource-form" onSubmit={submit}>
            <div className="service-tabs">
              {tabs.map((tab) => (
                <button key={tab.id} type="button" className={`service-tab ${activeTab === tab.id ? 'service-tab--active' : ''}`} onClick={() => setActiveTab(tab.id)}>
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="service-template-bar">
              <div className="service-template-bar__title">
                <LayoutTemplate size={17} />
                <span>Templates</span>
              </div>
              <div className="service-template-select">
                <span>Template</span>
                <button
                  type="button"
                  className="service-template-trigger"
                  onClick={() => setTemplateDropdownOpen((prev) => !prev)}
                >
                  <span>
                    {selectedTemplate
                      ? `${selectedTemplate.name}${selectedTemplate.eventType ? ` · ${selectedTemplate.eventType}` : ''}`
                      : 'Selecionar template'}
                  </span>
                  <ChevronDown size={16} />
                </button>
                {templateDropdownOpen ? (
                  <div className="service-template-menu">
                    <button
                      type="button"
                      className="service-template-option"
                      onClick={() => {
                        applyTemplate('');
                        setTemplateDropdownOpen(false);
                      }}
                    >
                      <span>Selecionar template</span>
                    </button>
                    {sortedTemplates.map((template) => (
                      <div key={template.id} className="service-template-option service-template-option--with-action">
                        <button
                          type="button"
                          onClick={() => {
                            applyTemplate(String(template.id));
                            setTemplateDropdownOpen(false);
                          }}
                        >
                          <span>{template.name}</span>
                          {template.eventType ? <small>{template.eventType}</small> : null}
                        </button>
                        <button
                          type="button"
                          className="icon-button icon-button--danger"
                          aria-label={`Apagar template ${template.name}`}
                          onClick={() => deleteSelectedTemplate(String(template.id))}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                    {!sortedTemplates.length ? <p className="muted">Sem templates guardados.</p> : null}
                  </div>
                ) : null}
              </div>
              <label>
                <span>Nome do template</span>
                <input
                  value={templateName}
                  placeholder={form.name || 'Ex: Casamento 80 pax'}
                  onChange={(event) => setTemplateName(event.target.value)}
                />
              </label>
              <button type="button" className="secondary-button" onClick={saveCurrentTemplate} disabled={savingTemplate}>
                <Save size={16} />
                {savingTemplate ? 'A guardar...' : 'Guardar template'}
              </button>
            </div>
            {templateError ? <p className="notice">{templateError}</p> : null}

            {activeTab === 'summary' ? (
              <div className="service-tab-panel">
                <section className="service-form-section">
                  <h3>Dados principais</h3>
                  <div className="form-grid">
                    <label>Evento / Serviço
                      <input value={form.name} required onChange={(event) => setForm({ ...form, name: event.target.value })} />
                    </label>
                    <label>Tipo de Evento
                      <select value={form.eventType} onChange={(event) => setForm({ ...form, eventType: event.target.value })}>
                        <option value="">Selecionar</option>
                        {eventTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                    <label>{form.isContinuous ? 'Data de inicio' : 'Data'}
                      <input type="date" value={form.date} required onChange={(event) => setForm({ ...form, date: event.target.value })} />
                    </label>
                    <label className="check-inline service-check">
                      <input
                        type="checkbox"
                        checked={form.isContinuous}
                        onChange={(event) => setForm({
                          ...form,
                          isContinuous: event.target.checked,
                          endDate: event.target.checked ? (form.endDate || form.date) : '',
                        })}
                      />
                      <span>Evento continuo</span>
                    </label>
                    {form.isContinuous ? (
                      <label>Data de fim
                        <input type="date" value={form.endDate} min={form.date || undefined} required onChange={(event) => setForm({ ...form, endDate: event.target.value })} />
                      </label>
                    ) : null}
                    <label>Nº de Convidados/Participantes
                      <input type="number" min="0" value={form.guestsCount} onChange={(event) => setForm({ ...form, guestsCount: event.target.value })} />
                    </label>
                    {form.isContinuous ? <p className="muted">Duracao: {eventDays} dia(s). Os calculos usam o horario previsto repetido por dia.</p> : null}
                  </div>
                </section>

                <section className="service-form-section">
                  <h3>Cliente e local</h3>
                  <div className="form-grid">
                    <label>Cliente
                      <select value={form.clientId} required onChange={(event) => updateClient(event.target.value)}>
                        <option value="">Selecionar</option>
                        {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                      </select>
                    </label>
                    <label className="check-inline service-check">
                      <input
                        type="checkbox"
                        checked={form.useDefaultLocation}
                        onChange={(event) => setForm({
                          ...form,
                          useDefaultLocation: event.target.checked,
                          location: event.target.checked ? (selectedClient?.address || '') : form.location,
                        })}
                      />
                      <span>Utilizar local habitual</span>
                    </label>
                    <div className="span-2 client-info-grid">
                      <p><span>Morada habitual</span><strong>{selectedClient?.address || '-'}</strong></p>
                      <p><span>NIF</span><strong>{selectedClient?.nif || '-'}</strong></p>
                      <p><span>Contacto</span><strong>{selectedClient?.representativeName || selectedClient?.contactPerson || '-'}</strong></p>
                      <p><span>Telefone</span><strong>{selectedClient?.phone || '-'}</strong></p>
                      <p><span>Email</span><strong>{selectedClient?.email || '-'}</strong></p>
                      <p>
                        <span>Horas mínimas</span>
                        <strong>{minimumHoursSnapshot > 0 ? `${minimumHoursSnapshot} h por colaborador/turno` : 'Sem mínimo'}</strong>
                        {minimumHoursSnapshot > 0 ? <SourceBadge>mínimo aplicado</SourceBadge> : null}
                      </p>
                      <p>
                        <span>Faturação</span>
                        <strong>{billingMethodLabels[selectedClient?.billingMethod] || '-'}</strong>
                        {selectedClient?.billingMethod ? <SourceBadge>regra do cliente</SourceBadge> : null}
                      </p>
                      <p>
                        <span>Prazo</span>
                        <strong>{paymentTermText(selectedClient)}</strong>
                        {selectedClient?.paymentTerm ? <SourceBadge>regra do cliente</SourceBadge> : null}
                      </p>
                      <p>
                        <span>Uniforme habitual</span>
                        <strong>{selectedClient?.defaultUniform || 'Definir no evento'}</strong>
                        {selectedClient?.defaultUniform ? <SourceBadge>uniforme habitual</SourceBadge> : null}
                      </p>
                      <p>
                        <span>Pré-pagamento</span>
                        <strong>{prepaymentRuleText(selectedClient)}</strong>
                        {selectedClient?.billingMethod === 'prepaid' ? <SourceBadge>regra de pré-pagamento</SourceBadge> : null}
                      </p>
                    </div>
                    <label className="span-2">Local do evento
                      <input value={form.useDefaultLocation ? (selectedClient?.address || form.location) : form.location} readOnly={form.useDefaultLocation} onChange={(event) => setForm({ ...form, location: event.target.value })} />
                    </label>
                    <div className="service-uniform-row span-2">
                      <label>Ponto de Encontro
                        <input value={form.meetingPoint} placeholder="Ex: Entrada de Staff" onChange={(event) => setForm({ ...form, meetingPoint: event.target.value })} />
                      </label>
                      <label>Uniforme
                        <select value={form.uniform} onChange={(event) => setForm({ ...form, uniform: event.target.value, uniformOther: event.target.value === 'Outros' ? form.uniformOther : '' })}>
                          <option value="">Selecionar</option>
                          {uniformOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </label>
                      {form.uniform === 'Outros' ? (
                        <label>Tipo de uniforme
                          <input
                            value={form.uniformOther}
                            placeholder="Indicar uniforme"
                            onChange={(event) => setForm({ ...form, uniformOther: event.target.value })}
                          />
                        </label>
                      ) : null}
                    </div>
                    <label>Contacto no Local - Nome
                      <input value={form.onsiteContactName} onChange={(event) => setForm({ ...form, onsiteContactName: event.target.value })} />
                    </label>
                    <label>Contacto no Local - Telefone
                      <input value={form.onsiteContactPhone} onChange={(event) => setForm({ ...form, onsiteContactPhone: event.target.value })} />
                    </label>
                  </div>
                </section>

                {renderPrepaymentPanel()}

                <section className="service-form-section">
                  <h3>Horario e estado</h3>
                  <div className="form-grid">
                    <label>Entrada prevista
                      <TimeInput value={form.startTime} onChange={(value) => setForm((current) => ({ ...current, startTime: value }))} />
                    </label>
                    <label>Saída prevista
                      <TimeInput value={form.endTime} onChange={(value) => setForm((current) => ({ ...current, endTime: value }))} />
                    </label>
                    <div className="services-row-3-top span-2">
                      <label>Deslocação
                        <select value={form.travelType} onChange={(event) => setTravelType(event.target.value)}>
                          <option value="none">Nenhuma</option>
                          <option value="outside_lisbon">Fora Grande Lisboa</option>
                          <option value="outside_plus_staff">Fora + Staff</option>
                          <option value="kilometers">Quilómetros</option>
                          <option value="manual">Valor manual</option>
                        </select>
                      </label>
                      {form.travelType === 'outside_plus_staff' ? (
                        <label>Pessoas deslocação
                          <input
                            type="number"
                            min="1"
                            value={form.travelPeople}
                            onChange={(event) => setForm({ ...form, travelPeople: event.target.value })}
                          />
                        </label>
                      ) : <div />}
                      <label>Estado Operacional
                        <select
                          value={form.status}
                          onChange={(event) => {
                            setStatusManualOverride(true);
                            setForm({ ...form, status: event.target.value });
                          }}
                        >
                          {operationalStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                    </div>
                    {form.travelType === 'kilometers' ? (
                      <div className="service-travel-cars span-2">
                        {(form.travelCars || [emptyTravelCar()]).map((car, index) => (
                          <div className="service-travel-car-row" key={car.id || index}>
                            <input
                              aria-label="Nome da viatura"
                              placeholder={`Carro ${index + 1}`}
                              value={car.label || ''}
                              onChange={(event) => updateTravelCar(index, { label: event.target.value })}
                            />
                            <input
                              aria-label="Quilómetros"
                              type="number"
                              min="0"
                              step="any"
                              placeholder="KM"
                              value={car.km ?? ''}
                              onChange={(event) => updateTravelCar(index, { km: event.target.value })}
                            />
                            <input
                              aria-label="Valor por quilómetro"
                              type="number"
                              min="0"
                              step="any"
                              placeholder="€/KM"
                              value={car.kmRate ?? ''}
                              onChange={(event) => updateTravelCar(index, { kmRate: event.target.value })}
                            />
                            <input
                              aria-label="Duração da deslocação"
                              type="number"
                              min="0"
                              step="any"
                              placeholder="Duração"
                              value={car.durationHours ?? ''}
                              onChange={(event) => updateTravelCar(index, { durationHours: event.target.value })}
                            />
                            <input
                              aria-label="Pessoas na deslocação"
                              type="number"
                              min="0"
                              step="1"
                              placeholder="Pessoas"
                              value={car.travelPeople ?? ''}
                              onChange={(event) => updateTravelCar(index, { travelPeople: event.target.value })}
                            />
                            <input
                              aria-label="Valor por hora da deslocação do staff"
                              type="text"
                              inputMode="decimal"
                              placeholder="Valor/h staff"
                              value={car.travelStaffHourlyRate ?? ''}
                              onChange={(event) => updateTravelCar(index, { travelStaffHourlyRate: event.target.value })}
                              onFocus={(event) => {
                                const parsed = parseMoney(event.target.value);
                                updateTravelCar(index, { travelStaffHourlyRate: parsed === null ? '' : String(parsed).replace('.', ',') });
                              }}
                              onBlur={(event) => updateTravelCar(index, { travelStaffHourlyRate: formatMoneyInline(event.target.value) })}
                            />
                            <button type="button" className="icon-button icon-button--danger" onClick={() => removeTravelCar(index)} aria-label="Remover carro">
                              <Trash2 size={15} />
                            </button>
                          </div>
                        ))}
                        <div className="service-travel-cars-actions">
                          <button type="button" className="secondary-button" onClick={addTravelCar}>+ Adicionar carro</button>
                          <label className="check-inline service-check">
                            <input type="checkbox" checked={form.split5050} onChange={(event) => setForm({ ...form, split5050: event.target.checked })} />
                            <span>50/50 no tempo de deslocação</span>
                          </label>
                        </div>
                      </div>
                    ) : null}
                    {form.travelType === 'manual' ? (
                      <div className="services-row-3-top span-2">
                        <label>Valor manual
                          <input
                            type="text"
                            value={form.travelManualAmount}
                            placeholder="Ex: 35,00€"
                            onChange={(event) => setForm({ ...form, travelManualAmount: event.target.value })}
                            onBlur={(event) => setForm({ ...form, travelManualAmount: formatMoneyInline(event.target.value) })}
                          />
                        </label>
                      </div>
                    ) : null}
                    {form.travelType !== 'none' ? (
                      <p className="muted span-2">Valor calculado da deslocação: <strong>{formatMoneyInline(travelExpenseAmount) || '0,00€'}</strong></p>
                    ) : null}
                    <label className="span-2">Descrição
                      <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
                    </label>
                  </div>
                </section>

                <section className="service-form-section">
                  <h3>Funcoes necessarias</h3>
                  <div className="service-role-requirements">
                    {availableRoles.map((role) => {
                      const item = form.requiredRoles.find((entry) => entry.role === role) || { qty: '', agreedRate: '' };
                      const inheritedRate = clientRuleRate(selectedClient, role);
                      return (
                        <div key={role} className="service-role-requirement-row">
                          <strong>{role}</strong>
                          <input type="number" min="0" placeholder="Nº" value={item.qty || ''} onChange={(event) => updateRoleRequirement(role, { qty: event.target.value })} />
                          <label className="service-role-rate-field">
                            <input
                              type="text"
                              placeholder="Valor/h cliente"
                              value={item.agreedRate || ''}
                              onChange={(event) => updateRoleRequirement(role, { agreedRate: event.target.value })}
                              onBlur={(event) => {
                                if (Number(item.qty || 0) > 0) updateRoleRequirement(role, { agreedRate: formatMoneyInline(event.target.value) });
                              }}
                            />
                            {inheritedRate !== null && item.agreedRate ? <SourceBadge>valor vindo do cliente</SourceBadge> : null}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            ) : null}

            {activeTab === 'team' ? (
              <div className="service-tab-panel">
                <section className="service-form-section">
                  <h3>Colaboradores</h3>
                  {form.isContinuous && teamDays.length ? (
                    <div className="service-day-tabs">
                      {teamDays.map((day) => (
                        <button
                          key={day}
                          type="button"
                          className={`service-tab ${selectedTeamDay === day ? 'service-tab--active' : ''}`}
                          onClick={() => setSelectedTeamDay(day)}
                        >
                          {date.format(new Date(`${day}T00:00:00`))}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="service-assignments-panel">
                    {form.requiredRoles.map((required) => {
                      const roleAssignments = form.assignments
                        .map((item, index) => ({ ...item, index }))
                        .filter((item) => item.role === required.role)
                        .filter((item) => (!form.isContinuous ? true : (item.assignmentDate || '') === (selectedTeamDay || teamDays[0] || '')))
                        .filter((item) => {
                          const collab = collaboratorsById.get(String(item.collaboratorId));
                          if (!collab) return true;
                          if (collab.status !== 'inactive') return true;
                          return canShowInactiveAssignments;
                        });
                      const workedAssignments = roleAssignments.filter((item) => !nonBillableStatuses.has(normalizeAssignmentStatus(item.status)));
                      const totalRoleHours = workedAssignments.reduce((sum, item) => sum + formAssignmentStaffHours(item), 0);
                      const clientRoleRate = parseMoney(required.agreedRate) || 0;
                      const totalRoleCost = workedAssignments.reduce(
                        (sum, item) => sum
                          + assignmentStaffCost(item, formAssignmentStaffHours(item), collaboratorsById, clientRoleRate)
                          + staffCarAdvancesTotal(item.advancePayments),
                        0,
                      );
                      return (
                        <div key={required.role} className="service-role-block">
                          <header>
                            <strong>{required.role}</strong>
                            <span className="muted">Total horas: {formatHours(totalRoleHours)}</span>
                            <span className="muted">Total a pagar: {euro(totalRoleCost)}</span>
                            <button type="button" className="secondary-button" onClick={() => addAssignment(required.role)} disabled={prepaidPaymentBlocked}>+ Adicionar colaborador</button>
                          </header>
                          {prepaidPaymentBlocked ? <p className="notice">Cliente com pré-pagamento: regista a sinalização antes de alocar novos colaboradores.</p> : null}
                          {roleAssignments.map((assignment) => {
                            const advances = Array.isArray(assignment.advancePayments) ? assignment.advancePayments : [];
                            const advanceTotal = staffAdvancesTotal(advances);
                            const carAdvanceTotal = staffCarAdvancesTotal(advances);
                            const combinedAdvanceTotal = advanceTotal + carAdvanceTotal;
                            const advancesOpen = activeAdvanceIndex === assignment.index;
                            return (
                              <div key={`${required.role}-${assignment.index}`} className="service-assignment-group">
                                <div className={[
                                  'service-assignment-row',
                                  form.isContinuous ? 'service-assignment-row--dated' : '',
                                  normalizeAssignmentStatus(assignment.status) === 'confirmed' ? 'service-assignment-row--confirmed' : '',
                                  !assignment.collaboratorId ? 'service-assignment-row--empty' : '',
                                ].filter(Boolean).join(' ')}
                                >
                                  <div className="service-assignment-collaborator">
                                    <label className="service-client-sync-check" title={assignment.clientSynced ? 'Sincronizado com o cliente' : 'Marcar como sincronizado com o cliente'}>
                                      <input
                                        type="checkbox"
                                        checked={Boolean(assignment.clientSynced)}
                                        onChange={(event) => updateAssignment(assignment.index, { clientSynced: event.target.checked })}
                                      />
                                      <span aria-hidden="true" />
                                    </label>
                                    <button
                                      type="button"
                                      className={`service-driver-toggle ${assignment.isDriver ? 'service-driver-toggle--active' : ''}`}
                                      title={assignment.isDriver ? 'Condutor' : 'Marcar como condutor'}
                                      aria-pressed={Boolean(assignment.isDriver)}
                                      onClick={() => updateAssignment(assignment.index, { isDriver: !assignment.isDriver })}
                                    >
                                      <CarFront size={15} />
                                    </button>
                                    <div className="service-collab-picker">
                                      <button
                                        type="button"
                                        className={`service-collab-trigger ${assignment.clientSynced ? 'service-collab-trigger--synced' : ''}`}
                                        onClick={(event) => toggleCollaboratorPicker(event, assignment.index)}
                                      >
                                        {assignment.collaboratorId
                                          ? collaboratorOptionLabel(collaboratorsById.get(String(assignment.collaboratorId)) || { id: assignment.collaboratorId, name: 'Colaborador' })
                                          : 'Por atribuir'}
                                      </button>
                                    {activeCollaboratorPickerIndex === assignment.index ? (
                                      <div
                                        className="service-collab-menu"
                                        style={collaboratorPickerPlacement ? {
                                          left: collaboratorPickerPlacement.left,
                                          top: collaboratorPickerPlacement.top,
                                          bottom: collaboratorPickerPlacement.bottom,
                                          width: collaboratorPickerPlacement.width,
                                          maxHeight: collaboratorPickerPlacement.maxHeight,
                                        } : undefined}
                                      >
                                        <input
                                          ref={collaboratorSearchRef}
                                          autoFocus
                                          type="text"
                                          placeholder="Filtrar por nome"
                                          value={assignment.collaboratorSearch || ''}
                                          onChange={(event) => updateAssignment(assignment.index, { collaboratorSearch: event.target.value })}
                                        />
                                        <div className="service-collab-options">
                                          {filterCollaboratorOptions([
                                            ...activeCollaborators.filter((collab) => collaboratorHasRole(collab, required.role)),
                                            ...((assignment.collaboratorId && !activeCollaborators.some((c) => String(c.id) === String(assignment.collaboratorId)))
                                              ? [collaboratorsById.get(String(assignment.collaboratorId))].filter(Boolean)
                                              : []),
                                          ]
                                            .filter((collab, index, arr) => collab && arr.findIndex((item) => String(item.id) === String(collab.id)) === index)
                                            .filter((collab) => collaboratorHasRole(collab, required.role) || String(collab.id) === String(assignment.collaboratorId)), assignment.collaboratorSearch)
                                            .map((collab) => (
                                              <button
                                                type="button"
                                                key={collab.id}
                                                className="service-collab-option"
                                                onClick={() => {
                                                  const nextAssignment = {
                                                    ...assignment,
                                                    collaboratorId: String(collab.id),
                                                  };
                                                  const roleRate = parseMoney(required.agreedRate) || 0;
                                                  const staffRate = assignmentStaffRate(nextAssignment, collaboratorsById, roleRate)
                                                    || collaboratorHourlyRate(collab);
                                                  updateAssignment(assignment.index, {
                                                    collaboratorId: String(collab.id),
                                                    hourlyRate: staffRate > 0 ? formatMoneyInline(staffRate) : assignment.hourlyRate,
                                                  });
                                                  setActiveCollaboratorPickerIndex(null);
                                                  setCollaboratorPickerPlacement(null);
                                                }}
                                              >
                                                <span>{collaboratorOptionLabel(collab)}</span>
                                                {collab.hasOwnCar ? <span className="service-collab-car-badge">Carro</span> : null}
                                              </button>
                                            ))}
                                        </div>
                                      </div>
                                    ) : null}
                                    </div>
                                  </div>
                                  {form.isContinuous ? (
                                    <input
                                      type="date"
                                      aria-label="Data de trabalho"
                                      title="Data de trabalho"
                                      value={assignment.assignmentDate || ''}
                                      min={form.date || undefined}
                                      max={(form.endDate || form.date || undefined)}
                                      onChange={(event) => updateAssignment(assignment.index, { assignmentDate: event.target.value })}
                                    />
                                  ) : null}
                                  <TimeInput aria-label="Entrada prevista" title="Entrada prevista" value={assignment.plannedCheckIn || ''} onChange={(value) => updateAssignment(assignment.index, { plannedCheckIn: value })} />
                                  <TimeInput aria-label="Saída prevista" title="Saída prevista" value={assignment.plannedCheckOut || ''} onChange={(value) => updateAssignment(assignment.index, { plannedCheckOut: value })} />
                                  <input type="text" aria-label="Horas previstas" title="Horas previstas" readOnly value={formatHours(formAssignmentPlannedHours(assignment))} />
                                  <input
                                    type="text"
                                    placeholder="Valor/h acordado"
                                    value={assignment.hourlyRate}
                                    onChange={(event) => updateAssignment(assignment.index, { hourlyRate: event.target.value, manualHourlyRate: true })}
                                    onFocus={(event) => {
                                      const parsed = parseMoney(event.target.value);
                                      updateAssignment(assignment.index, { hourlyRate: parsed === null ? '' : String(parsed).replace('.', ',') });
                                    }}
                                    onBlur={(event) => updateAssignment(assignment.index, { hourlyRate: formatMoneyInline(event.target.value) })}
                                  />
                                  <select className={`service-status-select service-status-select--${assignment.status || 'pending_confirmation'}`} value={assignment.status || 'pending_confirmation'} onChange={(event) => updateAssignment(assignment.index, { status: event.target.value })}>
                                    {assignmentStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                  </select>
                                  <button
                                    type="button"
                                    className={`service-advance-toggle ${combinedAdvanceTotal > 0 ? 'service-advance-toggle--active' : ''}`}
                                    onClick={() => setActiveAdvanceIndex(advancesOpen ? null : assignment.index)}
                                  >
                                    Adiantamentos
                                    {combinedAdvanceTotal > 0 ? <strong>{euro(combinedAdvanceTotal)}</strong> : null}
                                  </button>
                                  <button type="button" className="icon-button icon-button--danger" onClick={() => removeAssignment(assignment.index)}>
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                                {advancesOpen ? (
                                  <div className="service-advance-panel">
                                    <header>
                                      <strong>Adiantamentos</strong>
                                      <span>Descontar: {euro(advanceTotal)}</span>
                                      <span>Carro: {euro(carAdvanceTotal)}</span>
                                      <button type="button" className="secondary-button" onClick={() => addAssignmentAdvance(assignment.index)}>+ Adiantamento</button>
                                    </header>
                                    {advances.map((advance) => (
                                      <div key={advance.id} className="service-advance-row">
                                        <input
                                          type="date"
                                          aria-label="Data do adiantamento"
                                          value={advance.date || ''}
                                          onChange={(event) => updateAssignmentAdvance(assignment.index, advance.id, { date: event.target.value })}
                                        />
                                        <input
                                          type="text"
                                          inputMode="decimal"
                                          placeholder="Valor"
                                          value={advance.amount || ''}
                                          onChange={(event) => updateAssignmentAdvance(assignment.index, advance.id, { amount: event.target.value })}
                                          onFocus={(event) => {
                                            const parsed = parseMoney(event.target.value);
                                            updateAssignmentAdvance(assignment.index, advance.id, { amount: parsed === null ? '' : String(parsed).replace('.', ',') });
                                          }}
                                          onBlur={(event) => updateAssignmentAdvance(assignment.index, advance.id, { amount: formatMoneyInline(event.target.value) })}
                                        />
                                        <input
                                          type="text"
                                          placeholder="Motivo/observação"
                                          value={advance.note || ''}
                                          onChange={(event) => updateAssignmentAdvance(assignment.index, advance.id, { note: event.target.value })}
                                        />
                                        <label className="service-advance-car-check">
                                          <input
                                            type="checkbox"
                                            checked={Boolean(advance.car)}
                                            onChange={(event) => updateAssignmentAdvance(assignment.index, advance.id, { car: event.target.checked })}
                                          />
                                          <span>Carro</span>
                                        </label>
                                        <button type="button" className="icon-button icon-button--danger" onClick={() => removeAssignmentAdvance(assignment.index, advance.id)}>
                                          <Trash2 size={16} />
                                        </button>
                                      </div>
                                    ))}
                                    {!advances.length ? <p className="muted">Sem adiantamentos registados.</p> : null}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                          {!roleAssignments.length ? <p className="muted">Sem colaboradores atribuídos.</p> : null}
                        </div>
                      );
                    })}
                    {!form.requiredRoles.length ? <p className="muted">Define primeiro as funções necessárias no separador Evento/Serviço.</p> : null}
                  </div>
                </section>
              </div>
            ) : null}

            {activeTab === 'finance' ? (
              <div className="service-tab-panel">
                <section className="service-form-section">
                  <h3>Financeiro</h3>
                  <div className="service-finance-grid">
                    <div><span>Horas Reais</span><strong>{durationHours(financials.realHours)}</strong></div>
                    <div><span>Horas Faturáveis</span><strong>{durationHours(financials.billableHours)}</strong></div>
                    <div><span>Valor previsto</span><strong>{euro(financials.expectedRevenue)}</strong></div>
                    <div><span>Valor Total do Evento/Serviço</span><strong>{euro(financials.totalRevenue)}</strong></div>
                    {financials.externalChargeAmount > 0 ? (
                      <>
                        <div><span>Parceiros cobrados ao cliente</span><strong>{euro(financials.externalChargeAmount)}</strong></div>
                        <div><span>Custo real parceiros</span><strong>{euro(financials.externalCostAmount)}</strong></div>
                      </>
                    ) : null}
                    <div><span>Total a pagar aos colaboradores</span><strong>{euro(financials.totalCost)}</strong></div>
                    <div><span>Lucro do Evento/Serviço</span><strong className={financials.profit < 0 ? 'money-negative' : 'money-positive'}>{euro(financials.profit)}</strong></div>
                  </div>
                  {financials.externalChargeAmount > 0 ? (
                    <div className="service-external-costs">
                      <h4>Custos Externos/Parceiros</h4>
                      {normalizeExternalCosts(form.externalCosts).map((item) => (
                        <div className="service-external-row" key={item.id}>
                          <div>
                            <strong>{item.type || 'Custo externo'}</strong>
                            <small>{[item.supplier, item.description].filter(Boolean).join(' · ') || '-'}</small>
                          </div>
                          <span>Custo: {euro(item.costAmount)}</span>
                          <span>Margem: {item.marginPercent.toFixed(2).replace('.', ',')}%</span>
                          <strong>{euro(item.chargeAmount)}</strong>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              </div>
            ) : null}

            {formError ? <p className="notice">{formError}</p> : null}
            <footer className="form-actions form-actions--sticky service-form-actions">
              <button className="command-button" type="submit" disabled={saving || removing}>{saving ? 'A guardar...' : 'Guardar'}</button>
              {editing ? (
                <button className="secondary-button secondary-button--danger" type="button" onClick={removeEvent} disabled={saving || removing}>
                  <Trash2 size={16} />
                  {removing ? 'A eliminar...' : 'Eliminar'}
                </button>
              ) : null}
              {editing && isArchivedService(form) ? (
                <button className="secondary-button" type="button" onClick={restoreEventFromArchive} disabled={saving || removing}>
                  Retirar do arquivo
                </button>
              ) : null}
              <button className="secondary-button" type="button" onClick={() => closeForm()}>Cancelar</button>
            </footer>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
