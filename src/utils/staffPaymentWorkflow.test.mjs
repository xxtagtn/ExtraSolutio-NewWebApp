import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  staffPaymentFiltersMatch,
  staffPaymentSearchMatches,
  staffPaymentWorkflowTab,
} from './staffPaymentWorkflow.js';

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
