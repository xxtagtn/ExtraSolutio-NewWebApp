import assert from 'node:assert/strict';
import test from 'node:test';
import { updateAssignmentsInBulk } from './assignmentBulkUpdate.js';
import { buildStaffPaymentStatusPayload } from '../../src/utils/staffPaymentBulk.js';

function createTransactionalPrisma(initialRows) {
  const stored = new Map(initialRows.map((row) => [row.id, { ...row }]));
  let transactionCount = 0;
  let updateCount = 0;
  const prisma = {
    eventAssignment: {
      findMany: async ({ where }) => where.id.in.map((id) => stored.get(id)).filter(Boolean),
    },
    $transaction: async (operation) => {
      transactionCount += 1;
      const pending = new Map([...stored].map(([id, row]) => [id, { ...row }]));
      const tx = {
        eventAssignment: {
          update: async ({ where, data }) => {
            updateCount += 1;
            const row = { ...pending.get(where.id), ...data };
            pending.set(where.id, row);
            return row;
          },
        },
      };
      const result = await operation(tx);
      stored.clear();
      for (const [id, row] of pending) stored.set(id, row);
      return result;
    },
  };
  return {
    prisma,
    stored,
    get transactionCount() { return transactionCount; },
    get updateCount() { return updateCount; },
  };
}

test('updates several assignments and synchronizes each event only once', async () => {
  const stored = new Map([
    [1, { id: 1, eventId: 10, checkIn: '10:00' }],
    [2, { id: 2, eventId: 10, checkIn: '11:00' }],
  ]);
  const synchronized = [];
  let transactionCount = 0;
  const eventAssignment = {
    findMany: async ({ where }) => where.id.in.map((id) => stored.get(id)).filter(Boolean),
    update: async ({ where, data }) => {
      const row = { ...stored.get(where.id), ...data };
      stored.set(where.id, row);
      return row;
    },
  };
  const prisma = {
    eventAssignment,
    $transaction: async (operation) => {
      transactionCount += 1;
      return operation({ eventAssignment });
    },
  };

  const rows = await updateAssignmentsInBulk({
    prisma,
    updates: [
      { id: 1, data: { clientCheckIn: '10:05' } },
      { id: 2, data: { clientCheckIn: '11:05' } },
    ],
    normalizeUpdate: async (data) => data,
    synchronizeEvent: async (id, client) => synchronized.push({ id, client }),
  });

  assert.equal(transactionCount, 1);
  assert.deepEqual(rows.map((row) => row.clientCheckIn), ['10:05', '11:05']);
  assert.deepEqual(synchronized.map((item) => item.id), [10]);
  assert.equal(synchronized[0].client.eventAssignment, eventAssignment);
});

test('rolls back assignment changes when event synchronization fails', async () => {
  const stored = new Map([
    [1, { id: 1, eventId: 10, checkIn: '10:00' }],
  ]);
  const prisma = {
    eventAssignment: {
      findMany: async () => [...stored.values()],
    },
    $transaction: async (operation) => {
      const pending = new Map([...stored].map(([id, row]) => [id, { ...row }]));
      const tx = {
        eventAssignment: {
          update: async ({ where, data }) => {
            const row = { ...pending.get(where.id), ...data };
            pending.set(where.id, row);
            return row;
          },
        },
      };
      const result = await operation(tx);
      stored.clear();
      for (const [id, row] of pending) stored.set(id, row);
      return result;
    },
  };

  await assert.rejects(
    updateAssignmentsInBulk({
      prisma,
      updates: [{ id: 1, data: { clientCheckIn: '10:05' } }],
      normalizeUpdate: async (data) => data,
      synchronizeEvent: async () => {
        throw new Error('sync failed');
      },
    }),
    /sync failed/,
  );

  assert.equal(stored.get(1).clientCheckIn, undefined);
});

test('rejects duplicated assignment ids before writing', async () => {
  const prisma = {
    eventAssignment: { findMany: async () => [] },
    $transaction: async () => assert.fail('transaction must not run'),
  };
  await assert.rejects(
    updateAssignmentsInBulk({
      prisma,
      updates: [{ id: 1, data: {} }, { id: 1, data: {} }],
      normalizeUpdate: async (data) => data,
      synchronizeEvent: async () => {},
    }),
    /mesma linha/i,
  );
});

for (const count of [1, 2, 5, 10, 25, 50]) {
  test(`applies payment status to ${count} assignments in one transaction`, async () => {
    const fixture = createTransactionalPrisma(Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      eventId: 10,
      paymentStatus: 'unpaid',
      paymentDate: null,
    })));
    const statuses = ['paid', 'awaiting_data', 'penhorado', 'ganho', 'validated_es', 'unpaid'];
    const updates = Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      data: buildStaffPaymentStatusPayload({
        paymentStatus: statuses[index % statuses.length],
        paymentDate: '2026-10-04',
        paymentAdjustment: index + 0.5,
        paymentDeferredMonth: '2026-11',
      }, '2026-10-04'),
    }));
    const synchronized = [];
    const paidTransitions = [];

    const rows = await updateAssignmentsInBulk({
      prisma: fixture.prisma,
      updates,
      normalizeUpdate: async (data) => data,
      synchronizeEvent: async (id) => synchronized.push(id),
      afterUpdate: async ({ row, existing }) => {
        if (existing.paymentStatus !== 'paid' && row.paymentStatus === 'paid') {
          paidTransitions.push(row.id);
        }
      },
    });

    assert.equal(rows.length, count);
    assert.equal(fixture.transactionCount, 1);
    assert.equal(fixture.updateCount, count);
    assert.deepEqual(synchronized, [10]);
    assert.deepEqual(paidTransitions, updates
      .filter((item) => item.data.paymentStatus === 'paid')
      .map((item) => item.id));
    for (const update of updates) {
      const row = fixture.stored.get(update.id);
      assert.equal(row.paymentStatus, update.data.paymentStatus);
      assert.equal(row.paymentDate, update.data.paymentDate);
      assert.equal(row.paymentAdjustment, update.data.paymentAdjustment);
      assert.equal(row.paymentDeferredMonth, '2026-11');
    }
  });
}

test('rolls back all payment changes if a paid-travel snapshot fails', async () => {
  const fixture = createTransactionalPrisma([
    { id: 1, eventId: 10, paymentStatus: 'unpaid' },
    { id: 2, eventId: 10, paymentStatus: 'unpaid' },
  ]);

  await assert.rejects(updateAssignmentsInBulk({
    prisma: fixture.prisma,
    updates: [
      { id: 1, data: { paymentStatus: 'paid' } },
      { id: 2, data: { paymentStatus: 'paid' } },
    ],
    normalizeUpdate: async (data) => data,
    afterUpdate: async ({ row }) => {
      if (row.id === 2) throw new Error('snapshot failed');
    },
    synchronizeEvent: async () => {},
  }), /snapshot failed/);

  assert.equal(fixture.stored.get(1).paymentStatus, 'unpaid');
  assert.equal(fixture.stored.get(2).paymentStatus, 'unpaid');
});
