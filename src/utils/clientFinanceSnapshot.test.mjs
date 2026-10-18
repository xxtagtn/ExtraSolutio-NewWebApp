import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientFinanceSnapshot, clientArchiveState } from './clientFinanceSnapshot.js';
import { buildClientFinancialSummary } from './clientFinancialSummary.js';
import { clientPaymentRecordPatch } from '../../server/services/clientPaymentRecord.js';
import { splitClientBillingRows } from './clientBilling.js';

const now = new Date('2026-10-20T12:00:00Z');
const record = (patch = {}) => ({ version: 1, entries: [], financeWorkflowVersion: 2, ...patch });
const event = (patch = {}) => ({ id: 1, name: 'Service QA', clientId: 1, date: '2026-10-14', endDate: '2026-10-18', isContinuous: true,
  status: 'finalized', totalRevenue: 615, taxAmount: 115, paidAmount: 0, signaledAmount: 0, billingStatus: 'pending',
  staffVatRateSnapshot: 23, requiredRoles: [{ role: 'Bar', qty: 1, agreedRate: 10 }],
  client: { id: 1, name: 'QA', billingMethod: 'biweekly', paymentTerm: 'days_15' },
  clientPaymentRecord: record(), assignments: [14, 15, 16, 17, 18].map((day) => ({ assignmentDate: `2026-10-${day}`, role: 'Bar', status: 'confirmed', clientBillableHours: 10 })), ...patch });
const snapshot = (value) => buildClientFinanceSnapshot(value, { now });

test('a 14-18 October Staff service splits 2/3 days without duplicating total, tax or service count', () => {
  const value = event(), finance = snapshot(value);
  assert.equal(finance.allocationRequired, false);
  assert.deepEqual(finance.periods.map((part) => [part.total, part.tax, part.received, part.dueDate]), [[246, 46, 0, '2026-10-30'], [369, 69, 0, '2026-11-15']]);
  const [summary] = buildClientFinancialSummary({ events: [value], period: '2026-10' });
  assert.equal(summary.eventCount, 1); assert.equal(summary.events.length, 2); assert.equal(summary.total, 615);
});

test('global partner/travel values and partial receipts require explicit allocation, never a proportional guess', () => {
  const finance = snapshot(event({ totalRevenue: 738, taxAmount: 138, paidAmount: 100 }));
  assert.equal(finance.unassignedTotal, 123); assert.equal(finance.unassignedTax, 23);
  assert.equal(finance.allocationRequired, true);
  assert.deepEqual(finance.periods.map(({ total, received }) => [total, received]), [[null, null], [null, null]]);
  assert.equal(finance.payment.received, 100); assert.equal(finance.payment.outstanding, 638);
});

test('a stored manual allocation remains exact after reload and becomes invalid after price, day or receipt changes', () => {
  let value = event({ totalRevenue: 738, taxAmount: 138, paidAmount: 100 });
  const basis = snapshot(value).allocationBasis;
  const allocation = { total: 738, tax: 138, receivedTotal: 100, receiptRevision: 0, basis,
    periods: [{ key: 'biweekly:2026-10:1', globalTotal: 49.2, globalTax: 9.2, received: 100 }, { key: 'biweekly:2026-10:2', globalTotal: 73.8, globalTax: 13.8, received: 0 }] };
  value = { ...value, clientPaymentRecord: record({ billingAllocation: allocation }) };
  const finance = snapshot(value);
  assert.equal(finance.allocationRequired, false);
  assert.deepEqual(finance.periods.map((part) => [part.total, part.received]), [[295.2, 100], [442.8, 0]]);
  assert.deepEqual(snapshot(JSON.parse(JSON.stringify(value))), finance);
  assert.equal(snapshot({ ...value, totalRevenue: 740 }).allocationRequired, true);
  assert.equal(snapshot({ ...value, paidAmount: 110 }).allocationRequired, true);
  assert.equal(snapshot({ ...value, assignments: value.assignments.map((item, i) => ({ ...item, clientBillableHours: i === 0 ? 11 : i === 2 ? 9 : 10 })) }).allocationRequired, true);
  assert.equal(snapshot({ ...value, clientPaymentRecord: record({ billingAllocation: allocation, entries: [{ id: 'correction', type: 'correction', amount: 0 }] }) }).allocationRequired, true);
});

test('fully settled and unpaid Staff-only periods do not require receipt guesses', () => {
  const finance = snapshot(event({ paidAmount: 615, billingStatus: 'paid' }));
  assert.equal(finance.allocationRequired, false);
  assert.deepEqual(finance.periods.map(({ received, outstanding }) => [received, outstanding]), [[246, 0], [369, 0]]);
});

test('a Staff-only redistribution invalidates a previous partial-receipt split even when the grand total is unchanged', () => {
  let value = event({ paidAmount: 246 });
  const allocation = { total: 615, tax: 115, receivedTotal: 246, receiptRevision: 0, basis: snapshot(value).allocationBasis,
    periods: [{ key: 'biweekly:2026-10:1', globalTotal: 0, globalTax: 0, received: 246 }, { key: 'biweekly:2026-10:2', globalTotal: 0, globalTax: 0, received: 0 }] };
  value = { ...value, clientPaymentRecord: record({ billingAllocation: allocation }) };
  assert.equal(snapshot(value).allocationRequired, false);
  const changed = { ...value, assignments: value.assignments.map((item, index) => ({ ...item, clientBillableHours: index === 0 ? 9 : index === 2 ? 11 : 10 })) };
  const finance = snapshot(changed);
  assert.equal(finance.payment.received, 246); assert.equal(finance.payment.outstanding, 369);
  assert.equal(finance.allocationRequired, true); assert.equal(finance.periods[0].received, null);
});

test('cross-month services contribute only the corresponding days to each month', () => {
  const value = event({ date: '2026-10-31', endDate: '2026-11-01', totalRevenue: 246, taxAmount: 46,
    client: { id: 1, name: 'QA', billingMethod: 'monthly', paymentTerm: 'days_15' },
    assignments: ['2026-10-31', '2026-11-01'].map((assignmentDate) => ({ assignmentDate, role: 'Bar', clientBillableHours: 10 })) });
  for (const period of ['2026-10', '2026-11']) {
    const [summary] = buildClientFinancialSummary({ events: [value], period });
    assert.equal(summary.eventCount, 1); assert.equal(summary.total, 123); assert.equal(summary.events.length, 1);
  }
  assert.equal(buildClientFinancialSummary({ events: [value], period: '2026-00' })[0].total, 246);
});

test('H budget fallback uses real adjudication reference, 70/30 and seven days before, but registered terms win', () => {
  const value = event({ date: '2026-11-20', isContinuous: false, clientId: null, client: null, notes: '[BUDGET_REF:QA-1]',
    totalRevenue: 1000, taxAmount: 0, paidAmount: 700, clientPaymentRecord: record({ budgetAdjudicatedAt: '2026-10-10', budgetForecastTotal: 1000 }) });
  const finance = snapshot(value);
  assert.deepEqual(finance.prepaymentStages.map(({ total, outstanding, dueDate }) => [total, outstanding, dueDate]), [[700, 0, '2026-10-10'], [300, 300, '2026-11-13']]);
  assert.equal(snapshot({ ...value, clientId: 1, client: event().client }).prepaid, false);
  assert.equal(snapshot({ ...value, clientPaymentRecord: record() }).prepaymentStages[0].dueDate, null, 'Do not invent an old acceptance date');
});

test('I a received forecast stays active before completion; a later adjustment keeps all money and suppresses renewed 70/30', () => {
  let value = event({ date: '2026-11-20', isContinuous: false, status: 'in_progress', clientId: null, client: null, notes: '[BUDGET_REF:QA-2]',
    totalRevenue: 1000, taxAmount: 0, paidAmount: 1000, billingStatus: 'paid', clientPaymentRecord: record({ budgetForecastTotal: 1000, expectedTotal: 1000,
      settledFinancials: { total: 1000, base: 1000, tax: 0 }, entries: [{ id: 'cash', type: 'signal', amount: 1000 }] }) });
  assert.equal(snapshot(value).paymentLabel, 'Previsto totalmente recebido'); assert.equal(snapshot(value).archive.canArchive, false);
  value = { ...value, date: '2026-10-10', status: 'finalized', totalRevenue: 1150 };
  const finance = snapshot(value);
  assert.equal(finance.payment.received, 1000); assert.equal(finance.payment.outstanding, 150);
  assert.equal(finance.paymentLabel, 'Pagamento em falta'); assert.deepEqual(finance.prepaymentStages, []);
  assert.equal(finance.archive.canArchive, false);
});

test('newly paid services require explicit archive, legacy archived services stay archived, and new balances reopen them', () => {
  const legacy = event({ isContinuous: false, totalRevenue: 100, taxAmount: 0, paidAmount: 100, billingStatus: 'paid', clientPaymentRecord: null });
  assert.equal(clientArchiveState(legacy, { now }).archived, true);
  const current = { ...legacy, clientPaymentRecord: record() };
  assert.equal(clientArchiveState(current, { now }).needsConfirmation, true);
  const archived = { ...current, clientPaymentRecord: record({ financeArchive: { archivedAt: now.toISOString(), confirmedTotal: 100 } }) };
  assert.equal(clientArchiveState(archived, { now }).archived, true);
  assert.equal(clientArchiveState({ ...archived, totalRevenue: 118.45 }, { now }).archived, false);
  assert.equal(clientArchiveState({ ...archived, paidAmount: 50 }, { now }).archived, false);
  const other = { ...current, id: 2 };
  const rows = splitClientBillingRows([{ id: 1, nonInvoicedServices: [archived, other] }], { now });
  assert.deepEqual(rows.archivedRows.flatMap((row) => row.nonInvoicedServices.map((item) => item.id)), [1]);
  assert.deepEqual(rows.activeRows.flatMap((row) => row.nonInvoicedServices.map((item) => item.id)), [2]);
});

test('payment metadata marks a newly completed prepaid service for manual archive without altering cash', () => {
  const previous = event({ status: 'in_progress', paidAmount: 615, billingStatus: 'paid', clientPaymentRecord: null });
  const patch = clientPaymentRecordPatch(previous, { status: 'finalized' });
  const saved = { ...previous, status: 'finalized', ...patch };
  assert.equal(snapshot(saved).archive.archived, false); assert.equal(snapshot(saved).payment.received, 615);
});
