import test from 'node:test';
import assert from 'node:assert/strict';

import { durationHours } from './formatters.js';

test('formats decimal hours as hours and minutes', () => {
  assert.equal(durationHours(4.5), '4:30h');
  assert.equal(durationHours(4), '4:00h');
  assert.equal(durationHours(0), '0:00h');
});

test('rounds decimal hours to the nearest minute for display', () => {
  assert.equal(durationHours(4.47), '4:28h');
  assert.equal(durationHours('3,75'), '3:45h');
});
