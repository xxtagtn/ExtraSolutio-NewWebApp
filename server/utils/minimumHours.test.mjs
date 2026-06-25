import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  minimumHoursForEventUpdate,
  shouldPropagateMinimumHours,
} from './minimumHours.js';

test('uses the current client minimum for an open event', () => {
  assert.equal(minimumHoursForEventUpdate({ status: 'to_validate_staff', minimumHoursSnapshot: 4 }, 5), 5);
});

test('preserves the stored minimum for a finalized event', () => {
  assert.equal(minimumHoursForEventUpdate({ status: 'finalized', minimumHoursSnapshot: 4 }, 6), 4);
});

test('propagates client minimum changes only when the value changed', () => {
  assert.equal(shouldPropagateMinimumHours({ minimumHours: 4 }, { minimumHours: 5 }), true);
  assert.equal(shouldPropagateMinimumHours({ minimumHours: 5 }, { minimumHours: 5 }), false);
});
