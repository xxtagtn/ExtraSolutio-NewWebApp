import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { saveStaffPaymentAdjustment } from './staffPaymentAdjustment.js';
import { buildStaffBalance, staffAnalysisYears } from '../../src/utils/balanceStaff.js';
import { staffAdjustmentGainInvalidated } from '../../src/utils/staffAdjustmentGain.js';

const { PrismaClient } = await import(process.env.TEST_PRISMA_CLIENT
  ? pathToFileURL(resolve(process.env.TEST_PRISMA_CLIENT)).href : '@prisma/client');

const directory = mkdtempSync(join(tmpdir(), 'es-staff-gain-'));
const database = join(directory, 'test.db');
const datasourceUrl = `file:${database.replaceAll('\\', '/')}`;
const db = new PrismaClient({ datasourceUrl });
let event, staff;

before(async () => {
  const schema = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff',
    '--from-empty', '--to-schema-datamodel', 'prisma/sqlite/schema.prisma', '--script'], {
    env: { ...process.env, DATABASE_URL: datasourceUrl }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(schema.status, 0, schema.stderr);
  const sqlite = new DatabaseSync(database);
  sqlite.exec(schema.stdout);
  sqlite.close();
  staff = await db.collaborator.create({ data: { name: 'Staff QA', email: 'staff@example.test', nif: '123456789', includeVat: true } });
  event = await db.event.create({ data: { name: 'Servi\u00e7o QA', date: new Date('2026-12-20'), status: 'finalized',
    statusMode: 'manual', totalRevenue: 200, billingStatus: 'paid' } });
});

after(async () => {
  await db.$disconnect();
  rmSync(database, { force: true });
  rmdirSync(directory);
});

const fixture = (extra = {}) => db.eventAssignment.create({ data: {
  eventId: event.id, collaboratorId: staff.id, role: 'Emp.Mesa', status: 'confirmed',
  checkIn: '10:00', checkOut: '18:00', validatedCheckIn: '10:00', validatedCheckOut: '18:00',
  validationStatus: 'validated', hourlyRate: 10, paymentStatus: 'unpaid', ...extra,
} });
const save = (row, amount, asGain) => saveStaffPaymentAdjustment(db, row.id, { amount, asGain, updatedAt: row.updatedAt });
const read = () => db.event.findUnique({ where: { id: event.id }, include: { assignments: { include: { collaborator: true } } } });

test('normal adjustment and gain use the same payment; only explicitly marked paid gains are reported', async () => {
  const original = await fixture();
  const ordinary = await save(original, -15, false);
  assert.equal(Number(ordinary.paymentAdjustment), -15);
  assert.equal(ordinary.paymentAdjustmentGain, null);
  const withOrdinary = await read();
  const designated = await save(ordinary, -15, true);
  assert.equal(Number(designated.paymentAdjustmentGain), 15);
  assert.equal(designated.paymentStatus, 'unpaid');
  const pending = await read();
  assert.equal(Number(pending.totalCost), Number(withOrdinary.totalCost));
  assert.equal(Number(pending.totalRevenue), Number(withOrdinary.totalRevenue));
  assert.equal(buildStaffBalance({ services: [pending], period: { year: '2026', month: 12 } }).gainTotal, 0);
  const paid = await db.eventAssignment.update({ where: { id: original.id }, data: {
    paymentStatus: 'paid', paymentDate: new Date('2027-01-08'),
  } });
  const services = [await read()];
  assert.deepEqual(staffAnalysisYears(services), ['2026', '2027']);
  assert.equal(buildStaffBalance({ services, period: { year: '2026', month: 12 } }).gainTotal, 0);
  const january = buildStaffBalance({ services, period: { year: '2027', month: 1 } });
  assert.equal(january.gainTotal, 15);
  assert.equal(january.gains.length, 1);
  assert.equal(january.gains[0].name, 'Staff QA');
  assert.equal(january.gains[0].paymentDate, '2027-01-08');
  assert.equal(january.totals.cost, 0, 'Existing costs still follow service date');
  assert.equal(buildStaffBalance({ services, period: { year: '2027', month: 1 }, search: 'other' }).gainTotal, 0);
  assert.equal(buildStaffBalance({ services, period: { year: '2027', month: 1, clientId: '999' } }).gainTotal, 0);
  const cleared = await save(paid, -15, false);
  assert.equal(cleared.paymentAdjustmentGain, null);
  assert.equal(Number(cleared.paymentAdjustment), -15);
  assert.equal(cleared.paymentStatus, 'paid');
  assert.equal(buildStaffBalance({ services: [await read()], period: { year: '2027', month: 1 } }).gainTotal, 0);
});

test('rejects positive, excessive, invalid and stale gains without modifying the assignment', async () => {
  const row = await fixture();
  await assert.rejects(save(row, 15, true), { statusCode: 422 });
  await assert.rejects(save(row, -90, true), { statusCode: 422 });
  await assert.rejects(save(row, -1.005, true), { statusCode: 422 });
  await assert.rejects(save({ ...row, updatedAt: '2020-01-01' }, -15, true), { statusCode: 409 });
  const unchanged = await db.eventAssignment.findUnique({ where: { id: row.id } });
  assert.equal(Number(unchanged.paymentAdjustment), 0);
  assert.equal(unchanged.paymentAdjustmentGain, null);
  const absent = await fixture({ status: 'missed_justified' });
  await assert.rejects(save(absent, -10, true), { statusCode: 409 });
  const paid = await fixture({ paymentStatus: 'paid', paymentDate: new Date('2027-01-09') });
  await assert.rejects(save(paid, -10, true), { statusCode: 409 });
});

test('unrelated updates preserve designation; editing the adjustment or assignee invalidates it', () => {
  const row = { eventId: 1, collaboratorId: 2, paymentAdjustment: '-15.00' };
  assert.equal(staffAdjustmentGainInvalidated(row, { paymentStatus: 'paid', paymentAdjustment: -15 }), false);
  assert.equal(staffAdjustmentGainInvalidated(row, { paymentAdjustment: -14 }), true);
  assert.equal(staffAdjustmentGainInvalidated(row, { paymentAdjustment: 0 }), true);
  assert.equal(staffAdjustmentGainInvalidated(row, { collaboratorId: 3 }), true);
  assert.equal(staffAdjustmentGainInvalidated(row, { eventId: 2 }), true);
});

test('SQLite migration preserves historical negative adjustments without classifying them', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('CREATE TABLE "EventAssignment" ("paymentAdjustment" DECIMAL NOT NULL DEFAULT 0)');
    sqlite.exec('INSERT INTO "EventAssignment" ("paymentAdjustment") VALUES (-15)');
    sqlite.exec(readFileSync('prisma/sqlite/migrations/20261107010000_staff_adjustment_gain/migration.sql', 'utf8'));
    const record = sqlite.prepare('SELECT * FROM "EventAssignment"').get();
    assert.equal(record.paymentAdjustment, -15);
    assert.equal(record.paymentAdjustmentGain, null);
  } finally {
    sqlite.close();
  }
});
