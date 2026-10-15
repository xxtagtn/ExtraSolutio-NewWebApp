import test from 'node:test';
import assert from 'node:assert/strict';
import { externalServiceCanArchive, externalServiceCompletionBlocker, externalServiceIsSettled, isExternalOnlyService } from './externalServiceWorkflow.js';
import { nextAutomaticServiceStatus, nextTimeValidationServiceStatus, serviceStatusForDisplay } from './serviceStatus.js';
import { serviceChecklist } from './serviceDetail.js';
import { isArchivedService } from './serviceStatus.js';
import { externalClientBillingRows, splitClientBillingRows, billingValueForRow } from './clientBilling.js';
import { isFinanceReadyEvent } from './financeReadiness.js';

const external = (patch = {}) => ({ date: '2026-07-30', status: 'drafting', statusMode: 'automatic',
  requiredRoles: '[]', assignmentDrafts: null, assignments: [],
  externalCosts: JSON.stringify([{ type: 'Catering', supplier: 'Parceiro QA', costAmount: 1000, marginPercent: 20 }]),
  ...patch });
const now = new Date('2026-10-13T12:00:00Z');

test('identifies configured external services, not an empty event', () => {
  assert.equal(isExternalOnlyService(external()), true);
  assert.equal(isExternalOnlyService(external({ externalCosts: [] })), false);
  assert.equal(isExternalOnlyService(external({ externalCosts: [{ type: 'Catering', costAmount: '' }] })), false);
});

test('staff requirements, empty allocation drafts and actual assignments all prevent external-only classification', () => {
  for (const patch of [
    { requiredRoles: [{ role: 'Emp.Mesa', qty: 5 }] },
    { requiredRoles: [{ role: 'Bar', qty: 2 }] },
    { requiredRoles: [{ role: 'Emp.Mesa', qty: 0 }] },
    { requiredRoles: [{ quantity: 4 }] },
    { assignmentDrafts: [{ role: 'Bar', collaboratorId: null }] },
    { assignments: [{ collaboratorId: 1, role: 'Emp.Mesa' }] },
    { assignments: [{ collaboratorId: 1, status: 'cancelled' }] },
  ]) assert.equal(isExternalOnlyService(external(patch)), false, JSON.stringify(patch));
});

test('invalid or unloaded configuration does not authorize external completion', () => {
  for (const field of ['requiredRoles', 'assignmentDrafts', 'externalCosts']) {
    for (const value of ['{invalid', '{}', 'null', '123']) assert.equal(isExternalOnlyService(external({ [field]: value })), false);
  }
  assert.equal(isExternalOnlyService(external({ assignments: undefined })), false);
});

test('external services never enter hour validation and only auto-finalize when paid AND elapsed', () => {
  for (const status of ['drafting', 'team_complete', 'in_progress', 'to_validate_staff', 'to_validate_client']) {
    for (const billingStatus of ['pending', 'invoiced', 'paid']) {
      const expected = billingStatus === 'paid' ? 'finalized' : 'in_progress';
      assert.equal(nextAutomaticServiceStatus(external({ status, billingStatus }), now), expected);
      assert.equal(nextTimeValidationServiceStatus(external({ status, billingStatus })), expected);
    }
  }
  assert.equal(nextAutomaticServiceStatus(external({ date: '2030-07-30', billingStatus: 'paid' }), now), 'drafting');
  assert.equal(serviceStatusForDisplay(external({ status: 'finalized', statusMode: 'manual' }), now), 'finalized');
});

test('archive requires an elapsed whole period, even after manual completion or advance payment', () => {
  const onDay = external({ status: 'finalized', billingStatus: 'paid', date: '2026-12-20' });
  assert.equal(externalServiceCanArchive(onDay, new Date('2026-12-01T12:00:00Z')), false);
  assert.equal(externalServiceCanArchive(onDay, new Date('2026-12-20T12:00:00Z')), false);
  assert.equal(externalServiceCanArchive(onDay, new Date('2026-12-21T00:00:00Z')), true);
  assert.equal(externalServiceCanArchive(external({ status: 'finalized', billingStatus: 'pending' }), now), false);
});

test('issued invoices are authoritative for complete receipt; neither amounts nor partner payments suffice', () => {
  const issued = { id: 1, issueDate: '2026-07-30', status: 'issued' };
  assert.equal(externalServiceIsSettled(external({ billingStatus: 'paid', invoices: [issued] })), false);
  for (const status of ['paid', 'settled', 'regularized']) {
    assert.equal(externalServiceIsSettled(external({ invoices: [{ ...issued, status }] })), true);
  }
  assert.equal(externalServiceIsSettled(external({ invoices: [{ ...issued, status: 'paid' }, issued] })), false);
  assert.equal(externalServiceIsSettled(external({ paidAmount: 1476 })), false);
});

test('staff and mixed services keep the existing workflow', () => {
  const emptyTeam = external({ requiredRoles: [{ role: 'Emp.Mesa', qty: 4 }] });
  assert.equal(nextAutomaticServiceStatus(emptyTeam, now), 'drafting');
  const staff = external({ assignments: [{ collaboratorId: 1, role: 'Bar', status: 'confirmed' }] });
  assert.equal(nextAutomaticServiceStatus(staff, now), 'to_validate_staff');
  assert.equal(nextTimeValidationServiceStatus(staff), 'to_validate_staff');
});

test('explicit completion respects last active day, cancelled days and overnight end in Lisbon', () => {
  const event = external({ date: '2026-08-01', endDate: '2026-08-05', isContinuous: true,
    startTime: '18:00', endTime: '04:00' });
  assert.ok(externalServiceCompletionBlocker(event, new Date('2026-08-05T20:00:00Z')));
  assert.ok(externalServiceCompletionBlocker(event, new Date('2026-08-06T02:59:00Z')));
  assert.equal(externalServiceCompletionBlocker(event, new Date('2026-08-06T03:00:00Z')), '');
  const cancelled = { ...event, cancelledDays: '[{"date":"2026-08-05"}]' };
  assert.equal(externalServiceCompletionBlocker(cancelled, new Date('2026-08-05T03:00:00Z')), '');
  const day = external({ startTime: '09:00', endTime: '17:00' });
  assert.ok(externalServiceCompletionBlocker(day, new Date('2026-07-30T15:59:00Z')));
  assert.equal(externalServiceCompletionBlocker(day, new Date('2026-07-30T16:00:00Z')), '');
});

test('invalid dates, cancelled events and all-cancelled ranges stay blocked', () => {
  for (const patch of [{ date: 'invalid' }, { date: '2026-02-30' }, { status: 'cancelled' },
    { isContinuous: true, endDate: '2026-01-01' }, { cancelledDays: '[{"date":"2026-07-30"}]' },
    { endTime: '25:00' }]) assert.ok(externalServiceCompletionBlocker(external(patch), now));
});

test('external checklist requires only actual execution, not fabricated staff or hours', () => {
  assert.deepEqual(serviceChecklist(external()).map((item) => [item.id, item.done]), [['external', true], ['execution', false]]);
  assert.equal(serviceChecklist(external({ status: 'finalized' }))[1].done, true);
});

test('Finance and Services share archive eligibility; external service values remain represented once', () => {
  const events = [
    external({ id: 1, billingStatus: 'paid', financial: { revenue: 1476, receivable: 0 } }),
    external({ id: 2, billingStatus: 'paid', date: '2030-12-20', financial: { revenue: 240, receivable: 0 } }),
    external({ id: 3, status: 'finalized', billingStatus: 'invoiced', financial: { revenue: 120, receivable: 120 } }),
  ];
  const rows = externalClientBillingRows(events);
  const split = splitClientBillingRows(rows, { now });
  assert.deepEqual(split.archivedRows.map((row) => row.nonInvoicedServices[0].id), [1]);
  assert.deepEqual(split.activeRows.map((row) => row.nonInvoicedServices[0].id), [2, 3]);
  assert.equal(rows.reduce((sum, row) => sum + billingValueForRow(row), 0), 1476 + 240 + 120);
  for (const event of events) {
    assert.equal(isArchivedService(event, now), split.archivedRows.some((row) => row.nonInvoicedServices[0].id === event.id));
    assert.equal(isFinanceReadyEvent(event), true);
  }
});

test('issued external invoices remain consultable in archive and unsettled invoices prevent archive', () => {
  const event = external({ id: 5, billingStatus: 'paid', invoices: [{ id: 3, eventId: 5, issueDate: '2026-07-30', status: 'issued' }] });
  assert.equal(externalServiceCanArchive(event, now), false);
  const paid = { ...event, invoices: [{ ...event.invoices[0], status: 'paid' }] };
  const rows = externalClientBillingRows([paid], paid.invoices);
  assert.equal(splitClientBillingRows(rows, { now }).archivedRows.length, 1);
  assert.equal(rows[0].invoices[0].id, 3);
  assert.equal(rows[0].nonInvoicedServices[0].id, 5);
});
