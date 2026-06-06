import assert from 'node:assert/strict';
import { test } from 'node:test';
import { staffPaymentTotal } from './staffPayment.js';

test('adds a positive decimal adjustment to the staff payment', () => {
  assert.equal(staffPaymentTotal(80, false, '+2,50€'), 82.5);
});

test('subtracts a negative decimal adjustment from the staff payment', () => {
  assert.equal(staffPaymentTotal(80, false, '-2,43€'), 77.57);
});

test('applies the adjustment after collaborator VAT', () => {
  assert.equal(staffPaymentTotal(100, true, '-2,43'), 120.57);
});

test('does not allow an adjustment to produce a negative payment', () => {
  assert.equal(staffPaymentTotal(10, false, '-20,00'), 0);
});
