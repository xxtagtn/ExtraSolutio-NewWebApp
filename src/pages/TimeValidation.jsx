import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  Copy,
  FileDown,
  FileSpreadsheet,
  Hourglass,
  OctagonAlert,
  RotateCcw,
  Save,
  Siren,
  Upload,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Badge from '../components/UI/Badge.jsx';
import EmptyState from '../components/UI/EmptyState.jsx';
import Modal from '../components/UI/Modal.jsx';
import TimeInput from '../components/UI/TimeInput.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../utils/api.js';
import { collaboratorRoleOptions } from '../utils/collaboratorRoles.js';
import { externalCostsTotals } from '../utils/externalCosts.js';
import { date, durationHours } from '../utils/formatters.js';
import { buildBulkValidationCandidates, buildClientCopyCandidates } from '../utils/hourValidationBulk.js';
import { hoursValidationState, validationPersistenceFields } from '../utils/hourValidationStatus.js';
import { clientChargeHours, clientRealHours, decimalValue, staffWorkedHours } from '../utils/serviceFinance.js';
import { nextAutomaticServiceStatus, nextTimeValidationServiceStatus, SERVICE_STATUS } from '../utils/serviceStatus.js';
import { buildStaffScheduleExcelHtml, buildStaffSchedulePdfHtml } from '../utils/staffSchedulePdf.js';
import { assessTimeTolerance, resolvePlannedTimes } from '../utils/timeTolerance.js';
import {
  canConfirmTimeValidationImport,
  importConfirmationMessage,
  importResultMessage,
  isExcelImportFile,
} from '../utils/timeValidationImportUi.js';
import {
  dateKeysFrom,
  effectiveRowDateKey,
  filterRowsByDateRange,
  normalizeTimeInput,
} from '../utils/timeValidationFilters.js';
import {
  compareTimeValidationRowsNewest,
  clientTimeCorrection,
  currentMonthPeriod,
  currentWeekPeriod,
  persistedWorkflowAssignment,
  preserveStageAfterManualRowSave,
  previousMonthPeriod,
  prunePersistedDrafts,
  recentOperationalPeriod,
  reopenTargetStage,
  rowMatchesValidationStage,
  TIME_VALIDATION_STAGE,
  validationDisplayStageCounts,
  validationEventWorkflowSummary,
  validationStageCounts,
  validationWorkflowStage,
} from '../utils/timeValidationWorkflow.js';

const NON_BILLABLE_STATUSES = new Set(['missed_justified', 'missed_unjustified', 'cancelled']);
const VALIDATED_EVENT_MARKER = '[EVENT_VALIDATED_HOURS]';
const VALIDATION_STAGE_TABS = [
  { value: TIME_VALIDATION_STAGE.staffPending, label: 'Por preencher Staff', icon: Hourglass, tone: 'neutral' },
  { value: TIME_VALIDATION_STAGE.clientPending, label: 'Aguardar Cliente', icon: Hourglass, tone: 'warning' },
  { value: TIME_VALIDATION_STAGE.finalized, label: 'Finalizados', icon: CheckCircle2, tone: 'success' },
];

const IMPORT_MAPPING_LABELS = {
  session: 'Nome da sessão',
  category: 'Função',
  department: 'Departamento',
  collaborator: 'Colaborador',
  assignment: 'Turno',
};

const IMPORT_MANUAL_MAPPING_FIELDS = new Set(['session', 'category', 'collaborator']);

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

function periodLabel(start, end) {
  if (start && end && start === end) return date.format(new Date(start));
  if (start && end) return `${date.format(new Date(start))} a ${date.format(new Date(end))}`;
  if (start) return `Desde ${date.format(new Date(start))}`;
  if (end) return `Até ${date.format(new Date(end))}`;
  return 'Todos os dias';
}

function weekdayLabel(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const label = new Intl.DateTimeFormat('pt-PT', { weekday: 'long' }).format(parsed);
  return label.charAt(0).toUpperCase() + label.slice(1);
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

function timePairLabel(start, end) {
  return `${start || '--:--'} → ${end || '--:--'}`;
}

function staffHoursFor(assignment, event) {
  return staffWorkedHours(assignment, event.startTime, event.endTime);
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

function validationSummaryLabel(item = {}) {
  if (item.markedValidated) return 'Finalizado';
  if ((item.differences || 0) > 0) return 'Com divergências';
  if (item.ready) return 'Aguardar validação final';
  if ((item.stageCounts?.[TIME_VALIDATION_STAGE.clientPending] || 0) > 0) return 'Aguardar cliente';
  if ((item.stageCounts?.[TIME_VALIDATION_STAGE.staffPending] || 0) > 0) return 'Por preencher Staff';
  return 'Em validação';
}

function validationSummaryTone(item = {}) {
  if (item.markedValidated || item.ready) return 'success';
  if ((item.differences || 0) > 0) return 'orange';
  if ((item.stageCounts?.[TIME_VALIDATION_STAGE.clientPending] || 0) > 0) return 'warning';
  if ((item.stageCounts?.[TIME_VALIDATION_STAGE.staffPending] || 0) > 0) return 'neutral';
  return 'info';
}

function clientRowsMissing(item = {}) {
  return Math.max(0, Number(item.total || 0) - Number(item.clientComplete || 0));
}

function canBulkAcceptEvent(item = {}) {
  return Number(item.total || 0) > 0
    && clientRowsMissing(item) === 0
    && Number(item.differences || 0) === 0
    && Number(item.validated || 0) < Number(item.total || 0);
}

function rowsDuration(rows = [], getter) {
  return rows.reduce((sum, row) => sum + getter(row), 0);
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
  const externalTotals = externalCostsTotals(event.externalCosts);
  totalRevenue += externalTotals.chargeAmount;
  totalCost += externalTotals.costAmount;
  return {
    totalRevenue: Number(totalRevenue.toFixed(2)),
    totalCost: Number(totalCost.toFixed(2)),
    realHours: Number(realHours.toFixed(2)),
    billableHours: Number(billableHours.toFixed(2)),
  };
}

export default function TimeValidation() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: services, loading, error, reload } = useApi('/services', []);
  const [stage, setStage] = useState(TIME_VALIDATION_STAGE.staffPending);
  const [viewMode, setViewMode] = useState('event');
  const [selectedClientId, setSelectedClientId] = useState('all');
  const [selectedEventId, setSelectedEventId] = useState('all');
  const [selectedWorkDateKey, setSelectedWorkDateKey] = useState('all');
  const [selectedCollaboratorId, setSelectedCollaboratorId] = useState('all');
  const [periodStart, setPeriodStart] = useState(() => recentOperationalPeriod(new Date(), 30).start);
  const [periodEnd, setPeriodEnd] = useState(() => recentOperationalPeriod(new Date(), 30).end);
  const [savingId, setSavingId] = useState(null);
  const [validatingEventId, setValidatingEventId] = useState(null);
  const [bulkValidatingEventId, setBulkValidatingEventId] = useState(null);
  const [copyingClientEventId, setCopyingClientEventId] = useState(null);
  const [statusSyncing, setStatusSyncing] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importFileData, setImportFileData] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [importMappings, setImportMappings] = useState([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const [importDragActive, setImportDragActive] = useState(false);
  const [expandedFinalizedEventId, setExpandedFinalizedEventId] = useState(null);
  const validationTableRef = useRef(null);

  useEffect(() => {
    if (stage === TIME_VALIDATION_STAGE.ready) {
      setStage(TIME_VALIDATION_STAGE.clientPending);
    }
  }, [stage]);

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
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [reload]);

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

  useEffect(() => {
    const idParam = searchParams.get('eventId');
    if (!idParam || loading) return;
    const target = services.find((event) => String(event.id) === String(idParam));
    if (!target) return;

    const targetRows = allRows.filter((row) => String(row.event.id) === String(idParam));
    const counts = validationStageCounts(targetRows);
    const nextStage = eventIsMarkedValidated(target)
      ? TIME_VALIDATION_STAGE.finalized
      : counts[TIME_VALIDATION_STAGE.staffPending] > 0
        ? TIME_VALIDATION_STAGE.staffPending
        : TIME_VALIDATION_STAGE.clientPending;

    setViewMode('event');
    setSelectedClientId('all');
    setSelectedCollaboratorId('all');
    setSelectedEventId(String(idParam));
    setSelectedWorkDateKey('all');
    setStage(nextStage);
    setPeriodStart(dateKey(target.date));
    setPeriodEnd(dateKey(target.isContinuous && target.endDate ? target.endDate : target.date));
    if (nextStage === TIME_VALIDATION_STAGE.finalized) setExpandedFinalizedEventId(String(idParam));
    const nextParams = new window.URLSearchParams(searchParams);
    nextParams.delete('eventId');
    setSearchParams(nextParams, { replace: true });
  }, [allRows, loading, searchParams, services, setSearchParams]);

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

  const importEventOptions = useMemo(
    () => services
      .map((event) => ({
        id: String(event.id),
        label: `${event.name || '-'} · ${event.client?.name || '-'} · ${dateRangeLabelFromKeys([event.date, event.endDate])}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt')),
    [services],
  );

  const importCollaboratorOptions = useMemo(() => {
    const seen = new Map();
    for (const service of services) {
      for (const assignment of service.assignments || []) {
        const collaborator = assignment.collaborator;
        if (!collaborator?.id || seen.has(String(collaborator.id))) continue;
        seen.set(String(collaborator.id), {
          id: String(collaborator.id),
          label: `${collaborator.shortName || collaborator.name || '-'} · ${collaborator.nif || '-'}`,
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt'));
  }, [services]);

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
          stageCounts: validationStageCounts([]),
          markedValidated: eventIsMarkedValidated(row.event),
          validatedAt: extractValidatedAt(row.event),
          workDateKeys: new Set(),
          rows: [],
        });
      }
      const current = map.get(key);
      current.workDateKeys.add(row.workDateKey);
      current.rows.push(row);
    }
    return [...map.values()]
      .map((item) => {
        const workDateKeys = [...item.workDateKeys].filter(Boolean).sort();
        const latestWorkDateKey = workDateKeys[workDateKeys.length - 1] || item.event.date || '';
        const summary = validationEventWorkflowSummary(item.rows, {
          includeRow: (row) => !NON_BILLABLE_STATUSES.has(assignmentStatus(row.assignment.status)),
        });
        return {
          ...item,
          ...summary,
          dateLabel: dateRangeLabelFromKeys(workDateKeys),
          latestWorkDateKey,
        };
      })
      .sort((a, b) => new Date(b.latestWorkDateKey || 0).getTime() - new Date(a.latestWorkDateKey || 0).getTime());
  }, [clientRows]);

  const pendingEvents = useMemo(() => eventProgress.filter((item) => !item.markedValidated), [eventProgress]);
  const validatedEvents = useMemo(() => eventProgress.filter((item) => item.markedValidated), [eventProgress]);
  const finalizedRowsByEvent = useMemo(() => {
    const map = new Map();
    for (const row of clientRows) {
      if (row.workflowStage !== TIME_VALIDATION_STAGE.finalized) continue;
      const key = String(row.event.id);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    for (const eventRows of map.values()) {
      eventRows.sort(compareTimeValidationRowsNewest);
    }
    return map;
  }, [clientRows]);
  const stageCounts = useMemo(() => validationDisplayStageCounts(clientRows), [clientRows]);

  useEffect(() => {
    if (selectedClientId !== 'all' && !clientOptions.some((item) => item.id === selectedClientId)) {
      setSelectedClientId('all');
    }
  }, [clientOptions, selectedClientId]);

  useEffect(() => {
    if (selectedEventId !== 'all' && !eventOptions.some((item) => item.id === selectedEventId)) {
      setSelectedEventId('all');
      setSelectedWorkDateKey('all');
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
        if (!rowMatchesValidationStage(row.workflowStage, stage)) return false;
        if (viewMode === 'event' && selectedEventId !== 'all' && String(row.event.id) !== selectedEventId) return false;
        if (viewMode === 'event' && selectedWorkDateKey !== 'all' && row.workDateKey !== selectedWorkDateKey) return false;
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
    [clientRows, stage, selectedCollaboratorId, selectedEventId, selectedWorkDateKey, viewMode],
  );

  const staffPdfRows = useMemo(
    () => clientRows
      .filter((row) => {
        if (!rowMatchesValidationStage(row.workflowStage, stage)) return false;
        if (viewMode === 'event' && selectedEventId !== 'all' && String(row.event.id) !== selectedEventId) return false;
        if (viewMode === 'event' && selectedWorkDateKey !== 'all' && row.workDateKey !== selectedWorkDateKey) return false;
        if (viewMode === 'collaborator' && selectedCollaboratorId !== 'all' && String(row.assignment.collaboratorId) !== selectedCollaboratorId) return false;
        return true;
      })
      .map((row) => ({ ...row, staffScheduleHours: staffColumnHours(row.assignment) })),
    [clientRows, stage, selectedCollaboratorId, selectedEventId, selectedWorkDateKey, viewMode],
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

  const eventCardRows = useMemo(
    () => clientRows.filter((row) => {
      if (!rowMatchesValidationStage(row.workflowStage, stage)) return false;
      if (viewMode === 'collaborator' && selectedCollaboratorId !== 'all' && String(row.assignment.collaboratorId) !== selectedCollaboratorId) return false;
      return true;
    }),
    [clientRows, selectedCollaboratorId, stage, viewMode],
  );
  const visibleEventIds = useMemo(() => new Set(eventCardRows.map((row) => String(row.event.id))), [eventCardRows]);
  const visiblePendingEvents = useMemo(
    () => pendingEvents.filter((item) => visibleEventIds.has(String(item.event.id))),
    [pendingEvents, visibleEventIds],
  );
  const eventDayProgress = useMemo(() => {
    const map = new Map();
    for (const row of eventCardRows) {
      const key = `${row.event.id}-${row.workDateKey || 'sem-data'}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          event: row.event,
          workDateKey: row.workDateKey || '',
          workDateLabel: row.workDateLabel,
          rows: [],
        });
      }
      map.get(key).rows.push(row);
    }

    return [...map.values()]
      .map((item) => {
        const summary = validationEventWorkflowSummary(item.rows, {
          includeRow: (row) => !NON_BILLABLE_STATUSES.has(assignmentStatus(row.assignment.status)),
        });
        return {
          ...item,
          ...summary,
          markedValidated: eventIsMarkedValidated(item.event),
        };
      })
      .sort((a, b) => {
        const byDate = String(b.workDateKey || '').localeCompare(String(a.workDateKey || ''));
        if (byDate) return byDate;
        return String(a.event.name || '').localeCompare(String(b.event.name || ''), 'pt');
      });
  }, [eventCardRows]);
  const selectedEventSummary = useMemo(
    () => visiblePendingEvents.find((item) => String(item.event.id) === String(selectedEventId)) || null,
    [selectedEventId, visiblePendingEvents],
  );
  const selectedDaySummary = useMemo(
    () => {
      if (selectedWorkDateKey === 'all') return null;
      return eventDayProgress.find((item) => (
        String(item.event.id) === String(selectedEventId)
        && item.workDateKey === selectedWorkDateKey
      )) || null;
    },
    [eventDayProgress, selectedEventId, selectedWorkDateKey],
  );
  const selectedPanelRows = useMemo(() => {
    if (viewMode === 'collaborator') return rows;
    if (selectedDaySummary) return selectedDaySummary.rows;
    if (selectedEventSummary) return selectedEventSummary.rows;
    return rows;
  }, [rows, selectedDaySummary, selectedEventSummary, viewMode]);
  const selectedPanelSummary = selectedDaySummary || selectedEventSummary;
  const selectedPanelStaffHours = rowsDuration(selectedPanelRows, (row) => staffColumnHours(row.assignment));
  const selectedPanelClientHours = rowsDuration(selectedPanelRows, (row) => clientColumnHours(row.assignment));
  const selectedPanelPlannedHours = rowsDuration(selectedPanelRows, (row) => staffHoursFor({
    ...row.assignment,
    checkIn: row.plannedCheckIn,
    checkOut: row.plannedCheckOut,
  }, row.event));
  const shouldShowValidationTable = viewMode === 'collaborator' || selectedEventId !== 'all';

  useEffect(() => {
    if (selectedEventId === 'all' || selectedWorkDateKey === 'all') return;
    const exists = eventDayProgress.some((item) => (
      String(item.event.id) === String(selectedEventId)
      && item.workDateKey === selectedWorkDateKey
    ));
    if (!exists) setSelectedWorkDateKey('all');
  }, [eventDayProgress, selectedEventId, selectedWorkDateKey]);

  const importUnresolvedEntries = useMemo(() => {
    const unresolved = importPreview?.unresolvedMappings || {};
    return Object.entries(unresolved).flatMap(([field, entries]) => (
      IMPORT_MANUAL_MAPPING_FIELDS.has(field)
        ? (entries || []).map((entry) => ({ ...entry, field }))
        : []
    ));
  }, [importPreview]);

  const canConfirmImport = canConfirmTimeValidationImport(importPreview, importBusy);

  const selectedClientLabel = selectedClientId === 'all'
    ? 'Todos os clientes'
    : clientOptions.find((item) => item.id === selectedClientId)?.label || 'Cliente selecionado';

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

  function resetPeriodToToday() {
    const today = dateKey(new Date());
    setPeriod(today, today);
  }

  function resetPeriodToCurrentWeek() {
    const current = currentWeekPeriod();
    setPeriod(current.start, current.end);
  }

  function resetPeriodToCurrentMonth() {
    const current = currentMonthPeriod();
    setPeriod(current.start, current.end);
  }

  function resetPeriodToPreviousMonth() {
    const previous = previousMonthPeriod();
    setPeriod(previous.start, previous.end);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new window.FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Não foi possível ler o ficheiro Excel.'));
      reader.readAsDataURL(file);
    });
  }

  function resetImportState() {
    setImportFile(null);
    setImportFileData('');
    setImportPreview(null);
    setImportMappings([]);
    setImportError('');
    setImportBusy(false);
    setImportDragActive(false);
  }

  function closeImportModal() {
    setImportModalOpen(false);
    resetImportState();
  }

  function mappingValue(field, externalValue) {
    return importMappings.find((mapping) => (
      mapping.field === field && mapping.externalValue === externalValue
    ))?.internalValue || '';
  }

  function updateImportMapping(field, externalValue, internalValue) {
    setImportMappings((current) => {
      const next = current.filter((mapping) => (
        !(mapping.field === field && mapping.externalValue === externalValue)
      ));
      if (internalValue) next.push({ field, externalValue, internalValue });
      return next;
    });
  }

  async function previewImport(file = importFile, fileData = importFileData) {
    if (!file || !fileData) {
      setImportError('Seleciona primeiro o ficheiro Excel enviado pelo cliente.');
      return;
    }
    setImportBusy(true);
    setImportError('');
    try {
      const preview = await api('/time-validation-imports/preview', {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          fileData,
          mappings: importMappings.filter((mapping) => mapping.internalValue),
        }),
      });
      setImportPreview(preview);
    } catch (err) {
      setImportError(err?.message || 'Não foi possível analisar o ficheiro Excel.');
    } finally {
      setImportBusy(false);
    }
  }

  async function onImportFileSelected(file) {
    if (!file) return;
    if (!isExcelImportFile(file)) {
      setImportError('Arrasta ou seleciona um ficheiro Excel válido (.xlsx, .xls ou .xlsm).');
      return;
    }
    setImportFile(file);
    setImportPreview(null);
    setImportError('');
    try {
      const dataUrl = await fileToDataUrl(file);
      setImportFileData(dataUrl);
      await previewImport(file, dataUrl);
    } catch (err) {
      setImportError(err?.message || 'Não foi possível ler o ficheiro Excel.');
    }
  }

  function onImportDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!importBusy) setImportDragActive(true);
  }

  function onImportDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setImportDragActive(false);
  }

  async function onImportDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    setImportDragActive(false);
    if (importBusy) return;
    await onImportFileSelected(event.dataTransfer?.files?.[0]);
  }

  async function confirmImport() {
    if (!importPreview?.rows?.length) return;
    setImportBusy(true);
    setImportError('');
    try {
      const result = await api('/time-validation-imports/commit', {
        method: 'POST',
        body: JSON.stringify({
          rows: importPreview.rows,
          mappings: importMappings.filter((mapping) => mapping.internalValue),
        }),
      });
      window.alert(importResultMessage(result));
      closeImportModal();
      reload();
    } catch (err) {
      setImportError(err?.message || 'Não foi possível confirmar a importação.');
    } finally {
      setImportBusy(false);
    }
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

  function showEventRows(eventId, workDateKey = 'all') {
    setViewMode('event');
    if (String(selectedEventId) === String(eventId) && selectedWorkDateKey === workDateKey) {
      setSelectedEventId('all');
      setSelectedWorkDateKey('all');
      return;
    }
    setSelectedEventId(String(eventId));
    setSelectedWorkDateKey(workDateKey || 'all');
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
    const staffHours = staffHoursFor(merged, row.event);
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

  async function copyStaffToClientForEvent(item) {
    const eventRows = clientRows.filter((row) => (
      String(row.event.id) === String(item.event.id)
      && !NON_BILLABLE_STATUSES.has(assignmentStatus(row.assignment.status))
    ));
    const candidates = buildClientCopyCandidates(eventRows, drafts);

    if (!candidates.ready.length) {
      window.alert('Não existem linhas com horários Staff completos e Cliente por preencher neste evento.');
      return;
    }

    setCopyingClientEventId(item.event.id);
    try {
      const updates = new Map();
      await Promise.all(candidates.ready.map(({ row, merged }) => {
        const body = validationBodyFor(row, merged, 'auto');
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
      window.alert(error?.message || 'Não foi possível copiar os horários Staff para Cliente.');
    } finally {
      setCopyingClientEventId(null);
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
    const eventId = String(item.event.id);
    const targetStage = reopenTargetStage(clientRows.filter((row) => String(row.event.id) === eventId));
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
      setExpandedFinalizedEventId(null);
      setViewMode('event');
      setSelectedEventId(eventId);
      setStage(targetStage);
      reload();
    } catch (error) {
      window.alert(error?.message || 'Não foi possível voltar a colocar este evento em validação.');
    } finally {
      setValidatingEventId(null);
    }
  }

  const isFinalizedStage = stage === TIME_VALIDATION_STAGE.finalized;
  const selectedPanelEvent = selectedPanelSummary?.event || null;
  const selectedPanelDateLabel = selectedDaySummary?.workDateKey
    ? `${date.format(new Date(selectedDaySummary.workDateKey))} · ${weekdayLabel(selectedDaySummary.workDateKey)}`
    : selectedEventSummary?.dateLabel || periodLabel(periodStart, periodEnd);
  const selectedPanelTone = validationSummaryTone(selectedPanelSummary || {});
  const selectedPanelStatus = validationSummaryLabel(selectedPanelSummary || {});
  const showPlannedColumn = stage === TIME_VALIDATION_STAGE.staffPending;
  const showClientColumn = stage !== TIME_VALIDATION_STAGE.staffPending;
  const showDifferenceColumn = stage === TIME_VALIDATION_STAGE.clientPending;
  const tableColumnCount = 5
    + Number(showPlannedColumn)
    + Number(showClientColumn)
    + Number(showDifferenceColumn);

  return (
    <div className="page validation-page">
      <div className="page-title-row">
        <div>
          <h1>Conferência Operacional</h1>
          <p>Conferência entre horários Staff e Cliente antes da faturação e pagamento.</p>
        </div>
      </div>

      <section className="validation-shell">
        <div className="validation-stage-tabs" role="tablist" aria-label="Estado da validação">
          {VALIDATION_STAGE_TABS.map((item) => {
            const StageIcon = item.icon;
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={stage === item.value}
                className={`validation-stage-tab validation-stage-tab--${item.tone} ${stage === item.value ? 'is-active' : ''}`}
                onClick={() => {
                  setStage(item.value);
                  setSelectedEventId('all');
                  setSelectedWorkDateKey('all');
                  setSelectedCollaboratorId('all');
                }}
              >
                <StageIcon size={14} />
                <span>{item.label}</span>
                <strong>{stageCounts[item.value] || 0}</strong>
              </button>
            );
          })}
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
            <select
              className="form-control"
              value={selectedEventId}
              onChange={(event) => {
                setSelectedEventId(event.target.value);
                setSelectedWorkDateKey('all');
              }}
            >
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
            <button type="button" onClick={resetPeriodToCurrentWeek}>Semana</button>
            <button type="button" onClick={resetPeriodToCurrentMonth}>Este mês</button>
            <button type="button" onClick={resetPeriodToPreviousMonth}>Mês passado</button>
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
          <div className="validation-workspace">
            <aside className="validation-event-sidebar">
              <div className="validation-sidebar-head">
                <div>
                  <strong>Eventos ({eventDayProgress.length})</strong>
                  <span>Agrupados por dia</span>
                </div>
              </div>
              <div className="validation-sidebar-list">
              {eventDayProgress.map((item, index) => {
                const isOpen = String(item.event.id) === selectedEventId && item.workDateKey === selectedWorkDateKey;
                const showDateHeader = item.workDateKey !== eventDayProgress[index - 1]?.workDateKey;
                return (
                <Fragment key={item.key}>
                  {showDateHeader ? (
                    <div className="validation-sidebar-date-heading">
                      <span>{item.workDateLabel}</span>
                      <small>{weekdayLabel(item.workDateKey)}</small>
                    </div>
                  ) : null}
                <article
                  className={`validation-event-item ${isOpen ? 'validation-event-item--selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => showEventRows(item.event.id, item.workDateKey || 'all')}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      showEventRows(item.event.id, item.workDateKey || 'all');
                    }
                  }}
                >
                  <div className="validation-event-main">
                    <div>
                    <strong>{item.event.name || '-'}</strong>
                    <small>{item.event.client?.name || '-'} · {item.workDateLabel}</small>
                  </div>
                    <Badge tone={item.ready ? 'success' : 'warning'}>{item.ready ? 'Pronto para fechar' : 'Em validação'}</Badge>
                  </div>
                  <div className="validation-event-metrics">
                    <div className="validation-event-primary-stats">
                      <div>
                        <span>Staff</span>
                        <strong>{item.staffComplete}/{item.total}</strong>
                      </div>
                      <div>
                        <span>Cliente</span>
                        <strong>{item.clientComplete}/{item.total}</strong>
                      </div>
                    </div>
                    <div className="validation-event-workflow" aria-label="Resumo por estado">
                      <span>Staff em falta: <strong>{item.stageCounts[TIME_VALIDATION_STAGE.staffPending] || 0}</strong></span>
                      <span>Aguardar cliente: <strong>{item.stageCounts[TIME_VALIDATION_STAGE.clientPending] || 0}</strong></span>
                      <span>Divergências: <strong>{item.differences || 0}</strong></span>
                      <span>Aceites: <strong>{item.stageCounts[TIME_VALIDATION_STAGE.ready] || 0}</strong></span>
                    </div>
                  </div>
                  <div className="validation-event-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => showEventRows(item.event.id, item.workDateKey || 'all')}
                    >
                      {isOpen ? 'Esconder linhas' : 'Ver linhas'}
                    </button>
                    {stage === TIME_VALIDATION_STAGE.clientPending ? (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={!clientRowsMissing(item) || copyingClientEventId === item.event.id || bulkValidatingEventId === item.event.id}
                        onClick={() => copyStaffToClientForEvent(item)}
                      >
                        {copyingClientEventId === item.event.id ? 'A copiar...' : 'Copiar Staff para Cliente'}
                      </button>
                    ) : null}
                    {stage === TIME_VALIDATION_STAGE.clientPending && canBulkAcceptEvent(item) ? (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={bulkValidatingEventId === item.event.id}
                        onClick={() => validateAllRowsForEvent(item)}
                      >
                        {bulkValidatingEventId === item.event.id ? 'A validar...' : 'Validar tudo'}
                      </button>
                    ) : null}
                    {stage === TIME_VALIDATION_STAGE.clientPending && item.ready ? (
                      <button className="secondary-button" type="button" disabled={!item.ready || validatingEventId === item.event.id || bulkValidatingEventId === item.event.id} onClick={() => markEventValidated(item)}>
                        {validatingEventId === item.event.id ? 'A validar...' : 'Marcar evento validado'}
                      </button>
                    ) : null}
                  </div>
                </article>
                </Fragment>
                );
              })}
              {!loading && !eventDayProgress.length ? (
                <EmptyState
                  compact
                  icon={Hourglass}
                  title="Sem eventos nesta fase"
                  description="Ajusta o período, cliente ou estado para procurar outros registos."
                />
              ) : null}
            </div>
            </aside>

            <section className="validation-main-panel" ref={validationTableRef}>
              {selectedPanelSummary && selectedPanelEvent ? (
                <>
                  <header className="validation-main-header">
                    <div>
                      <div className="validation-main-title-line">
                        <h2>{selectedPanelEvent.name || '-'}</h2>
                        <Badge tone={selectedPanelTone}>{selectedPanelStatus}</Badge>
                      </div>
                      <p>{selectedPanelEvent.client?.name || '-'} · {selectedPanelDateLabel}</p>
                    </div>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => {
                        setSelectedEventId('all');
                        setSelectedWorkDateKey('all');
                      }}
                    >
                      Voltar à lista
                    </button>
                  </header>

                  <div className="validation-kpi-grid">
                    <div className="validation-kpi validation-kpi--success">
                      <span>Staff preenchido</span>
                      <strong>{selectedPanelSummary.staffComplete}/{selectedPanelSummary.total}</strong>
                      <small>horas preenchidas</small>
                    </div>
                    <div className="validation-kpi validation-kpi--warning">
                      <span>Cliente por preencher</span>
                      <strong>{selectedPanelSummary.clientComplete}/{selectedPanelSummary.total}</strong>
                      <small>{Math.max(0, selectedPanelSummary.total - selectedPanelSummary.clientComplete)} registo(s) pendente(s)</small>
                    </div>
                    <div className="validation-kpi validation-kpi--orange">
                      <span>Divergências</span>
                      <strong>{selectedPanelSummary.differences}</strong>
                      <small>linhas a rever</small>
                    </div>
                    <div className="validation-kpi validation-kpi--info">
                      <span>Total horas previsto</span>
                      <strong>{durationHours(selectedPanelPlannedHours)}</strong>
                      <small>{durationHours(selectedPanelStaffHours)} Staff · {durationHours(selectedPanelClientHours)} Cliente</small>
                    </div>
                  </div>

                  <div className="validation-main-toolbar">
                    <button className="secondary-button" type="button" onClick={() => setImportModalOpen(true)}>
                      <Upload size={16} />
                      Importar Excel Cliente
                    </button>
                    {stage === TIME_VALIDATION_STAGE.clientPending ? (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={!clientRowsMissing(selectedPanelSummary) || copyingClientEventId === selectedPanelEvent.id || bulkValidatingEventId === selectedPanelEvent.id}
                        onClick={() => copyStaffToClientForEvent(selectedPanelSummary)}
                      >
                        <Copy size={16} />
                        {copyingClientEventId === selectedPanelEvent.id ? 'A copiar...' : 'Copiar Staff para Cliente'}
                      </button>
                    ) : null}
                    {stage === TIME_VALIDATION_STAGE.clientPending && canBulkAcceptEvent(selectedPanelSummary) ? (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={bulkValidatingEventId === selectedPanelEvent.id}
                        onClick={() => validateAllRowsForEvent(selectedPanelSummary)}
                      >
                        <CheckCircle2 size={16} />
                        {bulkValidatingEventId === selectedPanelEvent.id ? 'A validar...' : 'Validar tudo'}
                      </button>
                    ) : null}
                    {stage === TIME_VALIDATION_STAGE.clientPending && selectedPanelSummary.ready ? (
                      <button
                        className="command-button"
                        type="button"
                        disabled={!selectedPanelSummary.ready || validatingEventId === selectedPanelEvent.id || bulkValidatingEventId === selectedPanelEvent.id}
                        onClick={() => markEventValidated(selectedPanelSummary)}
                      >
                        <CheckCircle2 size={16} />
                        {validatingEventId === selectedPanelEvent.id ? 'A validar...' : 'Marcar evento validado'}
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="validation-detail-empty">
                  <EmptyState
                    icon={CheckCircle2}
                    title="Seleciona um evento para ver as linhas"
                    description="A lista lateral mostra os eventos agrupados por dia dentro do período selecionado."
                  />
                </div>
              )}

              {shouldShowValidationTable ? (
                <>
                  {!loading && !rows.length ? (
                    <EmptyState
                      compact
                      icon={Hourglass}
                      title="Sem registos para validar"
                      description="Não existem colaboradores nesta fase para os filtros selecionados."
                    />
                  ) : null}

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
                          <tr key={row.id} className={`validation-row validation-row--${row.validationState.isValidated ? 'success' : row.tone}`}>
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
                                <small>Total: {durationHours(staffColumnHours(row.assignment))}</small>
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
                                  <small>Total: {durationHours(clientColumnHours(row.assignment))}</small>
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
                                  <button className="secondary-button validation-row-action" type="button" title="Aceitar validação" onClick={() => acceptRow(row)} disabled={!completeForAcceptance || savingId === row.id || bulkValidatingEventId !== null}>
                                    <CheckCircle2 size={14} />
                                    Aceitar
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
                  <div className="validation-table-summary">
                    <span>{rows.length} linha(s)</span>
                    <span>Total previsto: <strong>{durationHours(selectedPanelPlannedHours)}</strong></span>
                    <span>Total Staff: <strong>{durationHours(selectedPanelStaffHours)}</strong></span>
                    <span>Total Cliente: <strong>{durationHours(selectedPanelClientHours)}</strong></span>
                  </div>
              </>
            ) : null}
            </section>
          </div>
        ) : null}

        {isFinalizedStage ? (
          <div className="validation-history-list">
            {validatedEvents.map((item) => {
              const eventId = String(item.event.id);
              const expanded = expandedFinalizedEventId === eventId;
              const eventRows = finalizedRowsByEvent.get(eventId) || [];
              return (
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
                <div className="validation-history-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!eventRows.length}
                    onClick={() => setExpandedFinalizedEventId(expanded ? null : eventId)}
                  >
                    {expanded ? 'Ocultar horários' : 'Ver horários'}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={validatingEventId === item.event.id}
                    onClick={() => reopenValidatedEvent(item)}
                  >
                    {validatingEventId === item.event.id ? 'A reabrir...' : 'Voltar a validar'}
                  </button>
                </div>
                {expanded ? (
                  <div className="validation-history-details">
                    <div className="table-wrap">
                      <table className="validation-history-table">
                        <thead>
                          <tr>
                            <th>Colaborador</th>
                            <th>Data</th>
                            <th>Função</th>
                            <th>Previsto</th>
                            <th>Staff</th>
                            <th>Cliente</th>
                            <th>Diferença</th>
                            <th>Notas</th>
                          </tr>
                        </thead>
                        <tbody>
                          {eventRows.map((row) => (
                            <tr key={row.id} className={`validation-row validation-row--${row.tone}`}>
                              <td>
                                <strong>{row.assignment.collaborator?.shortName || row.assignment.collaborator?.name || '-'}</strong>
                                <small>{row.assignment.collaborator?.nif || '-'}</small>
                              </td>
                              <td>{row.workDateLabel}</td>
                              <td>{row.assignment.role || '-'}</td>
                              <td>{timePairLabel(row.plannedCheckIn, row.plannedCheckOut)}</td>
                              <td>
                                <strong>{timePairLabel(row.assignment.checkIn, row.assignment.checkOut)}</strong>
                                <small>{durationHours(staffColumnHours(row.assignment))}</small>
                              </td>
                              <td>
                                <strong>{timePairLabel(row.assignment.clientCheckIn, row.assignment.clientCheckOut)}</strong>
                                <small>{durationHours(clientColumnHours(row.assignment))}</small>
                              </td>
                              <td>
                                <Badge tone={row.tone}>
                                  <DifferenceIcon tone={row.tone} />
                                  <span>
                                    {row.toneLabel}
                                    {row.differenceDetail ? ` · ${row.differenceDetail}` : ''}
                                  </span>
                                </Badge>
                              </td>
                              <td>{row.assignment.validationNotes || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </article>
              );
            })}
            {!loading && !validatedEvents.length ? <p className="muted">Sem eventos/serviços finalizados neste período.</p> : null}
          </div>
        ) : null}
      </section>

      {importModalOpen ? (
        <Modal title="Importar Excel Cliente" onClose={closeImportModal} size="wide">
          <div className="validation-import-modal">
            <div
              className={`validation-import-upload${importDragActive ? ' validation-import-upload--active' : ''}`}
              onDragOver={onImportDragOver}
              onDragLeave={onImportDragLeave}
              onDrop={onImportDrop}
            >
              <label>
                <span>Ficheiro Excel do cliente</span>
                <strong>Arrasta o Excel para aqui ou seleciona o ficheiro</strong>
                <input
                  type="file"
                  accept=".xlsx,.xls,.xlsm"
                  onChange={(event) => onImportFileSelected(event.target.files?.[0])}
                />
              </label>
              {importFile ? <small>{importFile.name}</small> : <small>Formatos aceites: .xlsx, .xls ou .xlsm.</small>}
            </div>

            {importError ? <p className="form-error">{importError}</p> : null}

            {importPreview ? (
              <>
                <div className="validation-import-summary">
                  <div>
                    <span>Total de linhas</span>
                    <strong>{importPreview.summary.totalRows}</strong>
                  </div>
                  <div>
                    <span>Importáveis</span>
                    <strong>{importPreview.summary.validRows}</strong>
                  </div>
                  <div>
                    <span>Com avisos</span>
                    <strong>{importPreview.summary.warningRows}</strong>
                  </div>
                  <div>
                    <span>Inválidas</span>
                    <strong>{importPreview.summary.invalidRows}</strong>
                  </div>
                </div>

                {importPreview.summary.invalidRows ? (
                  <div className="validation-import-guidance">
                    <strong>Linhas inválidas não serão gravadas.</strong>
                    <span>
                      Se o colaborador ainda não existe, cria-o primeiro em Colaboradores e associa-o ao Evento/Serviço.
                      Se o turno não for encontrado, confirma se o colaborador está no evento, na função e na data correta.
                    </span>
                  </div>
                ) : null}

                <p className="validation-import-commit-note">
                  {importConfirmationMessage(importPreview)}
                </p>

                {importUnresolvedEntries.length ? (
                  <div className="validation-import-mappings">
                    <h3>Correspondências por confirmar</h3>
                    {importUnresolvedEntries.map((entry) => (
                      <label key={`${entry.field}-${entry.externalValue}`}>
                        <span>{IMPORT_MAPPING_LABELS[entry.field] || entry.field}: <strong>{entry.externalValue}</strong></span>
                        {entry.field === 'session' ? (
                          <select
                            className="form-control"
                            value={mappingValue(entry.field, entry.externalValue)}
                            onChange={(event) => updateImportMapping(entry.field, entry.externalValue, event.target.value)}
                          >
                            <option value="">Selecionar Evento/Serviço</option>
                            {importEventOptions.map((item) => (
                              <option key={item.id} value={item.id}>{item.label}</option>
                            ))}
                          </select>
                        ) : entry.field === 'category' ? (
                          <select
                            className="form-control"
                            value={mappingValue(entry.field, entry.externalValue)}
                            onChange={(event) => updateImportMapping(entry.field, entry.externalValue, event.target.value)}
                          >
                            <option value="">Selecionar função</option>
                            {collaboratorRoleOptions.map((role) => (
                              <option key={role} value={role}>{role}</option>
                            ))}
                          </select>
                        ) : entry.field === 'collaborator' ? (
                          <select
                            className="form-control"
                            value={mappingValue(entry.field, entry.externalValue)}
                            onChange={(event) => updateImportMapping(entry.field, entry.externalValue, event.target.value)}
                          >
                            <option value="">Selecionar colaborador</option>
                            {importCollaboratorOptions.map((item) => (
                              <option key={item.id} value={item.id}>{item.label}</option>
                            ))}
                          </select>
                        ) : null}
                      </label>
                    ))}
                    <button className="secondary-button" type="button" onClick={() => previewImport()} disabled={importBusy || !importFileData}>
                      {importBusy ? 'A revalidar...' : 'Revalidar'}
                    </button>
                  </div>
                ) : null}

                <div className="table-wrap validation-import-preview">
                  <table>
                    <thead>
                      <tr>
                        <th>Linha</th>
                        <th>Estado</th>
                        <th>Evento</th>
                        <th>Colaborador</th>
                        <th>Data</th>
                        <th>Cliente</th>
                        <th>Observações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.rows.map((row) => (
                        <tr key={row.rowNumber} className={`validation-import-row validation-import-row--${row.status}`}>
                          <td>{row.rowNumber}</td>
                          <td>
                            <Badge tone={row.status === 'invalid' ? 'danger' : row.status === 'warning' ? 'warning' : 'success'}>
                              {row.status === 'invalid' ? 'Inválido' : row.status === 'warning' ? 'Aviso' : 'Válido'}
                            </Badge>
                          </td>
                          <td>
                            <strong>{row.eventName || row.sessionName}</strong>
                            <small>{row.sessionName}</small>
                          </td>
                          <td>
                            <strong>{row.collaboratorName || '-'}</strong>
                            <small>{row.nif || '-'}</small>
                          </td>
                          <td>{row.eventDate || '-'}</td>
                          <td>{row.clientCheckIn || '--:--'} → {row.clientCheckOut || '--:--'}</td>
                          <td>
                            {[...(row.errors || []), ...(row.warnings || [])].join(' ') || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}

            <div className="form-actions form-actions--split">
              <span className="muted">
                {importPreview ? `Folha ${importPreview.sheetName} · cabeçalhos na linha ${importPreview.headerRowNumber}` : ''}
              </span>
              <div>
                <button className="primary-button" type="button" onClick={confirmImport} disabled={!canConfirmImport}>
                  {importBusy ? 'A importar...' : importPreview?.summary?.invalidRows ? 'Confirmar linhas válidas' : 'Confirmar importação'}
                </button>
                <button className="secondary-button" type="button" onClick={closeImportModal} disabled={importBusy}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}

    </div>
  );
}
