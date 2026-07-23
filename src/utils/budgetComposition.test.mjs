import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  hasBudgetExternalCosts,
  hasBudgetStaff,
  isBudgetCompositionValid,
} from './budgetComposition.js';

test('accepts a budget composed only of a valid external partner cost', () => {
  assert.equal(isBudgetCompositionValid({
    categories: [],
    externalCosts: [{ type: 'Material', costAmount: '790,00', marginPercent: 20 }],
  }), true);
});

test('accepts the existing staff workflow without external costs', () => {
  assert.equal(hasBudgetStaff([{ role: 'Emp.Mesa', qty: 1 }]), true);
  assert.equal(isBudgetCompositionValid({
    categories: [{ role: 'Emp.Mesa', qty: 1 }],
    externalCosts: [],
  }), true);
});

test('does not count empty staff rows or external costs without a value', () => {
  assert.equal(hasBudgetStaff([{ role: '', qty: 1 }]), false);
  assert.equal(hasBudgetExternalCosts([{ type: 'Material', costAmount: 0 }]), false);
  assert.equal(isBudgetCompositionValid({
    categories: [{ role: '', qty: 1 }],
    externalCosts: [{ type: 'Material', costAmount: 0 }],
  }), false);
});

test('supports serialized budget composition received by the API', () => {
  assert.equal(isBudgetCompositionValid({
    categories: '[]',
    externalCosts: JSON.stringify([{ type: 'Catering', costAmount: 100 }]),
  }), true);
});
