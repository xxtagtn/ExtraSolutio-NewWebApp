import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  countStaffPaymentTabs,
  staffPaymentFiltersMatch,
  staffPaymentSearchMatches,
  STAFF_PAYMENT_WORKFLOW_TABS,
  staffPaymentWorkflowTab,
} from './staffPaymentWorkflow.js';

const tabs = [
  { id: 'all', label: 'Todos os serviços', countBy: 'services' },
  ...STAFF_PAYMENT_WORKFLOW_TABS,
];

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
