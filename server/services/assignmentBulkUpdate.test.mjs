import assert from 'node:assert/strict';
import test from 'node:test';
import { updateAssignmentsInBulk } from './assignmentBulkUpdate.js';

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
