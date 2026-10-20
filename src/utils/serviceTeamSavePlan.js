import { decimalValue } from './serviceFinance.js';
import { assignmentWorkDate, buildEditableTeamRows, editableTeamRowsToAssignmentDrafts, editableTeamRowsToAssignmentPayloads, normalizeDailyRoleRequirements } from './serviceDetail.js';
import { isEventDayCancelled } from './eventCancelledDays.js';

const numericFields = new Set(['eventId', 'collaboratorId', 'workLocationId', 'hourlyRate', 'totalPay',
  'hoursWorked', 'clientRealHours', 'clientBillableHours', 'staffPayableHours']);
const booleanFields = new Set(['clientSynced', 'isDriver']);

function comparable(field, value) {
  if (numericFields.has(field)) return decimalValue(value) || 0;
  if (booleanFields.has(field)) return value === true || value === 1 || value === 'true' || value === '1';
  if (field === 'assignmentDate') return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
  if (field === 'advancePayments') {
    if (typeof value === 'string') {
      try { return JSON.stringify(JSON.parse(value)); } catch { return value; }
    }
    return JSON.stringify(value || []);
  }
  return String(value ?? '');
}

export function assignmentUpdateChanges(payload, existing = {}) {
  return Object.fromEntries(Object.entries(payload).filter(([field, value]) => field !== 'id'
    && comparable(field, value) !== comparable(field, existing[field])));
}

export function buildServiceTeamSavePlan(service, rows, roles) {
  const originalRoles = normalizeDailyRoleRequirements(service);
  const originalRows = buildEditableTeamRows({ ...service, requiredRoles: originalRoles });
  const originals = new Map(editableTeamRowsToAssignmentPayloads(originalRows, service).map(row => [Number(row.id), row]));
  const payloads = editableTeamRowsToAssignmentPayloads(rows, service)
    .filter(row => !isEventDayCancelled(service, assignmentWorkDate(row, service)));
  const keptIds = new Set(payloads.filter(row => row.id).map(row => Number(row.id)));
  const removedIds = (service.assignments || []).filter(row => !keptIds.has(Number(row.id))
    && !isEventDayCancelled(service, assignmentWorkDate(row, service))).map(row => row.id);
  const creates = payloads.filter(row => !row.id);
  const updates = payloads.filter(row => row.id).map(row => ({ id: row.id, data: assignmentUpdateChanges(row, originals.get(Number(row.id))) }))
    .filter(row => Object.keys(row.data).length);
  const drafts = editableTeamRowsToAssignmentDrafts(rows);
  const servicePatch = {};
  if (JSON.stringify(roles) !== JSON.stringify(originalRoles)) servicePatch.requiredRoles = roles;
  if (JSON.stringify(drafts) !== JSON.stringify(editableTeamRowsToAssignmentDrafts(originalRows))) servicePatch.assignmentDrafts = drafts;
  return { creates, updates, removedIds, servicePatch,
    changed: Boolean(creates.length || updates.length || removedIds.length || Object.keys(servicePatch).length) };
}
