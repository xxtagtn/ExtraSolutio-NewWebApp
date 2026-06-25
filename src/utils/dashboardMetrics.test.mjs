import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  availableFinancialYears,
  countRealizedServices,
  filterByFinancialPeriod,
  monthlyRevenueSeries,
} from './dashboardMetrics.js';

const todayStart = new Date('2026-06-05T00:00:00');

test('counts realized services by final status or past date and excludes cancelled services', () => {
  const services = [
    { id: 1, status: 'finalized', date: '2026-06-07' },
    { id: 2, status: 'invoiced', date: '2026-06-08' },
    { id: 3, status: 'paid', date: '2026-06-09' },
    { id: 4, status: 'drafting', date: '2026-06-04' },
    { id: 5, status: 'cancelled', date: '2026-06-03' },
    { id: 6, status: 'drafting', date: '2026-06-05' },
    { id: 7, status: 'drafting', date: '2026-06-10' },
  ];

  assert.equal(countRealizedServices(services, todayStart), 4);
});

test('uses the end date when counting continuous realized services', () => {
  const services = [
    { id: 1, status: 'drafting', isContinuous: true, date: '2026-06-01', endDate: '2026-06-04' },
    { id: 2, status: 'drafting', isContinuous: true, date: '2026-06-01', endDate: '2026-06-05' },
    { id: 3, status: 'drafting', isContinuous: true, date: '2026-06-01', endDate: '2026-06-08' },
  ];

  assert.equal(countRealizedServices(services, todayStart), 1);
});

test('filters financial records by any month and year combination', () => {
  const services = [
    { id: 1, date: '2025-01-10' },
    { id: 2, date: '2026-06-15' },
    { id: 3, date: '2027-06-20' },
    { id: 4, date: '2027-12-05' },
  ];

  assert.deepEqual(filterByFinancialPeriod(services, { month: '6', year: '2026' }).map((item) => item.id), [2]);
  assert.deepEqual(filterByFinancialPeriod(services, { month: '6', year: '' }).map((item) => item.id), [2, 3]);
  assert.deepEqual(filterByFinancialPeriod(services, { month: '', year: '2027' }).map((item) => item.id), [3, 4]);
  assert.deepEqual(filterByFinancialPeriod(services, { month: '', year: '' }).map((item) => item.id), [1, 2, 3, 4]);
});

test('collects financial years from services, invoices and transactions in descending order', () => {
  assert.deepEqual(availableFinancialYears(
    [{ date: '2025-01-10' }],
    [{ issueDate: '2027-04-12' }],
    [{ date: '2026-09-01' }],
  ), [2027, 2026, 2025]);
});

test('builds monthly revenue for the selected year and month', () => {
  const services = [
    { date: '2025-06-10', totalRevenue: 50 },
    { date: '2026-06-10', totalRevenue: 100 },
    { date: '2026-06-18', totalRevenue: 25 },
    { date: '2026-07-01', totalRevenue: 80 },
  ];

  const annual = monthlyRevenueSeries(services, { year: '2026' });
  assert.equal(annual[5].receita, 125);
  assert.equal(annual[6].receita, 80);

  assert.deepEqual(monthlyRevenueSeries(services, { month: '6', year: '2026' }), [
    { month: 'Jun', receita: 125 },
  ]);
});
