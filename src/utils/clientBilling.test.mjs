import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  billingEventIdsForRow,
  billingPaymentDateForRow,
  clientBillingRowsForActiveEvents,
  billingStatusForRow,
  billingValueForRow,
  dueDateForBillingGroup,
  expandClientBillingRows,
  filterBillingGroupsByPeriod,
  filterServicesByPeriod,
  splitClientBillingRows,
} from './clientBilling.js';

function localDateKey(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('keeps client billing groups separated by the selected month', () => {
  const groups = [
    {
      key: 'black:monthly:2026-10',
      issueDate: new Date('2026-10-31T00:00:00.000Z'),
      total: 120,
      events: [{ id: 1, date: '2026-10-12' }],
    },
    {
      key: 'black:monthly:2026-11',
      issueDate: new Date('2026-11-30T00:00:00.000Z'),
      total: 260,
      events: [{ id: 2, date: '2026-11-21' }],
    },
  ];

  const octoberGroups = filterBillingGroupsByPeriod(groups, '2026-10');

  assert.deepEqual(octoberGroups.map((group) => group.key), ['black:monthly:2026-10']);
  assert.equal(octoberGroups.reduce((sum, group) => sum + group.total, 0), 120);
});

test('includes all groups from the selected year when all months is selected', () => {
  const groups = [
    { key: 'black:monthly:2026-10', issueDate: new Date('2026-10-31'), events: [] },
    { key: 'black:monthly:2026-11', issueDate: new Date('2026-11-30'), events: [] },
    { key: 'black:monthly:2027-01', issueDate: new Date('2027-01-31'), events: [] },
  ];

  const annualGroups = filterBillingGroupsByPeriod(groups, '2026-00');

  assert.deepEqual(annualGroups.map((group) => group.key), ['black:monthly:2026-10', 'black:monthly:2026-11']);
});

test('includes a continuous event when a turn falls in the selected month', () => {
  const services = filterServicesByPeriod([{
    date: '2026-06-29',
    endDate: '2026-07-05',
    assignments: [
      { assignmentDate: '2026-06-29' },
      { assignmentDate: '2026-07-04' },
    ],
  }], '2026-07');

  assert.equal(services.length, 1);
});

test('does not match a monthly group by due date when the service belongs to another month', () => {
  const groups = [
    {
      key: 'black:monthly:2026-07',
      issueDate: new Date('2026-07-31T00:00:00.000Z'),
      dueDate: new Date('2026-06-30T00:00:00.000Z'),
      events: [{ id: 11, date: '2026-07-08' }],
    },
  ];

  assert.deepEqual(filterBillingGroupsByPeriod(groups, '2026-06'), []);
  assert.deepEqual(filterBillingGroupsByPeriod(groups, '2026-07').map((group) => group.key), ['black:monthly:2026-07']);
});

test('does not assign a due date before the invoice is issued', () => {
  const dueDate = dueDateForBillingGroup({
    method: 'monthly',
    issueDate: new Date('2026-07-31T00:00:00.000Z'),
    client: { paymentTerm: 'days_15' },
    events: [{ date: '2026-07-08' }],
  });

  assert.equal(dueDate, null);
});

test('calculates the due date from the actual invoice issue date and client payment term', () => {
  const dueDate = dueDateForBillingGroup({
    invoice: {
      status: 'issued',
      issueDate: '2026-07-31T00:00:00.000Z',
    },
    client: { paymentTerm: 'days_15' },
  });

  assert.equal(localDateKey(dueDate), '2026-08-15');
});

test('creates one visible client row per billing period', () => {
  const rows = expandClientBillingRows({
    id: 8,
    name: 'BLACK',
    billingMethod: 'monthly',
    invoices: [],
    nonInvoicedServices: [
      { id: 10, name: 'Junho', date: '2026-06-07', billingStatus: 'pending', financial: { receivable: 0 } },
      { id: 11, name: 'Julho', date: '2026-07-08', billingStatus: 'pending', financial: { receivable: 0 } },
    ],
    billingGroups: [
      {
        key: '8:monthly:2026-5',
        label: 'BLACK · junho de 2026',
        method: 'monthly',
        dueDate: new Date('2026-06-30'),
        total: 1571.1,
        events: [{ id: 10, name: 'Junho', date: '2026-06-07', billingStatus: 'pending' }],
      },
      {
        key: '8:monthly:2026-6',
        label: 'BLACK · julho de 2026',
        method: 'monthly',
        dueDate: new Date('2026-07-31'),
        total: 248.1,
        events: [{ id: 11, name: 'Julho', date: '2026-07-08', billingStatus: 'pending' }],
      },
    ],
  });

  assert.deepEqual(rows.map((row) => row.billingPeriodLabel), ['BLACK · junho de 2026', 'BLACK · julho de 2026']);
  assert.deepEqual(rows.map((row) => row.pendingBilling), [1571.1, 248.1]);
  assert.deepEqual(rows.map((row) => row.billingGroups[0].events.map((event) => event.id)), [[10], [11]]);
});

test('keeps services from the same monthly billing period in one visible row when statuses differ', () => {
  const rows = expandClientBillingRows({
    id: 8,
    name: 'BLACK',
    billingMethod: 'monthly',
    invoices: [],
    nonInvoicedServices: [
      { id: 20, name: 'BLACK 1', date: '2026-06-07', billingStatus: 'pending', financial: { revenue: 120, receivable: 120 } },
      { id: 21, name: 'BLACK 2', date: '2026-06-18', billingStatus: 'invoiced', financial: { revenue: 180, receivable: 180 } },
    ],
    billingGroups: [
      {
        key: '8:monthly:2026-5',
        label: 'BLACK - junho de 2026',
        method: 'monthly',
        issueDate: new Date('2026-06-30'),
        dueDate: new Date('2026-06-30'),
        total: 120,
        events: [{ id: 20, name: 'BLACK 1', date: '2026-06-07', billingStatus: 'pending', financial: { revenue: 120, receivable: 120 } }],
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].billingGroups[0].events.map((event) => event.id), [20, 21]);
  assert.equal(rows[0].pendingBilling, 300);
  assert.equal(rows[0].totalOpen, 300);
});

test('returns every service id covered by a client billing row', () => {
  const ids = billingEventIdsForRow({
    billingGroups: [
      { events: [{ id: 20 }, { id: 21 }] },
      { events: [{ id: 21 }, { id: 22 }] },
    ],
    nonInvoicedServices: [{ id: 23 }],
  });

  assert.deepEqual(ids, [20, 21, 22]);
});

test('shows a pending billing status while any service in the row is still pending', () => {
  const status = billingStatusForRow({
    billingGroups: [
      { events: [{ id: 20, billingStatus: 'invoiced' }, { id: 21, billingStatus: 'pending' }] },
    ],
  });

  assert.equal(status, 'pending');
});

test('creates billing period rows from closed standalone monthly services', () => {
  const rows = expandClientBillingRows({
    id: 8,
    name: 'BLACK',
    billingMethod: 'monthly',
    invoices: [],
    nonInvoicedServices: [
      { id: 30, name: 'BLACK junho', date: '2026-06-07', billingStatus: 'invoiced', financial: { revenue: 120, receivable: 120 } },
      { id: 31, name: 'BLACK julho', date: '2026-07-08', billingStatus: 'invoiced', financial: { revenue: 180, receivable: 180 } },
    ],
    billingGroups: [],
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.billingGroups[0].events.map((event) => event.id)), [[30], [31]]);
});

test('splits fully paid service rows into archive rows', () => {
  const paidRow = {
    rowId: 'client:8:group:paid',
    billingGroups: [{ events: [{ id: 30, billingStatus: 'paid' }] }],
    nonInvoicedServices: [],
  };
  const pendingRow = {
    rowId: 'client:8:group:pending',
    billingGroups: [{ events: [{ id: 31, billingStatus: 'paid' }, { id: 32, billingStatus: 'pending' }] }],
    nonInvoicedServices: [],
  };

  const result = splitClientBillingRows([paidRow, pendingRow]);

  assert.deepEqual(result.activeRows.map((row) => row.rowId), ['client:8:group:pending']);
  assert.deepEqual(result.archivedRows.map((row) => row.rowId), ['client:8:group:paid']);
});

test('keeps a paid unregistered client without an invoice visible for billing', () => {
  const paidWithoutInvoice = {
    rowId: 'unregistered-event:50',
    isUnregisteredClient: true,
    invoices: [],
    billingGroups: [{
      events: [{
        id: 50,
        billingStatus: 'paid',
        financial: { hasInvoice: false, revenue: 1166.04, receivable: 0 },
      }],
    }],
    nonInvoicedServices: [],
  };

  const result = splitClientBillingRows([paidWithoutInvoice]);

  assert.deepEqual(result.activeRows.map((row) => row.rowId), ['unregistered-event:50']);
  assert.deepEqual(result.archivedRows, []);
});

test('archives an unregistered client after its paid service has an invoice', () => {
  const paidWithInvoice = {
    rowId: 'unregistered-event:51',
    isUnregisteredClient: true,
    invoices: [{ id: 7, status: 'paid' }],
    billingGroups: [{
      events: [{
        id: 51,
        billingStatus: 'paid',
        financial: { hasInvoice: true, revenue: 250, receivable: 0 },
      }],
    }],
    nonInvoicedServices: [],
  };

  const result = splitClientBillingRows([paidWithInvoice]);

  assert.deepEqual(result.activeRows, []);
  assert.deepEqual(result.archivedRows.map((row) => row.rowId), ['unregistered-event:51']);
});

test('uses event revenue as the archived billing value when receivable is already zero', () => {
  const row = {
    billingGroups: [{
      total: 0,
      events: [
        { id: 30, billingStatus: 'paid', financial: { receivable: 0, revenue: 120 } },
        { id: 31, billingStatus: 'paid', financial: { receivable: 0, revenue: 180 } },
      ],
    }],
    nonInvoicedServices: [],
    pendingBilling: 0,
    totalOpen: 0,
  };

  assert.equal(billingValueForRow(row), 300);
});

test('returns the latest payment date from paid services in a billing row', () => {
  const row = {
    billingGroups: [{
      events: [
        { id: 30, billingStatus: 'paid', billingPaymentDate: '2026-06-12T00:00:00.000Z' },
        { id: 31, billingStatus: 'paid', billingPaymentDate: '2026-06-18T00:00:00.000Z' },
      ],
    }],
  };

  assert.equal(localDateKey(billingPaymentDateForRow(row)), '2026-06-18');
});

test('shows only client rows with active events and orders them alphabetically', () => {
  const rows = clientBillingRowsForActiveEvents([
    {
      rowId: 'client:2:empty',
      id: 2,
      name: 'Zulu',
      billingGroups: [],
      nonInvoicedServices: [],
      nextDueDate: '2026-06-10',
    },
    {
      rowId: 'client:3:event',
      id: 3,
      name: 'BLACK',
      billingGroups: [{ events: [{ id: 20, billingStatus: 'pending' }] }],
      nonInvoicedServices: [],
      nextDueDate: '2026-06-12',
    },
    {
      rowId: 'client:1:event',
      id: 1,
      name: 'Ana Eventos',
      billingGroups: [],
      nonInvoicedServices: [{ id: 10, billingStatus: 'pending' }],
      nextDueDate: '2026-06-15',
    },
  ]);

  assert.deepEqual(rows.map((row) => row.name), ['Ana Eventos', 'BLACK']);
});
