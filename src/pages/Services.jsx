import { ChevronRight, CircleDollarSign, Plus, Trash2, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Badge from '../components/UI/Badge.jsx';
import Card from '../components/UI/Card.jsx';
import Modal from '../components/UI/Modal.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../utils/api.js';
import { date } from '../utils/formatters.js';

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
  if (value === '' || value === null || value === undefined) return null;
  const normalized = String(value).replace('€', '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
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
  const explicit = Number(assignment.clientBillableHours || 0);
  if (explicit > 0) return explicit;
  const validated = calcRoundedBillableHours(assignment.validatedCheckIn, assignment.validatedCheckOut);
  if (validated > 0) return validated;
  const worked = Number(assignment.hoursWorked || 0);
  if (worked > 0) return worked;
  return calcRoundedBillableHours(assignment.checkIn || fallbackStart, assignment.checkOut || fallbackEnd);
}

function assignmentStaffHours(assignment, fallbackStart, fallbackEnd) {
  const explicit = Number(assignment.staffPayableHours || 0);
  if (explicit > 0) return explicit;
  const validated = calcRoundedBillableHours(assignment.validatedCheckIn, assignment.validatedCheckOut);
  if (validated > 0) return validated;
  const worked = Number(assignment.hoursWorked || 0);
  if (worked > 0) return worked;
  return calcRoundedBillableHours(assignment.checkIn || fallbackStart, assignment.checkOut || fallbackEnd);
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

function extractBudgetReference(text) {
  const raw = String(text || '');
  const tagged = raw.match(/\[BUDGET_REF:([^\]]+)\]/i);
  if (tagged?.[1]) return tagged[1].trim();
  const fallback = raw.match(/\bORC-\d+\b/i);
  return fallback ? fallback[0].toUpperCase() : '';
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
  return {
    name: row.name || '',
    eventType: row.eventType || '',
    date: row.date ? String(row.date).slice(0, 10) : '',
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
  const roleRateMap = new Map(requiredRoles.map((item) => [item.role, Number(item.agreedRate || 0)]));
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
  const expectedHours = calcRoundedBillableHours(row.startTime, row.endTime);
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

  const rows = useMemo(() => data.filter((row) => {
    const byDate = fromDate ? String(row.date).slice(0, 10) >= fromDate : true;
    const byClient = clientFilter ? String(row.clientId) === clientFilter : true;
    const byStatus = statusFilter ? row.status === statusFilter : true;
    return byDate && byClient && byStatus;
  }), [data, fromDate, clientFilter, statusFilter]);

  const availableRoles = useMemo(
    () => [...new Set((roleCatalog || []).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt')),
    [roleCatalog],
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
  const canShowInactiveAssignments = isPastEvent(form.date);

  function collaboratorOptionLabel(collab) {
    return `${collab.shortName || collab.name || `Colaborador ${collab.id}`} | ${collab.nif || '-'}`;
  }

  const expectedHours = calcRoundedBillableHours(form.startTime, form.endTime);
  const billableHours = expectedHours;
  const travelExpenseAmount = form.travelExpenseEnabled ? (parseMoney(form.travelExpenseAmount) || 0) : 0;

  const financials = useMemo(() => {
    const roleRateMap = new Map(form.requiredRoles.map((item) => [item.role, parseMoney(item.agreedRate) || 0]));
    const expectedRevenueByRoles = getRoleForecast(form.requiredRoles, expectedHours);
    const assignments = (form.assignments || []).filter((assignment) => assignment.role && assignment.collaboratorId);
    let totalRevenue = 0;
    let totalCost = 0;
    let expectedRevenue = 0;
    for (const assignment of assignments) {
      if (nonBillableStatuses.has(normalizeAssignmentStatus(assignment.status))) continue;
      const clientHours = assignmentClientHours(assignment, form.startTime, form.endTime);
      const staffHours = assignmentStaffHours(assignment, form.startTime, form.endTime);
      if (!assignment.role || (!clientHours && !staffHours)) continue;
      const clientRate = roleRateMap.get(assignment.role) || 0;
      const collaboratorRate = parseMoney(assignment.hourlyRate) || 0;
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
  }, [form.requiredRoles, form.assignments, form.startTime, form.endTime, expectedHours, travelExpenseAmount]);
  const paidAmount = parseMoney(form.signaledAmount) || 0;
  const amountMissing = Number((financials.totalRevenue - paidAmount).toFixed(2));

  function getAutoOperationalStatus(currentForm) {
    const requested = currentForm.requiredRoles.reduce((sum, item) => sum + Number(item.qty || 0), 0);
    const confirmed = currentForm.assignments.filter((item) => item.status === 'confirmed').length;
    const now = new Date();
    if (currentForm.date && currentForm.endTime) {
      const endDt = new Date(`${currentForm.date}T${currentForm.endTime}:00`);
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
  }, [searchParams, setSearchParams, loading, openedFromQuery, data]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setActiveTab('summary');
    setFormOpen(true);
    setFormError('');
    setStatusManualOverride(false);
  }

  function openEdit(row) {
    setEditing(row);
    setForm(toForm(row));
    setActiveTab('summary');
    setFormOpen(true);
    setFormError('');
    setStatusManualOverride(false);
  }

  function updateClient(clientId) {
    const client = clients.find((item) => String(item.id) === String(clientId));
    setForm((prev) => ({
      ...prev,
      clientId,
      location: prev.useDefaultLocation ? (client?.address || '') : prev.location,
      onsiteContactName: prev.onsiteContactName || client?.representativeName || client?.contactPerson || '',
      onsiteContactPhone: prev.onsiteContactPhone || client?.phone || '',
    }));
  }

  function updateRoleRequirement(role, patch) {
    const current = form.requiredRoles.find((item) => item.role === role) || { role, qty: '', agreedRate: '' };
    const nextItem = { ...current, ...patch };
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
    const roleConfig = form.requiredRoles.find((item) => item.role === role);
    setForm({
      ...form,
      assignments: [...form.assignments, {
        role,
        collaboratorId: '',
        collaboratorSearch: '',
        checkIn: form.startTime || '',
        checkOut: form.endTime || '',
        clientCheckIn: '',
        clientCheckOut: '',
        validatedCheckIn: '',
        validatedCheckOut: '',
        hoursWorked: calcRoundedBillableHours(form.startTime, form.endTime),
        clientBillableHours: 0,
        staffPayableHours: 0,
        hourlyRate: roleConfig.agreedRate || '',
        validationStatus: 'pending',
        validationNotes: '',
        status: 'pending_confirmation',
      }],
    });
  }

  function updateAssignment(index, patch) {
    const next = form.assignments.map((item, i) => {
      if (i !== index) return item;
      const merged = { ...item, ...patch };
      return { ...merged, hoursWorked: calcRoundedBillableHours(merged.checkIn, merged.checkOut) };
    });

    if (patch.collaboratorId) {
      const selected = next[index];
      const selectedId = Number(selected.collaboratorId);
      const selectedDate = form.date || '';
      const selectedStart = selected.checkIn || form.startTime;
      const selectedEnd = selected.checkOut || form.endTime;
      if (selectedId && selectedDate && selectedStart && selectedEnd) {
        const overlapInCurrentForm = next.some((item, i) => {
          if (i === index) return false;
          if (Number(item.collaboratorId) !== selectedId) return false;
          const otherStart = item.checkIn || form.startTime;
          const otherEnd = item.checkOut || form.endTime;
          return otherStart && otherEnd && timeRangesOverlap(selectedStart, selectedEnd, otherStart, otherEnd);
        });
        const overlapInOtherServices = data.some((service) => {
          if (editing && service.id === editing.id) return false;
          const serviceDate = service.date ? String(service.date).slice(0, 10) : '';
          if (serviceDate !== selectedDate) return false;
          return (service.assignments || []).some((assignment) => {
            if (Number(assignment.collaboratorId) !== selectedId) return false;
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

  function updateBillingStatus(nextBillingStatus) {
    if (nextBillingStatus === 'paid') {
      setStatusManualOverride(true);
      setForm((prev) => ({ ...prev, billingStatus: nextBillingStatus, status: 'paid' }));
      return;
    }
    setStatusManualOverride(false);
    setForm((prev) => {
      const next = { ...prev, billingStatus: nextBillingStatus };
      if (prev.status === 'paid') next.status = getAutoOperationalStatus(prev);
      return next;
    });
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.requiredRoles.length) {
      setFormError('Define pelo menos uma função necessária com número de colaboradores.');
      setActiveTab('summary');
      return;
    }
    const invalidAssignment = form.assignments.some((item) => item.role && !item.collaboratorId);
    if (invalidAssignment) {
      setFormError('Existem funções com colaborador por selecionar.');
      setActiveTab('team');
      return;
    }
    const duplicateKeys = new Set();
    for (const item of form.assignments) {
      if (!item.role || !item.collaboratorId) continue;
      const key = `${item.role}::${item.collaboratorId}`;
      if (duplicateKeys.has(key)) {
        setFormError('O mesmo colaborador não pode ser atribuído duas vezes à mesma função.');
        setActiveTab('team');
        return;
      }
      duplicateKeys.add(key);
    }
    setSaving(true);
    setFormError('');
    try {
      const effectiveLocation = form.useDefaultLocation ? (selectedClient?.address || form.location) : form.location;
      const payload = {
        ...form,
        status: form.billingStatus === 'paid' ? 'paid' : form.status,
        location: effectiveLocation,
        uniform: form.uniform === 'Outros' ? form.uniformOther : form.uniform,
        clientId: Number(form.clientId),
        guestsCount: form.guestsCount === '' ? null : Number(form.guestsCount),
        requiredRoles: form.requiredRoles,
        billableHours,
        totalRevenue: financials.totalRevenue,
        totalCost: financials.totalCost,
        travelExpenseEnabled: Boolean(form.travelExpenseEnabled),
        travelExpenseAmount: travelExpenseAmount || 0,
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
            const staffHours = assignmentStaffHours(item, form.startTime, form.endTime);
            const clientHours = assignmentClientHours(item, form.startTime, form.endTime);
            const hourlyRate = parseMoney(item.hourlyRate) || 0;
            const body = {
              eventId,
              collaboratorId: Number(item.collaboratorId),
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
        { id: 'billing', label: 'Faturação' },
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
            const requestedTotal = requiredRoles.reduce((sum, item) => sum + Number(item.qty || 0), 0);
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
                    <strong>{row.date ? date.format(new Date(row.date)) : '-'}</strong>
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
                    <label>Data
                      <input type="date" value={form.date} required onChange={(event) => setForm({ ...form, date: event.target.value })} />
                    </label>
                    <label>Nº de Convidados/Participantes
                      <input type="number" min="0" value={form.guestsCount} onChange={(event) => setForm({ ...form, guestsCount: event.target.value })} />
                    </label>
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
                      <label className="check-inline service-check">
                        <input type="checkbox" checked={form.travelExpenseEnabled} onChange={(event) => setForm({ ...form, travelExpenseEnabled: event.target.checked })} />
                        <span>Despesa de deslocamento (Kms)</span>
                      </label>
                      {form.travelExpenseEnabled ? (
                        <label>Valor deslocacao (cliente)
                          <input
                            type="text"
                            value={form.travelExpenseAmount}
                            onChange={(event) => setForm({ ...form, travelExpenseAmount: event.target.value })}
                            onBlur={(event) => setForm({ ...form, travelExpenseAmount: formatMoneyInline(event.target.value) })}
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
                  <div className="service-assignments-panel">
                    {form.requiredRoles.map((required) => {
                      const roleAssignments = form.assignments
                        .map((item, index) => ({ ...item, index }))
                        .filter((item) => item.role === required.role)
                        .filter((item) => {
                          const collab = collaboratorsById.get(String(item.collaboratorId));
                          if (!collab) return true;
                          if (collab.status !== 'inactive') return true;
                          return canShowInactiveAssignments;
                        });
                      return (
                        <div key={required.role} className="service-role-block">
                          <header>
                            <strong>{required.role}</strong>
                            <span className="muted">Solicitados: {required.qty}</span>
                            <button type="button" className="secondary-button" onClick={() => addAssignment(required.role)} disabled={prepaidPaymentBlocked}>+ Adicionar colaborador</button>
                          </header>
                          {prepaidPaymentBlocked ? <p className="notice">Cliente com pré-pagamento: recebe o pagamento antes de alocar novos colaboradores.</p> : null}
                          {roleAssignments.map((assignment) => (
                            <div key={`${required.role}-${assignment.index}`} className="service-assignment-row">
                              <div className="service-collab-picker">
                                <button
                                  type="button"
                                  className="service-collab-trigger"
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
                                              updateAssignment(assignment.index, { collaboratorId: String(collab.id) });
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
                              <input type="time" aria-label="Entrada real" title="Entrada real" value={assignment.checkIn} onChange={(event) => updateAssignment(assignment.index, { checkIn: event.target.value })} />
                              <input type="time" aria-label="Saída real" title="Saída real" value={assignment.checkOut} onChange={(event) => updateAssignment(assignment.index, { checkOut: event.target.value })} />
                              <input type="text" aria-label="Horas faturaveis" title="Horas faturaveis" readOnly value={`${assignment.hoursWorked || 0} h`} />
                              <input
                                type="text"
                                placeholder="Valor/h acordado"
                                value={assignment.hourlyRate}
                                onChange={(event) => updateAssignment(assignment.index, { hourlyRate: event.target.value })}
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

            {activeTab === 'billing' ? (
              <div className="service-tab-panel">
                <section className="service-form-section">
                  <h3>Faturação</h3>
                  <div className="services-row-4">
                    <label>Estado da Faturação
                      <select className={`payment-state payment-state--${form.billingStatus}`} value={form.billingStatus} onChange={(event) => updateBillingStatus(event.target.value)}>
                        <option value="pending">Pendente</option>
                        <option value="partial70">Sinalização</option>
                        <option value="paid">Pago</option>
                      </select>
                    </label>
                    <label>Valor sinalizado
                      <input
                        type="text"
                        value={form.signaledAmount}
                        disabled={form.billingStatus !== 'partial70'}
                        onChange={(event) => {
                          const next = event.target.value;
                          setForm({ ...form, signaledAmount: next, paidAmount: next });
                        }}
                        onBlur={(event) => {
                          const formatted = formatMoneyInline(event.target.value);
                          setForm({ ...form, signaledAmount: formatted, paidAmount: formatted });
                        }}
                      />
                    </label>
                    <label>Valor em falta
                      <input
                        type="text"
                        readOnly
                        value={euro(form.billingStatus === 'partial70' ? amountMissing : 0)}
                      />
                    </label>
                    <label>Data do restante pagamento
                      <input
                        type="date"
                        disabled={form.billingStatus !== 'partial70'}
                        value={form.remainingPaymentDate}
                        onChange={(event) => setForm({ ...form, remainingPaymentDate: event.target.value })}
                      />
                    </label>
                  </div>
                </section>
              </div>
            ) : null}

            {formError ? <p className="notice">{formError}</p> : null}
            <footer className="form-actions service-form-actions">
              {activeTab === 'billing' ? (
                <div className="billing-total-card billing-total-card--footer" role="status" aria-live="polite">
                  <div className="billing-total-card__label">
                    <CircleDollarSign size={18} />
                    <span>Valor Total</span>
                  </div>
                  <strong>{euro(financials.totalRevenue)}</strong>
                </div>
              ) : null}
              {editing ? (
                <button className="secondary-button secondary-button--danger" type="button" onClick={removeEvent} disabled={saving || removing}>
                  <Trash2 size={16} />
                  {removing ? 'A eliminar...' : 'Eliminar'}
                </button>
              ) : null}
              <button className="secondary-button" type="button" onClick={() => setFormOpen(false)}>Cancelar</button>
              <button className="command-button" type="submit" disabled={saving || removing}>{saving ? 'A guardar...' : 'Guardar'}</button>
            </footer>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
