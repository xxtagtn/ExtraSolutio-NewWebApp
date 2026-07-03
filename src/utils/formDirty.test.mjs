import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formHasChanges, normalizeForDirtyCheck } from './formDirty.js';

test('normalizes object key order before comparing forms', () => {
  const first = { name: 'Ana', roles: ['Barman', 'Emp.Mesa'], meta: { b: 2, a: 1 } };
  const second = { meta: { a: 1, b: 2 }, roles: ['Barman', 'Emp.Mesa'], name: 'Ana' };

  assert.equal(normalizeForDirtyCheck(first), normalizeForDirtyCheck(second));
  assert.equal(formHasChanges(first, second), false);
});

test('detects real changes in nested form data', () => {
  const original = { name: 'Evento', assignments: [{ id: 1, status: 'pending_confirmation' }] };
  const current = { name: 'Evento', assignments: [{ id: 1, status: 'confirmed' }] };

  assert.equal(formHasChanges(original, current), true);
});

test('treats equivalent dates as unchanged after slicing to input values', () => {
  const original = { date: '2026-07-02', name: 'Evento' };
  const current = { name: 'Evento', date: '2026-07-02' };

  assert.equal(formHasChanges(original, current), false);
});
