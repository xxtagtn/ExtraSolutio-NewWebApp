import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAFF_ACCEPTED_VALIDATION_STATUS } from './hourValidationStatus.js';
import {
  TIME_VALIDATION_STAGE,
  compareTimeValidationRowsNewest,
  clientTimeCorrection,
  currentMonthPeriod,
  currentWeekPeriod,
  previousMonthPeriod,
  reopenTargetStage,
  preserveStageAfterManualRowSave,
  persistedWorkflowAssignment,
  prunePersistedDrafts,
  recentOperationalPeriod,
  rowMatchesValidationStage,
  rowsForValidationStage,
  validationDisplayStageCounts,
  validationEventWorkflowSummary,
  validationStageCounts,
  validationWorkflowStage,
} from './timeValidationWorkflow.js';

function row(assignment = {}, overrides = {}) {
  return {
    id: overrides.id || 1,
    event: {
      name: overrides.eventName || 'Evento',
      date: overrides.date || '2026-06-20',
    },
    assignment: {
      validationStatus: 'pending',
      ...assignment,
    },
    eventValidated: Boolean(overrides.eventValidated),
    isDifference: Boolean(overrides.isDifference),
    collaboratorName: overrides.collaboratorName || 'Ana',
  };
}

test('classifies time validation rows by operational stage', () => {
  assert.equal(validationWorkflowStage(row()), TIME_VALIDATION_STAGE.staffPending);
  assert.equal(validationWorkflowStage(row({
    checkIn: '09:00',
    checkOut: '17:00',
  })), TIME_VALIDATION_STAGE.staffPending);
  assert.equal(validationWorkflowStage(row({
    checkIn: '09:00',
    checkOut: '17:00',
    validationStatus: STAFF_ACCEPTED_VALIDATION_STATUS,
  })), TIME_VALIDATION_STAGE.clientPending);
  assert.equal(validationWorkflowStage(row({
    checkIn: '09:00',
    checkOut: '17:00',
    clientCheckIn: '09:30',
    clientCheckOut: '18:00',
  }, { isDifference: true })), TIME_VALIDATION_STAGE.clientPending);
  assert.equal(validationWorkflowStage(row({
    checkIn: '09:00',
    checkOut: '17:00',
    clientCheckIn: '09:00',
    clientCheckOut: '17:00',
  })), TIME_VALIDATION_STAGE.clientPending);
  assert.equal(validationWorkflowStage(row({
    checkIn: '09:00',
    checkOut: '17:00',
    clientCheckIn: '09:00',
    clientCheckOut: '17:00',
    validationStatus: 'validated',
  })), TIME_VALIDATION_STAGE.ready);
  assert.equal(validationWorkflowStage(row({}, {
    eventValidated: true,
  })), TIME_VALIDATION_STAGE.finalized);
});

test('keeps an accepted divergent row in the ready stage', () => {
  assert.equal(validationWorkflowStage(row({
    checkIn: '09:00',
    checkOut: '17:00',
    clientCheckIn: '10:00',
    clientCheckOut: '18:00',
    validationStatus: 'validated',
  }, { isDifference: true })), TIME_VALIDATION_STAGE.ready);
});

test('keeps a previously matched staff row waiting for client if client times are cleared', () => {
  assert.equal(validationWorkflowStage(row({
    checkIn: '09:00',
    checkOut: '17:00',
    validationStatus: 'matched',
  })), TIME_VALIDATION_STAGE.clientPending);
});

test('keeps the current tab after manually saving or accepting a row', () => {
  const savedReadyRow = row({
    checkIn: '09:00',
    checkOut: '17:00',
    clientCheckIn: '09:00',
    clientCheckOut: '17:00',
    validationStatus: 'validated',
  });

  assert.equal(
    preserveStageAfterManualRowSave(TIME_VALIDATION_STAGE.clientPending, savedReadyRow),
    TIME_VALIDATION_STAGE.clientPending,
  );
});

test('shows ready rows inside the client pending validation tab', () => {
  const readyRow = row({
    checkIn: '09:00',
    checkOut: '17:00',
    clientCheckIn: '09:00',
    clientCheckOut: '17:00',
    validationStatus: 'validated',
  });
  readyRow.workflowStage = TIME_VALIDATION_STAGE.ready;

  assert.equal(rowMatchesValidationStage(readyRow.workflowStage, TIME_VALIDATION_STAGE.clientPending), true);
  assert.equal(rowMatchesValidationStage(readyRow.workflowStage, TIME_VALIDATION_STAGE.staffPending), false);
  assert.deepEqual(validationDisplayStageCounts([readyRow]), {
    staff_pending: 0,
    client_pending: 1,
    differences: 0,
    ready: 0,
    finalized: 0,
  });
});

test('keeps secondary validation filters scoped to the selected stage', () => {
  const staffRow = row({}, { id: 1 });
  const clientRow = row({
    checkIn: '09:00',
    checkOut: '17:00',
    validationStatus: STAFF_ACCEPTED_VALIDATION_STATUS,
  }, { id: 2 });
  const finalizedRow = row({}, { id: 3, eventValidated: true });

  assert.deepEqual(
    rowsForValidationStage([staffRow, clientRow, finalizedRow], TIME_VALIDATION_STAGE.staffPending)
      .map((item) => item.id),
    [1],
  );
  assert.deepEqual(
    rowsForValidationStage([staffRow, clientRow, finalizedRow], TIME_VALIDATION_STAGE.clientPending)
      .map((item) => item.id),
    [2],
  );
  assert.deepEqual(
    rowsForValidationStage([staffRow, clientRow, finalizedRow], TIME_VALIDATION_STAGE.finalized)
      .map((item) => item.id),
    [3],
  );
});

test('reopens finalized events into the stage that needs review', () => {
  assert.equal(reopenTargetStage([
    row({
      checkIn: '09:00',
      checkOut: '17:00',
      clientCheckIn: '09:00',
      clientCheckOut: '17:00',
    }),
  ]), TIME_VALIDATION_STAGE.clientPending);

  assert.equal(reopenTargetStage([
    row({
      checkIn: '09:00',
      checkOut: '17:00',
      clientCheckIn: '09:30',
      clientCheckOut: '17:00',
    }, { isDifference: true }),
  ]), TIME_VALIDATION_STAGE.clientPending);
});

test('reopens events with all rows accepted into the client pending tab', () => {
  assert.equal(reopenTargetStage([
    row({
      checkIn: '09:00',
      checkOut: '17:00',
      clientCheckIn: '09:00',
      clientCheckOut: '17:00',
      validationStatus: 'validated',
    }),
  ]), TIME_VALIDATION_STAGE.clientPending);
});

test('counts rows in each validation stage', () => {
  const rows = [
    row({}, { id: 1 }),
    row({ checkIn: '09:00', checkOut: '17:00' }, { id: 2 }),
    row({
      checkIn: '09:00',
      checkOut: '17:00',
      clientCheckIn: '09:30',
      clientCheckOut: '18:00',
    }, { id: 3, isDifference: true }),
    row({
      checkIn: '09:00',
      checkOut: '17:00',
      clientCheckIn: '09:00',
      clientCheckOut: '17:00',
    }, { id: 4 }),
    row({}, { id: 5, eventValidated: true }),
  ];

  assert.deepEqual(validationStageCounts(rows), {
    staff_pending: 2,
    client_pending: 2,
    differences: 0,
    ready: 0,
    finalized: 1,
  });
});

test('summarizes an event workflow by actionable validation stage', () => {
  const rows = [
    row({}, { id: 1 }),
    row({ checkIn: '09:00', checkOut: '17:00' }, { id: 2 }),
    row({
      checkIn: '09:00',
      checkOut: '17:00',
      clientCheckIn: '09:20',
      clientCheckOut: '17:00',
    }, { id: 3, isDifference: true }),
    row({
      checkIn: '09:00',
      checkOut: '17:00',
      clientCheckIn: '09:00',
      clientCheckOut: '17:00',
      validationStatus: 'validated',
    }, { id: 4 }),
    row({
      checkIn: '09:00',
      checkOut: '17:00',
      clientCheckIn: '09:00',
      clientCheckOut: '17:00',
    }, { id: 5, eventValidated: true }),
  ];

  const summary = validationEventWorkflowSummary(rows);

  assert.equal(summary.total, 5);
  assert.equal(summary.staffComplete, 4);
  assert.equal(summary.clientComplete, 3);
  assert.equal(summary.differences, 1);
  assert.equal(summary.validated, 1);
  assert.equal(summary.ready, false);
  assert.deepEqual(summary.stageCounts, {
    staff_pending: 2,
    client_pending: 1,
    differences: 0,
    ready: 1,
    finalized: 1,
  });
});

test('summarizes only billable rows when a filter is supplied', () => {
  const rows = [
    row({
      checkIn: '09:00',
      checkOut: '17:00',
      clientCheckIn: '09:00',
      clientCheckOut: '17:00',
      validationStatus: 'validated',
      status: 'confirmed',
    }, { id: 1 }),
    row({
      checkIn: '09:00',
      checkOut: '17:00',
      clientCheckIn: '09:00',
      clientCheckOut: '17:00',
      validationStatus: 'validated',
      status: 'cancelled',
    }, { id: 2 }),
  ];

  const summary = validationEventWorkflowSummary(rows, {
    includeRow: (item) => item.assignment.status !== 'cancelled',
  });

  assert.equal(summary.total, 1);
  assert.equal(summary.ready, true);
  assert.equal(summary.stageCounts.ready, 1);
});

test('does not mark an event as closable while ready rows are not accepted', () => {
  const rows = [
    row({
      checkIn: '09:00',
      checkOut: '17:00',
      clientCheckIn: '09:00',
      clientCheckOut: '17:00',
      validationStatus: 'matched',
    }, { id: 1 }),
  ];

  const summary = validationEventWorkflowSummary(rows);

  assert.equal(summary.stageCounts.client_pending, 1);
  assert.equal(summary.stageCounts.ready, 0);
  assert.equal(summary.ready, false);
});

test('counts the persisted workflow stage instead of unsaved draft values', () => {
  const staleDraftRow = row({
    checkIn: '09:00',
    checkOut: '17:00',
    clientCheckIn: '09:00',
    clientCheckOut: '17:00',
  });
  staleDraftRow.workflowStage = TIME_VALIDATION_STAGE.clientPending;

  assert.deepEqual(validationStageCounts([staleDraftRow]), {
    staff_pending: 0,
    client_pending: 1,
    differences: 0,
    ready: 0,
    finalized: 0,
  });
});

test('uses a saved draft for workflow and ignores an unsaved draft', () => {
  const assignment = {
    checkIn: '09:00',
    checkOut: '17:00',
    clientCheckIn: '09:00',
    clientCheckOut: '17:00',
  };

  assert.deepEqual(persistedWorkflowAssignment(assignment, {
    clientCheckIn: '',
    clientCheckOut: '',
    _persisted: false,
  }), assignment);

  assert.deepEqual(persistedWorkflowAssignment(assignment, {
    clientCheckIn: '',
    clientCheckOut: '',
    _persisted: true,
  }), {
    ...assignment,
    clientCheckIn: '',
    clientCheckOut: '',
  });
});

test('auto-saves an incomplete client correction after leaving the client fields', () => {
  assert.deepEqual(clientTimeCorrection({
    clientCheckIn: '09:00',
    clientCheckOut: '17:00',
  }, {
    clientCheckIn: '',
  }, false), {
    merged: {
      clientCheckIn: '',
      clientCheckOut: '17:00',
    },
    shouldPersist: true,
  });

  assert.equal(clientTimeCorrection({
    clientCheckIn: '',
    clientCheckOut: '17:00',
  }, {
    clientCheckOut: '',
  }, true).shouldPersist, false);
});

test('removes persisted drafts after fresh API data arrives', () => {
  assert.deepEqual(prunePersistedDrafts({
    1: { checkIn: '09:00', _persisted: true },
    2: { clientCheckIn: '10:00', _persisted: true },
    3: { checkIn: '11:00', _persisted: false },
  }, new Map([
    [1, { checkIn: '09:00' }],
    [2, { clientCheckIn: '' }],
    [3, { checkIn: '11:00' }],
  ])), {
    2: { clientCheckIn: '10:00', _persisted: true },
    3: { checkIn: '11:00', _persisted: false },
  });
});

test('keeps a persisted draft while the matching assignment is not loaded', () => {
  assert.deepEqual(prunePersistedDrafts({
    2: { clientCheckIn: '10:00', _persisted: true },
  }), {
    2: { clientCheckIn: '10:00', _persisted: true },
  });
});

test('builds the last seven days period ending today', () => {
  assert.deepEqual(recentOperationalPeriod(new Date(2026, 5, 22, 12, 0, 0)), {
    start: '2026-06-16',
    end: '2026-06-22',
  });
});

test('builds the last thirty days period ending today', () => {
  assert.deepEqual(recentOperationalPeriod(new Date(2026, 5, 22, 12, 0, 0), 30), {
    start: '2026-05-24',
    end: '2026-06-22',
  });
});

test('builds the current week period from monday to sunday', () => {
  assert.deepEqual(currentWeekPeriod(new Date(2026, 6, 3, 12, 0, 0)), {
    start: '2026-06-29',
    end: '2026-07-05',
  });

  assert.deepEqual(currentWeekPeriod(new Date(2026, 6, 5, 12, 0, 0)), {
    start: '2026-06-29',
    end: '2026-07-05',
  });
});

test('builds current and previous month periods', () => {
  assert.deepEqual(currentMonthPeriod(new Date(2026, 6, 3, 12, 0, 0)), {
    start: '2026-07-01',
    end: '2026-07-31',
  });

  assert.deepEqual(previousMonthPeriod(new Date(2026, 6, 3, 12, 0, 0)), {
    start: '2026-06-01',
    end: '2026-06-30',
  });

  assert.deepEqual(previousMonthPeriod(new Date(2026, 0, 10, 12, 0, 0)), {
    start: '2025-12-01',
    end: '2025-12-31',
  });
});

test('sorts validation rows from newest to oldest and then alphabetically', () => {
  const rows = [
    row({}, { id: 1, date: '2026-06-20', collaboratorName: 'Rui' }),
    row({}, { id: 2, date: '2026-06-22', collaboratorName: 'Marta' }),
    row({}, { id: 3, date: '2026-06-22', collaboratorName: 'Ana' }),
  ];

  assert.deepEqual([...rows].sort(compareTimeValidationRowsNewest).map((item) => item.id), [3, 2, 1]);
});
