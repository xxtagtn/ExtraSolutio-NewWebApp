import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import { once } from 'node:events';
import { createMonthlyPunchToken, createMonthlyQrToken } from '../utils/qrMonthlyToken.js';
import { eventStartInstant } from '../utils/eventTime.js';
import { ensureAssignmentQr } from './qrCodeGeneration.js';
import { readMonthlyPunchQr, registerMonthlyPunchQr } from './qrMonthlyPunching.js';

const directory = mkdtempSync(join(tmpdir(), 'es-pending-month-test-'));
const database = join(directory, 'test.db');
const datasourceUrl = `file:${database.replaceAll('\\', '/')}`;
const db = new PrismaClient({ datasourceUrl });
process.env.JWT_SECRET = 'pending-month-test-not-production';
process.env.APP_TIMEZONE = 'Europe/Lisbon';
const at = (day, time = '09:00:00') => new Date(eventStartInstant(day, time, 'Europe/Lisbon').getTime()
  + Number(time.split(':')[2] || 0) * 1000);
let sequence = 0;
before(() => {
  const result = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty',
    '--to-schema-datamodel', 'prisma/sqlite/schema.prisma', '--script'], {
    env: { ...process.env, DATABASE_URL: datasourceUrl }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  const sqlite = new DatabaseSync(database);
  sqlite.exec(result.stdout);
  sqlite.close();
});
after(async () => { await db.$disconnect(); rmSync(database, { force: true }); rmdirSync(directory); });

async function fixture() {
  const collaborator = await db.collaborator.create({ data: { name: 'Pending Month Test', email: `pending-${++sequence}@example.test`, nif: '123456789' } });
  const event = await db.event.create({ data: { name: 'Monthly confirmed service', date: new Date('2026-10-01'),
    endDate: new Date('2026-11-30'), isContinuous: true, startTime: '09:00', endTime: '12:00' } });
  const add = (day, data = {}) => db.eventAssignment.create({ data: {
    eventId: event.id, collaboratorId: collaborator.id, assignmentDate: new Date(day), status: 'confirmed',
    plannedCheckIn: '09:00', plannedCheckOut: '12:00', hourlyRate: 10, ...data,
  } });
  return { collaborator, event, add, token: createMonthlyPunchToken(collaborator.id, at('2026-10-15')) };
}
const read = (f, now = at('2026-10-15')) => readMonthlyPunchQr(db, f.token, { now });
async function punch(f, action, now, { state, id } = {}) {
  const current = state || await read(f, now);
  return registerMonthlyPunchQr(db, f.token, action, { assignmentId: id || current.active?.activeAssignmentId,
    revision: current.active?.revision }, { now });
}
const snapshot = (f) => db.eventAssignment.findMany({ where: { collaboratorId: f.collaborator.id }, orderBy: { id: 'asc' } });
const logs = (f) => db.qrCheckLog.findMany({ where: { collaboratorId: f.collaborator.id }, orderBy: { id: 'asc' } });

test('newly confirmed services appear in the same issued link and cancellations disappear without copying records', async () => {
  const f = await fixture();
  const existing = await f.add('2026-10-16');
  assert.deepEqual((await read(f)).services.map((row) => row.assignmentId), [existing.id]);
  const added = await f.add('2026-10-20', { plannedCheckIn: null, plannedCheckOut: null });
  const state = await read(f);
  assert.deepEqual(state.services.map((row) => row.assignmentId), [existing.id, added.id]);
  assert.equal(state.services[1].startTime, '09:00');
  assert.equal(state.services[1].endTime, '12:00');
  assert.equal(createMonthlyPunchToken(f.collaborator.id, at('2026-10-28')), f.token);
  await db.eventAssignment.update({ where: { id: existing.id }, data: { status: 'cancelled' } });
  assert.deepEqual((await read(f)).services.map((row) => row.assignmentId), [added.id]);
  assert.equal(await db.eventAssignment.count({ where: { collaboratorId: f.collaborator.id } }), 2);
  assert.equal((await logs(f)).length, 0);
});

test('the 15th lists only pending relevant services, excluding completed, expired, cancelled and other months/people', async () => {
  const f = await fixture();
  for (const day of ['2026-10-10', '2026-10-12']) await f.add(day, { checkIn: '09:01', checkOut: '12:00' });
  await f.add('2026-10-13');
  const wanted = [];
  for (const day of ['2026-10-16', '2026-10-20', '2026-10-28']) wanted.push(await f.add(day));
  await f.add('2026-11-01');
  await f.add('2026-10-17', { status: 'assigned' });
  await f.add('2026-10-18', { status: 'cancelled' });
  const revoked = await f.add('2026-10-19');
  const qr = await ensureAssignmentQr(db, revoked.id);
  await db.qrCheckCode.update({ where: { id: qr.id }, data: { revokedAt: at('2026-10-14') } });
  const other = await fixture();
  await other.add('2026-10-16');
  const before = await snapshot(f);
  const state = await read(f);
  assert.deepEqual(state.services.map((row) => row.assignmentId), wanted.map((row) => row.id));
  assert.equal(state.active, null);
  assert.equal(state.expiresAt, '2026-10-31T23:59:59.999Z');
  for (const row of state.services) {
    for (const key of ['checkIn', 'checkOut', 'validationStatus', 'validatedCheckIn', 'totalPay', 'hourlyRate', 'nif']) {
      assert.equal(Object.hasOwn(row, key), false, key);
    }
  }
  assert.deepEqual(await snapshot(f), before);
  assert.equal((await logs(f)).length, 0);
  await assert.rejects(punch(f, 'check_in', at('2026-10-15'), { id: wanted[0].id }), { code: 'QR_NOT_ACTIVE' });
});

test('entry stays visible for checkout; completed shifts disappear immediately without changing pay or validation', async () => {
  const f = await fixture();
  const morning = await f.add('2026-10-15', { clientCheckIn: '09:00', clientCheckOut: '12:00', validationStatus: 'approved' });
  const afternoon = await f.add('2026-10-15', { plannedCheckIn: '15:00', plannedCheckOut: '18:00' });
  const future = await f.add('2026-10-16');
  let current = await punch(f, 'check_in', at('2026-10-15'));
  assert.equal(current.services.find((row) => row.assignmentId === morning.id).inProgress, true);
  assert.equal(current.active.services[0].state.nextAction, 'check_out');
  assert.equal(current.active.services[0].checkOutRetryAfterMs, 1800000);
  await assert.rejects(punch(f, 'check_out', at('2026-10-15', '09:29:59')), { code: 'QR_CHECKOUT_TOO_EARLY' });
  const stale = current;
  current = await punch(f, 'check_out', at('2026-10-15', '12:00:00'));
  assert.deepEqual(current.services.map((row) => row.assignmentId), [afternoon.id, future.id]);
  assert.equal(current.active.services.some((row) => row.assignmentId === morning.id), false);
  await assert.rejects(punch(f, 'check_out', at('2026-10-15', '12:00:00'), { state: stale }), { code: 'QR_CHANGED' });
  await assert.rejects(punch(f, 'check_in', at('2026-10-15', '12:00:01')), { code: 'QR_SERVICE_SWITCH' });
  await punch(f, 'check_in', at('2026-10-15', '15:00:00'));
  current = await punch(f, 'check_out', at('2026-10-15', '18:00:00'));
  assert.deepEqual(current.services.map((row) => row.assignmentId), [future.id]);
  assert.equal(current.active, null);
  const saved = (await snapshot(f)).find((row) => row.id === morning.id);
  assert.equal(Number(saved.hoursWorked), 3);
  assert.equal(Number(saved.totalPay), 30);
  assert.equal(saved.clientCheckIn, '09:00');
  assert.equal(saved.clientCheckOut, '12:00');
  assert.equal(saved.validationStatus, 'approved');
  assert.equal((await logs(f)).length, 4);
});

test('all completed services produce an empty pending view; administrative reopening is read afresh', async () => {
  const f = await fixture();
  const row = await f.add('2026-10-15');
  await punch(f, 'check_in', at('2026-10-15'));
  const completed = await punch(f, 'check_out', at('2026-10-15', '12:00:00'));
  assert.deepEqual(completed.services, []);
  assert.equal(completed.active, null);
  await db.eventAssignment.update({ where: { id: row.id }, data: { checkOut: null } });
  const reopened = await read(f, at('2026-10-15', '12:01:00'));
  assert.equal(reopened.active.activeAssignmentId, row.id);
  assert.equal(reopened.active.services[0].state.nextAction, 'check_out');
});

test('overlap selection, concurrency, request revision and assignment spoofing reuse the daily safeguards', async () => {
  const f = await fixture();
  const first = await f.add('2026-10-15');
  const second = await f.add('2026-10-15', { plannedCheckIn: '11:00', plannedCheckOut: '14:00' });
  const future = await f.add('2026-10-16');
  const state = await read(f);
  assert.equal(state.active.selectionRequired, true);
  await assert.rejects(punch(f, 'check_in', at('2026-10-15')), { code: 'QR_SERVICE_REQUIRED' });
  await assert.rejects(punch(f, 'check_in', at('2026-10-15'), { id: future.id }), { code: 'QR_SERVICE_REQUIRED' });
  const results = await Promise.allSettled([first, second].map((row) => punch(f, 'check_in', at('2026-10-15'), { id: row.id, state })));
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal((await logs(f)).length, 1);
  const old = await read(f);
  await db.eventAssignment.update({ where: { id: future.id }, data: { status: 'cancelled' } });
  const opened = old.active.activeAssignmentId;
  await db.eventAssignment.update({ where: { id: opened }, data: { plannedCheckOut: '15:00' } });
  await assert.rejects(punch(f, 'check_out', at('2026-10-15', '12:00:00'), { state: old }), { code: 'QR_CHANGED' });
});

test('month expiry grants only an open closing-shift checkout, with the new month link still available', async () => {
  const f = await fixture();
  const row = await f.add('2026-10-31', { plannedCheckIn: '22:00', plannedCheckOut: '02:00' });
  const notStarted = await f.add('2026-10-31', { plannedCheckIn: '23:00', plannedCheckOut: '03:00' });
  const today = await f.add('2026-11-01');
  await punch(f, 'check_in', at('2026-10-31', '22:00:00'), { id: row.id });
  const before = await snapshot(f);
  await assert.rejects(punch(f, 'check_in', at('2026-11-01', '00:00:00')), { code: 'QR_EXPIRED' });
  const closing = await read(f, at('2026-11-01', '00:00:00'));
  assert.equal(closing.checkoutOnly, true);
  assert.deepEqual(closing.services.map((service) => service.assignmentId), [row.id]);
  assert.equal(closing.active.services[0].state.nextAction, 'check_out');
  await assert.rejects(read(f, new Date(at('2026-10-01', '00:00:00').getTime() - 1)), { code: 'QR_NOT_ACTIVE' });
  const next = { ...f, token: createMonthlyPunchToken(f.collaborator.id, at('2026-11-01')) };
  const overnight = await read(next, at('2026-11-01', '01:00:00'));
  assert.equal(overnight.active.activeAssignmentId, row.id);
  assert.deepEqual(overnight.services.map((service) => service.assignmentId), [row.id, today.id]);
  assert.equal(overnight.services.some((service) => service.assignmentId === notStarted.id), false);
  assert.deepEqual(await snapshot(f), before);
  const after = await punch(next, 'check_out', at('2026-11-01', '02:00:00'));
  assert.deepEqual(after.services.map((service) => service.assignmentId), [today.id]);
  assert.equal(Number((await snapshot(f)).find((item) => item.id === row.id).hoursWorked), 4);
  await assert.rejects(read(f, at('2026-11-01', '02:00:00')), { code: 'QR_EXPIRED' });
});

test('18:00 to 04:00 closes through the same expired monthly link with a successful acknowledgment, then disables it', async () => {
  const f = await fixture();
  const row = await f.add('2026-10-31', { plannedCheckIn: '18:00', plannedCheckOut: '04:00',
    clientCheckIn: '18:00', clientCheckOut: '04:00', validationStatus: 'approved' });
  const untouched = await f.add('2026-11-01');
  await punch(f, 'check_in', at('2026-10-31', '18:00:00'));
  const state = await read(f, at('2026-11-01', '04:00:00'));
  assert.deepEqual(state.services.map((service) => service.assignmentId), [row.id]);
  const ack = await punch(f, 'check_out', at('2026-11-01', '04:00:00'), { state });
  assert.equal(ack.closed, true);
  assert.equal(ack.active, null);
  assert.deepEqual(ack.services, []);
  const saved = (await snapshot(f)).find((item) => item.id === row.id);
  assert.equal(saved.checkOut, '04:00');
  assert.equal(Number(saved.hoursWorked), 10);
  assert.equal(Number(saved.totalPay), 100);
  assert.equal(saved.clientCheckIn, '18:00');
  assert.equal(saved.clientCheckOut, '04:00');
  assert.equal(saved.validationStatus, 'approved');
  assert.equal((await snapshot(f)).find((item) => item.id === untouched.id).checkIn, null);
  const before = await snapshot(f);
  for (const action of ['check_in', 'check_out']) {
    await assert.rejects(punch(f, action, at('2026-11-01', '04:00:01'), { state }), { code: 'QR_EXPIRED' });
  }
  await assert.rejects(read(f, at('2026-11-01', '04:00:01')), { code: 'QR_EXPIRED' });
  assert.deepEqual(await snapshot(f), before);
  assert.equal((await logs(f)).length, 2);
});

test('closing-shift extension preserves cooldown across midnight and rejects another assignment or new entry', async () => {
  const f = await fixture();
  const row = await f.add('2026-10-31', { plannedCheckIn: '23:00', plannedCheckOut: '04:00' });
  const unopened = await f.add('2026-10-31', { plannedCheckIn: '23:00', plannedCheckOut: '05:00' });
  await punch(f, 'check_in', at('2026-10-31', '23:50:00'), { id: row.id });
  const state = await read(f, at('2026-11-01', '00:00:00'));
  assert.equal(state.active.services[0].checkOutRetryAfterMs, 20 * 60 * 1000);
  await assert.rejects(punch(f, 'check_out', at('2026-11-01', '00:19:59'), { state }), { code: 'QR_CHECKOUT_TOO_EARLY' });
  await assert.rejects(punch(f, 'check_out', at('2026-11-01', '00:20:00'), { id: unopened.id }), { code: 'QR_EXPIRED' });
  await assert.rejects(punch(f, 'check_in', at('2026-11-01', '00:20:00'), { state, id: unopened.id }), { code: 'QR_EXPIRED' });
  assert.equal((await logs(f)).length, 1);
  assert.equal((await punch(f, 'check_out', at('2026-11-01', '00:20:00'))).closed, true);
});

test('closing exception stops at the original usage window and rejects revoked/cancelled/non-overnight services', async () => {
  for (const changed of ['cancelled', 'revoked', 'normal']) {
    const f = await fixture();
    const row = await f.add('2026-10-31', { plannedCheckIn: '18:00', plannedCheckOut: changed === 'normal' ? '22:00' : '04:00' });
    await punch(f, 'check_in', at('2026-10-31', '18:00:00'));
    if (changed === 'cancelled') await db.eventAssignment.update({ where: { id: row.id }, data: { status: 'cancelled' } });
    if (changed === 'revoked') await db.qrCheckCode.update({ where: { assignmentId: row.id }, data: { revokedAt: at('2026-11-01') } });
    const before = await snapshot(f);
    await assert.rejects(read(f, at('2026-11-01', '04:00:00')), { code: 'QR_EXPIRED' });
    assert.deepEqual(await snapshot(f), before);
  }
  const f = await fixture();
  await f.add('2026-10-31', { plannedCheckIn: '18:00', plannedCheckOut: '04:00' });
  await punch(f, 'check_in', at('2026-10-31', '18:00:00'));
  assert.equal((await read(f, at('2026-11-01', '23:59:59'))).checkoutOnly, true);
  await assert.rejects(read(f, at('2026-11-02', '00:00:00')), { code: 'QR_EXPIRED' });
  await assert.rejects(punch(f, 'check_out', at('2026-11-02', '00:00:00')), { code: 'QR_EXPIRED' });
  assert.equal((await logs(f)).length, 1);
});

test('entry after month end through a daily link does not reactivate the expired monthly link', async () => {
  const f = await fixture();
  const row = await f.add('2026-10-31', { plannedCheckIn: '18:00', plannedCheckOut: '04:00' });
  const qr = await ensureAssignmentQr(db, row.id);
  const { registerPublicQr } = await import('./qrAttendance.js');
  await registerPublicQr(db, qr.token, 'check_in', { now: at('2026-11-01', '00:10:00') });
  await assert.rejects(read(f, at('2026-11-01', '04:00:00')), { code: 'QR_EXPIRED' });
  assert.equal((await logs(f)).length, 1);
});

test('same-link overnight checkout handles leap February, year rollover and Lisbon summer time', async () => {
  for (const [last, next] of [['2028-02-29', '2028-03-01'], ['2026-12-31', '2027-01-01'], ['2026-03-31', '2026-04-01']]) {
    const f = await fixture();
    f.token = createMonthlyPunchToken(f.collaborator.id, at(last));
    await f.add(last, { plannedCheckIn: '18:00', plannedCheckOut: '04:00' });
    await punch(f, 'check_in', at(last, '18:00:00'));
    assert.equal((await read(f, at(next, '04:00:00'))).checkoutOnly, true);
    assert.equal((await punch(f, 'check_out', at(next, '04:00:00'))).closed, true);
    await assert.rejects(read(f, at(next, '04:00:01')), { code: 'QR_EXPIRED' });
  }
});

test('concurrent closing checkouts cannot duplicate logs or overwrite the same exit', async () => {
  const f = await fixture();
  await f.add('2026-10-31', { plannedCheckIn: '18:00', plannedCheckOut: '04:00' });
  await punch(f, 'check_in', at('2026-10-31', '18:00:00'));
  const state = await read(f, at('2026-11-01', '04:00:00'));
  const results = await Promise.allSettled([punch(f, 'check_out', at('2026-11-01', '04:00:00'), { state }),
    punch(f, 'check_out', at('2026-11-01', '04:00:00'), { state })]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal((await logs(f)).filter((item) => item.action === 'check_out').length, 1);
});

test('closing-shift authorization is checked again inside the attendance transaction', async () => {
  const f = await fixture();
  const row = await f.add('2026-10-31', { plannedCheckIn: '18:00', plannedCheckOut: '04:00' });
  await punch(f, 'check_in', at('2026-10-31', '18:00:00'));
  const now = at('2026-11-01', '04:00:00');
  const state = await read(f, now);
  const guardedDb = new Proxy(db, { get(target, key) {
    if (key === '$transaction') return async (callback, options) => {
      await db.eventAssignment.update({ where: { id: row.id }, data: { status: 'cancelled' } });
      return db.$transaction(callback, options);
    };
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  await assert.rejects(registerMonthlyPunchQr(guardedDb, f.token, 'check_out', {
    assignmentId: row.id, revision: state.active.revision,
  }, { now }), { code: 'QR_EXPIRED' });
  assert.equal((await snapshot(f)).find((item) => item.id === row.id).checkOut, null);
  assert.equal((await logs(f)).length, 1);
});

test('manual entry and inherited overnight schedules reuse the existing timestamp fallback', async () => {
  const f = await fixture();
  await db.event.update({ where: { id: f.event.id }, data: { startTime: '18:00', endTime: '04:00' } });
  const row = await f.add('2026-10-31', { plannedCheckIn: null, plannedCheckOut: null, checkIn: '18:00' });
  const state = await read(f, at('2026-11-01', '04:00:00'));
  assert.equal(state.active.activeAssignmentId, row.id);
  assert.equal((await punch(f, 'check_out', at('2026-11-01', '04:00:00'))).closed, true);
  assert.equal((await logs(f)).length, 1);
});

test('previous monthly links and altered or cross-scope tokens cannot query data or punch', async () => {
  const dbNeverCalled = new Proxy({}, { get: () => { throw new Error('Database must not be accessed'); } });
  const now = at('2026-10-15');
  const old = createMonthlyQrToken(1, now);
  for (const operation of [readMonthlyPunchQr, (client, token, options) => registerMonthlyPunchQr(client, token, 'check_in', {}, options)]) {
    await assert.rejects(operation(dbNeverCalled, old, { now }), { code: 'QR_RETIRED' });
    await assert.rejects(operation(dbNeverCalled, `${createMonthlyPunchToken(1, now)}x`, { now }), { code: 'QR_INVALID' });
  }
});

test('new monthly HTTP links integrate with Communication while daily URLs remain unchanged', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: at('2026-10-15') });
  process.env.DATABASE_URL = datasourceUrl;
  const { qrPublicRouter, qrCodesRouter } = await import('../routes/qrCheckins.js');
  const { prisma } = await import('../prisma.js');
  const f = await fixture();
  const row = await f.add('2026-10-15');
  const future = await f.add('2026-10-16');
  const app = express();
  app.use(express.json());
  app.use('/api/qr-check', qrPublicRouter);
  app.use('/api/qr-codes', qrCodesRouter);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message, code: error.code }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = `${base}/api/qr-check/month/${f.token}`;
  try {
    const code = await (await fetch(`${base}/api/qr-codes/assignments/${row.id}`)).json();
    assert.equal(code.qrScope, 'day');
    assert.match(code.qrUrl, /\/qr\/day\/day1\./);
    assert.ok(code.monthlyQrUrl.endsWith(`/qr/month/${f.token}`));
    const futureCode = await (await fetch(`${base}/api/qr-codes/assignments/${future.id}`)).json();
    assert.equal(futureCode.monthlyQrUrl, code.monthlyQrUrl);
    assert.notEqual(futureCode.qrUrl, code.qrUrl);
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    const state = await response.json();
    assert.equal(JSON.stringify(state).includes('123456789'), false);
    const send = (action, current = state) => fetch(`${url}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignmentId: row.id, revision: current.active?.revision }) });
    const entry = await send('check-in');
    assert.equal(entry.status, 200);
    const started = await entry.json();
    assert.equal((await send('check-in')).status, 409);
    assert.equal((await send('check-out', started)).status, 409);
    t.mock.timers.setTime(at('2026-10-15', '12:00:00').getTime());
    const exit = await send('check-out', started);
    assert.equal(exit.status, 200);
    assert.deepEqual((await exit.json()).services.map((service) => service.assignmentId), [future.id]);
    const before = await snapshot(f);
    t.mock.timers.setTime(at('2026-11-01', '00:00:00').getTime());
    for (const action of ['check-in', 'check-out']) assert.equal((await send(action)).status, 410);
    assert.equal((await fetch(url)).status, 410);
    assert.deepEqual(await snapshot(f), before);
    assert.equal((await logs(f)).length, 2);
    const closing = await fixture();
    const closingRow = await closing.add('2026-10-31', { plannedCheckIn: '18:00', plannedCheckOut: '04:00' });
    const nextMonthRow = await closing.add('2026-11-01');
    const closingUrl = `${base}/api/qr-check/month/${closing.token}`;
    t.mock.timers.setTime(at('2026-10-31', '18:00:00').getTime());
    const closingInitial = await (await fetch(closingUrl)).json();
    const sendClosing = (action, state) => fetch(`${closingUrl}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignmentId: closingRow.id, revision: state.active?.revision }),
    });
    assert.equal((await sendClosing('check-in', closingInitial)).status, 200);
    t.mock.timers.setTime(at('2026-11-01', '04:00:00').getTime());
    const closingResponse = await fetch(closingUrl);
    assert.equal(closingResponse.status, 200);
    assert.equal(closingResponse.headers.get('cache-control'), 'no-store');
    const closingState = await closingResponse.json();
    assert.equal(closingState.checkoutOnly, true);
    assert.deepEqual(closingState.services.map((service) => service.assignmentId), [closingRow.id]);
    assert.equal((await sendClosing('check-in', closingState)).status, 410);
    const closingExit = await sendClosing('check-out', closingState);
    assert.equal(closingExit.status, 200);
    const closed = await closingExit.json();
    assert.equal(closed.closed, true);
    assert.equal(closed.active, null);
    assert.deepEqual(closed.services, []);
    assert.equal((await fetch(closingUrl)).status, 410);
    assert.equal((await sendClosing('check-out', closingState)).status, 410);
    const closingSaved = await snapshot(closing);
    assert.equal(closingSaved.find((item) => item.id === closingRow.id).checkOut, '04:00');
    assert.equal(closingSaved.find((item) => item.id === nextMonthRow.id).checkIn, null);
    assert.equal((await logs(closing)).length, 2);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
});
