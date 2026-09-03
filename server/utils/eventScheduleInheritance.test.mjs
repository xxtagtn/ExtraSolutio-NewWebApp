import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inheritedAssignmentScheduleChanges } from './eventScheduleInheritance.js';

test('returns only event schedule fields that actually changed', () => {
  assert.deepEqual(inheritedAssignmentScheduleChanges({
    startTime: '12:00',
    endTime: '18:00',
  }, {
    startTime: '13:00',
    endTime: '18:00',
  }), [{ field: 'plannedCheckIn', previous: '12:00', next: '13:00' }]);
});
