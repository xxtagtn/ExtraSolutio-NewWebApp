import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientFinancialSummary } from './clientFinancialSummary.js';
import { calculateVatAmount, sumMoney } from '../../shared/money.js';
import { externalCostsTotals } from './externalCosts.js';
import { buildClientFinanceSnapshot } from './clientFinanceSnapshot.js';

const client = (patch = {}) => ({ id: 1, name: 'BLANK', billingMethod: 'monthly', paymentTerm: 'days_15', ...patch });
function service(id, base, patch = {}) {
  const rate = patch.staffVatRateSnapshot ?? 23;
  const taxAmount = calculateVatAmount(base, rate);
  return { id, name: `Service ${id}`, clientId: 1, client: client(), date: '2026-10-10', status: 'finalized',
    staffVatRateSnapshot: rate, totalRevenue: sumMoney(base, taxAmount), taxAmount, billingStatus: 'pending', paidAmount: 0,
    clientPaymentRecord: { version: 1, entries: [], financeWorkflowVersion: 2 }, ...patch };
}
const blank = () => [service(1, 976.5), service(2, 126), service(3, 157.5)];

test('BLANK monthly regression uses the client file: 1260 net + 289.80 VAT = 1549.80 instead of 1549.81', () => {
  const events = blank().map((event) => ({ ...event, client: client({ billingMethod: 'per_event' }) }));
  const clients = [client()], before = structuredClone({ events, clients });
  const [summary] = buildClientFinancialSummary({ events, clients, period: '2026-10' });
  assert.equal(summary.pendingBillingBase, 1260); assert.equal(summary.totalBase, 1260);
  assert.equal(summary.pendingBilling, 1549.8); assert.equal(summary.total, 1549.8);
  assert.equal(summary.billingVatRounding, -0.01);
  assert.equal(summary.billingVatGroups.length, 1);
  assert.deepEqual(summary.billingVatGroups[0].rates, [{ rate: 23, base: 1260, tax: 289.8 }]);
  assert.equal(summary.billingVatGroups[0].start, '2026-10-01'); assert.equal(summary.billingVatGroups[0].end, '2026-10-31');
  assert.equal(sumMoney(...summary.events.map((event) => event.displayValue)), 1549.81, 'Individual service totals remain recorded values');
  assert.deepEqual({ events, clients }, before);
});

test('the client configuration, not a name-specific rule, distinguishes monthly from per-service billing', () => {
  const events = blank();
  const [separate] = buildClientFinancialSummary({ events, clients: [client({ billingMethod: 'per_event' })] });
  assert.equal(separate.total, 1549.81); assert.equal(separate.billingVatRounding, 0); assert.deepEqual(separate.billingVatGroups, []);
  const [otherName] = buildClientFinancialSummary({ events, clients: [client({ name: 'Another monthly client' })] });
  assert.equal(otherName.total, 1549.8);
  assert.equal(buildClientFinancialSummary({ events, clients: [client({ billingMethod: 'custom' })] })[0].total, 1549.81);
});

test('year and all-period summaries never round VAT across different months', () => {
  const events = [service(1, 976.5), service(2, 126, { date: '2026-11-01' }), service(3, 157.5, { date: '2026-11-30' })];
  const [year] = buildClientFinancialSummary({ events, period: '2026-00' });
  assert.equal(year.totalBase, 1260); assert.equal(year.total, 1549.81); assert.equal(year.billingVatGroups.length, 2);
  assert.equal(buildClientFinancialSummary({ events })[0].total, 1549.81);
  assert.equal(buildClientFinancialSummary({ events, period: '2026-10' })[0].total, 1201.1);
  assert.equal(buildClientFinancialSummary({ events, period: '2026-11' })[0].total, 348.71);
});

test('biweekly clients retain two independent fiscal groups and do not inherit monthly rounding', () => {
  const events = [service(1, 976.5, { date: '2026-10-15' }), service(2, 126, { date: '2026-10-16' }), service(3, 157.5, { date: '2026-10-31' })];
  const [summary] = buildClientFinancialSummary({ events, clients: [client({ billingMethod: 'biweekly' })], period: '2026-10' });
  assert.equal(summary.total, 1549.81); assert.equal(summary.billingVatGroups.length, 2);
  assert.deepEqual(summary.billingVatGroups.map(({ start, end }) => [start, end]), [['2026-10-01', '2026-10-15'], ['2026-10-16', '2026-10-31']]);
});

test('different clients, exempt sales and distinct VAT rates are never combined into a flat 23 percent charge', () => {
  const events = [service(1, 0.5), service(2, 0.5), service(3, 0.5, { staffVatRateSnapshot: 13 }),
    service(4, 0.5, { staffVatRateSnapshot: 13 }), service(5, 1, { staffVatRateSnapshot: 0 }),
    service(6, 0.5, { clientId: 2, client: client({ id: 2, name: 'Second client' }) })];
  const rows = buildClientFinancialSummary({ events });
  const first = rows.find((row) => row.clientId === 1), second = rows.find((row) => row.clientId === 2);
  assert.equal(first.total, 3.36); assert.equal(first.totalBase, 3); assert.equal(second.total, 0.62);
  assert.deepEqual(first.billingVatGroups[0].rates, [{ rate: 0, base: 1, tax: 0 }, { rate: 13, base: 1, tax: 0.13 }, { rate: 23, base: 1, tax: 0.23 }]);
});

test('catering partners expand into their known 13 and 23 percent bases instead of guessing a rate', () => {
  const externalCosts = [{ id: 'catering', type: 'Catering', costAmount: 430, vatType: 'catering' }];
  const partners = externalCostsTotals(externalCosts);
  const events = [1, 2].map((id) => service(id, 0.5, { externalCosts,
    taxAmount: sumMoney(0.12, partners.taxAmount), totalRevenue: sumMoney(0.5, partners.grossAmount, 0.12) }));
  const [summary] = buildClientFinancialSummary({ events });
  assert.equal(summary.totalBase, 861); assert.equal(summary.total, 985.93);
  assert.deepEqual(summary.billingVatGroups[0].rates, [{ rate: 13, base: 731, tax: 95.03 }, { rate: 23, base: 130, tax: 29.9 }]);
});

test('issued/manual-invoiced services and draft-linked services are not regrouped or repriced', () => {
  for (const status of ['invoiced', 'paid']) {
    const events = blank().map((event) => ({ ...event, billingStatus: status, ...(status === 'paid' ? { paidAmount: event.totalRevenue } : {}) }));
    const invoices = [{ id: 9, clientId: 1, eventIds: '[1,2,3]', issueDate: '2026-10-31', status: status === 'paid' ? 'paid' : 'issued', total: 1549.81, taxAmount: 289.81 }];
    const before = structuredClone({ events, invoices });
    const [summary] = buildClientFinancialSummary({ events, invoices });
    assert.equal(summary.total, 1549.81); assert.equal(summary.billingVatRounding, 0); assert.equal(summary.pendingBilling, 0);
    assert.deepEqual({ events, invoices }, before);
  }
  const manual = buildClientFinancialSummary({ events: blank().map((event) => ({ ...event, billingStatus: 'invoiced' })) })[0];
  assert.equal(manual.total, 1549.81); assert.equal(manual.billingVatRounding, 0);
  const draft = buildClientFinancialSummary({ events: blank(), invoices: [{ id: 9, eventIds: '[1,2,3]', status: 'draft' }] })[0];
  assert.equal(draft.total, 1549.81); assert.equal(draft.billingVatRounding, 0);
});

test('grouping changes the forecast VAT only, never receipts, event balances, adjustments or archive eligibility', () => {
  const events = blank();
  events[0] = { ...events[0], paidAmount: 100, billingStatus: 'partial70', signaledAmount: 100,
    clientPaymentRecord: { version: 1, financeWorkflowVersion: 2, entries: [{ id: 'cash', type: 'signal', amount: 100 }] } };
  const now = new Date('2026-11-02T12:00:00Z');
  const before = structuredClone(events), finance = events.map((event) => buildClientFinanceSnapshot(event, { now }));
  const [summary] = buildClientFinancialSummary({ events });
  assert.equal(summary.total, 1549.8); assert.equal(summary.received, 100);
  assert.equal(summary.adjustments, 0); assert.equal(summary.billedOpen, 0);
  assert.deepEqual(events, before);
  assert.deepEqual(events.map((event) => buildClientFinanceSnapshot(event, { now })), finance);
});

test('an unknown fiscal component disables regrouping for its whole period, not just that service', () => {
  const events = [service(1, 0.5), service(2, 0.5), service(3, 100, { staffVatRateSnapshot: 0, taxAmount: 23, totalRevenue: 123 })];
  const [summary] = buildClientFinancialSummary({ events });
  assert.equal(summary.total, 124.24); assert.equal(summary.billingVatRounding, 0); assert.deepEqual(summary.billingVatGroups, []);
  const [taxOnly] = buildClientFinancialSummary({ events: [service(1, 0, { totalRevenue: 1, taxAmount: 1 })] });
  assert.equal(taxOnly.total, 1); assert.deepEqual(taxOnly.billingVatGroups, [], 'Unknown tax-only history cannot be discarded');
});

test('refresh/reordering is idempotent and picks up the current client method without altering stored service prices', () => {
  const events = blank(), clients = [client()];
  const first = buildClientFinancialSummary({ events, clients })[0];
  assert.equal(buildClientFinancialSummary({ events: [...events].reverse(), clients })[0].total, first.total);
  assert.equal(buildClientFinancialSummary(JSON.parse(JSON.stringify({ events, clients })))[0].total, first.total);
  clients[0].billingMethod = 'per_event';
  assert.equal(buildClientFinancialSummary({ events, clients })[0].total, 1549.81);
});

test('continuous Staff services split by dated periods and do not allocate mixed global costs proportionally', () => {
  const event = service(1, 1, { isContinuous: true, date: '2026-10-31', endDate: '2026-11-01', totalRevenue: 1.23, taxAmount: 0.23,
    requiredRoles: [{ role: 'Staff', qty: 1, agreedRate: 0.5 }], assignments: ['2026-10-31', '2026-11-01'].map((assignmentDate, i) => ({
      id: i + 1, collaboratorId: i + 1, assignmentDate, role: 'Staff', status: 'confirmed', clientCheckIn: '10:00', clientCheckOut: '11:00',
    })) });
  const [summary] = buildClientFinancialSummary({ events: [event] });
  assert.equal(summary.billingVatGroups.length, 2); assert.equal(summary.total, 1.24);
  const unknown = service(2, 100, { isContinuous: true, date: '2026-10-31', endDate: '2026-11-01', totalRevenue: 123, taxAmount: 23 });
  const [unallocated] = buildClientFinancialSummary({ events: [unknown] });
  assert.equal(unallocated.allocationRequired, true); assert.deepEqual(unallocated.billingVatGroups, []);
  const mixed = service(3, 1, { date: '2026-10-31', endDate: '2026-11-01', isContinuous: true, totalRevenue: 236, taxAmount: 36,
    staffVatRateSnapshot: 23, externalCosts: [{ id: 'partner', type: 'Catering', costAmount: 100, vatType: 'catering' }],
    clientFinance: { billingStatus: 'unbilled', allocationRequired: false, periods: [
      { days: ['2026-10-31'], total: 118, tax: 18, received: 0, outstanding: 118, staffBase: 0, staffTax: 0 },
      { days: ['2026-11-01'], total: 118, tax: 18, received: 0, outstanding: 118, staffBase: 0, staffTax: 0 },
    ] } });
  const [unknownRates] = buildClientFinancialSummary({ events: [mixed] });
  assert.equal(unknownRates.total, 236); assert.deepEqual(unknownRates.billingVatGroups, []);
});
