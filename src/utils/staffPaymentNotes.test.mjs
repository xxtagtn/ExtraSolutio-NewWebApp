import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasPaymentNotes, normalizePaymentNotes } from './staffPaymentNotes.js';

test('treats whitespace-only payment notes as empty', () => {
  assert.equal(hasPaymentNotes('   \n  '), false);
  assert.equal(normalizePaymentNotes('   \n  '), null);
});

test('preserves multiple lines while trimming surrounding whitespace', () => {
  assert.equal(hasPaymentNotes(' Primeira linha\nSegunda linha '), true);
  assert.equal(normalizePaymentNotes(' Primeira linha\nSegunda linha '), 'Primeira linha\nSegunda linha');
});
