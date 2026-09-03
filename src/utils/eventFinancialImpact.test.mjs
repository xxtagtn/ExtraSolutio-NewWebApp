import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventFinancialImpactMessage } from './eventFinancialImpact.js';

test('summarizes a reduction in staff and forecast revenue', () => {
  const message = eventFinancialImpactMessage({
    totalRevenue: 140,
    requiredRoles: [{ role: 'Emp.Mesa', qty: 2 }],
  }, {
    totalRevenue: 70,
    requiredRoles: [{ role: 'Emp.Mesa', qty: 1 }],
  });

  assert.match(message, /colaboradores 2 -> 1/);
  assert.match(message, /140,00/);
  assert.match(message, /70,00/);
  assert.match(message, /-70,00/);
});

test('omits the message when staff and value did not change', () => {
  assert.equal(eventFinancialImpactMessage({ totalRevenue: 70 }, { totalRevenue: 70 }), '');
});
