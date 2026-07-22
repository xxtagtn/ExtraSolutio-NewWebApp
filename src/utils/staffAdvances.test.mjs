import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeStaffAdvances,
  staffAdvancesTotal,
  staffCarAdvancesTotal,
  staffPaymentRemaining,
} from './staffAdvances.js';

test('normalizes multiple staff advances with decimal amounts, notes and car flag', () => {
  const advances = normalizeStaffAdvances([
    { id: 'a1', date: '2026-06-10', amount: '12,50€', note: 'Deslocação' },
    { id: 'a2', date: '2026-06-11', amount: '5.25', note: 'Alimentação', car: true },
  ]);

  assert.deepEqual(advances, [
    { id: 'a1', date: '2026-06-10', amount: 12.5, note: 'Deslocação', car: false },
    { id: 'a2', date: '2026-06-11', amount: 5.25, note: 'Alimentação', car: true },
  ]);
});

test('separates salary advances from car payments', () => {
  const advances = normalizeStaffAdvances([
    { amount: '', note: 'Sem valor' },
    { amount: '-1', note: 'Inválido' },
    { amount: '10,00', note: 'Táxi' },
    { amount: '6,00', note: 'Carro', car: true },
  ]);

  assert.equal(staffAdvancesTotal(advances), 10);
  assert.equal(staffCarAdvancesTotal(advances), 6);
});

test('subtracts salary advances and adds car payments to the amount still payable', () => {
  assert.equal(staffPaymentRemaining(80, [{ amount: 12.5 }, { amount: '7,50' }, { amount: 10, car: true }]), 70);
  assert.equal(staffPaymentRemaining(10, [{ amount: 20 }, { amount: 15, car: true }]), 15);
});
