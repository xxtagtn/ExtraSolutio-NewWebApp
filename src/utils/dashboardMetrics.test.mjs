import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countRealizedServices } from './dashboardMetrics.js';

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
