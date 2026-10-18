import test from 'node:test';
import assert from 'node:assert/strict';
import { billingDayKey, billingDueDate, billingTiming, clientBillingPeriodForDay } from './clientBillingCalendar.js';
import { effectiveInvoiceDueDate, invoiceBillingReferenceDate } from './invoiceLifecycle.js';

const client = (billingMethod, paymentTerm = 'days_15', extra = {}) => ({ billingMethod, paymentTerm, ...extra });
for (const [name, method, term, day, reference, due] of [
  ['A monthly + 15', 'monthly', 'days_15', '2026-10-03', '2026-10-31', '2026-11-15'],
  ['B monthly + 30', 'monthly', 'days_30', '2026-10-03', '2026-10-31', '2026-11-30'],
  ['C first fortnight', 'biweekly', 'days_15', '2026-10-01', '2026-10-15', '2026-10-30'],
  ['D second fortnight', 'biweekly', 'days_15', '2026-10-16', '2026-10-31', '2026-11-15'],
  ['E per event + 5', 'per_event', 'days_5', '2026-10-10', '2026-10-11', '2026-10-16'],
  ['F immediate', 'monthly', 'immediate', '2026-10-10', '2026-10-31', '2026-10-31'],
  ['L February 28', 'monthly', 'days_15', '2026-02-01', '2026-02-28', '2026-03-15'],
  ['L leap February 29', 'biweekly', 'days_15', '2028-02-16', '2028-02-29', '2028-03-15'],
  ['L April 30', 'monthly', 'days_30', '2026-04-01', '2026-04-30', '2026-05-30'],
  ['M December to January', 'monthly', 'days_15', '2026-12-21', '2026-12-31', '2027-01-15'],
]) test(name, () => {
  const config = client(method, term), period = clientBillingPeriodForDay(day, config);
  assert.equal(period.referenceDate, reference); assert.equal(billingDueDate(reference, config), due);
  assert.equal(billingTiming(reference, config, { outstanding: 1, now: `${due}T12:00:00Z` }).status, 'due_today');
});

test('G custom text never becomes a fabricated monthly calendar; numeric terms stay executable', () => {
  const config = client('custom', 'custom', { billingCustomRule: 'Conforme contrato', paymentTermDays: 12 });
  assert.equal(clientBillingPeriodForDay('2026-10-01', config).referenceDate, null);
  assert.equal(billingDueDate('2026-10-15', config), '2026-10-27');
  for (const paymentTermDays of [null, '', undefined, -1, 1.5, 'text']) assert.equal(billingDueDate('2026-10-15', { ...config, paymentTermDays }), null);
});

test('J partial overdue, K fully paid never overdue; Lisbon midnight and DST are calendar based', () => {
  const config = client('biweekly', 'immediate');
  assert.equal(billingTiming('2026-10-15', config, { outstanding: 18.45, now: '2026-10-17T12:00:00Z' }).overdueDays, 2);
  assert.equal(billingTiming('2026-10-15', config, { outstanding: 0, now: '2026-10-17T12:00:00Z' }).status, 'paid');
  assert.equal(billingTiming('2026-10-25', config, { outstanding: 1, now: '2026-10-26T12:00:00Z' }).overdueDays, 1);
  assert.equal(billingDayKey('2026-02-30'), null); assert.equal(billingDayKey(new Date('invalid')), null);
});

test('invoice reference is October month end even when processed on 10 November; historical issue is not mutated', () => {
  const invoice = { status: 'issued', issueDate: '2026-11-10', client: client('monthly'), event: { date: '2026-10-02' } };
  const before = structuredClone(invoice);
  assert.equal(invoiceBillingReferenceDate(invoice), '2026-10-31');
  assert.equal(billingDayKey(effectiveInvoiceDueDate(invoice)), '2026-11-15');
  assert.deepEqual(invoice, before);
});

test('an ambiguous multi-period document needs an explicit matching period, not a guessed deadline', () => {
  const invoice = { status: 'issued', issueDate: '2026-11-10', client: client('biweekly'), event: { date: '2026-10-14', endDate: '2026-10-18', isContinuous: true } };
  assert.equal(invoiceBillingReferenceDate(invoice), null); assert.equal(effectiveInvoiceDueDate(invoice), null);
  assert.equal(invoiceBillingReferenceDate({ ...invoice, issueDate: '2026-10-15' }), '2026-10-15');
});
