import test from 'node:test';
import assert from 'node:assert/strict';
import { applyExternalCostChange, externalCostRowsForEditing, validateExternalCostDraft } from './externalCostEditing.js';
import { externalCostsTotals, normalizeExternalCosts } from './externalCosts.js';

const cost = (patch = {}) => ({ id: 'partner-1', type: 'Catering', supplier: 'Parceiro A', description: 'Servico principal',
  costAmount: 500, marginPercent: 20, vatType: 'standard_23', status: 'pending', ...patch });

test('external editing uses existing markup and independent VAT formulas, never sale-price margin', () => {
  const calculated = validateExternalCostDraft(cost());
  assert.equal(calculated.marginAmount, 100); assert.equal(calculated.chargeAmount, 600);
  assert.equal(calculated.taxAmount, 138); assert.equal(calculated.grossAmount, 738);
  const catering = validateExternalCostDraft(cost({ vatType: 'catering' }));
  assert.equal(catering.taxAmount, 87); assert.equal(catering.grossAmount, 687);
  assert.equal(validateExternalCostDraft(cost({ vatType: 'exempt' })).grossAmount, 600);
});

test('adding retains every old row and stable ID; repeated add is idempotent', () => {
  const original = normalizeExternalCosts([cost()]);
  const draft = cost({ id: 'partner-2', supplier: 'Parceiro B', costAmount: 150 });
  const result = applyExternalCostChange(JSON.stringify(original), draft);
  assert.deepEqual(result.rows[0], original[0]); assert.equal(result.rows.length, 2);
  assert.equal(externalCostsTotals(result.rows).costAmount, 650);
  assert.equal(externalCostsTotals(result.rows).grossAmount, 959.4);
  assert.equal(applyExternalCostChange(result.rows, draft).unchanged, true);
  assert.throws(() => applyExternalCostChange(result.rows, { ...draft, costAmount: 999 }), { statusCode: 409 });
});

test('editing one partner preserves other records, settlement status and legacy metadata', () => {
  const original = [cost({ status: 'paid', customLegacyField: 'keep' }), cost({ id: 'partner-2', supplier: 'B', vatType: 'exempt' })];
  const snapshot = structuredClone(original);
  const edited = applyExternalCostChange(original, { ...cost(), costAmount: 600, marginPercent: 25, status: 'pending' }, { costId: 'partner-1' });
  assert.deepEqual(edited.rows[1], original[1]); assert.equal(edited.rows[0].id, 'partner-1');
  assert.equal(edited.rows[0].status, 'paid'); assert.equal(edited.rows[0].customLegacyField, 'keep');
  assert.equal(edited.rows[0].chargeAmount, 750); assert.deepEqual(original, snapshot);
  assert.throws(() => applyExternalCostChange(original, cost({ id: 'partner-2' }), { costId: 'partner-1' }), { statusCode: 422 });
  assert.throws(() => applyExternalCostChange(original, cost({ id: 'missing' }), { costId: 'missing' }), { statusCode: 404 });
});

test('legacy IDs are stable; malformed/duplicate data is never silently replaced', () => {
  const legacy = [{ type: 'Catering', supplier: 'A', costAmount: 100 }, { id: 'custom', supplier: 'B', type: 'DJ', costAmount: 50 }];
  const rows = externalCostRowsForEditing(JSON.stringify(legacy));
  assert.equal(rows[0].id, 'external-1'); assert.equal(rows[1].id, 'custom');
  assert.equal(externalCostRowsForEditing([{ ...legacy[0], id: '   ' }])[0].id, 'external-1');
  assert.deepEqual(legacy[0], { type: 'Catering', supplier: 'A', costAmount: 100 });
  for (const value of ['broken', '{}', '[null]', [{ id: 'same' }, { id: 'same' }]]) {
    assert.throws(() => externalCostRowsForEditing(value));
  }
});

test('external draft validation rejects missing/invalid fields but retains supported zero costs and precise margins', () => {
  for (const patch of [{ type: '' }, { supplier: '', description: '' }, { costAmount: '' }, { costAmount: -1 },
    { costAmount: 'abc' }, { marginPercent: -1 }, { marginPercent: 'abc' }, { vatType: 'new-tax' },
    { costAmount: 1e308, marginPercent: 1e308 }]) {
    assert.throws(() => validateExternalCostDraft(cost(patch)), { statusCode: 422 });
  }
  assert.equal(validateExternalCostDraft(cost({ costAmount: 0 })).costAmount, 0);
  assert.equal(validateExternalCostDraft(cost({ costAmount: '150,00', marginPercent: '5.0921' })).marginPercent, 5.0921);
  assert.equal(validateExternalCostDraft(cost({ marginAmount: 99999, chargeAmount: 99999, taxAmount: 99999 })).grossAmount, 738);
});
