import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EXTERNAL_COST_TYPE_OPTIONS,
  createEmptyExternalCost,
  externalCostVatBreakdown,
  normalizeExternalCosts,
} from './externalCosts.js';

test('provides the same external partner options to budgets and events', () => {
  assert.deepEqual(EXTERNAL_COST_TYPE_OPTIONS, [
    'Catering',
    'Bebidas',
    'Material',
    'Aluguer',
    'Transporte',
    'Outro',
  ]);
  assert.deepEqual(createEmptyExternalCost(), {
    type: '',
    supplier: '',
    description: '',
    costAmount: '',
    marginPercent: 0,
    vatType: 'standard_23',
  });
});

test('preserves high precision margin percentages for external partner costs', () => {
  const [cost] = normalizeExternalCosts([
    {
      type: 'Catering',
      supplier: 'Parceiro A',
      costAmount: '100,00',
      marginPercent: '5.0921',
    },
  ]);

  assert.equal(cost.marginPercent, 5.0921);
  assert.equal(cost.marginAmount, 5.09);
  assert.equal(cost.chargeAmount, 105.09);
});

test('calculates standard external VAT independently from the budget VAT mode', () => {
  const vat = externalCostVatBreakdown(100, 'standard_23');

  assert.equal(vat.vat23Base, 100);
  assert.equal(vat.vat23Amount, 23);
  assert.equal(vat.taxAmount, 23);
  assert.equal(vat.grossAmount, 123);
});

test('splits catering external VAT into 85% at 13% and 15% at 23%', () => {
  const vat = externalCostVatBreakdown(120, 'catering');

  assert.equal(vat.vat13Base, 102);
  assert.equal(vat.vat13Amount, 13.26);
  assert.equal(vat.vat23Base, 18);
  assert.equal(vat.vat23Amount, 4.14);
  assert.equal(vat.taxAmount, 17.4);
  assert.equal(vat.grossAmount, 137.4);
});

test('normalizes legacy external costs with the independent 23% VAT default', () => {
  const [cost] = normalizeExternalCosts([{ type: 'Bebidas', costAmount: 100 }]);

  assert.equal(cost.vatType, 'standard_23');
  assert.equal(cost.taxAmount, 23);
});
