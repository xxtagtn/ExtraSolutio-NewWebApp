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
import { monthlyQrRows, readMonthlyQr, registerMonthlyQr } from './qrMonthlyAttendance.js';
import { createMonthlyQrToken } from '../utils/qrMonthlyToken.js';
import { ensureAssignmentQr } from './qrCodeGeneration.js';
import { eventStartInstant } from '../utils/eventTime.js';

const directory = mkdtempSync(join(tmpdir(), 'es-monthly-qr-test-'));
const database = join(directory, 'test.db');
const datasourceUrl = `file:${database.replaceAll('\\', '/')}`;
const db = new PrismaClient({ datasourceUrl });
process.env.JWT_SECRET = 'monthly-qr-test-key-only-not-for-production';
process.env.APP_TIMEZONE = 'Europe/Lisbon';
let sequence = 0;
const at = (day, time = '09:00:00') => new Date(eventStartInstant(day, time, 'Europe/Lisbon').getTime()
  + Number(time.split(':')[2] || 0) * 1000);

before(() => {
  const result = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/sqlite/schema.prisma', '--script'], {
    env: { ...process.env, DATABASE_URL: datasourceUrl }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const sqlite = new DatabaseSync(database);
  sqlite.exec(result.stdout);
  sqlite.close();
});
after(async () => { await db.$disconnect(); rmSync(database, { force: true }); rmdirSync(directory); });

async function fixture() {
  const collaborator = await db.collaborator.create({ data: { name: 'Monthly QR Test', email: `month-${++sequence}@example.test`, nif: '123456789' } });
  const event = await db.event.create({ data: { name: 'Monthly service', date: new Date('2026-09-01'), isContinuous: true, endDate: new Date('2026-11-30') } });
  const add = (day, data = {}) => db.eventAssignment.create({ data: { eventId: event.id, collaboratorId: collaborator.id,
    assignmentDate: new Date(day), plannedCheckIn: '09:00', plannedCheckOut: '12:00', status: 'confirmed', hourlyRate: 10, ...data } });
  return { collaborator, event, add, token: createMonthlyQrToken(collaborator.id, at('2026-10-06')) };
}
async function punch(f, action, now, { state, id } = {}) {
  const current = state || await readMonthlyQr(db, f.token, { now });
  return registerMonthlyQr(db, f.token, action, { assignmentId: id || current.active.activeAssignmentId,
    revision: current.active?.revision }, { now });
}

test('only confirmed starts in the calendar month are listed; next month appears with its own link without mutations', async () => {
  const f = await fixture();
  const today = await f.add('2026-10-06', { plannedCheckIn: '15:00', plannedCheckOut: '18:00' });
  const inside = [today];
  for (const [day, plannedCheckIn, plannedCheckOut] of [
    ['2026-10-09', '08:00', '16:00'], ['2026-10-12', '15:30', '23:00'],
    ['2026-10-15', '00:30', '08:00'], ['2026-10-31', '23:00', '02:00'],
  ]) inside.push(await f.add(day, { plannedCheckIn, plannedCheckOut }));
  const outside = [await f.add('2026-11-01', { plannedCheckIn: '00:00' }), await f.add('2026-11-18')];
  const pending = await f.add('2026-10-12', { status: 'pending' });
  const otherEvent = await db.event.create({ data: { name: 'Out-of-cycle single event', date: new Date('2026-11-18') } });
  const single = await db.eventAssignment.create({ data: { eventId: otherEvent.id, collaboratorId: f.collaborator.id,
    status: 'confirmed', plannedCheckIn: '08:00', plannedCheckOut: '16:00' } });
  const before = await db.eventAssignment.findMany({ where: { collaboratorId: f.collaborator.id } });
  const current = await readMonthlyQr(db, f.token, { now: at('2026-10-06') });
  assert.deepEqual(current.services.map((row) => row.assignmentId), inside.map((row) => row.id));
  assert.equal(current.services.every((row) => row.upcoming), true, 'Upcoming uses the planned start, not just the service date');
  assert.equal(current.active.activeAssignmentId, today.id, 'Existing service-day punch rules are unchanged');
  assert.equal(current.services.at(-1).requiresNewLinkForCheckout, true);
  await assert.rejects(punch(f, 'check_in', at('2026-10-06'), { state: current, id: inside[1].id }), { code: 'QR_SERVICE_REQUIRED' });
  const now = at('2026-11-01', '00:00:00');
  const next = await readMonthlyQr(db, createMonthlyQrToken(f.collaborator.id, now), { now });
  for (const row of [...outside, single]) assert.ok(next.services.some((service) => service.assignmentId === row.id));
  assert.equal(next.services.some((row) => row.assignmentId === pending.id), false);
  assert.deepEqual(await db.eventAssignment.findMany({ where: { collaboratorId: f.collaborator.id } }), before);
  assert.equal(await db.qrCheckLog.count({ where: { collaboratorId: f.collaborator.id } }), 0);
  assert.equal(await db.qrCheckCode.count({ where: { collaboratorId: f.collaborator.id } }), 0);
});

test('September and October links keep separate month histories throughout consultation and communication reads', async () => {
  const f = await fixture();
  const september = [await f.add('2026-09-15', { checkIn: '09:00', checkOut: '12:00' }),
    await f.add('2026-09-30', { plannedCheckIn: '22:00', plannedCheckOut: '02:00', checkIn: '22:00', checkOut: '02:00' })];
  const singleEvent = await db.event.create({ data: { name: 'September single event', date: new Date('2026-09-28') } });
  september.push(await db.eventAssignment.create({ data: { eventId: singleEvent.id, collaboratorId: f.collaborator.id,
    status: 'confirmed', plannedCheckIn: '08:00', plannedCheckOut: '16:00' } }));
  const october = [await f.add('2026-10-01'), await f.add('2026-10-06'), await f.add('2026-10-31')];
  await f.add('2026-11-01');
  const before = await db.eventAssignment.findMany({ where: { collaboratorId: f.collaborator.id } });
  const septemberToken = createMonthlyQrToken(f.collaborator.id, at('2026-09-01'));
  const old = await readMonthlyQr(db, septemberToken, { now: at('2026-10-06') });
  assert.deepEqual(new Set(old.services.map((row) => row.assignmentId)), new Set(september.map((row) => row.id)));
  assert.equal(old.consultationOnly, true);
  assert.equal(old.active, null);
  for (const day of ['2026-10-01', '2026-10-06', '2026-10-14', '2026-10-15', '2026-11-14']) {
    const current = await readMonthlyQr(db, f.token, { now: at(day) });
    assert.deepEqual(current.services.map((row) => row.assignmentId), october.map((row) => row.id));
    assert.equal(current.historyFrom, '2026-10-01');
  }
  const communication = await monthlyQrRows(db, { collaboratorId: f.collaborator.id, now: at('2026-10-06') });
  assert.deepEqual(communication.map((row) => row.id), october.map((row) => row.id));
  await assert.rejects(readMonthlyQr(db, septemberToken, { now: at('2026-10-15', '00:00:00') }), { code: 'QR_EXPIRED' });
  assert.deepEqual(await db.eventAssignment.findMany({ where: { collaboratorId: f.collaborator.id } }), before);
});

test('same monthly link adds confirmed services and preserves daily cooldown, pay, validation and separate shifts', async () => {
  const f = await fixture();
  const morning = await f.add('2026-10-06', { validationStatus: 'approved', clientCheckIn: '09:00', clientCheckOut: '12:00' });
  const old = await f.add('2026-09-24', { checkIn: '08:02', checkOut: '16:05', validationStatus: 'validated', validatedCheckIn: '08:00', validatedCheckOut: '16:00' });
  await f.add('2026-08-31');
  let current = await readMonthlyQr(db, f.token, { now: at('2026-10-06') });
  assert.equal(current.services.length, 1);
  assert.equal(current.active.activeAssignmentId, morning.id);
  assert.equal(current.services.some((row) => row.assignmentId === old.id), false);
  assert.equal(JSON.stringify(current).includes('123456789'), false);
  assert.equal(JSON.stringify(current).includes('hourlyRate'), false);
  assert.equal(await db.qrCheckCode.count({ where: { collaboratorId: f.collaborator.id } }), 0);
  const afternoon = await f.add('2026-10-06', { plannedCheckIn: '15:00', plannedCheckOut: '18:00' });
  const future = await f.add('2026-10-09');
  const later = await f.add('2026-11-01');
  current = await readMonthlyQr(db, f.token, { now: at('2026-10-06') });
  assert.equal(current.services.length, 3);
  assert.equal(current.services.find((row) => row.assignmentId === future.id).upcoming, true);
  assert.equal(current.services.some((row) => row.assignmentId === later.id), false);
  current = await punch(f, 'check_in', at('2026-10-06'));
  await assert.rejects(punch(f, 'check_out', at('2026-10-06', '09:29:59')), { code: 'QR_CHECKOUT_TOO_EARLY' });
  await assert.rejects(punch(f, 'check_in', at('2026-10-06', '09:00:01'), { state: current }), { code: 'QR_CHANGED' });
  await punch(f, 'check_out', at('2026-10-06', '12:00:00'));
  await punch(f, 'check_in', at('2026-10-06', '15:00:00'));
  current = await punch(f, 'check_out', at('2026-10-06', '18:00:00'));
  assert.equal(current.active, null);
  for (const row of [morning, afternoon]) {
    const saved = await db.eventAssignment.findUnique({ where: { id: row.id } });
    assert.equal(Number(saved.hoursWorked), 3);
    assert.equal(Number(saved.totalPay), 30);
  }
  const saved = await db.eventAssignment.findUnique({ where: { id: morning.id } });
  assert.equal(saved.validationStatus, 'approved');
  assert.equal(saved.clientCheckIn, '09:00');
  assert.equal(await db.qrCheckLog.count({ where: { collaboratorId: f.collaborator.id } }), 4);
});

test('old month is read-only through the following 14th; new link handles overnight checkout without mutating history', async () => {
  const f = await fixture();
  const lastMonth = await f.add('2026-09-24', { checkIn: '09:00', checkOut: '12:00' });
  const overnight = await f.add('2026-10-31', { plannedCheckIn: '22:00', plannedCheckOut: '02:00', checkIn: '22:00' });
  const november = await f.add('2026-11-01');
  const last = at('2026-10-31', '23:59:59.999');
  const next = at('2026-11-01', '00:00:00');
  const current = await readMonthlyQr(db, f.token, { now: last });
  assert.equal(current.services.length, 1);
  assert.equal(current.active.activeAssignmentId, overnight.id);
  assert.equal(current.services.find((row) => row.assignmentId === overnight.id).requiresNewLinkForCheckout, true);
  const before = await db.eventAssignment.findMany({ where: { collaboratorId: f.collaborator.id } });
  const consultation = await readMonthlyQr(db, f.token, { now: next });
  assert.equal(consultation.consultationOnly, true);
  assert.equal(consultation.active, null);
  assert.equal(consultation.readOnly, true);
  assert.equal(consultation.services.every((row) => row.readOnly), true);
  assert.equal(consultation.services.some((row) => row.assignmentId === november.id), false);
  for (const action of ['check_in', 'check_out']) await assert.rejects(punch(f, action, next, { state: current }), { code: 'QR_READ_ONLY' });
  assert.equal((await readMonthlyQr(db, f.token, { now: at('2026-11-14', '23:59:59.999') })).consultationOnly, true);
  for (const action of ['check_in', 'check_out']) await assert.rejects(punch(f, action, at('2026-11-14'), { state: current }), { code: 'QR_READ_ONLY' });
  await assert.rejects(readMonthlyQr(db, f.token, { now: at('2026-11-15', '00:00:00') }), { code: 'QR_EXPIRED' });
  const token = createMonthlyQrToken(f.collaborator.id, next);
  assert.notEqual(token, f.token);
  const renewed = await readMonthlyQr(db, token, { now: next });
  assert.equal(renewed.services.some((row) => row.assignmentId === lastMonth.id), false);
  assert.equal(renewed.active.activeAssignmentId, overnight.id);
  assert.deepEqual(renewed.services.map((row) => row.assignmentId), [november.id]);
  assert.equal(renewed.active.services.some((row) => row.assignmentId === overnight.id), true);
  assert.deepEqual(await db.eventAssignment.findMany({ where: { collaboratorId: f.collaborator.id } }), before);
  const checked = await registerMonthlyQr(db, token, 'check_out', { assignmentId: overnight.id, revision: renewed.active.revision }, { now: at('2026-11-01', '02:00:00') });
  assert.equal(checked.services.some((row) => row.assignmentId === overnight.id), false);
  assert.equal((await db.eventAssignment.findUnique({ where: { id: overnight.id } })).checkOut, '02:00');
  assert.equal((await readMonthlyQr(db, f.token, { now: at('2026-11-01', '02:00:00') })).services[0].checkOut, '02:00');
  await punch({ ...f, token }, 'check_in', at('2026-11-01', '09:00:00'));
  assert.equal((await db.eventAssignment.findUnique({ where: { id: november.id } })).checkIn, '09:00');
  assert.equal((await db.eventAssignment.findUnique({ where: { id: lastMonth.id } })).checkIn, '09:00');
});

test('an overnight checkout remains possible without any new-month services and does not populate monthly history', async () => {
  const f = await fixture();
  const overnight = await f.add('2026-10-31', { plannedCheckIn: '22:00', plannedCheckOut: '02:00', checkIn: '22:00' });
  const now = at('2026-11-01', '01:00:00');
  const token = createMonthlyQrToken(f.collaborator.id, now);
  const current = await readMonthlyQr(db, token, { now });
  assert.deepEqual(current.services, []);
  assert.equal(current.active.activeAssignmentId, overnight.id);
  const finished = await registerMonthlyQr(db, token, 'check_out', { assignmentId: overnight.id,
    revision: current.active.revision }, { now: at('2026-11-01', '02:00:00') });
  assert.deepEqual(finished.services, []);
  assert.equal(finished.active, null);
  const old = await readMonthlyQr(db, f.token, { now: at('2026-11-01', '02:00:00') });
  assert.equal(old.services[0].checkOut, '02:00');
  assert.equal(old.consultationOnly, true);
});

test('monthly read isolates collaborators, rejects spoofing and stale revisions, excludes unconfirmed/cancelled/revoked services', async () => {
  const f = await fixture();
  const own = await f.add('2026-10-06');
  const pending = await f.add('2026-10-06', { status: 'pending' });
  await f.add('2026-10-06', { status: 'cancelled' });
  const revoked = await f.add('2026-10-06');
  const qr = await ensureAssignmentQr(db, revoked.id);
  await db.qrCheckCode.update({ where: { id: qr.id }, data: { revokedAt: at('2026-10-06') } });
  const other = await fixture();
  const otherRow = await other.add('2026-10-06');
  let current = await readMonthlyQr(db, f.token, { now: at('2026-10-06') });
  assert.deepEqual(current.services.map((row) => row.assignmentId), [own.id]);
  await assert.rejects(punch(f, 'check_in', at('2026-10-06'), { state: current, id: otherRow.id }), { code: 'QR_SERVICE_REQUIRED' });
  await assert.rejects(punch(f, 'check_in', at('2026-10-06'), { state: current, id: pending.id }), { code: 'QR_SERVICE_REQUIRED' });
  await assert.rejects(readMonthlyQr(db, `${f.token}x`, { now: at('2026-10-06') }), { code: 'QR_INVALID' });
  await f.add('2026-10-06', { plannedCheckIn: '15:00', plannedCheckOut: '18:00' });
  await assert.rejects(punch(f, 'check_in', at('2026-10-06'), { state: current }), { code: 'QR_CHANGED' });
  current = await readMonthlyQr(db, f.token, { now: at('2026-10-06') });
  await Promise.allSettled([punch(f, 'check_in', at('2026-10-06'), { state: current }), punch(f, 'check_in', at('2026-10-06'), { state: current })]);
  assert.equal(await db.qrCheckLog.count({ where: { collaboratorId: f.collaborator.id } }), 1);
  assert.equal((await db.eventAssignment.findUnique({ where: { id: otherRow.id } })).checkIn, null);
  await db.event.update({ where: { id: f.event.id }, data: { cancelledDays: JSON.stringify(['2026-10-06']) } });
  await assert.rejects(readMonthlyQr(db, f.token, { now: at('2026-10-06') }), { code: 'QR_MONTH_EMPTY' });
  await db.event.update({ where: { id: f.event.id }, data: { status: 'cancelled' } });
  await assert.rejects(readMonthlyQr(db, f.token, { now: at('2026-10-06') }), { code: 'QR_MONTH_EMPTY' });
});

test('HTTP monthly routes and communication generate the same link, expire without redirects and never leak private fields', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: at('2026-10-06') });
  process.env.DATABASE_URL = datasourceUrl;
  const { qrPublicRouter, qrCodesRouter } = await import('../routes/qrCheckins.js');
  const { prisma } = await import('../prisma.js');
  const f = await fixture();
  await f.add('2026-10-06');
  const otherEvent = await db.event.create({ data: { name: 'Another confirmed event', date: new Date('2026-10-07') } });
  await db.eventAssignment.create({ data: { collaboratorId: f.collaborator.id, eventId: otherEvent.id,
    status: 'confirmed', plannedCheckIn: '09:00', plannedCheckOut: '17:00' } });
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
    const listing = await (await fetch(`${base}/api/qr-codes/monthly?pageSize=100`)).json();
    assert.ok(listing.items, JSON.stringify(listing));
    const item = listing.items.find((row) => row.collaboratorId === f.collaborator.id);
    assert.equal(item.services.length, 2);
    assert.ok(item.qrUrl.endsWith(`/qr/month/${f.token}`));
    const filtered = await (await fetch(`${base}/api/qr-codes/monthly?pageSize=100&eventId=${f.event.id}`)).json();
    const filteredItem = filtered.items.find((row) => row.collaboratorId === f.collaborator.id);
    assert.equal(filteredItem.services.length, 1);
    assert.equal(filteredItem.qrUrl, item.qrUrl);
    assert.equal(listing.items.filter((row) => row.collaboratorId === f.collaborator.id).length, 1);
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const current = await response.json();
    assert.equal(current.scope, 'month');
    assert.equal(JSON.stringify(current).includes('123456789'), false);
    assert.equal(await db.qrCheckCode.count({ where: { collaboratorId: f.collaborator.id } }), 0);
    const body = JSON.stringify({ assignmentId: current.active.activeAssignmentId, revision: current.active.revision });
    assert.equal((await fetch(`${url}/check-in`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 200);
    assert.equal((await fetch(`${url}/check-out`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 409);
    const revokedAt = at('2026-10-06', '10:00:00');
    const qr = await db.qrCheckCode.findUnique({ where: { assignmentId: current.active.activeAssignmentId } });
    await db.qrCheckCode.update({ where: { id: qr.id }, data: { revokedAt } });
    assert.equal((await fetch(`${base}/api/qr-codes/assignments/${qr.assignmentId}`)).status, 410);
    assert.equal((await db.qrCheckCode.findUnique({ where: { id: qr.id } })).revokedAt.getTime(), revokedAt.getTime());
    t.mock.timers.setTime(at('2026-11-01', '00:00:00').getTime());
    assert.equal((await fetch(url)).status, 200);
    for (const suffix of ['/check-in', '/check-out']) {
      const readOnly = await fetch(`${url}${suffix}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      assert.equal(readOnly.status, 410);
      assert.equal((await readOnly.json()).code, 'QR_READ_ONLY');
    }
    await f.add('2026-11-16');
    t.mock.timers.setTime(at('2026-11-15', '00:00:00').getTime());
    for (const suffix of ['', '/check-in', '/check-out']) {
      const expired = await fetch(`${url}${suffix}`, suffix ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body } : {});
      assert.equal(expired.status, 410);
      assert.equal(expired.headers.get('location'), null);
      assert.equal(JSON.stringify(await expired.json()).includes('month1.'), false);
    }
    const updated = await (await fetch(`${base}/api/qr-codes/monthly?pageSize=100`)).json();
    assert.notEqual(updated.items.find((row) => row.collaboratorId === f.collaborator.id).qrUrl, item.qrUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
});
