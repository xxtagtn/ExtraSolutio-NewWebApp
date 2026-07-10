import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSameApiData } from './apiDataEquality.js';

test('treats equivalent API payloads as unchanged even with new references', () => {
  const previous = [{ id: 1, name: 'Evento', assignments: [{ id: 10, status: 'confirmed' }] }];
  const next = JSON.parse(JSON.stringify(previous));

  assert.equal(isSameApiData(previous, next), true);
});

test('detects real changes in nested API payloads', () => {
  const previous = [{ id: 1, name: 'Evento', assignments: [{ id: 10, status: 'confirmed' }] }];
  const next = [{ id: 1, name: 'Evento', assignments: [{ id: 10, status: 'pending' }] }];

  assert.equal(isSameApiData(previous, next), false);
});
