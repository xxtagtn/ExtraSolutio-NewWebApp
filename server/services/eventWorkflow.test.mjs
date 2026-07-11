import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deriveEventWorkflowStatus,
  EVENT_WORKFLOW_MODE,
  isEventWorkflowManual,
} from './eventWorkflow.js';

test('keeps a manually selected operational status unchanged', () => {
  const event = {
    status: 'team_complete',
    statusMode: EVENT_WORKFLOW_MODE.manual,
    date: '2026-06-10',
    assignments: [],
  };

  assert.equal(isEventWorkflowManual(event), true);
  assert.equal(deriveEventWorkflowStatus(event, new Date('2026-06-11T09:00:00')), 'team_complete');
});

test('uses the automatic service lifecycle for events without a manual override', () => {
  assert.equal(deriveEventWorkflowStatus({
    status: 'team_complete',
    statusMode: EVENT_WORKFLOW_MODE.automatic,
    date: '2026-06-10',
    assignments: [
      { status: 'confirmed' },
    ],
  }, new Date('2026-06-11T09:00:00')), 'to_validate_staff');
});

test('moves to client validation only after staff validation is accepted', () => {
  assert.equal(deriveEventWorkflowStatus({
    status: 'to_validate_staff',
    statusMode: EVENT_WORKFLOW_MODE.automatic,
    date: '2026-06-10',
    assignments: [
      {
        status: 'confirmed',
        checkIn: '09:00',
        checkOut: '17:00',
        validationStatus: 'staff_accepted',
      },
    ],
  }), 'to_validate_client');
});

test('planned times alone do not advance the workflow', () => {
  assert.equal(deriveEventWorkflowStatus({
    status: 'to_validate_staff',
    statusMode: EVENT_WORKFLOW_MODE.automatic,
    date: '2026-06-10',
    assignments: [
      {
        status: 'confirmed',
        plannedCheckIn: '09:00',
        plannedCheckOut: '17:00',
      },
    ],
  }), 'to_validate_staff');
});
