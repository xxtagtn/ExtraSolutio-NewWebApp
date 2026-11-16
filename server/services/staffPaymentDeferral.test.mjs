import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { saveStaffPaymentDeferral } from './staffPaymentDeferral.js';
import { staffPaymentTiming } from '../../src/utils/staffPayment.js';

const { PrismaClient } = await import(process.env.TEST_PRISMA_CLIENT
  ? pathToFileURL(resolve(process.env.TEST_PRISMA_CLIENT)).href : '@prisma/client');

const cacheDirectory = resolve('node_modules/.cache');
mkdirSync(cacheDirectory, { recursive: true });
const directory = mkdtempSync(join(cacheDirectory, 'es-staff-deferral-'));
const database = join(directory, 'test.db');
const datasourceUrl = `file:${database.replaceAll('\\', '/')}`;
const db = new PrismaClient({ datasourceUrl });
let event, staff;

before(async () => {
  const migrations = 'prisma/sqlite/migrations';
  const sqlite = new DatabaseSync(database);
  try {
    for (const name of readdirSync(migrations).filter((name) => /^\d/.test(name)).sort()) {
      sqlite.exec(readFileSync(join(migrations, name, 'migration.sql'), 'utf8'));
    }
  } finally {
    sqlite.close();
  }
  staff = await db.collaborator.create({ data: { name: 'Staff QA', email: 'staff@example.test', nif: '123456789' } });
  event = await db.event.create({ data: { name: 'Evento QA', date: new Date('2026-09-13'),
    status: 'finalized', totalRevenue: 200 } });
});

after(async () => {
  await db.$disconnect();
  rmSync(database, { force: true });
  rmdirSync(directory);
});

const fixture = (extra = {}) => db.eventAssignment.create({ data: {
  eventId: event.id, collaboratorId: staff.id, role: 'Emp.Mesa', status: 'confirmed',
  assignmentDate: new Date('2026-09-13'), paymentStatus: 'unpaid', totalPay: 76, ...extra,
} });
const save = (row, date) => saveStaffPaymentDeferral(db, row.id, { date, updatedAt: row.updatedAt });

test('reschedules one service repeatedly, preserves its debt and restores its original month', async () => {
  const original = await fixture();
  const other = await fixture({ assignmentDate: new Date('2026-09-14'), totalPay: 64 });
  const january = await save(original, '2027-01-01');
  assert.equal(january.paymentDeferredDate, '2027-01-01');
  assert.equal(staffPaymentTiming(january).paymentMonth, '2027-01');
  const february = await save(january, '2027-02-28');
  assert.equal(staffPaymentTiming(february).paymentMonth, '2027-02');
  assert.equal(february.paymentStatus, 'unpaid');
  assert.equal(february.paymentDate, null);
  assert.equal(Number(february.totalPay), 76);
  assert.deepEqual(await db.eventAssignment.findUnique({ where: { id: other.id } }), other);
  assert.deepEqual(await db.event.findUnique({ where: { id: event.id } }), event);
  const reset = await save(february, null);
  assert.equal(staffPaymentTiming(reset).paymentMonth, '2026-10');
  assert.equal(staffPaymentTiming(reset).deferred, false);
});

test('restores a legacy month, validates exact dates and rejects stale or nonpayable services', async () => {
  const legacy = await fixture({ paymentDeferredMonth: '2026-12' });
  assert.equal(staffPaymentTiming(legacy).paymentMonth, '2026-12');
  await assert.rejects(save(legacy, '2027-02-29'), { statusCode: 422 });
  await assert.rejects(save({ ...legacy, updatedAt: new Date('2026-01-01') }, null), { statusCode: 409 });
  assert.equal((await save(legacy, null)).paymentDeferredMonth, null);

  for (const extra of [{ paymentStatus: 'paid' }, { paymentStatus: 'ganho' }, { status: 'missed_justified' }]) {
    const row = await fixture(extra);
    await assert.rejects(save(row, '2027-02-28'), { statusCode: 409 });
    assert.deepEqual(await db.eventAssignment.findUnique({ where: { id: row.id } }), row);
  }
});

test('reports an outdated Prisma client or a missing migration before attempting to write', async () => {
  const clientWithoutDate = {
    $transaction: (callback) => callback({ eventAssignment: {
      findUnique: async () => ({ id: 1, paymentDeferredMonth: null }),
      updateMany: async () => assert.fail('Must not attempt a write with the outdated client'),
    } }),
  };
  await assert.rejects(saveStaffPaymentDeferral(clientWithoutDate, 1, { date: '2027-01-01' }),
    { statusCode: 503, message: /cliente Prisma/ });

  const missingColumn = Object.assign(new Error('Missing column'), {
    code: 'P2022', meta: { column: 'main.EventAssignment.paymentDeferredDate' },
  });
  const databaseWithoutDate = { $transaction: async () => { throw missingColumn; } };
  await assert.rejects(saveStaffPaymentDeferral(databaseWithoutDate, 1, { date: '2027-01-01' }),
    { statusCode: 503, message: /migração/, cause: missingColumn });
});
