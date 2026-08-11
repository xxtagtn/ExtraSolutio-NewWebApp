import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clientDetailTabFromQuery,
  serviceDetailTabFromQuery,
  shouldHandleDeepLink,
  staffPaymentLinkSelection,
} from './deepLinks.js';

test('maps dashboard service tab links to service detail tabs', () => {
  assert.equal(serviceDetailTabFromQuery('collaborators'), 'team');
  assert.equal(serviceDetailTabFromQuery('colaboradores'), 'team');
  assert.equal(serviceDetailTabFromQuery('validation'), 'validation');
  assert.equal(serviceDetailTabFromQuery('custos'), 'costs');
  assert.equal(serviceDetailTabFromQuery('unknown'), null);
});

test('maps client deep links to available client tabs', () => {
  assert.equal(clientDetailTabFromQuery('rules'), 'rules');
  assert.equal(clientDetailTabFromQuery('regras'), 'rules');
  assert.equal(clientDetailTabFromQuery('locations'), 'locations');
  assert.equal(clientDetailTabFromQuery('dados'), 'data');
  assert.equal(clientDetailTabFromQuery('unknown'), null);
});

test('builds staff payment filters from an assignment deep link', () => {
  const state = staffPaymentLinkSelection({
    id: 900,
    collaboratorId: 12,
    paymentStatus: 'paid',
    event: { id: 80 },
  }, {
    paymentMonth: '2026-07',
    workDate: '2026-06-21',
  });

  assert.deepEqual(state, {
    selectedMonth: '2026-07',
    staffPaymentTab: 'paid',
    selectedStaffPaymentIds: ['900'],
    staffFilters: {
      eventId: '80',
      collaboratorId: '12',
      date: '2026-06-21',
    },
  });
});

test('opens forecast staff payments in awaiting validation', () => {
  const state = staffPaymentLinkSelection({
    id: 901,
    collaboratorId: 13,
    paymentStatus: 'unpaid',
    _financeReady: false,
    event: { id: 81 },
  });

  assert.equal(state.staffPaymentTab, 'awaiting_validation');
});

test('only treats deep links as handled after the destination has opened', () => {
  assert.equal(shouldHandleDeepLink('4', '', false), true);
  assert.equal(shouldHandleDeepLink('4', '4', false), false);
  assert.equal(shouldHandleDeepLink('4', '', true), false);
});
