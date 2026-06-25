import assert from 'node:assert/strict';
import { test } from 'node:test';
import { documentExpiryAlert } from './documentExpiry.js';

const TODAY = new Date(2026, 5, 18, 12, 0, 0);

test('hides the document indicator when expiry is more than 30 days away', () => {
  assert.equal(documentExpiryAlert('2026-07-19', TODAY), null);
});

test('shows an orange document indicator from 30 days until expiry', () => {
  assert.deepEqual(documentExpiryAlert('2026-07-18', TODAY), {
    tone: 'orange',
    days: 30,
    label: 'Documento expira em 30 dias',
  });
});

test('shows an orange document indicator when the document expires today', () => {
  assert.deepEqual(documentExpiryAlert('2026-06-18', TODAY), {
    tone: 'orange',
    days: 0,
    label: 'Documento expira em 0 dias',
  });
});

test('shows a red document indicator after expiry', () => {
  assert.deepEqual(documentExpiryAlert('2026-06-15', TODAY), {
    tone: 'red',
    days: -3,
    label: 'Documento expirado há 3 dias',
  });
});

test('ignores missing and invalid document expiry dates', () => {
  assert.equal(documentExpiryAlert('', TODAY), null);
  assert.equal(documentExpiryAlert('data-inválida', TODAY), null);
});
