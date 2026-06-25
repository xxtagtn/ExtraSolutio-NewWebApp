import { AlertTriangle, ArrowDown, ArrowRight, CheckCircle2, Copy, FileDown, FileSpreadsheet, Hourglass, OctagonAlert, RotateCcw, Save, Siren } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Badge from '../components/UI/Badge.jsx';
import Card from '../components/UI/Card.jsx';
import TimeInput from '../components/UI/TimeInput.jsx';
import Stats from '../components/UI/Stats.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../utils/api.js';
import { date } from '../utils/formatters.js';
import { buildBulkValidationCandidates } from '../utils/hourValidationBulk.js';
import { hoursValidationState, validationPersistenceFields } from '../utils/hourValidationStatus.js';
import { clientChargeHours, clientRealHours, decimalValue } from '../utils/serviceFinance.js';
import { nextAutomaticServiceStatus, nextTimeValidationServiceStatus, SERVICE_STATUS } from '../utils/serviceStatus.js';
import { buildStaffScheduleExcelHtml, buildStaffSchedulePdfHtml } from '../utils/staffSchedulePdf.js';
import { assessTimeTolerance, resolvePlannedTimes } from '../utils/timeTolerance.js';
import {
  dateKeysFrom,
  effectiveRowDateKey,
  filterRowsByDateRange,
  normalizeTimeInput,
} from '../utils/timeValidationFilters.js';
import {
  compareTimeValidationRowsNewest,
  clientTimeCorrection,
  persistedWorkflowAssignment,
  preserveStageAfterManualRowSave,
  prunePersistedDrafts,
  recentOperationalPeriod,
  TIME_VALIDATION_STAGE,
  validationStageCounts,
  validationWorkflowStage,
} from '../utils/timeValidationWorkflow.js';

const NON_BILLABLE_STATUSES = new Set(['missed_justified', 'missed_unjustified', 'cancelled']);
const VALIDATED_EVENT_MARKER = '[EVENT_VALIDATED_HOURS]';
const VALIDATION_STAGE_TABS = [
  { value: TIME_VALIDATION_STAGE.staffPending, label: 'Por preencher Staff' },
  { value: TIME_VALIDATION_STAGE.clientPending, label: 'Aguardar Cliente' },
  { value: TIME_VALIDATION_STAGE.differences, label: 'Divergências' },
  { value: TIME_VALIDATION_STAGE.ready, label: 'Prontos a finalizar' },
  { value: TIME_VALIDATION_STAGE.finalized, label: 'Finalizados' },
];

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
  return event?.status === SERVICE_STATUS.finalized || String(event?.notes || '').includes(VALIDATED_EVENT_MARKER);
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

function dateRangeLabelFromKeys(keys) {
  const dates = [...new Set(dateKeysFrom(keys))].sort();
  if (!dates.length) return '-';
  if (dates.length === 1) return date.format(new Date(dates[0]));
  return `${date.format(new Date(dates[0]))} a ${date.format(new Date(dates[dates.length - 1]))}`;
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
  return clientChargeHours(
    assignment,
    event.startTime,
    event.endTime,
    event.minimumHoursSnapshot,
  );
}

function clientRealHoursFor(assignment) {
  return clientRealHours(assignment);
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

function rowAssessment(assignment) {
  return assessTimeTolerance({
    checkIn: assignment.checkIn,
    checkOut: assignment.checkOut,
    clientCheckIn: assignment.clientCheckIn,
    clientCheckOut: assignment.clientCheckOut,
  });
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
  let realHours = 0;
  let billableHours = 0;
  for (const assignment of assignments) {
    if (NON_BILLABLE_STATUSES.has(assignmentStatus(assignment.status))) continue;
    const realClientHours = clientRealHoursFor(assignment);
    const clientHours = clientHoursFor(assignment, event);
    const staffHours = staffHoursFor(assignment, event);
    totalRevenue += clientHours * (roleRateMap.get(assignment.role) || 0);
    totalCost += staffHours * num(assignment.hourlyRate);
    realHours += realClientHours;
    billableHours += clientHours;
  }
  if (event.travelExpenseEnabled) totalRevenue += num(event.travelExpenseAmount);
  return {
    totalRevenue: Number(totalRevenue.toFixed(2)),
    totalCost: Number(totalCost.toFixed(2)),
    realHours: Number(realHours.toFixed(2)),
    billableHours: Number(billableHours.toFixed(2)),
  };
}

export default function TimeValidation() {
  const { data: services, loading, error, reload } = useApi('/services', []);
  const [stage, setStage] = useState(TIME_VALIDATION_STAGE.staffPending);
  const [viewMode, setViewMode] = useState('event');
  const [selectedClientId, setSelectedClientId] = useState('all');
  const [selectedEventId, setSelectedEventId] = useState('all');
  const [selectedCollaboratorId, setSelectedCollaboratorId] = useState('all');
  const [periodStart, setPeriodStart] = useState(() => recentOperationalPeriod().start);
  const [periodEnd, setPeriodEnd] = useState(() => recentOperationalPeriod().end);
  const [savingId, setSavingId] = useState(null);
  const [validatingEventId, setValidatingEventId] = useState(null);
  const [bulkValidatingEventId, setBulkValidatingEventId] = useState(null);
  const [statusSyncing, setStatusSyncing] = useState(false);
  const [drafts, setDrafts] = useState({});
  const validationTableRef = useRef(null);

  useEffect(() => {
    if (loading || statusSyncing || !services.length) return;
    const updates = services
      .map((event) => ({ event, nextStatus: nextAutomaticServiceStatus(event) }))
      .filter(({ event, nextStatus }) => nextStatus && nextStatus !== event.status);
    if (!updates.length) return;

    let cancelled = false;
    setStatusSyncing(true);
    Promise.all(updates.map(({ event, nextStatus }) => api(`/services/${event.id}`, {
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
  }, [loading, reload, services, statusSyncing]);

  useEffect(() => {
    setDrafts((current) => {
      const next = prunePersistedDrafts(current);
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [services]);

  const allRows = useMemo(
    () => services.flatMap((event) => (event.assignments || [])
      .filter((assignment) => assignment.collaboratorId && assignment.role)
      .map((assignment) => {
        const draft = drafts[assignment.id] || {};
        const merged = { ...assignment, ...draft };
        const assessment = rowAssessment(merged);
        const persistedAssignment = persistedWorkflowAssignment(assignment, draft);
        const persistedAssessment = rowAssessment(persistedAssignment);
        const planned = resolvePlannedTimes(merged, event);
        const collaboratorName = merged.collaborator?.shortName || merged.collaborator?.name || '';
        const workDateKey = effectiveRowDateKey({ event, assignment: merged });
        const row = {
          id: assignment.id,
          event,
          assignment: merged,
          eventValidated: eventIsMarkedValidated(event),
          workDateKey,
          workDateLabel: workDateKey ? date.format(new Date(workDateKey)) : '-',
          collaboratorName,
          validationState: hoursValidationState(persistedAssignment),
          persistedAssignment,
          tone: assessment.tone,
          toneLabel: assessment.label,
          diffMinutes: assessment.diffMinutes,
          differenceDetail: assessment.detail,
          plannedCheckIn: planned.plannedCheckIn,
          plannedCheckOut: planned.plannedCheckOut,
          isDifference: assessment.isDifference,
          needsAttention: assessment.needsAttention,
          clientHours: clientHoursFor(merged, event),
          staffHours: staffHoursFor(merged, event),
        };
        return {
          ...row,
          workflowStage: validationWorkflowStage({
            ...row,
            assignment: persistedAssignment,
            isDifference: persistedAssessment.isDifference,
          }),
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
          name: row.event.name || '-',
          dates: new Set(),
        });
      }
      seen.get(id).dates.add(row.workDateKey);
    }
    return [...seen.values()]
      .map((item) => ({ id: item.id, label: `${item.name} · ${dateRangeLabelFromKeys(item.dates)}` }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt'));
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
          staffComplete: 0,
          clientComplete: 0,
          differences: 0,
          markedValidated: eventIsMarkedValidated(row.event),
          validatedAt: extractValidatedAt(row.event),
          workDateKeys: new Set(),
        });
      }
      const current = map.get(key);
      current.workDateKeys.add(row.workDateKey);
      if (!NON_BILLABLE_STATUSES.has(assignmentStatus(row.assignment.status))) {
        const persistedAssignment = row.persistedAssignment || row.assignment;
        current.total += 1;
        if (rowIsValidated(persistedAssignment)) current.validated += 1;
        if (persistedAssignment.checkIn && persistedAssignment.checkOut) current.staffComplete += 1;
        if (persistedAssignment.clientCheckIn && persistedAssignment.clientCheckOut) current.clientComplete += 1;
        if (row.workflowStage === TIME_VALIDATION_STAGE.differences) current.differences += 1;
      }
    }
    return [...map.values()]
      .map((item) => {
        const workDateKeys = [...item.workDateKeys].filter(Boolean).sort();
        const latestWorkDateKey = workDateKeys[workDateKeys.length - 1] || item.event.date || '';
        return {
          ...item,
          dateLabel: dateRangeLabelFromKeys(workDateKeys),
          latestWorkDateKey,
          ready: item.total > 0 && item.validated >= item.total,
        };
      })
      .sort((a, b) => new Date(b.latestWorkDateKey || 0).getTime() - new Date(a.latestWorkDateKey || 0).getTime());
  }, [clientRows]);

  const pendingEvents = useMemo(() => eventProgress.filter((item) => !item.markedValidated), [eventProgress]);
  const validatedEvents = useMemo(() => eventProgress.filter((item) => item.markedValidated), [eventProgress]);
  const stageCounts = useMemo(() => validationStageCounts(clientRows), [clientRows]);

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
        if (row.workflowStage !== stage) return false;
        if (viewMode === 'event' && selectedEventId !== 'all' && String(row.event.id) !== selectedEventId) return false;
        if (viewMode === 'collaborator' && selectedCollaboratorId !== 'all' && String(row.assignment.collaboratorId) !== selectedCollaboratorId) return false;
        return true;
      })
      .sort((a, b) => {
        if (viewMode === 'collaborator') {
          const byName = String(a.collaboratorName || '').localeCompare(String(b.collaboratorName || ''), 'pt');
          if (byName !== 0) return byName;
          return compareTimeValidationRowsNewest(a, b);
        }
        return compareTimeValidationRowsNewest(a, b);
      }),
    [clientRows, stage, selectedCollaboratorId, selectedEventId, viewMode],
  );

  const staffPdfRows = useMemo(
    () => clientRows
      .filter((row) => {
        if (row.workflowStage !== stage) return false;
        if (viewMode === 'event' && selectedEventId !== 'all' && String(row.event.id) !== selectedEventId) return false;
        if (viewMode === 'collaborator' && selectedCollaboratorId !== 'all' && String(row.assignment.collaboratorId) !== selectedCollaboratorId) return false;
        return true;
      })
      .map((row) => ({ ...row, staffScheduleHours: staffColumnHours(row.assignment) })),
    [clientRows, stage, selectedCollaboratorId, selectedEventId, viewMode],
  );

  const rowGroups = useMemo(() => {
    const groups = [];
    for (const row of rows) {
      const last = groups[groups.length - 1];
      if (!last || last.key !== row.workDateKey) {
        groups.push({
          key: row.workDateKey,
          label: row.workDateLabel,
          rows: [row],
        });
      } else {
        last.rows.push(row);
      }
    }
    return groups;
  }, [rows]);

  const visibleEventIds = useMemo(() => new Set(rows.map((row) => String(row.event.id))), [rows]);
  const visiblePendingEvents = useMemo(
    () => pendingEvents.filter((item) => visibleEventIds.has(String(item.event.id))),
    [pendingEvents, visibleEventIds],
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
      { label: 'Horas Faturáveis', value: `${clientHours.toFixed(2)} h` },
      { label: 'Horas Staff', value: `${staffHours.toFixed(2)} h` },
    ];
  }, [clientRows, validatedEvents.length]);

  function updateDraft(row, patch) {
    setDrafts((prev) => {
      const current = { ...row.assignment, ...(prev[row.id] || {}) };
      const next = { ...current, ...patch, _persisted: false };
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

  function setPeriod(start, end) {
    setPeriodStart(start);
    setPeriodEnd(end);
  }

  function resetPeriodToRecentDays() {
    const recent = recentOperationalPeriod();
    setPeriod(recent.start, recent.end);
  }

  function resetPeriodToToday() {
    const today = dateKey(new Date());
    setPeriod(today, today);
  }

  function resetPeriodToYesterday() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const key = dateKey(yesterday);
    setPeriod(key, key);
  }

  function resetPeriodToCurrentMonth() {
    const current = currentMonthPeriod();
    setPeriod(current.start, current.end);
  }

  function copyPlannedToStaff(row) {
    updateDraft(row, {
      checkIn: row.plannedCheckIn || '',
      checkOut: row.plannedCheckOut || '',
    });
  }

  function copyStaffToClient(row) {
    const merged = { ...row.assignment, ...(drafts[row.id] || {}) };
    updateDraft(row, {
      clientCheckIn: merged.checkIn || '',
      clientCheckOut: merged.checkOut || '',
    });
  }

  function handleClientTimeBlur(row, field, rawValue, relatedTarget) {
    const normalizedValue = normalizeTimeInput(rawValue);
    const draft = drafts[row.id] || {};
    const correction = clientTimeCorrection(
      { ...row.assignment, ...draft },
      { [field]: normalizedValue },
      relatedTarget?.dataset?.validationClientRow === String(row.id),
    );
    updateDraft(row, { [field]: normalizedValue });
    if (correction.shouldPersist) {
      persistRow(row, correction.merged, 'auto');
    }
  }

  function showEventRows(eventId) {
    setViewMode('event');
    setSelectedEventId(String(eventId));
    window.requestAnimationFrame(() => {
      validationTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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
    const realClientHours = clientRealHoursFor(merged);
    const clientHours = clientHoursFor(merged, row.event);
    const staffHours = num(merged.staffPayableHours) || staffHoursFor(merged, row.event);
    const persistence = validationPersistenceFields(
      merged,
      mode,
      validationStatusFor(row.event, merged),
    );

    return {
      eventId: merged.eventId,
      collaboratorId: merged.collaboratorId,
      role: merged.role,
      checkIn: merged.checkIn || null,
      checkOut: merged.checkOut || null,
      clientCheckIn: merged.clientCheckIn || null,
      clientCheckOut: merged.clientCheckOut || null,
      validatedCheckIn: persistence.validatedCheckIn,
      validatedCheckOut: persistence.validatedCheckOut,
      hoursWorked: staffHours,
      clientRealHours: realClientHours,
      clientBillableHours: clientHours,
      staffPayableHours: staffHours,
      hourlyRate: num(merged.hourlyRate),
      totalPay: Number((staffHours * num(merged.hourlyRate)).toFixed(2)),
      validationStatus: persistence.validationStatus,
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
      const nextStatus = nextTimeValidationServiceStatus({ ...row.event, assignments: nextAssignments });
      try {
        await api(`/services/${row.event.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            ...totals,
            status: nextStatus,
          }),
        });
      } catch (error) {
        console.warn('Falha a atualizar totais do evento apos validar horas:', error);
      }

      const persistedDraft = { ...merged, ...body, _persisted: true };
      setDrafts((prev) => ({ ...prev, [row.id]: persistedDraft }));
      const nextAssessment = rowAssessment(persistedDraft);
      setStage((currentStage) => preserveStageAfterManualRowSave(currentStage, {
        assignment: persistedDraft,
        eventValidated: eventIsMarkedValidated(row.event),
        isDifference: nextAssessment.isDifference,
      }));
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
    if (!merged.checkIn || !merged.checkOut || !merged.clientCheckIn || !merged.clientCheckOut) {
      window.alert('Preenche os horários Staff e Cliente antes de aceitar a validação.');
      return;
    }
    const validatedCheckIn = merged.clientCheckIn;
    const validatedCheckOut = merged.clientCheckOut;
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
      const nextStatus = nextTimeValidationServiceStatus({ ...item.event, assignments: nextAssignments });
      await api(`/services/${item.event.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...totals,
          status: nextStatus,
        }),
      });

      setDrafts((prev) => {
        const next = { ...prev };
        for (const { row, merged } of candidates.ready) {
          next[row.id] = { ...merged, ...updates.get(row.id), _persisted: true };
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
      await api(`/services/${row.event.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          notes: removeValidatedMarker(row.event.notes) || null,
          status: SERVICE_STATUS.toValidateStaff,
        }),
      });
      setDrafts((prev) => ({
        ...prev,
        [row.id]: { ...merged, ...reopenAssignmentPayload(merged), _persisted: true },
      }));
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
          status: SERVICE_STATUS.finalized,
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
          status: SERVICE_STATUS.toValidateStaff,
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

  const isFinalizedStage = stage === TIME_VALIDATION_STAGE.finalized;
  const showPlannedColumn = stage === TIME_VALIDATION_STAGE.staffPending
    || stage === TIME_VALIDATION_STAGE.differences
    || stage === TIME_VALIDATION_STAGE.ready;
  const showClientColumn = stage !== TIME_VALIDATION_STAGE.staffPending;
  const showDifferenceColumn = stage === TIME_VALIDATION_STAGE.differences
    || stage === TIME_VALIDATION_STAGE.ready;
  const tableColumnCount = 5
    + Number(showPlannedColumn)
    + Number(showClientColumn)
    + Number(showDifferenceColumn);

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
        <div className="validation-stage-tabs" role="tablist" aria-label="Estado da validação">
          {VALIDATION_STAGE_TABS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={stage === item.value}
              className={`validation-stage-tab ${stage === item.value ? 'is-active' : ''}`}
              onClick={() => {
                setStage(item.value);
                setSelectedEventId('all');
                setSelectedCollaboratorId('all');
              }}
            >
              <span>{item.label}</span>
              <strong>{stageCounts[item.value] || 0}</strong>
            </button>
          ))}
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
          </div>
          <div className="validation-period-presets" aria-label="Atalhos de período">
            <button type="button" onClick={resetPeriodToToday}>Hoje</button>
            <button type="button" onClick={resetPeriodToYesterday}>Ontem</button>
            <button type="button" onClick={resetPeriodToRecentDays}>7 dias</button>
            <button type="button" onClick={resetPeriodToCurrentMonth}>Este mês</button>
          </div>
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

        {!isFinalizedStage ? (
          <>
            <div className="validation-event-list">
              {visiblePendingEvents.map((item) => (
                <article key={item.event.id} className="validation-event-item">
                  <div>
                    <strong>{item.event.name || '-'}</strong>
                    <small>{item.event.client?.name || '-'} · {item.dateLabel}</small>
                  </div>
                  <div className="validation-event-metrics">
                    <span>Staff {item.staffComplete}/{item.total} · Cliente {item.clientComplete}/{item.total}</span>
                    <span>{item.differences} divergência(s) · {item.validated}/{item.total} aceites</span>
                    <Badge tone={item.ready ? 'success' : 'warning'}>{item.ready ? 'Pronto para fechar' : 'Em validação'}</Badge>
                  </div>
                  <div className="validation-event-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => showEventRows(item.event.id)}
                    >
                      Ver linhas
                    </button>
                    {[TIME_VALIDATION_STAGE.differences, TIME_VALIDATION_STAGE.ready].includes(stage) ? (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={!item.total || item.validated >= item.total || bulkValidatingEventId === item.event.id}
                        onClick={() => validateAllRowsForEvent(item)}
                      >
                        {bulkValidatingEventId === item.event.id ? 'A validar...' : 'Validar tudo'}
                      </button>
                    ) : null}
                    {stage === TIME_VALIDATION_STAGE.ready ? (
                      <button className="secondary-button" type="button" disabled={!item.ready || validatingEventId === item.event.id || bulkValidatingEventId === item.event.id} onClick={() => markEventValidated(item)}>
                        {validatingEventId === item.event.id ? 'A validar...' : 'Marcar evento validado'}
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
              {!loading && !visiblePendingEvents.length ? <p className="muted">Sem eventos nesta fase e período.</p> : null}
            </div>

            {!loading && !rows.length ? <p className="muted">Sem registos para validar.</p> : null}

            <div className="table-wrap" ref={validationTableRef}>
              <table className="validation-table">
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>Evento</th>
                    {showPlannedColumn ? <th>Previsto</th> : null}
                    <th>Staff</th>
                    {showClientColumn ? <th>Cliente</th> : null}
                    {showDifferenceColumn ? <th>Diferença</th> : null}
                    <th>Notas</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rowGroups.map((group) => (
                    <Fragment key={group.key}>
                      <tr className="validation-date-group">
                        <th colSpan={tableColumnCount}>
                          <span>{group.label}</span>
                          <small>{group.rows.length} registo(s)</small>
                        </th>
                      </tr>
                      {group.rows.map((row) => {
                        const completeForAcceptance = Boolean(
                          row.assignment.checkIn
                          && row.assignment.checkOut
                          && row.assignment.clientCheckIn
                          && row.assignment.clientCheckOut,
                        );
                        return (
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
                              <small>{row.event.client?.name || '-'} · {row.workDateLabel}</small>
                            </td>
                            {showPlannedColumn ? (
                              <td>
                                <div className="validation-time-stack">
                                  <div className="validation-time-plain-field">
                                    <em>{row.plannedCheckIn || '--:--'}</em>
                                    <ArrowRight size={14} aria-hidden="true" />
                                  </div>
                                  <span className="validation-time-spacer" aria-hidden="true" />
                                  <div className="validation-time-plain-field">
                                    <em>{row.plannedCheckOut || '--:--'}</em>
                                    <ArrowRight size={14} aria-hidden="true" />
                                  </div>
                                </div>
                              </td>
                            ) : null}
                            <td>
                              <div className="validation-time-stack">
                                <TimeInput
                                  aria-label="Entrada Staff"
                                  className="validation-time-input"
                                  placeholder="--:--"
                                  value={row.assignment.checkIn || ''}
                                  onChange={(value) => updateDraft(row, { checkIn: value })}
                                />
                                <ArrowDown size={14} className="validation-time-arrow" aria-hidden="true" />
                                <TimeInput
                                  aria-label="Saída Staff"
                                  className="validation-time-input"
                                  placeholder="--:--"
                                  value={row.assignment.checkOut || ''}
                                  onChange={(value) => updateDraft(row, { checkOut: value })}
                                />
                                <small>Total: {staffColumnHours(row.assignment).toFixed(2)} h</small>
                                {stage === TIME_VALIDATION_STAGE.staffPending ? (
                                  <button className="validation-copy-button" type="button" onClick={() => copyPlannedToStaff(row)}>
                                    <Copy size={12} />
                                    Previsto
                                  </button>
                                ) : null}
                              </div>
                            </td>
                            {showClientColumn ? (
                              <td>
                                <div className="validation-time-stack">
                                  <TimeInput
                                    aria-label="Entrada Cliente"
                                    className="validation-time-input"
                                    placeholder="--:--"
                                    data-validation-client-row={row.id}
                                    value={row.assignment.clientCheckIn || ''}
                                    onBlur={(value, event) => handleClientTimeBlur(
                                      row,
                                      'clientCheckIn',
                                      value,
                                      event.relatedTarget,
                                    )}
                                    onChange={(value) => updateDraft(row, { clientCheckIn: value })}
                                  />
                                  <ArrowDown size={14} className="validation-time-arrow" aria-hidden="true" />
                                  <TimeInput
                                    aria-label="Saída Cliente"
                                    className="validation-time-input"
                                    placeholder="--:--"
                                    data-validation-client-row={row.id}
                                    value={row.assignment.clientCheckOut || ''}
                                    onBlur={(value, event) => handleClientTimeBlur(
                                      row,
                                      'clientCheckOut',
                                      value,
                                      event.relatedTarget,
                                    )}
                                    onChange={(value) => updateDraft(row, { clientCheckOut: value })}
                                  />
                                  <small>Total: {clientColumnHours(row.assignment).toFixed(2)} h</small>
                                  <button className="validation-copy-button" type="button" onClick={() => copyStaffToClient(row)}>
                                    <Copy size={12} />
                                    Staff
                                  </button>
                                </div>
                              </td>
                            ) : null}
                            {showDifferenceColumn ? (
                              <td>
                                <Badge tone={row.tone}>
                                  <DifferenceIcon tone={row.tone} />
                                  <span>
                                    {row.toneLabel}
                                    {row.differenceDetail ? ` · ${row.differenceDetail}` : ''}
                                  </span>
                                </Badge>
                              </td>
                            ) : null}
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
                                  <button className="icon-button" type="button" title="Aceitar validação" aria-label="Aceitar validação" onClick={() => acceptRow(row)} disabled={!completeForAcceptance || savingId === row.id || bulkValidatingEventId !== null}>
                                    <CheckCircle2 size={16} />
                                  </button>
                                )}
                                <button className="icon-button" type="button" title="Guardar validação" onClick={() => saveRow(row)} disabled={savingId === row.id || bulkValidatingEventId !== null}>
                                  <Save size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {isFinalizedStage ? (
          <div className="validation-history-list">
            {validatedEvents.map((item) => (
              <article key={item.event.id} className="validation-history-item">
                <div>
                  <strong>{item.event.name || '-'}</strong>
                  <small>{item.event.client?.name || '-'} · {item.dateLabel}</small>
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
            {!loading && !validatedEvents.length ? <p className="muted">Sem eventos/serviços finalizados neste período.</p> : null}
          </div>
        ) : null}
      </Card>

    </div>
  );
}
