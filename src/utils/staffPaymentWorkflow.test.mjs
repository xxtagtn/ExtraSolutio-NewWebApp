import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  countStaffPaymentTabs,
  sumStaffPaymentTabs,
  staffPaymentFiltersMatch,
  staffPaymentSearchMatches,
  STAFF_PAYMENT_WORKFLOW_TABS,
  staffPaymentWorkflowTab,
} from './staffPaymentWorkflow.js';
import { staffAssignmentPaymentTotal } from './staffPayment.js';
import { staffPaymentRemaining } from './staffAdvances.js';

const tabs = [
  { id: 'all', label: 'Todos os serviços', countBy: 'services' },
  ...STAFF_PAYMENT_WORKFLOW_TABS,
];

const paymentAmount = (assignment) => staffPaymentRemaining(
  staffAssignmentPaymentTotal(assignment), assignment.advancePayments,
);

test('maps existing payment states to their workflow tabs', () => {
  assert.equal(staffPaymentWorkflowTab({ _financeReady: true, paymentStatus: 'unpaid' }), 'unpaid');
  assert.equal(staffPaymentWorkflowTab({ _financeReady: true, paymentStatus: 'validated_es' }), 'validated_es');
  assert.equal(staffPaymentWorkflowTab({ _financeReady: true, paymentStatus: 'awaiting_data' }), 'awaiting_data');
  assert.equal(staffPaymentWorkflowTab({ _financeReady: true, paymentStatus: 'penhorado' }), 'penhorado');
  assert.equal(staffPaymentWorkflowTab({ _financeReady: true, paymentStatus: 'ganho' }), 'ganho');
  assert.equal(staffPaymentWorkflowTab({ _financeReady: true, paymentStatus: 'paid' }), 'paid');
});

test('preserves the new payment states before finance validation', () => {
  assert.equal(staffPaymentWorkflowTab({ _financeReady: false, paymentStatus: 'penhorado' }), 'penhorado');
  assert.equal(staffPaymentWorkflowTab({ _financeReady: false, paymentStatus: 'ganho' }), 'ganho');
});

test('keeps non-ready assignments in the derived awaiting validation phase', () => {
  assert.equal(staffPaymentWorkflowTab({ _financeReady: false, paymentStatus: 'unpaid' }), 'awaiting_validation');
});

test('preserves an explicit processed state when an event is reopened', () => {
  assert.equal(staffPaymentWorkflowTab({ _financeReady: false, paymentStatus: 'paid' }), 'paid');
  assert.equal(staffPaymentWorkflowTab({ _financeReady: false, paymentStatus: 'validated_es' }), 'validated_es');
});

test('searches collaborators by name, short name or nif without accents', () => {
  const assignment = {
    collaborator: {
      name: 'Miriam Peçanha de Oliveira',
      shortName: 'Miriam Oliveira',
      nif: '326077405',
    },
  };

  assert.equal(staffPaymentSearchMatches(assignment, 'pecanha'), true);
  assert.equal(staffPaymentSearchMatches(assignment, '326077405'), true);
  assert.equal(staffPaymentSearchMatches(assignment, 'Ana'), false);
});

test('filters payment rows by event and collaborator independently', () => {
  const assignment = { event: { id: 21 }, collaboratorId: 8 };

  assert.equal(staffPaymentFiltersMatch(assignment, { eventId: '21', collaboratorId: '8' }), true);
  assert.equal(staffPaymentFiltersMatch(assignment, { eventId: '22', collaboratorId: '8' }), false);
  assert.equal(staffPaymentFiltersMatch(assignment, { eventId: 'all', collaboratorId: '9' }), false);
  assert.equal(staffPaymentFiltersMatch(assignment, { eventId: 'all', collaboratorId: 'all' }), true);
});

test('counts one service and one unique collaborator in the relevant tabs', () => {
  const entries = [{ id: 1, collaboratorId: 11, paymentStatus: 'unpaid', _financeReady: true }];

  assert.deepEqual(countStaffPaymentTabs(entries, tabs), {
    all: 1,
    unpaid: 1,
    awaiting_validation: 0,
    validated_es: 0,
    awaiting_data: 0,
    penhorado: 0,
    ganho: 0,
    paid: 0,
  });
});

test('counts services as rows and collaborator tabs by distinct collaborator ID', () => {
  const entries = [
    { collaboratorId: 11, paymentStatus: 'unpaid', _financeReady: true },
    { collaboratorId: 11, paymentStatus: 'unpaid', _financeReady: true },
    { collaboratorId: 22, paymentStatus: 'unpaid', _financeReady: true },
    { collaboratorId: 22, paymentStatus: 'unpaid', _financeReady: true },
    { collaboratorId: 11, paymentStatus: 'validated_es', _financeReady: true },
    { collaboratorId: 33, paymentStatus: 'validated_es', _financeReady: true },
    { collaboratorId: 33, paymentStatus: 'validated_es', _financeReady: true },
    { collaboratorId: 66, paymentStatus: 'penhorado', _financeReady: true },
    { collaboratorId: 66, paymentStatus: 'penhorado', _financeReady: true },
    { collaboratorId: 77, paymentStatus: 'ganho', _financeReady: true },
    { collaboratorId: 44, paymentStatus: 'paid', _financeReady: true },
    { collaboratorId: 44, paymentStatus: 'paid', _financeReady: true },
    { collaboratorId: 55, paymentStatus: 'unpaid', _financeReady: false },
    { collaboratorId: 55, paymentStatus: 'unpaid', _financeReady: false },
  ];

  const counts = countStaffPaymentTabs(entries, tabs);
  assert.equal(counts.all, 14);
  assert.equal(counts.unpaid, 2);
  assert.equal(counts.validated_es, 3);
  assert.equal(counts.paid, 1);
  assert.equal(counts.awaiting_validation, 2);
  assert.equal(counts.penhorado, 2);
  assert.equal(counts.ganho, 1);
});

test('recalculates badge counts after filtered results and bulk status changes', () => {
  const entries = [
    ...Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      collaboratorId: 11,
      event: { id: 7 },
      assignmentDate: '2026-10-04',
      paymentStatus: 'unpaid',
      _financeReady: true,
      collaborator: { name: 'Miriam Oliveira' },
    })),
    {
      id: 26,
      collaboratorId: 22,
      event: { id: 8 },
      assignmentDate: '2026-10-05',
      paymentStatus: 'unpaid',
      _financeReady: true,
      collaborator: { name: 'Ana Rosa' },
    },
  ];
  const selectedFilters = entries
    .filter((entry) => entry.assignmentDate === '2026-10-04')
    .filter((entry) => staffPaymentFiltersMatch(entry, { eventId: '7', collaboratorId: '11' }))
    .filter((entry) => staffPaymentSearchMatches(entry, 'miriam'));

  assert.equal(countStaffPaymentTabs(selectedFilters, tabs).unpaid, 1);
  assert.equal(countStaffPaymentTabs(selectedFilters, tabs).all, 25);

  const bulkChanged = entries.map((entry) => (
    entry.collaboratorId === 11 ? { ...entry, paymentStatus: 'paid' } : entry
  ));
  const countsAfterBulkChange = countStaffPaymentTabs(bulkChanged, tabs);
  assert.equal(countsAfterBulkChange.all, 26);
  assert.equal(countsAfterBulkChange.unpaid, 1);
  assert.equal(countsAfterBulkChange.paid, 1);
});

test('does not count collaborator rows without a collaborator identifier', () => {
  const counts = countStaffPaymentTabs([
    { paymentStatus: 'unpaid', _financeReady: true },
    { paymentStatus: 'unpaid', _financeReady: true, collaborator: { id: 19 } },
  ], tabs);

  assert.equal(counts.all, 2);
  assert.equal(counts.unpaid, 1);
});

test('empty payment tabs retain their counts and show zero monetary totals', () => {
  const totals = sumStaffPaymentTabs([], tabs, paymentAmount);
  assert.deepEqual(totals, Object.fromEntries(tabs.map((tab) => [tab.id, 0])));
  assert.deepEqual(countStaffPaymentTabs([], tabs), totals);
});

test('sums services in their current state, not every service belonging to a collaborator', () => {
  const entries = [
    { id: 1, collaboratorId: 11, totalPay: 100, paymentStatus: 'unpaid' },
    { id: 2, collaboratorId: 11, totalPay: 200, paymentStatus: 'unpaid' },
    { id: 3, collaboratorId: 11, totalPay: 50, paymentStatus: 'paid' },
    { id: 4, collaboratorId: 22, totalPay: 70, paymentStatus: 'paid' },
    { id: 5, collaboratorId: 22, totalPay: 80, paymentStatus: 'validated_es' },
    { id: 6, collaboratorId: 33, totalPay: 90, paymentStatus: 'awaiting_data' },
    { id: 7, collaboratorId: 33, totalPay: 30, paymentStatus: 'penhorado' },
    { id: 8, collaboratorId: 44, totalPay: 20, paymentStatus: 'ganho' },
    { id: 9, collaboratorId: 44, totalPay: 40, paymentStatus: 'unpaid', _financeReady: false },
  ];
  assert.deepEqual(sumStaffPaymentTabs(entries, tabs, paymentAmount), {
    all: 680, unpaid: 300, paid: 120, validated_es: 80,
    awaiting_data: 90, penhorado: 30, ganho: 20, awaiting_validation: 40,
  });
  const counts = countStaffPaymentTabs(entries, tabs);
  assert.equal(counts.all, 9);
  assert.equal(counts.unpaid, 1);
  assert.equal(counts.paid, 2);
});

test('tab totals reuse validated hours, rates, travel, VAT, adjustments, advances and car payments', () => {
  const assignment = {
    id: 1, collaboratorId: 11, paymentStatus: 'paid', status: 'confirmed',
    assignmentDate: '2026-09-04', checkIn: '08:00', checkOut: '18:00',
    validatedCheckIn: '08:00', validatedCheckOut: '16:00', hourlyRate: 10,
    paymentAdjustment: '-2,50', collaborator: { id: 11, includeVat: true },
    advancePayments: JSON.stringify([{ amount: 20 }, { amount: 40, car: true }]),
    event: { id: 7, date: '2026-09-04', status: 'finalized', travelCars: [
      { kind: 'staff_compensation', assignmentId: 1, collaboratorId: 11, durationHours: 2 },
    ] },
  };
  const before = structuredClone(assignment);
  assert.equal(paymentAmount(assignment), 140.5);
  const totals = sumStaffPaymentTabs([assignment], tabs, paymentAmount);
  assert.equal(totals.paid, 140.5);
  assert.equal(totals.all, 140.5);
  assert.equal(totals.unpaid, 0);
  assert.deepEqual(assignment, before);
});

test('zero balances and explicit legacy totals follow existing payment rules', () => {
  const entries = [
    { id: 1, totalPay: 100, paymentAdjustment: -200, paymentStatus: 'unpaid' },
    { id: 2, totalPay: 80, advancePayments: [{ amount: 90 }], paymentStatus: 'paid' },
    { id: 3, totalPay: 12.43, paymentStatus: 'paid' },
  ];
  const totals = sumStaffPaymentTabs(entries, tabs, paymentAmount);
  assert.equal(totals.unpaid, 0);
  assert.equal(totals.paid, 12.43);
  assert.equal(totals.all, 12.43);
});

test('tab sums retain exact cents across many services and rounding boundaries', () => {
  const entries = Array.from({ length: 1001 }, (_, index) => ({
    id: index + 1, totalPay: index % 2 ? 0.2 : 0.1, paymentStatus: 'paid',
  }));
  const totals = sumStaffPaymentTabs(entries, tabs, paymentAmount);
  assert.equal(totals.paid, 150.1);
  assert.equal(totals.all, 150.1);
});

test('payment tab amounts respect the same filtered and searched dataset as counts', () => {
  const entries = [
    { id: 1, collaboratorId: 11, event: { id: 7 }, assignmentDate: '2026-09-04', totalPay: 100, paymentStatus: 'paid', collaborator: { name: 'Miriam Oliveira' } },
    { id: 2, collaboratorId: 11, event: { id: 8 }, assignmentDate: '2026-09-04', totalPay: 200, paymentStatus: 'paid', collaborator: { name: 'Miriam Oliveira' } },
    { id: 3, collaboratorId: 22, event: { id: 7 }, assignmentDate: '2026-09-05', totalPay: 300, paymentStatus: 'paid', collaborator: { name: 'Ana Rosa' } },
  ];
  const filtered = entries.filter((entry) => entry.assignmentDate === '2026-09-04')
    .filter((entry) => staffPaymentFiltersMatch(entry, { eventId: '7', collaboratorId: '11' }))
    .filter((entry) => staffPaymentSearchMatches(entry, 'miriam'));
  assert.equal(countStaffPaymentTabs(filtered, tabs).paid, 1);
  assert.equal(sumStaffPaymentTabs(filtered, tabs, paymentAmount).paid, 100);
  assert.equal(sumStaffPaymentTabs([], tabs, paymentAmount).paid, 0);
});

test('validation moves its amount from awaiting validation to unpaid without changing payment rules', () => {
  const entry = { id: 1, collaboratorId: 11, _financeReady: false, paymentStatus: 'unpaid',
    plannedCheckIn: '08:00', plannedCheckOut: '16:00', hourlyRate: 10 };
  const before = sumStaffPaymentTabs([entry], tabs, paymentAmount);
  assert.equal(before.awaiting_validation, 80);
  assert.equal(before.unpaid, 0);
  const validated = { ...entry, _financeReady: true, validatedCheckIn: '08:00', validatedCheckOut: '15:30' };
  const after = sumStaffPaymentTabs([validated], tabs, paymentAmount);
  assert.equal(after.awaiting_validation, 0);
  assert.equal(after.unpaid, 75);
  assert.equal(after.all, 75);
});

for (const size of [1, 5, 10, 25, 50]) {
  test(`recalculates tab amounts and unique counts after ${size} services move between every payment state`, () => {
    const entries = Array.from({ length: size }, (_, index) => ({
      id: index + 1, collaboratorId: index % 2 ? 22 : 11,
      totalPay: 10.25, paymentStatus: 'unpaid', _financeReady: true,
    }));
    const original = structuredClone(entries);
    assert.equal(sumStaffPaymentTabs(entries, tabs, paymentAmount).unpaid, size * 10.25);
    for (const paymentStatus of ['paid', 'validated_es', 'awaiting_data', 'penhorado', 'ganho']) {
      const updated = entries.map((entry) => ({ ...entry, paymentStatus }));
      const totals = sumStaffPaymentTabs(updated, tabs, paymentAmount);
      assert.equal(totals.unpaid, 0);
      assert.equal(totals[paymentStatus], size * 10.25);
      assert.equal(totals.all, size * 10.25);
      assert.equal(Object.entries(totals).filter(([id]) => id !== 'all').reduce((sum, [, amount]) => sum + amount, 0), totals.all);
      assert.equal(countStaffPaymentTabs(updated, tabs)[paymentStatus], paymentStatus === 'paid' ? Math.min(size, 2) : size);
    }
    assert.deepEqual(entries, original);
  });
}
