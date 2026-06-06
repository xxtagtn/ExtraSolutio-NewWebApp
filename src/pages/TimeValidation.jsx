import { AlertTriangle, ArrowDown, ArrowRight, CheckCircle2, FileDown, FileSpreadsheet, Hourglass, OctagonAlert, RotateCcw, Save, Siren } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import Badge from '../components/UI/Badge.jsx';
import Card from '../components/UI/Card.jsx';
import Stats from '../components/UI/Stats.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../utils/api.js';
import { date } from '../utils/formatters.js';
import { buildBulkValidationCandidates } from '../utils/hourValidationBulk.js';
import { hoursValidationState } from '../utils/hourValidationStatus.js';
import { clientChargeHours, decimalValue } from '../utils/serviceFinance.js';
import { buildStaffScheduleExcelHtml, buildStaffSchedulePdfHtml } from '../utils/staffSchedulePdf.js';
import { filterRowsByDateRange } from '../utils/timeValidationFilters.js';

const NON_BILLABLE_STATUSES = new Set(['missed_justified', 'missed_unjustified', 'cancelled']);
const VALIDATED_EVENT_MARKER = '[EVENT_VALIDATED_HOURS]';

function num(value) {
  return Number(value || 0);
}

function parseRequiredRoles(value) {
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
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

function assignmentStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function rowIsValidated(assignment) {
  return hoursValidationState(assignment).isValidated;
}

function eventIsMarkedValidated(event) {
  return String(event?.notes || '').includes(VALIDATED_EVENT_MARKER);
}

function extractValidatedAt(event) {
  const notes = String(event?.notes || '');
  const match = notes.match(/\[EVENT_VALIDATED_HOURS\]\s*([^\n\r]+)/);
  if (!match?.[1]) return '';
  const dateValue = new Date(match[1].trim());
  if (Number.isNaN(dateValue.getTime())) return '';
  return date.format(dateValue);
}

function removeValidatedMarker(notes) {
  const lines = String(notes || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => !line.includes(VALIDATED_EVENT_MARKER));
  return lines.join('\n').trim();
}

function dateKey(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function currentMonthPeriod(value = new Date()) {
  const d = new Date(value);
  return {
    start: dateKey(new Date(d.getFullYear(), d.getMonth(), 1)),
    end: dateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
  };
}

function periodLabel(start, end) {
  if (start && end && start === end) return date.format(new Date(start));
  if (start && end) return `${date.format(new Date(start))} a ${date.format(new Date(end))}`;
  if (start) return `Desde ${date.format(new Date(start))}`;
  if (end) return `Até ${date.format(new Date(end))}`;
  return 'Todos os dias';
}

function fileSafeName(value) {
  return String(value || 'horarios-staff')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'horarios-staff';
}

function clientHoursFor(assignment, event) {
  return clientChargeHours(assignment, event.startTime, event.endTime);
}

function staffHoursFor(assignment, event) {
  const explicit = num(assignment.staffPayableHours);
  if (explicit > 0) return explicit;
  const validated = calcRoundedBillableHours(assignment.validatedCheckIn, assignment.validatedCheckOut);
  if (validated > 0) return validated;
  const staff = num(assignment.hoursWorked);
  if (staff > 0) return staff;
  return calcRoundedBillableHours(assignment.checkIn || event.startTime, assignment.checkOut || event.endTime);
}

function staffColumnHours(assignment) {
  return calcRoundedBillableHours(assignment.checkIn, assignment.checkOut);
}

function clientColumnHours(assignment) {
  return calcRoundedBillableHours(assignment.clientCheckIn, assignment.clientCheckOut);
}

function hasTimePair(checkIn, checkOut) {
  return Boolean(checkIn && checkOut);
}

function rowAssessment(assignment) {
  if (!hasTimePair(assignment.checkIn, assignment.checkOut) || !hasTimePair(assignment.clientCheckIn, assignment.clientCheckOut)) {
    return { tone: 'info', label: 'Aguardar validação', diffMinutes: null, isDifference: false, needsAttention: true };
  }

  const staffMinutes = Math.round(staffColumnHours(assignment) * 60);
  const clientMinutes = Math.round(clientColumnHours(assignment) * 60);
  const diffMinutes = Math.abs(staffMinutes - clientMinutes);

  if (diffMinutes <= 15) {
    return { tone: 'success', label: 'Dentro da tolerancia', diffMinutes, isDifference: false, needsAttention: false };
  }
  if (diffMinutes <= 30) {
    return { tone: 'warning', label: 'Atenção', diffMinutes, isDifference: true, needsAttention: true };
  }
  if (diffMinutes <= 60) {
    return { tone: 'orange', label: 'Divergência relevante', diffMinutes, isDifference: true, needsAttention: true };
  }
  if (diffMinutes <= 120) {
    return { tone: 'danger', label: 'Divergência crítica', diffMinutes, isDifference: true, needsAttention: true };
  }
  return { tone: 'critical', label: 'Possível erro de registo', diffMinutes, isDifference: true, needsAttention: true };
}

function DifferenceIcon({ tone }) {
  if (tone === 'success') return <CheckCircle2 size={14} />;
  if (tone === 'info') return <Hourglass size={14} />;
  if (tone === 'danger') return <OctagonAlert size={14} />;
  if (tone === 'critical') return <Siren size={14} />;
  return <AlertTriangle size={14} />;
}

function rowTone(assignment) {
  return rowAssessment(assignment).tone;
}

function validationStatusFor(_event, assignment) {
  if (assignment.validatedCheckIn && assignment.validatedCheckOut) return 'validated';
  const tone = rowTone(assignment);
  if (tone === 'success') return 'matched';
  return 'pending';
}

function reopenAssignmentPayload(assignment) {
  return {
    eventId: assignment.eventId,
    collaboratorId: assignment.collaboratorId,
    role: assignment.role,
    checkIn: assignment.checkIn || null,
    checkOut: assignment.checkOut || null,
    clientCheckIn: assignment.clientCheckIn || null,
    clientCheckOut: assignment.clientCheckOut || null,
    validatedCheckIn: null,
    validatedCheckOut: null,
    validationStatus: 'reopened',
    validationNotes: assignment.validationNotes || null,
    status: assignment.status,
    paymentStatus: assignment.paymentStatus,
    clientSynced: Boolean(assignment.clientSynced),
  };
}

function eventTotals(event, assignments) {
  const requiredRoles = parseRequiredRoles(event.requiredRoles);
  const roleRateMap = new Map(requiredRoles.map((item) => [item.role, decimalValue(item.agreedRate) || 0]));
  let totalRevenue = 0;
  let totalCost = 0;
  for (const assignment of assignments) {
    if (NON_BILLABLE_STATUSES.has(assignmentStatus(assignment.status))) continue;
    const clientHours = clientHoursFor(assignment, event);
    const staffHours = staffHoursFor(assignment, event);
    totalRevenue += clientHours * (roleRateMap.get(assignment.role) || 0);
    totalCost += staffHours * num(assignment.hourlyRate);
  }
  if (event.travelExpenseEnabled) totalRevenue += num(event.travelExpenseAmount);
  return {
    totalRevenue: Number(totalRevenue.toFixed(2)),
    totalCost: Number(totalCost.toFixed(2)),
  };
}

export default function TimeValidation() {
  const { data: services, loading, error, reload } = useApi('/services', []);
  const [scope, setScope] = useState('pending');
  const [viewMode, setViewMode] = useState('event');
  const [selectedClientId, setSelectedClientId] = useState('all');
  const [selectedEventId, setSelectedEventId] = useState('all');
  const [selectedCollaboratorId, setSelectedCollaboratorId] = useState('all');
  const [periodStart, setPeriodStart] = useState(() => currentMonthPeriod().start);
  const [periodEnd, setPeriodEnd] = useState(() => currentMonthPeriod().end);
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [validatingEventId, setValidatingEventId] = useState(null);
  const [bulkValidatingEventId, setBulkValidatingEventId] = useState(null);
  const [drafts, setDrafts] = useState({});

  const allRows = useMemo(
    () => services.flatMap((event) => (event.assignments || [])
      .filter((assignment) => assignment.collaboratorId && assignment.role)
      .map((assignment) => {
        const draft = drafts[assignment.id] || {};
        const merged = { ...assignment, ...draft };
        const assessment = rowAssessment(merged);
        const collaboratorName = merged.collaborator?.shortName || merged.collaborator?.name || '';
        return {
          id: assignment.id,
          event,
          assignment: merged,
          collaboratorName,
          validationState: hoursValidationState(merged),
          tone: assessment.tone,
          toneLabel: assessment.label,
          diffMinutes: assessment.diffMinutes,
          isDifference: assessment.isDifference,
          needsAttention: assessment.needsAttention,
          clientHours: clientHoursFor(merged, event),
          staffHours: staffHoursFor(merged, event),
        };
      })),
    [services, drafts],
  );

  const periodRows = useMemo(
    () => filterRowsByDateRange(allRows, periodStart, periodEnd),
    [allRows, periodStart, periodEnd],
  );

  const clientOptions = useMemo(() => {
    const seen = new Map();
    for (const row of periodRows) {
      const id = String(row.event.clientId || row.event.client?.id || '');
      if (!id || seen.has(id)) continue;
      seen.set(id, {
        id,
        label: row.event.client?.name || '-',
      });
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt'));
  }, [periodRows]);

  const clientRows = useMemo(
    () => periodRows.filter((row) => (
      selectedClientId === 'all'
      || String(row.event.clientId || row.event.client?.id || '') === selectedClientId
    )),
    [periodRows, selectedClientId],
  );

  const eventOptions = useMemo(() => {
    const seen = new Map();
    for (const row of clientRows) {
      const id = String(row.event.id);
      if (!seen.has(id)) {
        seen.set(id, {
          id,
          label: `${row.event.name || '-'} · ${row.event.date ? date.format(new Date(row.event.date)) : '-'}`,
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt'));
  }, [clientRows]);

  const collaboratorOptions = useMemo(() => {
    const seen = new Map();
    for (const row of clientRows) {
      const id = String(row.assignment.collaboratorId);
      if (!seen.has(id)) {
        seen.set(id, {
          id,
          label: `${row.collaboratorName || '-'} · ${row.assignment.collaborator?.nif || '-'}`,
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt'));
  }, [clientRows]);

  const eventProgress = useMemo(() => {
    const map = new Map();
    for (const row of clientRows) {
      const key = String(row.event.id);
      if (!map.has(key)) {
        map.set(key, {
          event: row.event,
          total: 0,
          validated: 0,
          markedValidated: eventIsMarkedValidated(row.event),
          validatedAt: extractValidatedAt(row.event),
        });
      }
      const current = map.get(key);
      if (!NON_BILLABLE_STATUSES.has(assignmentStatus(row.assignment.status))) {
        current.total += 1;
        if (rowIsValidated(row.assignment)) current.validated += 1;
      }
    }
    return [...map.values()]
      .map((item) => ({ ...item, ready: item.total > 0 && item.validated >= item.total }))
      .sort((a, b) => new Date(b.event.date || 0).getTime() - new Date(a.event.date || 0).getTime());
  }, [clientRows]);

  const pendingEvents = useMemo(() => eventProgress.filter((item) => !item.markedValidated), [eventProgress]);
  const validatedEvents = useMemo(() => eventProgress.filter((item) => item.markedValidated), [eventProgress]);

  useEffect(() => {
    if (selectedClientId !== 'all' && !clientOptions.some((item) => item.id === selectedClientId)) {
      setSelectedClientId('all');
    }
  }, [clientOptions, selectedClientId]);

  useEffect(() => {
    if (selectedEventId !== 'all' && !eventOptions.some((item) => item.id === selectedEventId)) {
      setSelectedEventId('all');
    }
  }, [eventOptions, selectedEventId]);

  useEffect(() => {
    if (selectedCollaboratorId !== 'all' && !collaboratorOptions.some((item) => item.id === selectedCollaboratorId)) {
      setSelectedCollaboratorId('all');
    }
  }, [collaboratorOptions, selectedCollaboratorId]);

  const rows = useMemo(
    () => clientRows
      .filter((row) => {
        const marked = eventIsMarkedValidated(row.event);
        if (scope === 'pending' && marked) return false;
        if (scope === 'validated' && !marked) return false;
        if (scope === 'pending' && onlyDifferences && !row.needsAttention) return false;
        if (viewMode === 'event' && selectedEventId !== 'all' && String(row.event.id) !== selectedEventId) return false;
        if (viewMode === 'collaborator' && selectedCollaboratorId !== 'all' && String(row.assignment.collaboratorId) !== selectedCollaboratorId) return false;
        return true;
      })
      .sort((a, b) => {
        if (viewMode === 'collaborator') {
          const byName = String(a.collaboratorName || '').localeCompare(String(b.collaboratorName || ''), 'pt');
          if (byName !== 0) return byName;
          return new Date(b.event.date || 0).getTime() - new Date(a.event.date || 0).getTime();
        }
        const byEventDate = new Date(b.event.date || 0).getTime() - new Date(a.event.date || 0).getTime();
        if (byEventDate !== 0) return byEventDate;
        return String(a.event.name || '').localeCompare(String(b.event.name || ''), 'pt');
      }),
    [clientRows, scope, onlyDifferences, selectedCollaboratorId, selectedEventId, viewMode],
  );

  const staffPdfRows = useMemo(
    () => clientRows
      .filter((row) => {
        const marked = eventIsMarkedValidated(row.event);
        if (scope === 'pending' && marked) return false;
        if (scope === 'validated' && !marked) return false;
        if (viewMode === 'event' && selectedEventId !== 'all' && String(row.event.id) !== selectedEventId) return false;
        if (viewMode === 'collaborator' && selectedCollaboratorId !== 'all' && String(row.assignment.collaboratorId) !== selectedCollaboratorId) return false;
        return true;
      })
      .map((row) => ({ ...row, staffScheduleHours: staffColumnHours(row.assignment) })),
    [clientRows, scope, selectedCollaboratorId, selectedEventId, viewMode],
  );

  const selectedClientLabel = selectedClientId === 'all'
    ? 'Todos os clientes'
    : clientOptions.find((item) => item.id === selectedClientId)?.label || 'Cliente selecionado';

  const stats = useMemo(() => {
    const divergent = clientRows.filter((row) => row.isDifference).length;
    const validated = clientRows.filter((row) => rowIsValidated(row.assignment)).length;
    const clientHours = clientRows.reduce((sum, row) => sum + clientHoursFor(row.assignment, row.event), 0);
    const staffHours = clientRows.reduce((sum, row) => sum + staffHoursFor(row.assignment, row.event), 0);
    return [
      { label: 'Registos', value: String(clientRows.length) },
      { label: 'Divergências', value: String(divergent) },
      { label: 'Validados', value: String(validated) },
      { label: 'Eventos validados', value: String(validatedEvents.length) },
      { label: 'Horas Cliente', value: `${clientHours.toFixed(2)} h` },
      { label: 'Horas Staff', value: `${staffHours.toFixed(2)} h` },
    ];
  }, [clientRows, validatedEvents.length]);

  function updateDraft(row, patch) {
    setDrafts((prev) => {
      const current = { ...row.assignment, ...(prev[row.id] || {}) };
      const next = { ...current, ...patch };
      if (patch.validatedCheckIn !== undefined || patch.validatedCheckOut !== undefined) {
        const rounded = calcRoundedBillableHours(next.validatedCheckIn, next.validatedCheckOut);
        if (rounded > 0) {
          next.clientBillableHours = rounded;
          next.staffPayableHours = rounded;
        }
      }
      return { ...prev, [row.id]: next };
    });
  }

  function resetPeriodToCurrentMonth() {
    const current = currentMonthPeriod();
    setPeriodStart(current.start);
    setPeriodEnd(current.end);
  }

  function generateStaffPdf() {
    if (!staffPdfRows.length) {
      window.alert('Sem horários Staff para gerar PDF com os filtros selecionados.');
      return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      window.alert('Não foi possível abrir a janela de impressão. Verifica se o bloqueador de popups está ativo.');
      return;
    }

    const html = buildStaffSchedulePdfHtml(staffPdfRows, {
      clientLabel: selectedClientLabel,
      monthLabel: periodLabel(periodStart, periodEnd),
    });

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => {
      printWindow.print();
    }, 250);
  }

  function downloadStaffExcel() {
    if (!staffPdfRows.length) {
      window.alert('Sem horários Staff para gerar Excel com os filtros selecionados.');
      return;
    }

    const excelHtml = buildStaffScheduleExcelHtml(staffPdfRows, {
      clientLabel: selectedClientLabel,
      periodLabel: periodLabel(periodStart, periodEnd),
    });
    const blob = new window.Blob([`\uFEFF${excelHtml}`], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    const filename = `horarios-staff-${fileSafeName(selectedClientLabel)}-${fileSafeName(periodLabel(periodStart, periodEnd))}.xls`;
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => window.URL.revokeObjectURL(url), 500);
  }

  function validationBodyFor(row, merged, mode = 'auto') {
    const clientHours = clientHoursFor(merged, row.event);
    const staffHours = num(merged.staffPayableHours) || staffHoursFor(merged, row.event);
    const normalizedValidatedCheckIn = mode === 'pending' ? null : (merged.validatedCheckIn || null);
    const normalizedValidatedCheckOut = mode === 'pending' ? null : (merged.validatedCheckOut || null);
    const validationStatus = mode === 'validated'
      ? 'validated'
      : mode === 'pending'
        ? 'pending'
        : validationStatusFor(row.event, merged);

    return {
      eventId: merged.eventId,
      collaboratorId: merged.collaboratorId,
      role: merged.role,
      checkIn: merged.checkIn || null,
      checkOut: merged.checkOut || null,
      clientCheckIn: merged.clientCheckIn || null,
      clientCheckOut: merged.clientCheckOut || null,
      validatedCheckIn: normalizedValidatedCheckIn,
      validatedCheckOut: normalizedValidatedCheckOut,
      hoursWorked: staffHours,
      clientBillableHours: clientHours,
      staffPayableHours: staffHours,
      hourlyRate: num(merged.hourlyRate),
      totalPay: Number((staffHours * num(merged.hourlyRate)).toFixed(2)),
      validationStatus,
      validationNotes: merged.validationNotes || null,
      clientSynced: Boolean(merged.clientSynced),
      status: merged.status,
      paymentStatus: merged.paymentStatus,
    };
  }

  async function persistRow(row, merged, mode = 'auto') {
    setSavingId(row.id);
    try {
      const body = validationBodyFor(row, merged, mode);
      await api(`/assignments/${row.id}`, { method: 'PUT', body: JSON.stringify(body) });

      const nextAssignments = (row.event.assignments || []).map((assignment) => (
        assignment.id === row.id ? { ...assignment, ...body } : assignment
      ));
      const totals = eventTotals(row.event, nextAssignments);
      try {
        await api(`/services/${row.event.id}`, {
          method: 'PUT',
          body: JSON.stringify(totals),
        });
      } catch (error) {
        console.warn('Falha a atualizar totais do evento apos validar horas:', error);
      }

      setDrafts((prev) => ({ ...prev, [row.id]: { ...merged, ...body } }));
      reload();
    } catch (error) {
      window.alert(error?.message || 'Não foi possível guardar esta validação.');
    } finally {
      setSavingId(null);
    }
  }

  async function saveRow(row) {
    const merged = { ...row.assignment, ...(drafts[row.id] || {}) };
    await persistRow(row, merged, 'auto');
  }

  async function acceptRow(row) {
    const merged = { ...row.assignment, ...(drafts[row.id] || {}) };
    const validatedCheckIn = merged.validatedCheckIn || merged.clientCheckIn || merged.checkIn || row.event.startTime || '';
    const validatedCheckOut = merged.validatedCheckOut || merged.clientCheckOut || merged.checkOut || row.event.endTime || '';
    if (!validatedCheckIn || !validatedCheckOut) {
      window.alert('Sem horas suficientes para aceitar esta validação.');
      return;
    }
    await persistRow(row, { ...merged, validatedCheckIn, validatedCheckOut }, 'validated');
  }

  async function validateAllRowsForEvent(item) {
    const eventRows = clientRows.filter((row) => (
      String(row.event.id) === String(item.event.id)
      && !NON_BILLABLE_STATUSES.has(assignmentStatus(row.assignment.status))
    ));
    const candidates = buildBulkValidationCandidates(eventRows, drafts);

    if (!candidates.ready.length) {
      window.alert('Não existem colaboradores por validar com horas suficientes neste evento.');
      return;
    }
    if (candidates.missing.length) {
      window.alert(`Não foi possível validar tudo. Existem ${candidates.missing.length} colaborador(es) sem horas suficientes.`);
      return;
    }

    setBulkValidatingEventId(item.event.id);
    try {
      const updates = new Map();
      await Promise.all(candidates.ready.map(({ row, merged }) => {
        const body = validationBodyFor(row, merged, 'validated');
        updates.set(row.id, body);
        return api(`/assignments/${row.id}`, { method: 'PUT', body: JSON.stringify(body) });
      }));

      const nextAssignments = (item.event.assignments || []).map((assignment) => (
        updates.has(assignment.id) ? { ...assignment, ...updates.get(assignment.id) } : assignment
      ));
      const totals = eventTotals(item.event, nextAssignments);
      await api(`/services/${item.event.id}`, {
        method: 'PUT',
        body: JSON.stringify(totals),
      });

      setDrafts((prev) => {
        const next = { ...prev };
        for (const { row, merged } of candidates.ready) {
          next[row.id] = { ...merged, ...updates.get(row.id) };
        }
        return next;
      });
      reload();
    } catch (error) {
      window.alert(error?.message || 'Não foi possível validar todos os colaboradores deste evento.');
    } finally {
      setBulkValidatingEventId(null);
    }
  }

  async function reopenRowValidation(row) {
    const merged = { ...row.assignment, ...(drafts[row.id] || {}) };
    setSavingId(row.id);
    try {
      await api(`/assignments/${row.id}`, {
        method: 'PUT',
        body: JSON.stringify(reopenAssignmentPayload(merged)),
      });
      setDrafts((prev) => ({ ...prev, [row.id]: { ...merged, ...reopenAssignmentPayload(merged) } }));
      reload();
    } catch (error) {
      window.alert(error?.message || 'Não foi possível reabrir esta validação.');
    } finally {
      setSavingId(null);
    }
  }

  async function markEventValidated(item) {
    if (!item?.event?.id || item.markedValidated || !item.ready) return;
    setValidatingEventId(item.event.id);
    try {
      const currentNotes = String(item.event.notes || '').trim();
      const nextNotes = currentNotes.includes(VALIDATED_EVENT_MARKER)
        ? currentNotes
        : [currentNotes, `${VALIDATED_EVENT_MARKER} ${new Date().toISOString()}`].filter(Boolean).join('\n');
      await api(`/services/${item.event.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          notes: nextNotes,
          status: 'to_validate_client',
        }),
      });
      reload();
    } finally {
      setValidatingEventId(null);
    }
  }

  async function reopenValidatedEvent(item) {
    if (!item?.event?.id || !item.markedValidated) return;
    setValidatingEventId(item.event.id);
    try {
      const assignmentsToReopen = (item.event.assignments || [])
        .filter((assignment) => assignment.collaboratorId && assignment.role);

      await Promise.all(assignmentsToReopen.map((assignment) => api(`/assignments/${assignment.id}`, {
        method: 'PUT',
        body: JSON.stringify(reopenAssignmentPayload(assignment)),
      })));

      const nextNotes = removeValidatedMarker(item.event.notes);
      await api(`/services/${item.event.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          notes: nextNotes || null,
          status: 'pending',
        }),
      });
      setDrafts((prev) => {
        const next = { ...prev };
        for (const assignment of assignmentsToReopen) {
          delete next[assignment.id];
        }
        return next;
      });
      reload();
    } catch (error) {
      window.alert(error?.message || 'Não foi possível voltar a colocar este evento em validação.');
    } finally {
      setValidatingEventId(null);
    }
  }

  return (
    <div className="page validation-page">
      <div className="page-title-row">
        <div>
          <h1>Validação de Horas</h1>
          <p>Conferência entre previsto, staff e cliente antes da faturação e pagamento.</p>
        </div>
      </div>

      <Stats items={stats} />

      <Card title="Conferência Operacional">
        <div className="service-tabs budget-tabs">
          <button type="button" className={`service-tab ${scope === 'pending' ? 'service-tab--active' : ''}`} onClick={() => setScope('pending')}>
            Pendentes
          </button>
          <button type="button" className={`service-tab ${scope === 'validated' ? 'service-tab--active' : ''}`} onClick={() => setScope('validated')}>
            Eventos/Serviços Validados
          </button>
        </div>

        <div className="service-tabs budget-tabs">
          <button
            type="button"
            className={`service-tab ${viewMode === 'event' ? 'service-tab--active' : ''}`}
            onClick={() => setViewMode('event')}
          >
            Evento/Serviço
          </button>
          <button
            type="button"
            className={`service-tab ${viewMode === 'collaborator' ? 'service-tab--active' : ''}`}
            onClick={() => setViewMode('collaborator')}
          >
            Colaboradores
          </button>
        </div>

        <div className="validation-filters">
          <select className="form-control" value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value)}>
            <option value="all">Todos os clientes</option>
            {clientOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          {viewMode === 'event' ? (
            <select className="form-control" value={selectedEventId} onChange={(event) => setSelectedEventId(event.target.value)}>
              <option value="all">Todos os eventos/serviços</option>
              {eventOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          ) : (
            <select className="form-control" value={selectedCollaboratorId} onChange={(event) => setSelectedCollaboratorId(event.target.value)}>
              <option value="all">Todos os colaboradores</option>
              {collaboratorOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          )}
          <div className="validation-period-control" aria-label="Período">
            <input
              className="form-control"
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
              aria-label="Data inicial"
            />
            <span>até</span>
            <input
              className="form-control"
              type="date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
              aria-label="Data final"
            />
            <button className="secondary-button" type="button" onClick={resetPeriodToCurrentMonth}>Atual</button>
          </div>
          <label className="check-inline service-check">
            <input type="checkbox" checked={onlyDifferences} onChange={(event) => setOnlyDifferences(event.target.checked)} disabled={scope === 'validated'} />
            <span>Mostrar apenas divergências</span>
          </label>
          <button className="secondary-button validation-pdf-button" type="button" onClick={generateStaffPdf} disabled={!staffPdfRows.length}>
            <FileDown size={16} />
            <span>PDF Staff</span>
          </button>
          <button className="secondary-button validation-pdf-button" type="button" onClick={downloadStaffExcel} disabled={!staffPdfRows.length}>
            <FileSpreadsheet size={16} />
            <span>Excel Staff</span>
          </button>
        </div>
        {error ? <p className="notice">{error}</p> : null}
        {loading ? <p className="muted">A carregar...</p> : null}

        {scope === 'pending' ? (
          <>
            <div className="validation-event-list">
              {pendingEvents.map((item) => (
                <article key={item.event.id} className="validation-event-item">
                  <div>
                    <strong>{item.event.name || '-'}</strong>
                    <small>{item.event.client?.name || '-'} · {item.event.date ? date.format(new Date(item.event.date)) : '-'}</small>
                  </div>
                  <div className="validation-event-metrics">
                    <span>{item.validated}/{item.total} validados</span>
                    <Badge tone={item.ready ? 'success' : 'warning'}>{item.ready ? 'Pronto para fechar' : 'Em validação'}</Badge>
                  </div>
                  <div className="validation-event-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={!item.total || item.validated >= item.total || bulkValidatingEventId === item.event.id}
                      onClick={() => validateAllRowsForEvent(item)}
                    >
                      {bulkValidatingEventId === item.event.id ? 'A validar...' : 'Validar tudo'}
                    </button>
                    <button className="secondary-button" type="button" disabled={!item.ready || validatingEventId === item.event.id || bulkValidatingEventId === item.event.id} onClick={() => markEventValidated(item)}>
                      {validatingEventId === item.event.id ? 'A validar...' : 'Marcar evento validado'}
                    </button>
                  </div>
                </article>
              ))}
              {!loading && !pendingEvents.length ? <p className="muted">Sem eventos pendentes neste mês.</p> : null}
            </div>

            {!loading && !rows.length ? <p className="muted">Sem registos para validar.</p> : null}

            <div className="table-wrap">
              <table className="validation-table">
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>Evento</th>
                    <th>Previsto</th>
                    <th>Staff</th>
                    <th>Cliente</th>
                    <th>Diferença</th>
                    <th>Notas</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className={`validation-row validation-row--${row.tone}`}>
                      <td>
                        <div className="validation-collaborator-heading">
                          <strong>{row.assignment.collaborator?.shortName || row.assignment.collaborator?.name || '-'}</strong>
                          <Badge tone={row.validationState.tone}>
                            {row.validationState.isValidated ? <CheckCircle2 size={13} /> : <Hourglass size={13} />}
                            <span>{row.validationState.label}</span>
                          </Badge>
                        </div>
                        <small>{row.assignment.role || '-'}</small>
                      </td>
                      <td>
                        <strong>{row.event.name}</strong>
                        <small>{row.event.client?.name || '-'} · {row.event.date ? date.format(new Date(row.event.date)) : '-'}</small>
                      </td>
                      <td>
                        <div className="validation-time-stack">
                          <div className="validation-time-plain-field">
                            <em>{row.event.startTime || '--:--'}</em>
                            <ArrowRight size={14} aria-hidden="true" />
                          </div>
                          <span className="validation-time-spacer" aria-hidden="true" />
                          <div className="validation-time-plain-field">
                            <em>{row.event.endTime || '--:--'}</em>
                            <ArrowRight size={14} aria-hidden="true" />
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="validation-time-stack">
                          <input type="time" value={row.assignment.checkIn || ''} onChange={(event) => updateDraft(row, { checkIn: event.target.value })} />
                          <ArrowDown size={14} className="validation-time-arrow" aria-hidden="true" />
                          <input type="time" value={row.assignment.checkOut || ''} onChange={(event) => updateDraft(row, { checkOut: event.target.value })} />
                          <small>Total: {staffColumnHours(row.assignment).toFixed(2)} h</small>
                        </div>
                      </td>
                      <td>
                        <div className="validation-time-stack">
                          <input type="time" value={row.assignment.clientCheckIn || ''} onChange={(event) => updateDraft(row, { clientCheckIn: event.target.value })} />
                          <ArrowDown size={14} className="validation-time-arrow" aria-hidden="true" />
                          <input type="time" value={row.assignment.clientCheckOut || ''} onChange={(event) => updateDraft(row, { clientCheckOut: event.target.value })} />
                          <small>Total: {clientColumnHours(row.assignment).toFixed(2)} h</small>
                        </div>
                      </td>
                      <td>
                        <Badge tone={row.tone}>
                          <DifferenceIcon tone={row.tone} />
                          <span>{row.toneLabel}{row.diffMinutes === null ? '' : ` (${row.diffMinutes} min)`}</span>
                        </Badge>
                      </td>
                      <td>
                        <input
                          className="validation-note-input"
                          value={row.assignment.validationNotes || ''}
                          onChange={(event) => updateDraft(row, { validationNotes: event.target.value })}
                        />
                      </td>
                      <td>
                        <div className="validation-row-actions">
                          {row.validationState.isValidated ? (
                            <button className="icon-button" type="button" title="Reabrir validação" aria-label="Reabrir validação" onClick={() => reopenRowValidation(row)} disabled={savingId === row.id || bulkValidatingEventId !== null}>
                              <RotateCcw size={16} />
                            </button>
                          ) : (
                            <button className="icon-button" type="button" title="Aceitar validação" aria-label="Aceitar validação" onClick={() => acceptRow(row)} disabled={savingId === row.id || bulkValidatingEventId !== null}>
                              <CheckCircle2 size={16} />
                            </button>
                          )}
                          <button className="icon-button" type="button" title="Guardar validação" onClick={() => saveRow(row)} disabled={savingId === row.id || bulkValidatingEventId !== null}>
                            <Save size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {scope === 'validated' ? (
          <div className="validation-history-list">
            {validatedEvents.map((item) => (
              <article key={item.event.id} className="validation-history-item">
                <div>
                  <strong>{item.event.name || '-'}</strong>
                  <small>{item.event.client?.name || '-'} · {item.event.date ? date.format(new Date(item.event.date)) : '-'}</small>
                </div>
                <div>
                  <span>Validado</span>
                  <strong>{item.validatedAt || '-'}</strong>
                </div>
                <div>
                  <span>Registos</span>
                  <strong>{item.validated}/{item.total}</strong>
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={validatingEventId === item.event.id}
                  onClick={() => reopenValidatedEvent(item)}
                >
                  {validatingEventId === item.event.id ? 'A reabrir...' : 'Voltar a validar'}
                </button>
              </article>
            ))}
            {!loading && !validatedEvents.length ? <p className="muted">Sem eventos/serviços validados neste mês.</p> : null}
          </div>
        ) : null}
      </Card>

    </div>
  );
}
