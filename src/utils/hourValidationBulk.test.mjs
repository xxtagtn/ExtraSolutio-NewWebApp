import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBulkValidationCandidates } from './hourValidationBulk.js';

test('builds bulk validation candidates from unvalidated rows with available times', () => {
  const rows = [
    {
      id: 1,
      event: { startTime: '09:00', endTime: '17:00' },
      assignment: {
        id: 1,
        validationStatus: 'pending',
        checkIn: '09:10',
        checkOut: '17:05',
      },
    },
    {
      id: 2,
      event: { startTime: '10:00', endTime: '18:00' },
      assignment: {
        id: 2,
        validationStatus: 'validated',
        checkIn: '10:00',
        checkOut: '18:00',
      },
    },
    {
      id: 3,
      event: {},
      assignment: {
        id: 3,
        validationStatus: 'pending',
      },
    },
  ];

  const result = buildBulkValidationCandidates(rows, {
    1: { clientCheckIn: '09:15' },
  });

  assert.equal(result.ready.length, 1);
  assert.equal(result.missing.length, 1);
  assert.equal(result.ready[0].row.id, 1);
  assert.equal(result.ready[0].merged.validatedCheckIn, '09:15');
  assert.equal(result.ready[0].merged.validatedCheckOut, '17:05');
  assert.equal(result.missing[0].row.id, 3);
});
