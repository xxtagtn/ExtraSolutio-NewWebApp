import {
  compareTimeValidationRows,
  effectiveRowDateKey,
} from './timeValidationFilters.js';
import { hoursValidationState } from './hourValidationStatus.js';

export const TIME_VALIDATION_STAGE = Object.freeze({
  staffPending: 'staff_pending',
  clientPending: 'client_pending',
  differences: 'differences',
  ready: 'ready',
  finalized: 'finalized',
});

function hasTimePair(checkIn, checkOut) {
  return Boolean(checkIn && checkOut);
}

function localDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function validationWorkflowStage(row = {}) {
  if (row.eventValidated) return TIME_VALIDATION_STAGE.finalized;

  const assignment = row.assignment || {};
  const staffComplete = hasTimePair(assignment.checkIn, assignment.checkOut);
  if (!staffComplete) return TIME_VALIDATION_STAGE.staffPending;

  const clientComplete = hasTimePair(assignment.clientCheckIn, assignment.clientCheckOut);
  if (!clientComplete) return TIME_VALIDATION_STAGE.clientPending;

  if (assignment.validationStatus === 'validated') return TIME_VALIDATION_STAGE.ready;
  return TIME_VALIDATION_STAGE.clientPending;
}

export function preserveStageAfterManualRowSave(currentStage, savedRow = {}) {
  return currentStage || validationWorkflowStage(savedRow);
}

export function reopenTargetStage(rows = []) {
  const reopenedStages = rows.map((row) => {
    const assignment = row?.assignment || {};
    return validationWorkflowStage({
      ...row,
      eventValidated: false,
      assignment: {
        ...assignment,
        validationStatus: assignment.validationStatus === 'validated' ? 'reopened' : assignment.validationStatus,
      },
    });
  });

  if (reopenedStages.includes(TIME_VALIDATION_STAGE.staffPending)) return TIME_VALIDATION_STAGE.staffPending;
  if (reopenedStages.includes(TIME_VALIDATION_STAGE.clientPending)) return TIME_VALIDATION_STAGE.clientPending;
  return TIME_VALIDATION_STAGE.ready;
}

export function validationStageCounts(rows = []) {
  const counts = {
    [TIME_VALIDATION_STAGE.staffPending]: 0,
    [TIME_VALIDATION_STAGE.clientPending]: 0,
    [TIME_VALIDATION_STAGE.differences]: 0,
    [TIME_VALIDATION_STAGE.ready]: 0,
    [TIME_VALIDATION_STAGE.finalized]: 0,
  };

  for (const row of rows) {
    const stage = row?.workflowStage || validationWorkflowStage(row);
    counts[stage] += 1;
  }
  return counts;
}

export function validationEventWorkflowSummary(rows = [], options = {}) {
  const includeRow = typeof options.includeRow === 'function' ? options.includeRow : () => true;
  const countableRows = rows.filter((row) => includeRow(row));
  const stageCounts = validationStageCounts(countableRows);

  return {
    total: countableRows.length,
    validated: countableRows.filter((row) => hoursValidationState(row?.assignment).isValidated).length,
    staffComplete: countableRows.filter((row) => Boolean(row?.assignment?.checkIn && row?.assignment?.checkOut)).length,
    clientComplete: countableRows.filter((row) => Boolean(row?.assignment?.clientCheckIn && row?.assignment?.clientCheckOut)).length,
    differences: countableRows.filter((row) => row?.isDifference && !hoursValidationState(row?.assignment).isValidated).length,
    ready: countableRows.length > 0 && countableRows.every((row) => (
      hoursValidationState(row?.assignment).isValidated
      || (row?.workflowStage || validationWorkflowStage(row)) === TIME_VALIDATION_STAGE.finalized
    )),
    stageCounts,
  };
}

export function persistedWorkflowAssignment(assignment = {}, draft = {}) {
  if (!draft?._persisted) return assignment;
  const savedValues = { ...draft };
  delete savedValues._persisted;
  return {
    ...assignment,
    ...savedValues,
  };
}

export function clientTimeCorrection(assignment = {}, patch = {}, movingWithinClientFields = false) {
  const merged = {
    ...assignment,
    ...patch,
  };
  const clientComplete = Boolean(merged.clientCheckIn && merged.clientCheckOut);
  return {
    merged,
    shouldPersist: !movingWithinClientFields && !clientComplete,
  };
}

export function prunePersistedDrafts(drafts = {}) {
  return Object.fromEntries(
    Object.entries(drafts).filter(([, draft]) => !draft?._persisted),
  );
}

export function recentOperationalPeriod(value = new Date(), days = 7) {
  const end = new Date(value);
  const start = new Date(value);
  start.setDate(start.getDate() - Math.max(0, Number(days || 1) - 1));
  return {
    start: localDateKey(start),
    end: localDateKey(end),
  };
}

export function compareTimeValidationRowsNewest(a, b) {
  const byDate = String(effectiveRowDateKey(b) || '').localeCompare(String(effectiveRowDateKey(a) || ''));
  if (byDate) return byDate;
  return compareTimeValidationRows(a, b);
}
