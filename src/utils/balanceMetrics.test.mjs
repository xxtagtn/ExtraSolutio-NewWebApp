import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildBalanceOverview, buildClientBalanceSeries } from './balanceMetrics.js';

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
    today: new Date('2026-06-01T12:00:00'),
    period: { month: '6', year: '2026', clientId: 'all', status: 'all' },
  });

  assert.deepEqual(overview.kpis, {
    validatedRevenue: 1800,
    staffToPay: 680,
    externalCosts: 0,
    realMargin: 1120,
    receivable: 600,
    finalizedEvents: 1,
    overdueClients: 0,
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
    today: new Date('2026-06-01T12:00:00'),
    period: { month: '6', year: '2026', clientId: '11', status: 'confirmed' },
  });

  assert.deepEqual(overview.eventRows.map((row) => row.id), [2]);
  assert.equal(overview.kpis.validatedRevenue, 600);
  assert.equal(overview.kpis.staffToPay, 260);
  assert.equal(overview.kpis.realMargin, 340);
  assert.equal(overview.kpis.receivable, 600);
});

test('separates staff and external partner costs in the real margin', () => {
  const overview = buildBalanceOverview({
    services: [{
      id: 20,
      name: 'Evento com parceiro',
      date: '2026-06-20',
      status: 'finalized',
      totalRevenue: 1_000,
      totalCost: 500,
      externalCosts: [{ type: 'catering', costAmount: 200, marginPercent: 10 }],
      client: { id: 30, name: 'Cliente A' },
    }],
    period: { month: '6', year: '2026', clientId: 'all', status: 'all' },
  });

  assert.equal(overview.eventRows[0].staff, 300);
  assert.equal(overview.eventRows[0].external, 200);
  assert.equal(overview.eventRows[0].margin, 500);
  assert.equal(overview.kpis.externalCosts, 200);
  assert.equal(overview.kpis.realMargin, 500);
  assert.equal(overview.clientRows[0].marginPct, 50);
});

test('groups occasional clients by their manual name and exposes their monthly evolution', () => {
  const overview = buildBalanceOverview({
    services: [
      { id: 31, name: 'Evento junho', date: '2026-06-10', status: 'finalized', clientName: 'João Silva', totalRevenue: 500, totalCost: 200 },
      { id: 32, name: 'Evento julho', date: '2026-07-10', status: 'finalized', clientName: 'João Silva', totalRevenue: 700, totalCost: 250 },
    ],
    period: { month: '', year: '2026', clientId: 'all', status: 'all' },
  });

  assert.equal(overview.clientRows.length, 1);
  assert.equal(overview.clientRows[0].clientName, 'João Silva');
  assert.equal(overview.clientRows[0].eventCount, 2);

  const series = buildClientBalanceSeries(overview.annualRows, overview.clientRows[0].key);
  assert.equal(series[5].receita, 500);
  assert.equal(series[6].receita, 700);
});
