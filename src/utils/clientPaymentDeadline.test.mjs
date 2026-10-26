import test from 'node:test';
import assert from 'node:assert/strict';
import { clientPaymentDeadline, normalizeCommercialIssueDate } from './clientPaymentDeadline.js';
import { shouldShowClientPaymentAlert } from './clientPaymentAlert.js';
import { clientPaymentSummary } from './clientPayment.js';
import { splitClientBillingRows } from './clientBilling.js';

const today = new Date('2026-10-17T12:00:00');
const service = (patch = {}) => ({ id: 1, date: '2026-10-01', endDate: '2026-10-02', isContinuous: true,
  status: 'finalized', billingStatus: 'pending', totalRevenue: 295.2, taxAmount: 55.2, paidAmount: 0,
  client: { name: 'FIC Restaurante', billingMethod: 'biweekly', paymentTerm: 'immediate' },
  clientPaymentRecord: { version: 1, entries: [], commercialStatus: 'invoiced', commercialIssueDate: '2026-10-15' }, ...patch });
const deadline = (event, day = today) => clientPaymentDeadline(event, { today: day });
const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

test('FIC fortnightly billing with actual issue on 15/10 and immediate payment is 2 days overdue on 17/10', () => {
  const event = service(), result = deadline(event);
  assert.equal(key(result.dueDate), '2026-10-15'); assert.equal(result.status, 'overdue');
  assert.equal(result.overdueDays, 2); assert.equal(result.label, 'Vencida há 2 dias');
  assert.equal(shouldShowClientPaymentAlert(event, { today }), true);
});

test('fortnight reference plus client term overrides a later manual processing date', () => {
  const event = service({ client: { billingMethod: 'biweekly', paymentTerm: 'days_15' } });
  const result = deadline(event);
  assert.equal(key(result.dueDate), '2026-10-30'); assert.equal(result.label, 'A aguardar pagamento');
  assert.equal(shouldShowClientPaymentAlert(event, { today }), false);
  const delayed = { ...event, clientPaymentRecord: { ...event.clientPaymentRecord, commercialIssueDate: '2026-10-20' } };
  assert.equal(deadline(delayed).issueDate, '2026-10-20');
  assert.equal(deadline(delayed).referenceDate, '2026-10-15');
  assert.equal(key(deadline(delayed).dueDate), '2026-10-30');
});

test('configured periodic clients derive reference dates without changing historical records', () => {
  for (const record of [{ commercialStatus: 'invoiced' }, { legacyInvoiced: true }, {}]) {
    const event = service({ billingStatus: 'invoiced', clientPaymentRecord: { version: 1, entries: [], ...record } });
    assert.equal(deadline(event).issueDate, '2026-10-15'); assert.equal(key(deadline(event).dueDate), '2026-10-15');
    assert.equal(shouldShowClientPaymentAlert(event, { today }), true);
  }
});

test('calendar reference is shared by manual commercial status and issued documents', () => {
  const event = service({ invoices: [{ status: 'issued', issueDate: '2026-10-19', dueDate: '2020-01-01' }] });
  assert.equal(deadline(event).source, 'calendar'); assert.equal(key(deadline(event).dueDate), '2026-10-15');
  assert.equal(deadline(event).status, 'overdue');
  assert.equal(deadline(event).issueDate, '2026-10-19', 'An issued document remains authoritative');
});

test('correcting the manual issue date changes its display, not the monthly due date or financial state', () => {
  const event = service({ client: { billingMethod: 'monthly', paymentTerm: 'days_15' },
    clientPaymentRecord: { version: 1, entries: [], commercialStatus: 'invoiced', commercialIssueDate: '2026-10-16' } });
  const before = structuredClone(event), result = deadline(event);
  assert.equal(result.issueDate, '2026-10-16'); assert.equal(result.referenceDate, '2026-10-31');
  assert.equal(key(result.dueDate), '2026-11-15');
  assert.deepEqual(deadline(JSON.parse(JSON.stringify(event))), result);
  assert.deepEqual(event, before);
});

test('SSH retains the configured 30-day term, even without a linked invoice entity', () => {
  const event = service({ client: { name: 'SSH', billingMethod: 'monthly', paymentTerm: 'days_30' } });
  assert.equal(key(deadline(event).dueDate), '2026-11-30');
  assert.equal(deadline(event).status, 'within_term');
  assert.equal(deadline(event, '2026-12-01').label, 'Vencida há 1 dia');
});

test('due today is not overdue; no money is created and full settlement clears the alert', () => {
  const event = service();
  assert.equal(deadline(event, '2026-10-15').label, 'Vence hoje');
  assert.equal(shouldShowClientPaymentAlert(event, { today: '2026-10-15' }), false);
  assert.equal(clientPaymentSummary(event).received, 0);
  const paid = { ...event, paidAmount: 295.2, billingStatus: 'paid' };
  assert.equal(deadline(paid).label, 'Pago'); assert.equal(shouldShowClientPaymentAlert(paid, { today }), false);
});

test('missing conditions do not invent a deadline; custom terms and DST calendar days are respected', () => {
  assert.equal(deadline(service({ client: {} })).label, 'Data por configurar');
  const custom = service({ client: { paymentTerm: 'custom', paymentTermDays: 5 },
    clientPaymentRecord: { version: 1, entries: [], commercialStatus: 'invoiced', commercialIssueDate: '2026-10-24' } });
  assert.equal(key(deadline(custom).dueDate), '2026-10-29');
  assert.equal(deadline(custom, '2026-10-30').overdueDays, 1);
  assert.equal(normalizeCommercialIssueDate('2026-02-30'), null);
  assert.equal(normalizeCommercialIssueDate('2026-10-15T00:00:00Z'), null);
});

test('consulting timing and reloading preserve money, fiscal details, status, audit and archive classification', () => {
  const event = service(), original = structuredClone(event);
  const rows = [{ nonInvoicedServices: [event] }], before = splitClientBillingRows(rows);
  const calculated = deadline(event);
  assert.deepEqual(deadline(JSON.parse(JSON.stringify(event))), calculated);
  assert.deepEqual(event, original); assert.deepEqual(splitClientBillingRows(rows), before);
  assert.equal(clientPaymentSummary(event).outstanding, 295.2);
});
