import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { PrismaClient } from '@prisma/client';
import { createCrudRouter, normalizeAssignment } from '../routes/crud.js';
import { updateAssignmentsInBulk } from './assignmentBulkUpdate.js';
import { readPublicQr, registerPublicQr, qrCheckoutProtection } from './qrAttendance.js';
import { qrCodeStateForAssignment } from '../utils/qrCheckins.js';
import { roundedBillableHours } from '../../src/utils/serviceFinance.js';

const directory = mkdtempSync(join(tmpdir(), 'es-qr-attendance-test-'));
const database = join(directory, 'test.db');
const datasourceUrl = `file:${database.replaceAll('\\', '/')}`;
const db = new PrismaClient({ datasourceUrl });
const day = new Date('2026-09-23T00:00:00Z');
const at = (time) => new Date(`2026-09-23T${time}Z`);
const adminRouter = createCrudRouter(db.eventAssignment, [], { normalizeUpdate: normalizeAssignment });
const adminUpdate = adminRouter.stack.find((layer) => layer.route?.methods.put).route.stack.at(-1).handle;

before(async () => {
  const result = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/sqlite/schema.prisma', '--script'], {
    env: { ...process.env, DATABASE_URL: datasourceUrl }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const sqlite = new DatabaseSync(database);
  sqlite.exec(result.stdout);
  sqlite.close();
  await db.collaborator.create({ data: { id: 1, name: 'QR Test', email: 'qr@example.test' } });
  await db.event.createMany({ data: [
    { id: 1, name: 'Single day', date: day },
    { id: 2, name: 'Continuous', date: new Date('2026-09-01'), endDate: new Date('2026-09-30'), isContinuous: true },
  ] });
});

after(async () => {
  await db.$disconnect();
  rmSync(database, { force: true });
  rmdirSync(directory);
});

async function fixture(data = {}) {
  const assignment = await db.eventAssignment.create({
    data: { eventId: 1, collaboratorId: 1, assignmentDate: day, hourlyRate: 8.5, status: 'confirmed', ...data },
  });
  return db.qrCheckCode.create({ data: {
    token: `test-${assignment.id}`, eventId: assignment.eventId, collaboratorId: 1,
    assignmentId: assignment.id, eventDate: assignment.assignmentDate,
  } });
}

function edit(qr, body) {
  return new Promise((resolve, reject) => adminUpdate(
    { params: { id: String(qr.assignmentId) }, body }, { json: resolve }, reject,
  ));
}

const punch = (qr, action, time) => registerPublicQr(db, qr.token, action, { now: at(time) });
const read = (qr, time = '10:00:00') => readPublicQr(db, qr.token, { now: at(time) });
const logs = (qr) => db.qrCheckLog.findMany({ where: { qrCodeId: qr.id }, orderBy: { id: 'asc' } });

test('normal entry and later exit retain existing hours/pay calculation', async () => {
  const qr = await fixture();
  const entry = await punch(qr, 'check_in', '10:00:00');
  assert.equal(entry.assignment.checkIn, '11:00');
  assert.equal(entry.assignment.checkOut, null);
  const result = await punch(qr, 'check_out', '14:02:00');
  assert.equal(result.assignment.checkOut, '15:02');
  const expectedHours = roundedBillableHours('11:00', '15:02');
  assert.equal(Number(result.assignment.hoursWorked), expectedHours);
  assert.equal(Number(result.assignment.staffPayableHours), expectedHours);
  assert.equal(Number(result.assignment.totalPay), expectedHours * 8.5);
  assert.equal(qrCodeStateForAssignment(result.assignment).nextAction, null);
  assert.deepEqual((await logs(qr)).map((row) => row.action), ['check_in', 'check_out']);
});

test('immediate double click and attempts during 30 minutes never create exit or audit entries', async () => {
  const qr = await fixture();
  await punch(qr, 'check_in', '10:00:45');
  for (const time of ['10:00:45', '10:15:00', '10:30:44.999']) {
    await assert.rejects(punch(qr, 'check_out', time), { code: 'QR_CHECKOUT_TOO_EARLY', statusCode: 409 });
  }
  await assert.rejects(punch(qr, 'check_in', '10:00:46'), { code: 'QR_CHECKIN_EXISTS' });
  assert.equal((await read(qr)).assignment.checkOut, null);
  assert.equal((await logs(qr)).length, 1);
  assert.equal(qrCheckoutProtection(await read(qr), at('10:00:45')).checkOutRetryAfterMs, 30 * 60000);
  const result = await punch(qr, 'check_out', '10:30:45');
  assert.equal(result.assignment.checkOut, '11:30');
});

test('empty-string admin deletion persists NULL and reopens exit despite historical exit logs', async () => {
  const qr = await fixture();
  await punch(qr, 'check_in', '10:00:00');
  await punch(qr, 'check_out', '11:00:00');
  const history = await logs(qr);
  const corrected = await edit(qr, { checkOut: '' });
  assert.equal(corrected.checkOut, null);
  assert.equal(corrected.checkIn, '11:00');
  assert.equal(qrCodeStateForAssignment((await read(qr)).assignment).nextAction, 'check_out');
  assert.equal(qrCheckoutProtection(await read(qr), at('11:01:00')).checkOutRetryAfterMs, 0);
  const result = await punch(qr, 'check_out', '14:00:00');
  assert.equal(result.assignment.checkOut, '15:00');
  assert.deepEqual((await logs(qr)).slice(0, 2), history);
  assert.equal((await logs(qr)).length, 3);
});

test('admin can edit/remove an erroneous immediate exit without the cooldown restricting edits', async () => {
  const qr = await fixture();
  await punch(qr, 'check_in', '10:00:00');
  const edited = await edit(qr, { checkOut: '11:00' });
  assert.equal(edited.checkOut, '11:00');
  const cleared = await edit(qr, { checkOut: null });
  assert.equal(cleared.checkOut, null);
  await assert.rejects(punch(qr, 'check_out', '10:20:00'), { code: 'QR_CHECKOUT_TOO_EARLY' });
  assert.equal((await punch(qr, 'check_out', '10:30:00')).assignment.checkOut, '11:30');
});

test('clearing entry allows a new entry, preserves the other field and all history', async () => {
  const qr = await fixture();
  await punch(qr, 'check_in', '10:00:00');
  await punch(qr, 'check_out', '11:00:00');
  const history = await logs(qr);
  const corrected = await edit(qr, { checkIn: '' });
  assert.equal(corrected.checkIn, null);
  assert.equal(corrected.checkOut, '12:00');
  assert.equal(qrCodeStateForAssignment((await read(qr)).assignment).nextAction, 'check_in');
  await assert.rejects(punch(qr, 'check_out', '11:01:00'), { code: 'QR_CHECKIN_REQUIRED' });
  const result = await punch(qr, 'check_in', '11:02:00');
  assert.equal(result.assignment.checkIn, '12:02');
  assert.equal(result.assignment.checkOut, '12:00');
  assert.deepEqual((await logs(qr)).slice(0, 2), history);
});

test('clearing both punches resets lifecycle; the new entry starts a new cooldown', async () => {
  const qr = await fixture();
  await punch(qr, 'check_in', '10:00:00');
  await punch(qr, 'check_out', '11:00:00');
  await edit(qr, { checkIn: null, checkOut: '' });
  assert.equal(qrCheckoutProtection(await read(qr)).checkOutAvailableAt, null);
  await punch(qr, 'check_in', '12:00:50');
  await assert.rejects(punch(qr, 'check_out', '12:30:49'), { code: 'QR_CHECKOUT_TOO_EARLY' });
  assert.equal((await punch(qr, 'check_out', '12:30:50')).assignment.checkOut, '13:30');
});

test('manual entry edits are authoritative, not the previous QR log', async () => {
  const qr = await fixture();
  await punch(qr, 'check_in', '10:00:45');
  await edit(qr, { checkIn: '09:00' });
  assert.equal((await punch(qr, 'check_out', '10:01:00')).assignment.checkOut, '11:01');

  const manual = await fixture({ checkIn: '11:00' });
  await assert.rejects(punch(manual, 'check_out', '10:29:59'), { code: 'QR_CHECKOUT_TOO_EARLY' });
  assert.equal((await punch(manual, 'check_out', '10:30:00')).assignment.checkOut, '11:30');
});

test('continuous events isolate corrections and cooldowns by assignment/day', async () => {
  const previousDay = await fixture({ eventId: 2, assignmentDate: new Date('2026-09-22'), checkIn: '11:00', checkOut: '15:00', totalPay: 34 });
  const before = await db.eventAssignment.findUnique({ where: { id: previousDay.assignmentId } });
  const qr = await fixture({ eventId: 2 });
  await punch(qr, 'check_in', '10:00:00');
  await edit(qr, { checkIn: '' });
  await punch(qr, 'check_in', '11:00:00');
  assert.equal((await punch(qr, 'check_out', '11:30:00')).assignment.checkOut, '12:30');
  assert.deepEqual(await db.eventAssignment.findUnique({ where: { id: previousDay.assignmentId } }), before);
  await assert.rejects(read(previousDay), { code: 'QR_EXPIRED' });
});

test('simultaneous requests record only one entry and one exit', async () => {
  const qr = await fixture();
  for (const [action, time, errorCode] of [['check_in', '10:00:00', 'QR_CHECKIN_EXISTS'], ['check_out', '11:00:00', 'QR_CHECKOUT_EXISTS']]) {
    const results = await Promise.allSettled([punch(qr, action, time), punch(qr, action, time)]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const failure = results.find((result) => result.status === 'rejected').reason;
    assert.ok([errorCode, 'QR_CHANGED'].includes(failure.code), failure.stack);
  }
  assert.equal((await logs(qr)).length, 2);
});

test('bulk administrative deletion also clears punches without touching validation/payment fields', async () => {
  const qr = await fixture({ checkIn: '11:00', checkOut: '11:00', clientCheckIn: '11:00', clientCheckOut: '15:00', validatedCheckIn: '11:00', validatedCheckOut: '15:00', validationStatus: 'validated', paymentStatus: 'paid', totalPay: 34, staffPayableHours: 4 });
  const before = await db.eventAssignment.findUnique({ where: { id: qr.assignmentId } });
  await updateAssignmentsInBulk({ prisma: db, updates: [{ id: qr.assignmentId, data: { checkOut: '' } }], normalizeUpdate: normalizeAssignment, synchronizeEvent: async () => {} });
  const current = (await read(qr)).assignment;
  assert.equal(current.checkOut, null);
  for (const field of ['checkIn', 'clientCheckIn', 'clientCheckOut', 'validatedCheckIn', 'validatedCheckOut', 'validationStatus', 'paymentStatus', 'totalPay', 'staffPayableHours']) {
    assert.deepEqual(current[field], before[field], field);
  }
});

test('unchanged historical rows are read without migration or mutation; old logs never restore a punch', async () => {
  const qr = await fixture({ checkIn: '11:00', checkOut: '11:00' });
  const before = await db.eventAssignment.findUnique({ where: { id: qr.assignmentId } });
  const current = await read(qr);
  assert.equal(qrCodeStateForAssignment(current.assignment).nextAction, null);
  assert.deepEqual(await db.eventAssignment.findUnique({ where: { id: qr.assignmentId } }), before);
  assert.equal((await logs(qr)).length, 0);
});

test('day validity, revoked codes, cancelled assignments and invalid actions remain protected', async () => {
  const qr = await fixture();
  await assert.rejects(registerPublicQr(db, qr.token, 'check_in', { now: new Date('2026-09-22T10:00:00Z') }), { code: 'QR_NOT_ACTIVE' });
  await assert.rejects(punch(qr, 'invalid', '10:00:00'), { code: 'QR_ACTION_INVALID' });
  await edit(qr, { status: 'cancelled' });
  await assert.rejects(punch(qr, 'check_in', '10:00:00'), { code: 'QR_DAY_CANCELLED' });
  await db.qrCheckCode.update({ where: { id: qr.id }, data: { revokedAt: at('10:00:00') } });
  await assert.rejects(read(qr), { code: 'QR_REVOKED' });
  assert.equal((await logs(qr)).length, 0);
});

test('failed audit insert rolls back the punch', async () => {
  const qr = await fixture();
  const failingDb = { $transaction: (callback) => db.$transaction((tx) => callback({
    ...tx, qrCheckLog: { create: () => { throw new Error('Audit unavailable'); } },
  })) };
  await assert.rejects(registerPublicQr(failingDb, qr.token, 'check_in', { now: at('10:00:00') }), /Audit unavailable/);
  assert.equal((await read(qr)).assignment.checkIn, null);
  assert.equal((await logs(qr)).length, 0);
});

test('normalization distinguishes explicit clearing from omitted fields', () => {
  assert.deepEqual(normalizeAssignment({ checkIn: '', checkOut: '' }), { checkIn: null, checkOut: null });
  assert.deepEqual(normalizeAssignment({ checkIn: null }), { checkIn: null });
  assert.deepEqual(normalizeAssignment({}), {});
});
