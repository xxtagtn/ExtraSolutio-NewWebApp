import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TIME_VALIDATION_STAGE,
  compareTimeValidationRowsNewest,
  clientTimeCorrection,
  preserveStageAfterManualRowSave,
  persistedWorkflowAssignment,
  prunePersistedDrafts,
  recentOperationalPeriod,
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
  })), TIME_VALIDATION_STAGE.clientPending);
  assert.equal(validationWorkflowStage(row({
    checkIn: '09:00',
    checkOut: '17:00',
    clientCheckIn: '09:30',
    clientCheckOut: '18:00',
  }, { isDifference: true })), TIME_VALIDATION_STAGE.differences);
  assert.equal(validationWorkflowStage(row({
    checkIn: '09:00',
    checkOut: '17:00',
    clientCheckIn: '09:00',
    clientCheckOut: '17:00',
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
    staff_pending: 1,
    client_pending: 1,
    differences: 1,
    ready: 1,
    finalized: 1,
  });
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
    2: { checkIn: '10:00', _persisted: false },
  }), {
    2: { checkIn: '10:00', _persisted: false },
  });
});

test('builds the last seven days period ending today', () => {
  assert.deepEqual(recentOperationalPeriod(new Date(2026, 5, 22, 12, 0, 0)), {
    start: '2026-06-16',
    end: '2026-06-22',
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
