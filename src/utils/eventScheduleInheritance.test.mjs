import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyInheritedEventScheduleChange } from './eventScheduleInheritance.js';

test('updates inherited assignment and role times with the event schedule', () => {
  const next = applyInheritedEventScheduleChange({
    startTime: '12:00',
    assignments: [{ plannedCheckIn: '12:00' }, { plannedCheckIn: '' }],
    requiredRoles: [{ role: 'Emp.Mesa', start: '12:00' }],
  }, 'startTime', '13:00');

  assert.deepEqual(next.assignments.map((item) => item.plannedCheckIn), ['13:00', '13:00']);
  assert.equal(next.requiredRoles[0].start, '13:00');
});

test('preserves assignment and role times that were manually overridden', () => {
  const next = applyInheritedEventScheduleChange({
    endTime: '18:00',
    assignments: [{ plannedCheckOut: '17:30' }],
    requiredRoles: [{ role: 'Barman', end: '19:00' }],
  }, 'endTime', '20:00');

  assert.equal(next.assignments[0].plannedCheckOut, '17:30');
  assert.equal(next.requiredRoles[0].end, '19:00');
});
