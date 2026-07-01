import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildBalanceOverview } from './balanceMetrics.js';

const services = [
  {
    id: 1,
    name: 'Embaixada da China',
    date: '2026-06-11',
    status: 'finalized',
    billingStatus: 'paid',
    totalRevenue: 1200,
    totalCost: 420,
    client: { id: 10, name: 'Embaixada da República Popular da China' },
  },
  {
    id: 2,
    name: 'Restaurante Luz Chakall',
    date: '2026-06-17',
    status: 'confirmed',
    billingStatus: 'invoiced',
    financial: { revenue: 600, staffCost: 260, receivable: 600 },
    client: { id: 11, name: 'SSH - Supreme Sport Hospitality' },
  },
  {
    id: 3,
    name: 'Hotel Altis',
    date: '2026-05-20',
    status: 'finalized',
    billingStatus: 'invoiced',
    totalRevenue: 800,
    totalCost: 700,
    client: { id: 12, name: 'Hotel Altis' },
  },
  {
    id: 4,
    name: 'Evento cancelado',
    date: '2026-06-21',
    status: 'cancelled',
    totalRevenue: 900,
    totalCost: 200,
    client: { id: 13, name: 'Cliente Cancelado' },
  },
];

test('builds the balance overview for the selected month and year', () => {
  const overview = buildBalanceOverview({
    services,
    period: { month: '6', year: '2026', clientId: 'all', status: 'all' },
  });

  assert.deepEqual(overview.kpis, {
    validatedRevenue: 1800,
    staffToPay: 680,
    realMargin: 1120,
    receivable: 600,
    finalizedEvents: 1,
  });

  assert.deepEqual(overview.eventRows.map((row) => row.id), [1, 2]);
  assert.equal(overview.eventRows[0].marginPct, 65);
  assert.equal(overview.monthlySeries[5].receita, 1800);
  assert.equal(overview.monthlySeries[5].staff, 680);
  assert.equal(overview.monthlySeries[5].margem, 1120);
  assert.equal(overview.alerts.lowMarginEvents.count, 0);
  assert.equal(overview.alerts.clientsOpen.count, 1);
  assert.equal(overview.alerts.staffToProcess.count, 2);
});

test('filters the balance overview by client and operational status', () => {
  const overview = buildBalanceOverview({
    services,
    period: { month: '6', year: '2026', clientId: '11', status: 'confirmed' },
  });

  assert.deepEqual(overview.eventRows.map((row) => row.id), [2]);
  assert.equal(overview.kpis.validatedRevenue, 600);
  assert.equal(overview.kpis.staffToPay, 260);
  assert.equal(overview.kpis.realMargin, 340);
  assert.equal(overview.kpis.receivable, 600);
});
