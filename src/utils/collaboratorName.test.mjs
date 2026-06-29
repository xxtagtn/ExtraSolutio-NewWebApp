import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeShortName } from './collaboratorName.js';

test('builds the collaborator short name from first, second and last name', () => {
  assert.equal(computeShortName('Josane Maria da Silva Santos'), 'Josane Maria Santos');
});

test('keeps one or two names as the short name', () => {
  assert.equal(computeShortName('Josane'), 'Josane');
  assert.equal(computeShortName('Josane Maria'), 'Josane Maria');
});

