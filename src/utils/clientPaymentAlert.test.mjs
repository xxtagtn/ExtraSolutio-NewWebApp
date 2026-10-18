import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowClientPaymentAlert } from './clientPaymentAlert.js';
import { clientFinancialState } from './clientFinancialState.js';
import { splitClientBillingRows } from './clientBilling.js';

const today = new Date('2026-10-17T12:00:00');
const ssh = { name: 'SSH - Supreme Sport Hospitality', billingMethod: 'monthly', paymentTerm: 'days_30' };
const event = (patch = {}) => ({ id: 1, date: '2026-10-10', status: 'finalized', totalRevenue: 1000,
  paidAmount: 800, signaledAmount: 200, billingStatus: 'partial70', clientPaymentRecord: { version: 1, entries: [] },
  client: { billingMethod: 'per_event', paymentTerm: 'immediate' }, ...patch });
const alert = (value, day = today) => shouldShowClientPaymentAlert(value, { today: day });
const invoice = (patch = {}) => ({ status: 'issued', issueDate: '2026-09-01', total: 1000, ...patch });

test('unbilled balances and unconfigured customers are not falsely classified as overdue invoices', () => {
  assert.equal(alert(event({ billingStatus: 'pending', signaledAmount: 0, paidAmount: 0 })), false);
  assert.equal(alert(event({ client: null, billingStatus: 'paid' })), false);
  assert.equal(alert(event({ client: {}, billingStatus: 'pending', signaledAmount: 0 })), false);
});

test('fully received services never alert, even with an old open invoice', () => {
  assert.equal(alert(event({ paidAmount: 1000, invoices: [invoice()] })), false);
});

test('SSH monthly unbilled services never acquire an invented event-based 30-day deadline', () => {
  const service = event({ client: ssh });
  for (const day of ['2026-10-17', '2026-10-31', '2026-12-01']) assert.equal(alert(service, day), false);
  assert.equal(alert({ ...service, invoice: invoice({ status: 'draft' }) }), false);
  assert.equal(alert({ ...service, billingStatus: 'invoiced', clientPaymentRecord: { version: 1, entries: [], commercialStatus: 'invoiced' } }), false);
});

test('monthly billing uses the service month end even when the document is processed later', () => {
  const service = event({ client: ssh, date: '2026-06-10', invoice: invoice({ issueDate: '2026-10-01', dueDate: '2026-06-01' }) });
  assert.equal(alert(service), true);
  assert.equal(alert(service, '2026-07-30'), false);
  assert.equal(alert(service, '2026-07-31'), true);
});

test('SSH overdue unpaid invoices alert, but paid/cancelled/void/draft invoices do not', () => {
  assert.equal(alert(event({ client: ssh, date: '2026-08-10', invoices: [invoice()] })), true);
  for (const status of ['paid', 'settled', 'regularized', 'draft', 'cancelled', 'void']) {
    assert.equal(alert(event({ client: ssh, date: '2026-08-10', invoices: [invoice({ status })] })), false, status);
  }
});

test('biweekly, monthly and custom billing remain protected until a real invoice exists', () => {
  for (const billingMethod of ['biweekly', 'monthly', 'custom']) {
    assert.equal(alert(event({ client: { billingMethod, paymentTerm: 'immediate', billingCustomRule: 'Special written condition' } })), false);
  }
});

test('15-day, 45-day and numeric custom terms use the existing invoice lifecycle', () => {
  for (const [paymentTerm, paymentTermDays, due] of [['days_15', null, '2026-10-26'], ['days_45', null, '2026-11-25'], ['custom', 12, '2026-10-23']]) {
    const client = { billingMethod: 'per_event', paymentTerm, paymentTermDays };
    assert.equal(alert(event({ client })), false, 'No forecast deadline before issue');
    const service = event({ client, invoice: invoice({ issueDate: '2026-10-01' }) });
    assert.equal(alert(service, due), false);
    const next = new Date(`${due}T12:00:00`); next.setDate(next.getDate() + 1);
    assert.equal(alert(service, next), true);
  }
});

test('a client name does not assign commercial rules or exemptions', () => {
  assert.equal(alert(event({ client: { name: ssh.name }, billingStatus: 'pending', signaledAmount: 0 })), false);
  assert.equal(alert(event({ client: { ...ssh, name: 'Other monthly customer' } })), false);
});

test('partial receipts remain visible without an overdue alert inside the invoice term', () => {
  const service = event({ client: ssh, invoices: [invoice({ issueDate: '2026-10-01' })] });
  const state = clientFinancialState(service);
  assert.equal(state.received, 800); assert.equal(state.outstanding, 200);
  assert.equal(state.label, 'Faturado'); assert.equal(state.missingPayment, true);
  assert.equal(alert(service), false);
});

test('prepayment uses the existing manual remaining date or client days-before rule', () => {
  const service = event({ client: { billingMethod: 'prepaid', paymentTerm: 'immediate', prepaymentRemainingDaysBefore: 7 }, date: '2026-10-24' });
  assert.equal(alert(service), false);
  assert.equal(alert(service, '2026-10-18'), true);
  assert.equal(alert({ ...service, remainingPaymentDate: '2026-10-20' }), false);
  assert.equal(alert({ ...service, remainingPaymentDate: '2026-10-16' }), true);
});

test('a manual remaining date does not override a registered per-event billing calendar', () => {
  assert.equal(alert(event({ remainingPaymentDate: '2026-10-18' })), false);
  assert.equal(alert(event({ remainingPaymentDate: '2026-10-16' })), false);
  assert.equal(alert(event({ billingStatus: 'invoiced', remainingPaymentDate: '2026-10-18' })), true);
});

test('unknown invoice dates/terms do not invent commercial deadlines', () => {
  assert.equal(alert(event({ client: ssh, invoices: [invoice({ issueDate: null })] })), false);
  assert.equal(alert(event({ client: { billingMethod: 'per_event', paymentTerm: 'unsupported' } })), false);
  assert.equal(alert(event({ invoices: [invoice({ issueDate: 'invalid' })], client: ssh })), false);
  assert.equal(alert(event({ client: {}, invoices: [invoice()] })), false);
});

test('periodic calendar timing is independent of the linked invoice order', () => {
  const service = event({ client: ssh, date: '2026-08-01', invoices: [invoice({ issueDate: '2026-10-01' }), invoice()] });
  assert.equal(alert(service), true);
  assert.equal(alert({ ...service, invoices: [...service.invoices].reverse() }), true);
});

test('alert evaluation preserves adjustments, VAT, receipts, status and archive classification', () => {
  const service = event({ totalRevenue: 1763.82, taxAmount: 329.82, paidAmount: 1745.37, billingStatus: 'paid', client: ssh });
  const original = structuredClone(service), state = clientFinancialState(service);
  const rows = [{ billingGroups: [{ events: [service] }], nonInvoicedServices: [service] }];
  const archiveBefore = splitClientBillingRows(rows);
  assert.equal(alert(service), false);
  assert.equal(alert({ ...service, invoices: [invoice()] }), false, 'October monthly bill is not due yet');
  assert.equal(state.outstanding, 18.45); assert.equal(state.received, 1745.37);
  assert.deepEqual(clientFinancialState(service), state);
  assert.deepEqual(splitClientBillingRows(rows), archiveBefore);
  assert.deepEqual(service, original);
  assert.equal(alert(JSON.parse(JSON.stringify(service))), false, 'Same result after persisted data is reloaded');
});
