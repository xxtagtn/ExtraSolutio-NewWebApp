import { normalizeAssignmentDrafts } from './serviceAssignmentDrafts.js';

const NON_BILLABLE_ASSIGNMENT_STATUSES = new Set(['missed_justified', 'missed_unjustified', 'cancelled']);
export const MANUAL_TEAM_ROLE = 'Sem função';

export function safeJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function dateKey(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

export function assignmentWorkDate(assignment = {}, event = {}) {
  return dateKey(assignment.assignmentDate || event.date);
}

function localDateKey(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

export function billableAssignments(assignments = []) {
  return assignments.filter((assignment) => (
    assignment?.collaboratorId
    && !NON_BILLABLE_ASSIGNMENT_STATUSES.has(normalizeStatus(assignment.status))
  ));
}

export function requiredStaffTotal(event = {}) {
  return safeJsonArray(event.requiredRoles)
    .reduce((sum, role) => sum + Math.max(0, Number(role.qty || 0)), 0);
}

export function serviceDetailMetrics(event = {}) {
  const assignments = Array.isArray(event.assignments) ? event.assignments : [];
  const billable = billableAssignments(assignments);
  const requested = requiredStaffTotal(event);
  const confirmed = billable.filter((assignment) => normalizeStatus(assignment.status) === 'confirmed').length;
  const staffFilled = billable.filter((assignment) => assignment.checkIn && assignment.checkOut).length;
  const clientFilled = billable.filter((assignment) => assignment.clientCheckIn && assignment.clientCheckOut).length;
  const validated = billable.filter((assignment) => normalizeStatus(assignment.validationStatus) === 'validated').length;

  return {
    requested,
    assigned: billable.length,
    confirmed,
    staffFilled,
    clientFilled,
    validated,
    missingStaff: Math.max(0, requested - confirmed),
    teamComplete: requested > 0 && confirmed >= requested,
    staffHoursComplete: billable.length > 0 && staffFilled === billable.length,
    clientHoursComplete: billable.length > 0 && clientFilled === billable.length,
    validationComplete: billable.length > 0 && validated === billable.length,
  };
}

export function serviceChecklist(event = {}) {
  const metrics = serviceDetailMetrics(event);
  return [
    {
      id: 'team',
      label: 'Equipa completa',
      done: metrics.teamComplete,
      detail: `${metrics.confirmed}/${metrics.requested || metrics.assigned} confirmados`,
    },
    {
      id: 'staff',
      label: 'Horários Staff preenchidos',
      done: metrics.staffHoursComplete,
      detail: `${metrics.staffFilled}/${metrics.assigned} registos`,
    },
    {
      id: 'client',
      label: 'Horários Cliente preenchidos',
      done: metrics.clientHoursComplete,
      detail: `${metrics.clientFilled}/${metrics.assigned} registos`,
    },
    {
      id: 'validation',
      label: 'Validação concluída',
      done: metrics.validationComplete,
      detail: `${metrics.validated}/${metrics.assigned} validados`,
    },
    {
      id: 'finance',
      label: 'Pronto para Financeiro',
      done: metrics.validationComplete || normalizeStatus(event.status) === 'finalized',
      detail: metrics.validationComplete ? 'Dados prontos' : 'A aguardar validação',
    },
  ];
}

export function serviceAssignmentDays(event = {}) {
  const days = new Set();
  if (event.date) days.add(dateKey(event.date));
  if (event.endDate) {
    const start = new Date(dateKey(event.date));
    const end = new Date(dateKey(event.endDate));
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end >= start) {
      const cursor = new Date(start);
      while (cursor <= end) {
        days.add(localDateKey(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
    }
  }
  for (const assignment of event.assignments || []) {
    const key = assignmentWorkDate(assignment, event);
    if (key) days.add(key);
  }
  return [...days].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

export function resolveSelectedTeamDay({ isContinuous = false, days = [], selectedDay = '' } = {}) {
  if (!isContinuous || !days.length) return '';
  if (selectedDay && days.includes(selectedDay)) return selectedDay;
  return days[0] || '';
}

export function groupAssignmentsByRole(assignments = [], event = {}, selectedDate = '') {
  const groups = new Map();
  for (const assignment of assignments) {
    if (selectedDate && assignmentWorkDate(assignment, event) !== selectedDate) continue;
    const role = assignment.role || MANUAL_TEAM_ROLE;
    if (!groups.has(role)) groups.set(role, []);
    groups.get(role).push(assignment);
  }

  return [...groups.entries()]
    .map(([role, rows]) => ({
      role,
      rows,
    }))
    .sort((a, b) => a.role.localeCompare(b.role, 'pt'));
}

function numberValue(value) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowDateKeyForRequirement(event = {}, required = {}) {
  return event.isContinuous ? dateKey(required.day || event.date) : '';
}

function rowDateMatchesRequirement(row = {}, event = {}, required = {}) {
  const expectedDate = rowDateKeyForRequirement(event, required);
  const rowDate = event.isContinuous ? dateKey(row.assignmentDate) : '';
  return row.role === required.role && rowDate === expectedDate;
}

function editableRowFromAssignment(assignment = {}) {
  return {
    ...assignment,
    rowKey: assignment.id ? `assignment-${assignment.id}` : `assignment-new-${Math.random().toString(36).slice(2)}`,
    collaboratorId: assignment.collaboratorId ? String(assignment.collaboratorId) : '',
    assignmentDate: dateKey(assignment.assignmentDate),
    plannedCheckIn: assignment.plannedCheckIn || '',
    plannedCheckOut: assignment.plannedCheckOut || '',
    hourlyRate: assignment.hourlyRate ?? '',
    status: assignment.status || 'pending_confirmation',
    clientSynced: Boolean(assignment.clientSynced),
    isDriver: Boolean(assignment.isDriver),
    isDraft: false,
  };
}

function editableRowFromDraft(draft = {}) {
  return {
    ...draft,
    id: '',
    rowKey: draft.draftId ? `draft-${draft.draftId}` : `draft-${Math.random().toString(36).slice(2)}`,
    collaboratorId: '',
    assignmentDate: dateKey(draft.assignmentDate),
    plannedCheckIn: draft.plannedCheckIn || '',
    plannedCheckOut: draft.plannedCheckOut || '',
    hourlyRate: draft.hourlyRate || '',
    status: draft.status || 'pending_confirmation',
    clientSynced: Boolean(draft.clientSynced),
    isDriver: Boolean(draft.isDriver),
    isDraft: true,
  };
}

function emptyEditableTeamRow(event = {}, required = {}, index = 0) {
  return {
    rowKey: `required-${required.role}-${rowDateKeyForRequirement(event, required) || 'single'}-${index}`,
    role: required.role,
    collaboratorId: '',
    assignmentDate: rowDateKeyForRequirement(event, required),
    plannedCheckIn: required.start || event.startTime || '',
    plannedCheckOut: required.end || event.endTime || '',
    hourlyRate: '',
    status: 'pending_confirmation',
    clientSynced: false,
    isDriver: false,
    isDraft: true,
  };
}

export function createManualTeamRow(event = {}, { role = MANUAL_TEAM_ROLE, selectedDay = '', rowKey = '' } = {}) {
  const normalizedRole = role || MANUAL_TEAM_ROLE;
  const assignmentDate = event.isContinuous ? dateKey(selectedDay || event.date) : '';
  return {
    rowKey: rowKey || `manual-${normalizedRole}-${assignmentDate || 'single'}-${Date.now()}`,
    role: normalizedRole,
    collaboratorId: '',
    assignmentDate,
    plannedCheckIn: event.startTime || '',
    plannedCheckOut: event.endTime || '',
    hourlyRate: '',
    status: 'pending_confirmation',
    clientSynced: false,
    isDriver: false,
    isDraft: true,
  };
}

export function buildEditableTeamRows(event = {}) {
  const rows = [
    ...(event.assignments || []).map(editableRowFromAssignment),
    ...normalizeAssignmentDrafts(event.assignmentDrafts).map(editableRowFromDraft),
  ];

  for (const required of safeJsonArray(event.requiredRoles)) {
    if (!required.role) continue;
    const target = Math.max(0, Number(required.qty || 0));
    const existing = rows.filter((row) => rowDateMatchesRequirement(row, event, required)).length;
    for (let index = existing; index < target; index += 1) {
      rows.push(emptyEditableTeamRow(event, required, index));
    }
  }

  return rows;
}

export function editableTeamRowsToAssignmentPayloads(rows = [], event = {}) {
  return rows
    .filter((row) => row.role && row.collaboratorId)
    .map((row) => {
      const payload = {
        eventId: Number(event.id),
        collaboratorId: Number(row.collaboratorId),
        assignmentDate: dateKey(row.assignmentDate) || null,
        role: row.role,
        plannedCheckIn: row.plannedCheckIn || null,
        plannedCheckOut: row.plannedCheckOut || null,
        hourlyRate: numberValue(row.hourlyRate),
        status: row.status || 'pending_confirmation',
        clientSynced: Boolean(row.clientSynced),
        isDriver: Boolean(row.isDriver),
      };
      if (row.id) payload.id = row.id;
      return payload;
    });
}

export function editableTeamRowsToAssignmentDrafts(rows = []) {
  return normalizeAssignmentDrafts(rows
    .filter((row) => row.role && !row.collaboratorId)
    .map((row) => ({
      draftId: row.rowKey,
      role: row.role,
      assignmentDate: dateKey(row.assignmentDate),
      plannedCheckIn: row.plannedCheckIn || '',
      plannedCheckOut: row.plannedCheckOut || '',
      hourlyRate: row.hourlyRate || '',
      status: row.status || 'pending_confirmation',
      clientSynced: Boolean(row.clientSynced),
      isDriver: Boolean(row.isDriver),
      validationNotes: row.validationNotes || '',
    })));
}
