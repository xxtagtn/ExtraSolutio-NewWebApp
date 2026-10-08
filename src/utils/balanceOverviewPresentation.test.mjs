import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBalanceOverview } from './balanceMetrics.js';
import { staffAssignmentPaymentTotal } from './staffPayment.js';
import { staffPaymentRemaining } from './staffAdvances.js';
import { balanceChartWindow, balanceMonthComparison, buildBalanceAttention, buildBalanceForecast } from './balanceOverviewPresentation.js';

const client = { id: 1, name: 'Cliente', paymentTerm: 'days_30' };
const services = [
  { id: 1, name: 'Concluído', date: '2026-10-01', client, status: 'finalized', totalRevenue: 1000, totalCost: 500,
    assignments: [
      { id: 1, collaboratorId: 1, collaborator: { name: 'Ana' }, totalPay: 100, paymentStatus: 'unpaid', advancePayments: [{ amount: 20 }] },
      { id: 2, collaboratorId: 2, totalPay: 100, paymentStatus: 'paid' },
      { id: 3, collaboratorId: 3, totalPay: 70, paymentStatus: 'ganho' },
      { id: 4, collaboratorId: 4, totalPay: 50, paymentStatus: 'penhorado' },
      { id: 5, collaboratorId: 5, totalPay: 90, status: 'cancelled' },
    ] },
  { id: 2, name: 'Confirmado', date: '2026-10-10', client, status: 'confirmed', totalRevenue: 300, totalCost: 100,
    assignments: [{ id: 6, collaboratorId: 1, totalPay: 300 }] },
  { id: 3, name: 'Por faturar', date: '2026-10-02', client, status: 'finalized', totalRevenue: 150, billingAdjustment: 10 },
  { id: 4, name: 'Outro mês', date: '2026-09-01', client, status: 'finalized', totalRevenue: 200 },
];
const period = { year: '2026', month: '10', clientId: 'all', status: 'all' };
const invoices = [
  { id: 1, eventIds: [1, 2], total: 250, issueDate: '2026-08-01', status: 'issued', client },
  { id: 2, eventId: 1, total: 300, issueDate: '2026-10-01', status: 'issued', client },
  { id: 3, eventId: 1, total: 100, issueDate: '2026-08-01', status: 'paid', client },
  { id: 4, eventId: 3, total: 150, status: 'draft', client },
  { id: 5, eventId: 4, total: 200, issueDate: '2026-08-01', status: 'issued', client },
];
const overview = buildBalanceOverview({ services, invoices, period });
const today = new Date('2026-10-06T12:00:00');

test('attention respects filtered events and counts shared overdue invoices once', () => {
  const attention = buildBalanceAttention({ eventRows: overview.eventRows, invoices, today });
  assert.equal(attention.overdue.amount, 250);
  assert.equal(attention.overdue.rows.length, 1);
  assert.equal(attention.staff.amount, 200);
  assert.deepEqual(attention.staff.rows.map((row) => row.key), ['assignment:1', 'assignment:3', 'assignment:4']);
  assert.equal(attention.unbilled.amount, 150); // Existing draft invoice suppresses billing adjustment.
  assert.equal(attention.unbilled.rows.length, 1);
  const filtered = buildBalanceAttention({ eventRows: overview.eventRows.filter((row) => row.id === 3), invoices, today });
  assert.equal(filtered.overdue.amount, 0);
  assert.equal(filtered.staff.amount, 0);
  assert.equal(filtered.unbilled.amount, 150);
});

test('pending billing reuses adjustments and issued/paid invoice rules', () => {
  const result = buildBalanceAttention({ eventRows: overview.eventRows, invoices: invoices.filter((invoice) => invoice.id !== 4), today });
  assert.equal(result.unbilled.amount, 160);
  assert.equal(result.unbilled.rows[0].to, '/finance?area=clients&eventId=3');
});

test('staff pending amount reuses VAT, travel, adjustments and advances without changing work hours', () => {
  const assignment = { id: 10, collaboratorId: 10, status: 'confirmed', collaborator: { includeVat: true }, totalPay: 100, hourlyRate: 10,
    paymentAdjustment: -5, advancePayments: [{ amount: 20 }, { amount: 40, car: true }] };
  const event = { ...services[0], travelExpenseEnabled: true, travelExpenseMode: 'kms',
    travelCars: [{ id: 'car-1', durationHours: 2 }], assignments: [assignment] };
  const rows = buildBalanceOverview({ services: [event], period }).eventRows;
  const expected = staffPaymentRemaining(staffAssignmentPaymentTotal(assignment, event), assignment.advancePayments);
  assert.equal(expected, 161.45);
  const before = structuredClone(event);
  assert.equal(buildBalanceAttention({ eventRows: rows }).staff.amount, expected);
  const splitEvent = { ...event, split5050: true };
  assert.equal(buildBalanceAttention({ eventRows: buildBalanceOverview({ services: [splitEvent], period }).eventRows }).staff.amount, 149.15);
  assert.deepEqual(event, before);
});

test('forecast separates confirmed events and pending budgets and respects period/client/status', () => {
  const budgets = [
    { id: 1, eventDate: '2026-10-20', clientId: 1, status: 'sent', totalAmount: 500 },
    { id: 2, eventDate: '2026-10-22', clientId: 1, status: 'analysis', totalAmount: 200 },
    { id: 3, eventDate: '2026-10-22', clientId: 1, status: 'accepted', totalAmount: 900 },
    { id: 4, eventDate: '2026-09-22', clientId: 1, status: 'sent', totalAmount: 700 },
    { id: 5, eventDate: '2026-10-22', clientId: 2, status: 'sent', totalAmount: 100 },
  ];
  const result = buildBalanceForecast({ eventRows: overview.eventRows, budgets, period: { ...period, clientId: '1' } });
  assert.equal(result.confirmed.amount, 300);
  assert.equal(result.budgets.amount, 700);
  assert.equal(buildBalanceForecast({ budgets, period: { ...period, status: 'finalized' } }).budgets.amount, 0);
});

test('read-only presentation leaves every original balance total unchanged', () => {
  const before = structuredClone(overview);
  buildBalanceAttention({ eventRows: overview.eventRows, invoices, today });
  buildBalanceForecast({ eventRows: overview.eventRows, period });
  assert.deepEqual(overview, before);
  assert.deepEqual(buildBalanceOverview({ services, invoices, period }), overview);
});

test('chart window and comparisons do not invent a previous month baseline', () => {
  const series = Array.from({ length: 12 }, (_, month) => ({ month, receita: month * 100 }));
  assert.equal(balanceMonthComparison(series, '1', 'receita'), null);
  assert.equal(balanceMonthComparison(series, '2', 'receita'), null);
  assert.equal(balanceMonthComparison(series, '', 'receita'), null);
  assert.equal(balanceMonthComparison(series, '3', 'receita'), 100);
  assert.deepEqual(balanceChartWindow(series, '10').map((row) => row.month), [4, 5, 6, 7, 8, 9]);
  assert.equal(balanceChartWindow(series, '').length, 12);
  assert.equal(balanceChartWindow(series, '1').length, 1);
  assert.deepEqual(buildBalanceAttention().staff, { rows: [], amount: 0 });
});
