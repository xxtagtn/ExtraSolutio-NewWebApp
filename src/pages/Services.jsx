import { ChevronDown, ChevronRight, LayoutTemplate, Plus, Save, Trash2, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Badge from '../components/UI/Badge.jsx';
import Card from '../components/UI/Card.jsx';
import Modal from '../components/UI/Modal.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../utils/api.js';
import { date } from '../utils/formatters.js';
import { assignmentStaffCost, assignmentStaffRate, clientChargeHours, collaboratorHourlyRate, decimalValue } from '../utils/serviceFinance.js';
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

const operationalStatusOptions = [
  { value: 'drafting', label: 'A preencher' },
  { value: 'team_complete', label: 'Equipa completa' },
  { value: 'in_progress', label: 'Em execução' },
  { value: 'completed', label: 'Concluído' },
  { value: 'to_validate_staff', label: 'Por validar horários (Staff)' },
  { value: 'to_validate_client', label: 'Por validar horários (Cliente)' },
  { value: 'invoiced', label: 'Faturado' },
  { value: 'paid', label: 'Pago' },
];

const uniformOptions = [
  'Polo ExtraSolutio',
  'Camisa Branca',
  'Camisa Preta',
  'Fato',
  'Definido pelo cliente',
  'Outros',
];

const assignmentStatusOptions = [
  { value: 'confirmed', label: 'Confirmado' },
  { value: 'pending_confirmation', label: 'Aguardar Confirmação' },
  { value: 'missed_justified', label: 'Faltou c/Justificação' },
  { value: 'missed_unjustified', label: 'Faltou s/Justificação' },
  { value: 'cancelled', label: 'Cancelado' },
];

const nonBillableStatuses = new Set(['missed_justified', 'missed_unjustified', 'cancelled']);

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
    split5050: false,
    travelManualAmount: '',
    description: '',
    status: 'drafting',
    billingStatus: 'pending',
    signaledAmount: '',
    paidAmount: '',
    remainingPaymentDate: '',
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
  const amount = Number(value || 0);
  return `${amount.toFixed(2).replace('.', ',')} h`;
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

function assignmentClientHours(assignment, fallbackStart, fallbackEnd) {
  return clientChargeHours(assignment, fallbackStart, fallbackEnd);
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

function dateRangesOverlap(aStartValue, aEndValue, bStartValue, bEndValue) {
  const aStart = parseDateOnly(aStartValue);
  const aEnd = parseDateOnly(aEndValue || aStartValue);
  const bStart = parseDateOnly(bStartValue);
  const bEnd = parseDateOnly(bEndValue || bStartValue);
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart <= bEnd && bStart <= aEnd;
}

function formatEventDateRange(item) {
  if (!item?.date) return '-';
  const start = date.format(new Date(item.date));
  const endValue = eventRangeEnd(item);
  if (!item.isContinuous || !endValue || dateOnly(endValue) === dateOnly(item.date)) return start;
  return `${start} - ${date.format(new Date(endValue))}`;
}

function timeRangesOverlap(aStart, aEnd, bStart, bEnd) {
  const startA = toMinutes(aStart);
  const endA = toMinutes(aEnd);
  const startB = toMinutes(bStart);
  const endB = toMinutes(bEnd);
  if (startA === null || endA === null || startB === null || endB === null) return false;
  let sA = startA;
  let eA = endA;
  let sB = startB;
  let eB = endB;
  if (eA <= sA) eA += 24 * 60;
  if (eB <= sB) eB += 24 * 60;
  return sA < eB && sB < eA;
}

function statusLabel(status) {
  const found = operationalStatusOptions.find((option) => option.value === status);
  if (found) return found.label;
  if (status === 'cancelled') return 'Cancelado';
  return status || '-';
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

function clientRoleRates(client) {
  return safeArrayJson(client?.roleRates)
    .filter((item) => item?.role && parseMoney(item.rate) !== null);
}

function clientRateForRole(client, role) {
  const item = clientRoleRates(client).find((entry) => entry.role === role);
  const value = parseMoney(item?.rate);
  return value === null ? '' : formatMoneyInline(value);
}

function extractBudgetReference(text) {
  const raw = String(text || '');
  const tagged = raw.match(/\[BUDGET_REF:([^\]]+)\]/i);
  if (tagged?.[1]) return tagged[1].trim();
  const fallback = raw.match(/\bORC-\d+\b/i);
  return fallback ? fallback[0].toUpperCase() : '';
}

function parseTemplatePayload(template) {
  if (!template?.payload) return {};
  if (typeof template.payload === 'object') return template.payload;
  try {
    const parsed = JSON.parse(template.payload);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function templatePayloadFromForm(currentForm) {
  const calculatedTravelAmount = calculateTravelAmount(currentForm);
  return {
    eventName: currentForm.name || '',
    eventType: currentForm.eventType || '',
    isContinuous: Boolean(currentForm.isContinuous),
    useDefaultLocation: Boolean(currentForm.useDefaultLocation),
    location: currentForm.location || '',
    guestsCount: currentForm.guestsCount || '',
    startTime: currentForm.startTime || '',
    endTime: currentForm.endTime || '',
    uniform: currentForm.uniform || '',
    uniformOther: currentForm.uniformOther || '',
    meetingPoint: currentForm.meetingPoint || '',
    onsiteContactName: currentForm.onsiteContactName || '',
    onsiteContactPhone: currentForm.onsiteContactPhone || '',
    travelExpenseEnabled: calculatedTravelAmount > 0,
    travelExpenseAmount: calculatedTravelAmount,
    travelType: currentForm.travelType || 'none',
    travelPeople: currentForm.travelPeople || 1,
    km: currentForm.km || 0,
    kmRate: currentForm.kmRate || 0.4,
    durationHours: currentForm.durationHours || 0,
    split5050: Boolean(currentForm.split5050),
    travelManualAmount: currentForm.travelManualAmount || '',
    description: currentForm.description || '',
    requiredRoles: (currentForm.requiredRoles || []).map((item) => ({
      role: item.role || '',
      qty: Number(item.qty || 0),
      agreedRate: item.agreedRate || '',
    })).filter((item) => item.role && item.qty > 0),
  };
}

function collaboratorHasRole(collab, role) {
  if (!role) return true;
  const roles = Array.isArray(collab?.roles) ? collab.roles : [];
  return roles.includes(role) || String(collab?.category || '') === String(role);
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
    split5050: Boolean(row.split5050),
    travelManualAmount: savedTravelType === 'manual' ? formatMoneyInline(row.travelManualAmount || savedTravelAmount) : '',
    description: row.description || '',
    status: row.status || 'drafting',
    billingStatus: row.billingStatus || 'pending',
    signaledAmount: row.signaledAmount === undefined || row.signaledAmount === null ? '' : formatMoneyInline(row.signaledAmount),
    paidAmount: row.paidAmount === undefined || row.paidAmount === null ? '' : formatMoneyInline(row.paidAmount),
    remainingPaymentDate: row.remainingPaymentDate ? String(row.remainingPaymentDate).slice(0, 10) : '',
    requiredRoles: parsedRequiredRoles.map((item) => ({
      ...item,
      agreedRate: formatMoneyInline(item.agreedRate),
    })),
    assignments: (row.assignments || []).map((item) => ({
      id: item.id,
      role: item.role || '',
      collaboratorId: item.collaboratorId ? String(item.collaboratorId) : '',
      assignmentDate: item.assignmentDate ? dateOnly(item.assignmentDate) : '',
      collaboratorSearch: '',
      checkIn: item.checkIn || '',
      checkOut: item.checkOut || '',
      clientCheckIn: item.clientCheckIn || '',
      clientCheckOut: item.clientCheckOut || '',
      validatedCheckIn: item.validatedCheckIn || '',
      validatedCheckOut: item.validatedCheckOut || '',
      hoursWorked: Number(item.hoursWorked || 0),
      clientBillableHours: Number(item.clientBillableHours || 0),
      staffPayableHours: Number(item.staffPayableHours || 0),
      hourlyRate: formatMoneyInline(item.hourlyRate),
      validationStatus: item.validationStatus || 'pending',
      validationNotes: item.validationNotes || '',
      clientSynced: Boolean(item.clientSynced),
      status: normalizeAssignmentStatus(item.status),
    })),
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
  const assignments = (row.assignments || []).filter((item) => item.role && item.collaboratorId);
  if (assignments.length) {
    const billable = assignments.filter((item) => !nonBillableStatuses.has(normalizeAssignmentStatus(item.status)));
    const total = billable.reduce((sum, item) => {
      const hours = assignmentClientHours(item, row.startTime, row.endTime);
      const rate = roleRateMap.get(item.role) || 0;
      return sum + (hours * rate);
    }, 0);
    return Number((total + travel).toFixed(2));
  }
  const expectedHours = calcRoundedBillableHours(row.startTime, row.endTime) * inclusiveDayCount(row.date, eventRangeEnd(row));
  const forecast = getRoleForecast(requiredRoles, expectedHours);
  return Number((forecast + travel).toFixed(2));
}

export default function Services() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, loading, error, reload } = useApi('/services', []);
  const { data: clients } = useApi('/clients', []);
  const { data: collaborators } = useApi('/collaborators', []);
  const { data: budgets, reload: reloadBudgets } = useApi('/budgets', []);
  const { data: roleCatalog } = useApi('/collaborators/roles', []);
  const { data: serviceTemplates, reload: reloadTemplates } = useApi('/service-templates', []);
  const [fromDate, setFromDate] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('summary');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [formError, setFormError] = useState('');
  const [openedFromQuery, setOpenedFromQuery] = useState(false);
  const [statusManualOverride, setStatusManualOverride] = useState(false);
  const [activeCollaboratorPickerIndex, setActiveCollaboratorPickerIndex] = useState(null);
  const [selectedTeamDay, setSelectedTeamDay] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState('');

  const rows = useMemo(() => data.filter((row) => {
    const byDate = fromDate ? dateOnly(eventRangeEnd(row)) >= fromDate : true;
    const byClient = clientFilter ? String(row.clientId) === clientFilter : true;
    const byStatus = statusFilter ? row.status === statusFilter : true;
    return byDate && byClient && byStatus;
  }), [data, fromDate, clientFilter, statusFilter]);

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
  const prepaidPaymentBlocked = selectedClient?.billingMethod === 'prepaid' && form.billingStatus !== 'paid';
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
  const expectedHours = Number((expectedDailyHours * eventDays).toFixed(2));
  const billableHours = expectedHours;
  const travelExpenseAmount = calculateTravelAmount(form);

  const formAssignmentClientHours = useCallback((assignment) => {
    return clientChargeHours(assignment, form.startTime, form.endTime);
  }, [form.endTime, form.startTime]);

  const formAssignmentStaffHours = useCallback((assignment) => {
    const checked = calcRoundedBillableHours(assignment.checkIn || form.startTime, assignment.checkOut || form.endTime);
    if (assignment.timesTouched && checked > 0) return checked;
    const explicit = Number(assignment.staffPayableHours || 0);
    if (explicit > 0) return explicit;
    const validated = calcRoundedBillableHours(assignment.validatedCheckIn, assignment.validatedCheckOut);
    if (validated > 0) return validated;
    if (checked > 0) return checked;
    return Number(assignment.hoursWorked || 0);
  }, [form.endTime, form.startTime]);

  const financials = useMemo(() => {
    const roleRateMap = new Map(form.requiredRoles.map((item) => [item.role, parseMoney(item.agreedRate) || 0]));
    const expectedRevenueByRoles = getRoleForecast(form.requiredRoles, expectedHours);
    const assignments = (form.assignments || []).filter((assignment) => assignment.role && assignment.collaboratorId);
    let totalRevenue = 0;
    let totalCost = 0;
    let expectedRevenue = 0;
    for (const assignment of assignments) {
      if (nonBillableStatuses.has(normalizeAssignmentStatus(assignment.status))) continue;
      const clientHours = formAssignmentClientHours(assignment);
      const staffHours = formAssignmentStaffHours(assignment);
      if (!assignment.role || (!clientHours && !staffHours)) continue;
      const clientRate = roleRateMap.get(assignment.role) || 0;
      const collaboratorRate = assignmentStaffRate(assignment, collaboratorsById, clientRate);
      expectedRevenue += clientHours * clientRate;
      totalRevenue += clientHours * clientRate;
      totalCost += staffHours * collaboratorRate;
    }
    const hasAssignments = assignments.length > 0;
    const revenueWithoutTravel = hasAssignments ? totalRevenue : expectedRevenueByRoles;
    const expectedWithoutTravel = hasAssignments ? expectedRevenue : expectedRevenueByRoles;
    const revenue = revenueWithoutTravel + travelExpenseAmount;
    return {
      expectedRevenue: Number((expectedWithoutTravel + travelExpenseAmount).toFixed(2)),
      totalRevenue: Number(revenue.toFixed(2)),
      totalCost: Number(totalCost.toFixed(2)),
      profit: Number((revenue - totalCost).toFixed(2)),
    };
  }, [form.requiredRoles, form.assignments, expectedHours, travelExpenseAmount, formAssignmentClientHours, formAssignmentStaffHours, collaboratorsById]);

  function getAutoOperationalStatus(currentForm) {
    const requested = currentForm.isContinuous
      ? currentForm.assignments.filter((item) => item.role && item.collaboratorId && item.assignmentDate).length
      : currentForm.requiredRoles.reduce((sum, item) => sum + Number(item.qty || 0), 0);
    const confirmed = currentForm.assignments.filter((item) => item.status === 'confirmed').length;
    const now = new Date();
    const finalDate = currentForm.isContinuous && currentForm.endDate ? currentForm.endDate : currentForm.date;
    if (finalDate && currentForm.endTime) {
      const endDt = new Date(`${finalDate}T${currentForm.endTime}:00`);
      if (!Number.isNaN(endDt.getTime()) && now >= endDt) return 'to_validate_staff';
    }
    if (currentForm.date && currentForm.startTime) {
      const startDt = new Date(`${currentForm.date}T${currentForm.startTime}:00`);
      if (!Number.isNaN(startDt.getTime()) && now >= startDt) return 'in_progress';
    }
    if (requested > 0 && confirmed >= requested) return 'team_complete';
    return 'drafting';
  }

  useEffect(() => {
    if (!formOpen || statusManualOverride) return;
    const autoStatus = getAutoOperationalStatus(form);
    if (form.status !== autoStatus) setForm((prev) => ({ ...prev, status: autoStatus }));
  }, [formOpen, statusManualOverride, form]);

  useEffect(() => {
    if (!formOpen) return;
    if (!form.isContinuous) {
      setSelectedTeamDay('');
      return;
    }
    if (!teamDays.length) {
      setSelectedTeamDay('');
      return;
    }
    if (!selectedTeamDay || !teamDays.includes(selectedTeamDay)) {
      setSelectedTeamDay(teamDays[0]);
    }
  }, [formOpen, form.isContinuous, teamDays, selectedTeamDay]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setActiveTab('summary');
    setFormOpen(true);
    setFormError('');
    setTemplateError('');
    setTemplateName('');
    setSelectedTemplateId('');
    setStatusManualOverride(false);
    setSelectedTeamDay('');
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
    setEditing(row);
    setForm(formWithStaffRates(toForm(row)));
    setActiveTab('summary');
    setFormOpen(true);
    setFormError('');
    setTemplateError('');
    setTemplateName('');
    setSelectedTemplateId('');
    setStatusManualOverride(false);
    setSelectedTeamDay('');
  }, [formWithStaffRates]);

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
    const payload = parseTemplatePayload(template);
    const nextUniform = payload.uniform || '';
    const isKnownUniform = uniformOptions.includes(nextUniform) && nextUniform !== 'Outros';
    const useDefaultLocation = payload.useDefaultLocation !== false;
    setTemplateName(template.name || '');
    setForm((prev) => ({
      ...prev,
      name: prev.name || payload.eventName || template.name || '',
      eventType: payload.eventType || prev.eventType,
      isContinuous: Boolean(payload.isContinuous),
      endDate: payload.isContinuous ? prev.endDate : '',
      useDefaultLocation,
      location: useDefaultLocation ? (selectedClient?.address || payload.location || prev.location) : (payload.location || prev.location),
      guestsCount: payload.guestsCount ?? prev.guestsCount,
      startTime: payload.startTime || prev.startTime,
      endTime: payload.endTime || prev.endTime,
      uniform: isKnownUniform ? nextUniform : (nextUniform ? 'Outros' : prev.uniform),
      uniformOther: isKnownUniform ? '' : (payload.uniformOther || nextUniform || prev.uniformOther),
      meetingPoint: payload.meetingPoint || prev.meetingPoint,
      onsiteContactName: payload.onsiteContactName || prev.onsiteContactName,
      onsiteContactPhone: payload.onsiteContactPhone || prev.onsiteContactPhone,
      travelExpenseEnabled: Boolean(payload.travelExpenseEnabled),
      travelExpenseAmount: payload.travelExpenseAmount || '',
      travelType: payload.travelType || (payload.travelExpenseEnabled ? 'manual' : 'none'),
      travelPeople: payload.travelPeople || 1,
      km: payload.km || 0,
      kmRate: payload.kmRate || 0.4,
      durationHours: payload.durationHours || 0,
      split5050: Boolean(payload.split5050),
      travelManualAmount: payload.travelManualAmount || payload.travelExpenseAmount || '',
      description: payload.description || prev.description,
      requiredRoles: Array.isArray(payload.requiredRoles) ? payload.requiredRoles.map((item) => ({
        role: item.role || '',
        qty: Number(item.qty || 0),
        agreedRate: item.agreedRate || '',
      })).filter((item) => item.role && item.qty > 0) : prev.requiredRoles,
      assignments: [],
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

  function updateClient(clientId) {
    const client = clients.find((item) => String(item.id) === String(clientId));
    setForm((prev) => ({
      ...prev,
      clientId,
      location: prev.useDefaultLocation ? (client?.address || '') : prev.location,
      onsiteContactName: prev.onsiteContactName || client?.representativeName || client?.contactPerson || '',
      onsiteContactPhone: prev.onsiteContactPhone || client?.phone || '',
      requiredRoles: prev.requiredRoles.map((item) => ({
        ...item,
        agreedRate: item.agreedRate || clientRateForRole(client, item.role),
      })),
    }));
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
      window.alert('Cliente com pré-pagamento: marca o evento como pago antes de alocar staff.');
      return;
    }
    setForm({
      ...form,
      assignments: [...form.assignments, {
        role,
        collaboratorId: '',
        assignmentDate: form.isContinuous ? (selectedTeamDay || form.date || '') : '',
        collaboratorSearch: '',
        checkIn: form.startTime || '',
        checkOut: form.endTime || '',
        clientCheckIn: '',
        clientCheckOut: '',
        validatedCheckIn: '',
        validatedCheckOut: '',
        hoursWorked: expectedDailyHours,
        clientBillableHours: 0,
        staffPayableHours: 0,
        hourlyRate: '',
        validationStatus: 'pending',
        validationNotes: '',
        clientSynced: false,
        status: 'pending_confirmation',
      }],
    });
  }

  function updateAssignment(index, patch) {
    const next = form.assignments.map((item, i) => {
      if (i !== index) return item;
      const merged = { ...item, ...patch };
      const timesTouched = patch.checkIn !== undefined || patch.checkOut !== undefined;
      const workedHours = calcRoundedBillableHours(merged.checkIn, merged.checkOut);
      const updated = { ...merged, hoursWorked: workedHours };
      if (timesTouched) {
        updated.timesTouched = true;
        updated.staffPayableHours = workedHours;
        if (!merged.clientCheckIn && !merged.clientCheckOut && !merged.validatedCheckIn && !merged.validatedCheckOut) {
          updated.clientBillableHours = workedHours;
        }
      }
      return updated;
    });

    if (patch.collaboratorId) {
      const selected = next[index];
      const selectedId = Number(selected.collaboratorId);
      const selectedDate = selected.assignmentDate || form.date || '';
      const selectedEndDate = selectedDate;
      const selectedStart = selected.checkIn || form.startTime;
      const selectedEnd = selected.checkOut || form.endTime;
      if (selectedId && selectedDate && selectedStart && selectedEnd) {
        const overlapInCurrentForm = next.some((item, i) => {
          if (i === index) return false;
          if (Number(item.collaboratorId) !== selectedId) return false;
          const itemDate = item.assignmentDate || form.date || '';
          if (itemDate !== selectedDate) return false;
          const otherStart = item.checkIn || form.startTime;
          const otherEnd = item.checkOut || form.endTime;
          return otherStart && otherEnd && timeRangesOverlap(selectedStart, selectedEnd, otherStart, otherEnd);
        });
        const overlapInOtherServices = data.some((service) => {
          if (editing && service.id === editing.id) return false;
          const serviceDate = dateOnly(service.date);
          const serviceEndDate = dateOnly(eventRangeEnd(service));
          if (!dateRangesOverlap(selectedDate, selectedEndDate, serviceDate, serviceEndDate)) return false;
          return (service.assignments || []).some((assignment) => {
            if (Number(assignment.collaboratorId) !== selectedId) return false;
            const assignmentDay = dateOnly(assignment.assignmentDate || service.date);
            if (assignmentDay !== selectedDate) return false;
            const otherStart = assignment.checkIn || service.startTime;
            const otherEnd = assignment.checkOut || service.endTime;
            return otherStart && otherEnd && timeRangesOverlap(selectedStart, selectedEnd, otherStart, otherEnd);
          });
        });
        if (overlapInCurrentForm || overlapInOtherServices) {
          const collaborator = collaborators.find((c) => c.id === selectedId);
          const collaboratorName = collaborator?.shortName
            || collaborator?.name
            || 'colaborador';
          window.alert(`Conflito de horário: ${collaboratorName} já está atribuído a outro serviço no mesmo dia/horário.`);
          next[index] = { ...next[index], collaboratorId: '' };
        }
      }
    }
    setForm({ ...form, assignments: next });
  }

  function removeAssignment(index) {
    setForm({ ...form, assignments: form.assignments.filter((_, i) => i !== index) });
  }

  async function submit(event) {
    event.preventDefault();
    if (form.isContinuous && form.endDate && form.date && parseDateOnly(form.endDate) < parseDateOnly(form.date)) {
      setFormError('A data de fim nao pode ser anterior a data de inicio.');
      setActiveTab('summary');
      return;
    }
    const invalidAssignment = form.assignments.some((item) => item.role && !item.collaboratorId);
    if (invalidAssignment) {
      setFormError('Existem funções com colaborador por selecionar.');
      setActiveTab('team');
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
    for (let i = 0; i < form.assignments.length; i += 1) {
      const current = form.assignments[i];
      if (!current.role || !current.collaboratorId) continue;
      const currentDate = current.assignmentDate || form.date || '';
      const currentStart = current.checkIn || form.startTime;
      const currentEnd = current.checkOut || form.endTime;
      if (!currentDate || !currentStart || !currentEnd) continue;
      for (let j = i + 1; j < form.assignments.length; j += 1) {
        const other = form.assignments[j];
        if (!other.role || !other.collaboratorId) continue;
        if (String(other.collaboratorId) !== String(current.collaboratorId)) continue;
        const otherDate = other.assignmentDate || form.date || '';
        if (otherDate !== currentDate) continue;
        const otherStart = other.checkIn || form.startTime;
        const otherEnd = other.checkOut || form.endTime;
        if (!otherStart || !otherEnd) continue;
        if (timeRangesOverlap(currentStart, currentEnd, otherStart, otherEnd)) {
          setFormError('O mesmo colaborador não pode ter horários sobrepostos no mesmo dia.');
          setActiveTab('team');
          return;
        }
      }
    }
    setSaving(true);
    setFormError('');
    try {
      const effectiveLocation = form.useDefaultLocation ? (selectedClient?.address || form.location) : form.location;
      const payload = {
        ...form,
        status: form.billingStatus === 'paid' ? 'paid' : form.status,
        endDate: form.isContinuous && form.endDate ? form.endDate : null,
        location: effectiveLocation,
        uniform: form.uniform === 'Outros' ? form.uniformOther : form.uniform,
        clientId: Number(form.clientId),
        guestsCount: form.guestsCount === '' ? null : Number(form.guestsCount),
        requiredRoles: form.requiredRoles,
        billableHours,
        totalRevenue: financials.totalRevenue,
        totalCost: financials.totalCost,
        travelExpenseEnabled: travelExpenseAmount > 0,
        travelExpenseAmount: travelExpenseAmount || 0,
        travelType: form.travelType || 'none',
        travelPeople: form.travelPeople || null,
        km: form.km || null,
        kmRate: form.kmRate || null,
        durationHours: form.durationHours || null,
        split5050: Boolean(form.split5050),
        travelManualAmount: form.travelType === 'manual' ? (parseMoney(form.travelManualAmount) || 0) : 0,
        signaledAmount: form.billingStatus === 'partial70' ? (parseMoney(form.signaledAmount) || 0) : 0,
        paidAmount: form.billingStatus === 'partial70' ? (parseMoney(form.signaledAmount) || 0) : 0,
        remainingPaymentDate: form.billingStatus === 'partial70' && form.remainingPaymentDate ? form.remainingPaymentDate : null,
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
      await Promise.all(
        form.assignments
          .filter((item) => item.role && item.collaboratorId)
          .map((item) => {
            const staffHours = formAssignmentStaffHours(item);
            const clientHours = formAssignmentClientHours(item);
            const roleConfig = form.requiredRoles.find((required) => required.role === item.role);
            const clientRoleRate = parseMoney(roleConfig?.agreedRate) || 0;
            const hourlyRate = assignmentStaffRate(item, collaboratorsById, clientRoleRate);
            const body = {
              eventId,
              collaboratorId: Number(item.collaboratorId),
              assignmentDate: form.isContinuous ? (item.assignmentDate || null) : null,
              role: item.role,
              checkIn: item.checkIn || null,
              checkOut: item.checkOut || null,
              clientCheckIn: item.clientCheckIn || null,
              clientCheckOut: item.clientCheckOut || null,
              validatedCheckIn: item.validatedCheckIn || null,
              validatedCheckOut: item.validatedCheckOut || null,
              hoursWorked: staffHours,
              clientBillableHours: clientHours,
              staffPayableHours: staffHours,
              hourlyRate,
              totalPay: Number((staffHours * hourlyRate).toFixed(2)),
              validationStatus: item.validationStatus || 'pending',
              validationNotes: item.validationNotes || null,
              clientSynced: Boolean(item.clientSynced),
              status: item.status || 'pending_confirmation',
            };
            if (item.id) return api(`/assignments/${item.id}`, { method: 'PUT', body: JSON.stringify(body) });
            return api('/assignments', { method: 'POST', body: JSON.stringify(body) });
          }),
      );
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
      setFormOpen(false);
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
      setFormOpen(false);
      setEditing(null);
      setForm(emptyForm());
      reload();
    } catch (err) {
      setFormError(err.message || 'Não foi possível eliminar o evento/serviço.');
    } finally {
      setRemoving(false);
    }
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
              <button key={row.id} type="button" className="service-card" onClick={() => openEdit(row)}>
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
                  <Badge tone="info">{statusLabel(row.status)}</Badge>
                  <ChevronRight size={16} />
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {formOpen ? (
        <Modal title={editing ? form.name || 'Editar Evento/Serviço' : 'Novo Evento/Serviço'} onClose={() => setFormOpen(false)} size="wide">
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

                <section className="service-form-section">
                  <h3>Horario e estado</h3>
                  <div className="form-grid">
                    <label>Entrada prevista
                      <input type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} />
                    </label>
                    <label>Saída prevista
                      <input type="time" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} />
                    </label>
                    <div className="services-row-3-top span-2">
                      <label>Deslocação
                        <select value={form.travelType} onChange={(event) => setForm({ ...form, travelType: event.target.value })}>
                          <option value="none">Nenhuma</option>
                          <option value="outside_lisbon">Fora Grande Lisboa</option>
                          <option value="outside_plus_staff">Fora + Staff</option>
                          <option value="kilometers">Quilómetros</option>
                          <option value="manual">Valor manual</option>
                        </select>
                      </label>
                      {['outside_plus_staff', 'kilometers'].includes(form.travelType) ? (
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
                      <div className="services-row-4 span-2">
                        <label>KM
                          <input type="number" min="0" step="0.01" value={form.km} onChange={(event) => setForm({ ...form, km: event.target.value })} />
                        </label>
                        <label>Valor/KM
                          <input type="number" min="0" step="0.01" value={form.kmRate} onChange={(event) => setForm({ ...form, kmRate: event.target.value })} />
                        </label>
                        <label>Duração deslocação (h)
                          <input type="number" min="0" step="0.01" value={form.durationHours} onChange={(event) => setForm({ ...form, durationHours: event.target.value })} />
                        </label>
                        <label className="check-inline service-check">
                          <input type="checkbox" checked={form.split5050} onChange={(event) => setForm({ ...form, split5050: event.target.checked })} />
                          <span>50/50 no tempo de deslocação</span>
                        </label>
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
                      return (
                        <div key={role} className="service-role-requirement-row">
                          <strong>{role}</strong>
                          <input type="number" min="0" placeholder="Nº" value={item.qty || ''} onChange={(event) => updateRoleRequirement(role, { qty: event.target.value })} />
                          <input
                            type="text"
                            placeholder="Valor/h cliente"
                            value={item.agreedRate || ''}
                            onChange={(event) => updateRoleRequirement(role, { agreedRate: event.target.value })}
                            onBlur={(event) => {
                              if (Number(item.qty || 0) > 0) updateRoleRequirement(role, { agreedRate: formatMoneyInline(event.target.value) });
                            }}
                          />
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
                        (sum, item) => sum + assignmentStaffCost(item, formAssignmentStaffHours(item), collaboratorsById, clientRoleRate),
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
                          {prepaidPaymentBlocked ? <p className="notice">Cliente com pré-pagamento: recebe o pagamento antes de alocar novos colaboradores.</p> : null}
                          {roleAssignments.map((assignment) => (
                            <div key={`${required.role}-${assignment.index}`} className="service-assignment-row">
                              <div className="service-assignment-collaborator">
                                <label className="service-client-sync-check" title={assignment.clientSynced ? 'Sincronizado com o cliente' : 'Marcar como sincronizado com o cliente'}>
                                  <input
                                    type="checkbox"
                                    checked={Boolean(assignment.clientSynced)}
                                    onChange={(event) => updateAssignment(assignment.index, { clientSynced: event.target.checked })}
                                  />
                                  <span aria-hidden="true" />
                                </label>
                                <div className="service-collab-picker">
                                  <button
                                    type="button"
                                    className={`service-collab-trigger ${assignment.clientSynced ? 'service-collab-trigger--synced' : ''}`}
                                    onClick={() => setActiveCollaboratorPickerIndex((prev) => (prev === assignment.index ? null : assignment.index))}
                                  >
                                    {assignment.collaboratorId
                                      ? collaboratorOptionLabel(collaboratorsById.get(String(assignment.collaboratorId)) || { id: assignment.collaboratorId, name: 'Colaborador' })
                                      : 'Selecionar colaborador'}
                                  </button>
                                {activeCollaboratorPickerIndex === assignment.index ? (
                                  <div className="service-collab-menu">
                                    <input
                                      type="text"
                                      placeholder="Filtrar por nome"
                                      value={assignment.collaboratorSearch || ''}
                                      onChange={(event) => updateAssignment(assignment.index, { collaboratorSearch: event.target.value })}
                                    />
                                    <div className="service-collab-options">
                                      {[
                                        ...activeCollaborators.filter((collab) => collaboratorHasRole(collab, required.role)),
                                        ...((assignment.collaboratorId && !activeCollaborators.some((c) => String(c.id) === String(assignment.collaboratorId)))
                                          ? [collaboratorsById.get(String(assignment.collaboratorId))].filter(Boolean)
                                          : []),
                                      ]
                                        .filter((collab, index, arr) => collab && arr.findIndex((item) => String(item.id) === String(collab.id)) === index)
                                        .filter((collab) => collaboratorHasRole(collab, required.role) || String(collab.id) === String(assignment.collaboratorId))
                                        .filter((collab) => {
                                          const q = String(assignment.collaboratorSearch || '').trim().toLowerCase();
                                          if (!q) return true;
                                          return String(collab.name || '').toLowerCase().includes(q)
                                            || String(collab.shortName || '').toLowerCase().includes(q)
                                            || String(collab.nif || '').includes(q);
                                        })
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
                                            }}
                                          >
                                            {collaboratorOptionLabel(collab)}
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
                              <input type="time" aria-label="Entrada real" title="Entrada real" value={assignment.checkIn} onChange={(event) => updateAssignment(assignment.index, { checkIn: event.target.value })} />
                              <input type="time" aria-label="Saída real" title="Saída real" value={assignment.checkOut} onChange={(event) => updateAssignment(assignment.index, { checkOut: event.target.value })} />
                              <input type="text" aria-label="Horas trabalhadas" title="Horas trabalhadas" readOnly value={formatHours(formAssignmentStaffHours(assignment))} />
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
                              <button type="button" className="icon-button icon-button--danger" onClick={() => removeAssignment(assignment.index)}>
                                <Trash2 size={16} />
                              </button>
                            </div>
                          ))}
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
                    <div><span>Valor previsto</span><strong>{euro(financials.expectedRevenue)}</strong></div>
                    <div><span>Valor Total do Evento/Serviço</span><strong>{euro(financials.totalRevenue)}</strong></div>
                    <div><span>Total a pagar aos colaboradores</span><strong>{euro(financials.totalCost)}</strong></div>
                    <div><span>Lucro do Evento/Serviço</span><strong className={financials.profit < 0 ? 'money-negative' : 'money-positive'}>{euro(financials.profit)}</strong></div>
                  </div>
                </section>
              </div>
            ) : null}

            {formError ? <p className="notice">{formError}</p> : null}
            <footer className="form-actions service-form-actions">
              {editing ? (
                <button className="secondary-button secondary-button--danger" type="button" onClick={removeEvent} disabled={saving || removing}>
                  <Trash2 size={16} />
                  {removing ? 'A eliminar...' : 'Eliminar'}
                </button>
              ) : null}
              <button className="command-button" type="submit" disabled={saving || removing}>{saving ? 'A guardar...' : 'Guardar'}</button>
              <button className="secondary-button" type="button" onClick={() => setFormOpen(false)}>Cancelar</button>
            </footer>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
