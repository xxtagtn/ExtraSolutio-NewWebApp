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
import { readDailyQr, registerDailyQr } from './qrDailyAttendance.js';
import { ensureAssignmentQr } from './qrCodeGeneration.js';
import { readPublicQr, registerPublicQr } from './qrAttendance.js';
import { createDailyQrToken } from '../utils/qrDailyToken.js';

const directory = mkdtempSync(join(tmpdir(), 'es-daily-qr-test-'));
const database = join(directory, 'test.db');
const datasourceUrl = `file:${database.replaceAll('\\', '/')}`;
const db = new PrismaClient({ datasourceUrl });
const day = '2026-09-24';
const at = (time, date = day) => new Date(`${date}T${time}+01:00`);
let sequence = 0;
process.env.JWT_SECRET = 'daily-qr-test-key-only-not-for-production';
process.env.APP_TIMEZONE = 'Europe/Lisbon';

before(async () => {
  const result = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/sqlite/schema.prisma', '--script'], {
    env: { ...process.env, DATABASE_URL: datasourceUrl }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const sqlite = new DatabaseSync(database);
  sqlite.exec(result.stdout);
  sqlite.close();
});

after(async () => {
  await db.$disconnect();
  rmSync(database, { force: true });
  rmdirSync(directory);
});

async function fixture({ times = [['09:00', '12:00'], ['15:00', '18:00']], continuous = false, sameEvent = true, date = day } = {}) {
  const collaborator = await db.collaborator.create({ data: { name: 'Daily QR Test', email: `daily-${++sequence}@example.test` } });
  const makeEvent = () => db.event.create({ data: {
    name: 'Test service', date: new Date(continuous ? '2026-09-01' : date),
    isContinuous: continuous, endDate: continuous ? new Date('2026-09-30') : null,
  } });
  const event = await makeEvent();
  const rows = [];
  for (const [start, end] of times) {
    rows.push(await db.eventAssignment.create({ data: {
      eventId: sameEvent || !rows.length ? event.id : (await makeEvent()).id,
      collaboratorId: collaborator.id, assignmentDate: continuous ? new Date(date) : null,
      plannedCheckIn: start, plannedCheckOut: end, status: 'confirmed', hourlyRate: 10,
    } }));
  }
  return { rows, collaborator, event, token: createDailyQrToken(collaborator.id, date) };
}

const read = (fixture, time = '09:00:00', date = day) => readDailyQr(db, fixture.token, { now: at(time, date) });
async function punch(fixture, action, time, { id, state, date = day } = {}) {
  const current = state || await read(fixture, time, date);
  return registerDailyQr(db, fixture.token, action, { assignmentId: id || current.activeAssignmentId, revision: current.revision }, { now: at(time, date) });
}
const saved = (row) => db.eventAssignment.findUnique({ where: { id: row.id } });
const edit = (row, data) => db.eventAssignment.update({ where: { id: row.id }, data });
const logs = (fixture) => db.qrCheckLog.findMany({ where: { collaboratorId: fixture.collaborator.id }, orderBy: { id: 'asc' } });

test('one daily link completes morning and afternoon separately and preserves existing pay/validation fields', async () => {
  const fixtureData = await fixture();
  const [morning, afternoon] = fixtureData.rows;
  await edit(morning, { clientCheckIn: '09:00', clientCheckOut: '12:00', validationStatus: 'approved' });
  let state = await punch(fixtureData, 'check_in', '09:00:00');
  assert.equal(state.activeAssignmentId, morning.id);
  assert.equal(state.services[0].checkOutRetryAfterMs, 1800000);
  state = await punch(fixtureData, 'check_out', '12:00:00');
  assert.equal(state.activeAssignmentId, afternoon.id);
  assert.equal(state.completedCount, 1);
  assert.equal((await saved(afternoon)).checkIn, null);
  await punch(fixtureData, 'check_in', '15:00:00');
  state = await punch(fixtureData, 'check_out', '18:00:00');
  assert.equal(state.completed, true);
  assert.equal(state.completedCount, 2);
  assert.equal(state.activeAssignmentId, null);
  for (const row of fixtureData.rows) {
    const result = await saved(row);
    assert.equal(Number(result.hoursWorked), 3);
    assert.equal(Number(result.totalPay), 30);
  }
  const result = await saved(morning);
  assert.equal(result.clientCheckIn, '09:00');
  assert.equal(result.clientCheckOut, '12:00');
  assert.equal(result.validationStatus, 'approved');
  assert.deepEqual((await logs(fixtureData)).map((log) => [log.assignmentId, log.action]), [
    [morning.id, 'check_in'], [morning.id, 'check_out'], [afternoon.id, 'check_in'], [afternoon.id, 'check_out'],
  ]);
});

test('duplicate requests and checkout inside 30 minutes are blocked; exactly 30 minutes is accepted', async () => {
  const f = await fixture();
  const initial = await read(f);
  await punch(f, 'check_in', '09:00:45', { state: initial });
  await assert.rejects(punch(f, 'check_in', '09:00:45', { state: initial }), { code: 'QR_CHANGED' });
  for (const time of ['09:00:45', '09:10:00', '09:30:44.999']) {
    await assert.rejects(punch(f, 'check_out', time), { code: 'QR_CHECKOUT_TOO_EARLY' });
  }
  await punch(f, 'check_out', '09:30:45');
  assert.equal((await logs(f)).length, 2);
});

test('finishing a service cannot turn a repeated or immediate tap into the next entry', async () => {
  const f = await fixture();
  await punch(f, 'check_in', '09:00:00');
  const beforeExit = await read(f, '12:00:00');
  const afterExit = await punch(f, 'check_out', '12:00:00', { state: beforeExit });
  await assert.rejects(punch(f, 'check_out', '12:00:00', { state: beforeExit }), { code: 'QR_CHANGED' });
  await assert.rejects(punch(f, 'check_in', '12:00:01.999', { state: afterExit }), { code: 'QR_SERVICE_SWITCH' });
  assert.equal((await saved(f.rows[1])).checkIn, null);
  await punch(f, 'check_in', '12:00:02', { state: afterExit });
  await assert.rejects(punch(f, 'check_out', '12:10:00'), { code: 'QR_CHECKOUT_TOO_EARLY' });
});

test('admin deletion of exit/entry reopens that service and historical logs do not block repunching', async () => {
  const f = await fixture();
  await punch(f, 'check_in', '09:00:00');
  await punch(f, 'check_out', '12:00:00');
  const history = await logs(f);
  const stale = await read(f, '12:01:00');
  await edit(f.rows[0], { checkOut: null });
  await assert.rejects(punch(f, 'check_in', '12:01:00', { state: stale }), { code: 'QR_CHANGED' });
  assert.equal((await read(f, '12:01:00')).activeAssignmentId, f.rows[0].id);
  await punch(f, 'check_out', '12:05:00');
  await edit(f.rows[0], { checkIn: null });
  assert.equal((await read(f, '12:06:00')).services[0].state.nextAction, 'check_in');
  await punch(f, 'check_in', '12:06:00');
  assert.equal((await saved(f.rows[0])).checkIn, '12:06');
  assert.equal((await saved(f.rows[0])).checkOut, '12:05');
  assert.deepEqual((await logs(f)).slice(0, history.length), history);
});

test('continuous event days and collaborators stay isolated, including services across different events', async () => {
  const f = await fixture({ continuous: true, sameEvent: false });
  const otherDay = await db.eventAssignment.create({ data: { ...Object.fromEntries(['eventId', 'collaboratorId'].map((key) => [key, f.rows[0][key]])), assignmentDate: new Date('2026-09-25'), plannedCheckIn: '09:00', plannedCheckOut: '12:00' } });
  const otherPerson = await fixture();
  assert.deepEqual((await read(f)).services.map((row) => row.assignmentId), f.rows.map((row) => row.id));
  await punch(f, 'check_in', '09:00:00');
  assert.equal((await saved(otherDay)).checkIn, null);
  assert.equal((await saved(otherPerson.rows[0])).checkIn, null);
  const nextDay = await readDailyQr(db, createDailyQrToken(f.collaborator.id, '2026-09-25'), { now: at('09:00:00', '2026-09-25') });
  assert.deepEqual(nextDay.services.map((row) => row.assignmentId), [otherDay.id]);
});

test('cancelled, removed, absent or revoked services are excluded and changes invalidate stale requests', async () => {
  for (const status of ['cancelled', 'missed_justified', 'missed_unjustified']) {
    const f = await fixture();
    const old = await read(f);
    await edit(f.rows[0], { status });
    assert.equal((await read(f)).activeAssignmentId, f.rows[1].id);
    await assert.rejects(punch(f, 'check_in', '09:00:00', { state: old }), { code: 'QR_CHANGED' });
  }
  const f = await fixture({ continuous: true, sameEvent: false });
  const qr = await ensureAssignmentQr(db, f.rows[0].id);
  await db.qrCheckCode.update({ where: { id: qr.id }, data: { revokedAt: new Date() } });
  assert.equal((await read(f)).total, 1);
  await db.event.update({ where: { id: f.rows[1].eventId }, data: { cancelledDays: JSON.stringify([day]) } });
  await assert.rejects(read(f), { code: 'QR_DAY_EMPTY' });
  assert.ok((await db.qrCheckCode.findUnique({ where: { id: qr.id } })).revokedAt);
});

test('overlapping/unknown schedules require a service choice, then the open service takes priority', async () => {
  for (const times of [[['09:00', '12:00'], ['11:00', '14:00']], [['', ''], ['', '']]]) {
    const f = await fixture({ times });
    const state = await read(f);
    assert.equal(state.selectionRequired, true);
    assert.equal(state.activeAssignmentId, null);
    await assert.rejects(punch(f, 'check_in', '09:00:00'), { code: 'QR_SERVICE_REQUIRED' });
    const result = await punch(f, 'check_in', '09:00:00', { id: f.rows[1].id });
    assert.equal(result.activeAssignmentId, f.rows[1].id);
    await assert.rejects(punch(f, 'check_in', '09:01:00', { id: f.rows[0].id }), { code: 'QR_SERVICE_REQUIRED' });
  }
});

test('concurrent requests against two overlapping services cannot open both', async () => {
  const f = await fixture({ times: [['09:00', '12:00'], ['09:00', '12:00']] });
  const state = await read(f);
  const results = await Promise.allSettled(f.rows.map((row) => punch(f, 'check_in', '09:00:00', { id: row.id, state })));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await logs(f)).length, 1);
});

test('legacy links remain valid and synchronize with the daily view without replacing their tokens', async () => {
  const f = await fixture();
  const qr = await ensureAssignmentQr(db, f.rows[0].id);
  const before = await db.qrCheckCode.findUnique({ where: { id: qr.id } });
  await read(f);
  assert.deepEqual(await db.qrCheckCode.findUnique({ where: { id: qr.id } }), before);
  await registerPublicQr(db, qr.token, 'check_in', { now: at('09:00:00') });
  assert.equal((await read(f)).services[0].checkIn, '09:00');
  await punch(f, 'check_out', '12:00:00');
  const oldLink = await readPublicQr(db, qr.token, { now: at('12:00:00') });
  assert.equal(oldLink.assignment.checkOut, '12:00');
  assert.equal(oldLink.token, qr.token);
});

test('overnight checkout and after-midnight entry work without exposing the following day services', async () => {
  const f = await fixture({ times: [['09:00', '12:00'], ['22:00', '02:00']] });
  await punch(f, 'check_in', '09:00:00');
  await punch(f, 'check_out', '12:00:00');
  await punch(f, 'check_in', '22:00:00');
  const result = await punch(f, 'check_out', '02:00:00', { date: '2026-09-25' });
  assert.equal(result.completed, true);
  assert.equal(Number((await saved(f.rows[1])).hoursWorked), 4);
  const late = await fixture({ times: [['22:00', '02:00']] });
  await punch(late, 'check_in', '00:15:00', { date: '2026-09-25' });
  await assert.rejects(punch(late, 'check_out', '00:44:59', { date: '2026-09-25' }), { code: 'QR_CHECKOUT_TOO_EARLY' });
  await punch(late, 'check_out', '00:45:00', { date: '2026-09-25' });
  await assert.rejects(read(f, '00:00:00', '2026-09-26'), { code: 'QR_EXPIRED' });
});

test('date restrictions, invalid links and assignment spoofing do not write anything', async () => {
  const f = await fixture();
  const other = await fixture();
  await assert.rejects(punch(f, 'check_in', '23:59:59', { date: '2026-09-23' }), { code: 'QR_NOT_ACTIVE' });
  await assert.rejects(read(f, '00:00:00', '2026-09-25'), { code: 'QR_EXPIRED' });
  await assert.rejects(readDailyQr(db, 'invalid'), { code: 'QR_INVALID' });
  await assert.rejects(punch(f, 'check_in', '09:00:00', { id: other.rows[0].id }), { code: 'QR_SERVICE_REQUIRED' });
  assert.equal((await logs(f)).length, 0);
  assert.equal((await saved(other.rows[0])).checkIn, null);
});

test('daily link previews split services exactly 24h before the first start, without authorizing punches or writing data', async () => {
  const f = await fixture({ continuous: true });
  const before = await db.eventAssignment.findMany({ where: { collaboratorId: f.collaborator.id } });
  await assert.rejects(read(f, '08:59:59.999', '2026-09-23'), { code: 'QR_NOT_ACTIVE' });
  for (const time of ['09:00:00', '10:00:00', '23:59:59.999']) {
    const state = await read(f, time, '2026-09-23');
    assert.equal(state.total, 2);
    assert.equal(state.activeAssignmentId, f.rows[0].id);
    assert.equal(state.punchAvailableAt, '2026-09-23T23:00:00.000Z');
    assert.equal(state.punchAvailableTime, '00:00');
    assert.ok(state.punchRetryAfterMs > 0);
    for (const action of ['check_in', 'check_out']) {
      await assert.rejects(punch(f, action, time, { state, date: '2026-09-23' }), { code: 'QR_NOT_ACTIVE' });
    }
  }
  assert.deepEqual(await db.eventAssignment.findMany({ where: { collaboratorId: f.collaborator.id } }), before);
  assert.equal(await db.qrCheckCode.count({ where: { collaboratorId: f.collaborator.id } }), 0);
  assert.equal((await logs(f)).length, 0);
  const ready = await read(f, '00:00:00');
  assert.equal(ready.punchRetryAfterMs, 0);
  await punch(f, 'check_in', '00:00:00', { state: ready });
  assert.equal((await saved(f.rows[0])).checkIn, '00:00');
});

test('preview uses each collaborator schedule, actual entry when present, and start-only schedules', async () => {
  const early = await fixture({ times: [['07:00', '15:00'], ['16:00', '20:00']] });
  const late = await fixture({ times: [['18:00', '23:00']] });
  const partial = await fixture({ times: [['07:00', null]] });
  assert.equal((await read(early, '07:00:00', '2026-09-23')).total, 2);
  assert.equal((await read(partial, '07:00:00', '2026-09-23')).total, 1);
  await assert.rejects(read(late, '07:00:00', '2026-09-23'), { code: 'QR_NOT_ACTIVE' });
  await edit(early.rows[0], { checkIn: '08:00' });
  await assert.rejects(read(early, '07:00:00', '2026-09-23'), { code: 'QR_NOT_ACTIVE' });
  assert.equal((await read(early, '08:00:00', '2026-09-23')).total, 2);
});

test('preview boundaries use 24 elapsed hours across DST and the application timezone for partial schedules', async () => {
  for (const [date, previewStart, punchStart] of [
    ['2026-03-29', '2026-03-28T08:00:00Z', '2026-03-29T00:00:00.000Z'],
    ['2026-10-25', '2026-10-24T09:00:00Z', '2026-10-24T23:00:00.000Z'],
  ]) {
    const f = await fixture({ date });
    await assert.rejects(readDailyQr(db, f.token, { now: new Date(new Date(previewStart).getTime() - 1) }), { code: 'QR_NOT_ACTIVE' });
    const state = await readDailyQr(db, f.token, { now: new Date(previewStart) });
    assert.equal(state.punchAvailableAt, punchStart);
  }
  const f = await fixture({ times: [['09:00', null]] });
  process.env.APP_TIMEZONE = 'America/New_York';
  try {
    await assert.rejects(readDailyQr(db, f.token, { now: new Date('2026-09-23T12:59:59Z') }), { code: 'QR_NOT_ACTIVE' });
    const state = await readDailyQr(db, f.token, { now: new Date('2026-09-23T13:00:00Z') });
    assert.equal(state.punchAvailableAt, '2026-09-24T04:00:00.000Z');
  } finally {
    process.env.APP_TIMEZONE = 'Europe/Lisbon';
  }
});

test('service changes, removal and daily work locations are read afresh without rewriting history', async () => {
  const f = await fixture({ continuous: true });
  await db.event.update({ where: { id: f.event.id }, data: { workLocationsEnabled: true } });
  const locations = [];
  for (const name of ['Sala A', 'Sala B']) locations.push(await db.eventWorkLocation.create({ data: { eventId: f.event.id, name } }));
  for (const [index, row] of f.rows.entries()) await edit(row, { workLocationId: locations[index].id });
  const old = await read(f);
  assert.deepEqual(old.services.map((row) => row.workLocation), ['Sala A', 'Sala B']);
  const before = await db.eventAssignment.findMany({ where: { collaboratorId: f.collaborator.id } });
  await read(f);
  assert.deepEqual(await db.eventAssignment.findMany({ where: { collaboratorId: f.collaborator.id } }), before);
  await edit(f.rows[0], { plannedCheckIn: '16:00', plannedCheckOut: '19:00' });
  await assert.rejects(punch(f, 'check_in', '15:00:00', { state: old }), { code: 'QR_CHANGED' });
  await db.eventAssignment.delete({ where: { id: f.rows[0].id } });
  assert.deepEqual((await read(f)).services.map((row) => row.assignmentId), [f.rows[1].id]);
  await db.event.update({ where: { id: f.event.id }, data: { status: 'cancelled' } });
  await assert.rejects(read(f), { code: 'QR_DAY_EMPTY' });
});

test('public HTTP routes accept signed daily links, enforce request revisions and retain legacy routes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: at('09:00:00') });
  process.env.DATABASE_URL = datasourceUrl;
  const { qrPublicRouter } = await import('../routes/qrCheckins.js');
  const { prisma } = await import('../prisma.js');
  const f = await fixture();
  const app = express();
  app.use(express.json());
  app.use('/api/qr-check', qrPublicRouter);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message, code: error.code }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/qr-check`;
  try {
    const initial = await fetch(`${url}/day/${f.token}`);
    assert.equal(initial.status, 200);
    assert.equal(initial.headers.get('cache-control'), 'no-store');
    const state = await initial.json();
    const body = JSON.stringify({ assignmentId: state.activeAssignmentId, revision: state.revision });
    const send = (action) => fetch(`${url}/day/${f.token}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal((await send('check-in')).status, 200);
    assert.equal((await send('check-in')).status, 409);
    const qr = await ensureAssignmentQr(db, f.rows[0].id);
    const legacy = await fetch(`${url}/${qr.token}`);
    assert.equal(legacy.status, 200);
    assert.equal((await legacy.json()).checkIn, '09:00');
    assert.equal((await fetch(`${url}/day/invalid`)).status, 404);
    const empty = await fetch(`${url}/day/${f.token}/check-out`, { method: 'POST' });
    assert.equal(empty.status, 409);
    assert.equal((await logs(f)).length, 1);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
});
