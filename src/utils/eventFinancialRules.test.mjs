import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateFinancialMargin,
  clientRateForAssignment,
  eventFinancialWarnings,
} from './eventFinancialRules.js';

test('uses the single historical event rate for legacy rows without a function', () => {
  const event = { requiredRoles: [{ role: 'Emp.Mesa', agreedRate: 9.5 }] };
  assert.equal(clientRateForAssignment({ role: 'Sem função' }, event), 9.5);
});

test('does not guess a rate for an unassigned role when the event has several functions', () => {
  const event = {
    requiredRoles: [
      { role: 'Emp.Mesa', agreedRate: 9.5 },
      { role: 'Barman', agreedRate: 11 },
    ],
  };
  assert.equal(clientRateForAssignment({ role: 'Sem função' }, event), 0);
});

test('matches common aliases for Empregado de Mesa', () => {
  const event = { requiredRoles: [{ role: 'Emp.Mesa', agreedRate: 10.5 }] };
  assert.equal(clientRateForAssignment({ role: 'Empregado de Mesa' }, event), 10.5);
});

test('calculates margin and margin percentage from revenue', () => {
  assert.deepEqual(calculateFinancialMargin(570, 478.25, 0), { margin: 91.75, marginPct: 16.1 });
  assert.deepEqual(calculateFinancialMargin(0, 50, 10), { margin: -60, marginPct: 0 });
});

test('warns about missing rates and incomplete continuous event coverage', () => {
  const warnings = eventFinancialWarnings({
    date: '2026-06-01',
    endDate: '2026-06-03',
    isContinuous: true,
    requiredRoles: [{ role: 'Emp.Mesa', agreedRate: 0 }],
  }, [{ collaboratorId: 1, assignmentDate: '2026-06-01', role: 'Emp.Mesa', status: 'confirmed' }], {
    revenue: 0,
    staff: 40,
  });

  assert.deepEqual(warnings.map((item) => item.code), [
    'revenue_zero_with_staff',
    'assignment_without_client_rate',
    'role_without_client_rate',
    'continuous_days_incomplete',
  ]);
});
