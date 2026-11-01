import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { PrismaClient } from '@prisma/client';
import { once } from 'node:events';
import express from 'express';
import { ensureCollaboratorAttendanceLink as ensure, readCollaboratorAttendanceLink as read,
  registerCollaboratorAttendanceLink as register, listCollaboratorAttendanceLinks as list } from './collaboratorAttendanceLink.js';
import { createMonthlyPunchToken } from '../utils/qrMonthlyToken.js';
import { createDailyQrToken } from '../utils/qrDailyToken.js';
import { readMonthlyPunchQr } from './qrMonthlyPunching.js';
import { readDailyQr } from './qrDailyAttendance.js';
import { readPublicQr } from './qrAttendance.js';
import { ensureAssignmentQr } from './qrCodeGeneration.js';
import { eventStartInstant } from '../utils/eventTime.js';
import { issueSessionToken } from '../security/sessionTokens.js';
import { requirePermission } from '../security/permissions.js';
import { PERMISSIONS } from '../../src/utils/accessPermissions.js';

const directory = mkdtempSync(join(tmpdir(), 'es-fixed-link-'));
const datasourceUrl = `file:${join(directory, 'test.db').replaceAll('\\', '/')}`;
process.env.JWT_SECRET = 'isolated-permanent-qr-tests-only';
process.env.APP_TIMEZONE = 'Europe/Lisbon';
const db = new PrismaClient({ datasourceUrl });
const at = (day, time = '09:00') => eventStartInstant(day, time, 'Europe/Lisbon');
let sequence = 0, applicationDb;
before(() => {
  const result = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff',
    '--from-empty', '--to-schema-datamodel', 'prisma/sqlite/schema.prisma', '--script'], {
    env: { ...process.env, DATABASE_URL: datasourceUrl }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  const sqlite = new DatabaseSync(join(directory, 'test.db')); sqlite.exec(result.stdout); sqlite.close();
});
after(async () => {
  await db.$disconnect(); await applicationDb?.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});
async function fixture() {
  const collaborator = await db.collaborator.create({ data: { name: `Fixed QR ${++sequence}`, email: `fixed${sequence}@example.test` } });
  const event = await db.event.create({ data: { name: 'Fixed link service', date: new Date('2026-10-01'),
    startTime: '09:00', endTime: '12:00', totalRevenue: 252 } });
  const link = await ensure(db, collaborator.id);
  const add = (day, data = {}) => db.eventAssignment.create({ data: {
    eventId: event.id, collaboratorId: collaborator.id, assignmentDate: new Date(day),
    plannedCheckIn: '09:00', plannedCheckOut: '12:00', status: 'confirmed', hourlyRate: 8, ...data,
  } });
  return { collaborator, event, link, add };
}
async function punch(f, action, now, state) {
  const current = state || await read(db, f.link.token, { now });
  return register(db, f.link.token, action, { assignmentId: current.active?.activeAssignmentId,
    revision: current.active?.revision }, { now });
}

test('one unpredictable stable address exists before allocation and survives months and years without expiry', async () => {
  const f = await fixture();
  assert.match(f.link.token, /^[\w-]{43}$/);
  assert.equal((await ensure(db, f.collaborator.id)).token, f.link.token);
  const before = await db.event.findUnique({ where: { id: f.event.id }, include: { assignments: true } });
  for (const now of [at('2026-10-27'), at('2026-11-01'), at('2027-01-01'), at('2030-02-01')]) {
    const state = await read(db, f.link.token, { now });
    assert.equal(state.permanent, true); assert.equal(state.active, null); assert.deepEqual(state.services, []);
    assert.equal(Object.hasOwn(state, 'expiresAt'), false);
  }
  assert.deepEqual(await db.event.findUnique({ where: { id: f.event.id }, include: { assignments: true } }), before);
  assert.equal(await db.collaboratorAttendanceLink.count({ where: { collaboratorId: f.collaborator.id } }), 1);
});

test('the same link selects the new month automatically and only confirmed eligible services', async () => {
  const f = await fixture();
  const oct = await f.add('2026-10-31'), nov = await f.add('2026-11-01');
  await f.add('2026-11-02', { status: 'missed_justified' });
  await f.add('2026-11-03', { status: 'pending_confirmation' });
  const october = await read(db, f.link.token, { now: at('2026-10-31') });
  const november = await read(db, f.link.token, { now: at('2026-11-01') });
  assert.deepEqual(october.services.map((s) => s.assignmentId), [oct.id]);
  assert.deepEqual(november.services.map((s) => s.assignmentId), [nov.id]);
});

test('inactive and paused collaborators return identical 404 on read and stale-page POST; reactivation restores link', async () => {
  const f = await fixture(); await f.add('2026-10-15');
  const now = at('2026-10-15'), stale = await read(db, f.link.token, { now });
  for (const status of ['inactive', 'paused']) {
    await db.collaborator.update({ where: { id: f.collaborator.id }, data: { status } });
    await assert.rejects(read(db, f.link.token, { now }), { statusCode: 404, code: 'QR_NOT_FOUND' });
    await assert.rejects(punch(f, 'check_in', now, stale), { statusCode: 404, code: 'QR_NOT_FOUND' });
    await assert.rejects(ensure(db, f.collaborator.id), { statusCode: 404 });
  }
  assert.equal(await db.qrCheckLog.count({ where: { collaboratorId: f.collaborator.id } }), 0);
  await db.collaborator.update({ where: { id: f.collaborator.id }, data: { status: 'active' } });
  assert.equal((await read(db, f.link.token, { now })).active.activeAssignmentId, stale.active.activeAssignmentId);
});

test('deletion cascades only link; deleted and unknown tokens have indistinguishable 404', async () => {
  const f = await fixture();
  await db.collaborator.delete({ where: { id: f.collaborator.id } });
  assert.equal(await db.collaboratorAttendanceLink.count({ where: { collaboratorId: f.collaborator.id } }), 0);
  for (const token of [f.link.token, 'x'.repeat(43), 'invalid']) {
    await assert.rejects(read(db, token), { statusCode: 404, code: 'QR_NOT_FOUND', message: 'Este endereço não está disponível.' });
    await assert.rejects(register(db, token, 'check_in', {}), { statusCode: 404 });
  }
});

test('replacement invalidates the old address including stale POST without changing attendance or finance', async () => {
  const f = await fixture(); await f.add('2026-10-15');
  const now = at('2026-10-15'), stale = await read(db, f.link.token, { now });
  const before = await db.event.findUnique({ where: { id: f.event.id }, include: { assignments: true } });
  const replacement = await ensure(db, f.collaborator.id, { replace: true });
  assert.notEqual(replacement.token, f.link.token);
  await assert.rejects(read(db, f.link.token, { now }), { statusCode: 404 });
  await assert.rejects(punch(f, 'check_in', now, stale), { statusCode: 404 });
  assert.ok((await read(db, replacement.token, { now })).active);
  assert.deepEqual(await db.event.findUnique({ where: { id: f.event.id }, include: { assignments: true } }), before);
});

test('parallel first requests share one token without creating duplicates', async () => {
  const collaborator = await db.collaborator.create({ data: { name: 'Parallel QR', email: 'parallel-fixed@example.test' } });
  const results = await Promise.all(Array.from({ length: 5 }, () => ensure(db, collaborator.id)));
  assert.equal(new Set(results.map((link) => link.token)).size, 1);
  assert.equal(await db.collaboratorAttendanceLink.count({ where: { collaboratorId: collaborator.id } }), 1);
});

test('access is checked again inside the transaction, not only when the page was loaded', async () => {
  for (const change of ['inactive', 'replace']) {
    const f = await fixture(); const row = await f.add('2026-10-15');
    const now = at('2026-10-15'), stale = await read(db, f.link.token, { now });
    const racingDb = new Proxy(db, { get(target, property) {
      if (property !== '$transaction') return Reflect.get(target, property);
      return async (callback, options) => {
        if (change === 'inactive') await db.collaborator.update({ where: { id: f.collaborator.id }, data: { status: 'inactive' } });
        else await ensure(db, f.collaborator.id, { replace: true });
        return target.$transaction(callback, options);
      };
    } });
    await assert.rejects(register(racingDb, f.link.token, 'check_in', {
      assignmentId: row.id, revision: stale.active.revision,
    }, { now }), { statusCode: 404, code: 'QR_NOT_FOUND' });
    assert.equal((await db.eventAssignment.findUnique({ where: { id: row.id } })).checkIn, null);
    assert.equal(await db.qrCheckLog.count({ where: { assignmentId: row.id } }), 0);
  }
});

test('real punch pipeline keeps cooldown, duplicates, checkout receipt, completed-service removal and audit', async () => {
  const f = await fixture(); const row = await f.add('2026-10-15');
  const start = at('2026-10-15'), initial = await read(db, f.link.token, { now: start });
  await assert.rejects(punch(f, 'check_out', start, initial), { code: 'QR_CHANGED' });
  const entered = await punch(f, 'check_in', start, initial);
  await assert.rejects(punch(f, 'check_in', start, initial), { code: 'QR_CHANGED' });
  await assert.rejects(punch(f, 'check_out', at('2026-10-15', '09:29'), entered), { code: 'QR_CHECKOUT_TOO_EARLY' });
  const exited = await punch(f, 'check_out', at('2026-10-15', '12:00'), entered);
  assert.equal(exited.checkoutReceipt.assignmentId, row.id); assert.deepEqual(exited.services, []);
  assert.equal(exited.permanent, true);
  assert.equal(await db.qrCheckLog.count({ where: { assignmentId: row.id } }), 2);
  const saved = await db.eventAssignment.findUnique({ where: { id: row.id } });
  assert.equal(saved.totalPay.toString(), '24');
});

test('a fixed address never permits an early or forged-service punch', async () => {
  const f = await fixture(); const row = await f.add('2026-11-01');
  const now = at('2026-10-27');
  await assert.rejects(register(db, f.link.token, 'check_in', { assignmentId: row.id, revision: 'forged' }, { now }), { code: 'QR_MONTH_EMPTY' });
  assert.equal((await db.eventAssignment.findUnique({ where: { id: row.id } })).checkIn, null);
});

test('overnight shift crosses month/year boundary using the same fixed link', async () => {
  const f = await fixture(); const row = await f.add('2026-12-31', { plannedCheckIn: '23:00', plannedCheckOut: '02:00' });
  const entered = await punch(f, 'check_in', at('2026-12-31', '23:00'));
  assert.ok(entered.active);
  const state = await read(db, f.link.token, { now: at('2027-01-01', '01:00') });
  assert.equal(state.active.activeAssignmentId, row.id);
  const exited = await punch(f, 'check_out', at('2027-01-01', '01:00'), state);
  assert.equal(exited.checkoutReceipt.assignmentId, row.id); assert.equal(exited.active, null);
});

test('legacy monthly, daily and single-service URLs cannot bypass inactive status', async () => {
  const f = await fixture(); const row = await f.add('2026-10-15');
  const qr = await ensureAssignmentQr(db, row.id), now = at('2026-10-15');
  await db.collaborator.update({ where: { id: f.collaborator.id }, data: { status: 'inactive' } });
  for (const promise of [readMonthlyPunchQr(db, createMonthlyPunchToken(f.collaborator.id, now), { now }),
    readDailyQr(db, createDailyQrToken(f.collaborator.id, '2026-10-15'), { now }), readPublicQr(db, qr.token, { now })]) {
    await assert.rejects(promise, { statusCode: 404, code: 'QR_NOT_FOUND' });
  }
});

test('management shows active people only after confirmation and never exposes link tokens', async () => {
  const f = await fixture();
  const now = at('2026-11-15');
  assert.equal((await list(db, { search: f.collaborator.name }, { now })).total, 0);
  await f.add('2026-11-15');
  const result = await list(db, { search: f.collaborator.name, pageSize: 1 }, { now });
  assert.equal(result.total, 1); assert.equal(result.items[0].id, f.collaborator.id);
  assert.equal(JSON.stringify(result).includes(f.link.token), false);
  await db.collaborator.update({ where: { id: f.collaborator.id }, data: { status: 'inactive' } });
  assert.equal((await list(db, { search: f.collaborator.name }, { now })).total, 0);
});

test('confirmed counts use current-month service days, include completed shifts and exclude absences, cancellations and revoked access', async () => {
  const f = await fixture();
  await f.add('2026-11-01');
  await f.add('2026-11-02', { checkIn: '09:00', checkOut: '12:00' });
  for (const status of ['pending_confirmation', 'missed_justified', 'missed_unjustified', 'cancelled']) {
    await f.add('2026-11-04', { status });
  }
  await f.add('2026-10-31'); await f.add('2026-12-01');
  await f.add('2026-11-03');
  await db.event.update({ where: { id: f.event.id }, data: { cancelledDays: JSON.stringify(['2026-11-03']) } });
  const revoked = await f.add('2026-11-05');
  const qr = await ensureAssignmentQr(db, revoked.id);
  await db.qrCheckCode.update({ where: { id: qr.id }, data: { revokedAt: new Date() } });
  const cancelled = await db.event.create({ data: { name: 'Cancelled', date: new Date('2026-11-06'), status: 'cancelled' } });
  await f.add('2026-11-06', { eventId: cancelled.id });
  const undated = await db.event.create({ data: { name: 'Single day fallback', date: new Date('2026-11-07') } });
  await f.add('2026-11-07', { eventId: undated.id, assignmentDate: null });
  const before = await db.eventAssignment.findMany({ where: { collaboratorId: f.collaborator.id } });
  const result = await list(db, { search: f.collaborator.name }, { now: at('2026-11-15') });
  assert.equal(result.monthFrom, '2026-11-01');
  assert.equal(result.items[0].confirmedServices, 3);
  assert.deepEqual(await db.eventAssignment.findMany({ where: { collaboratorId: f.collaborator.id } }), before);
  const december = await list(db, { search: f.collaborator.name }, { now: at('2026-12-01') });
  assert.equal(december.items[0].confirmedServices, 1);
});

test('confirmed count follows Lisbon month rollover and hides people without assignments', async () => {
  const f = await fixture();
  const empty = await list(db, { search: f.collaborator.name }, { now: at('2026-03-31') });
  assert.equal(empty.items.length, 0); assert.equal(empty.total, 0);
  await f.add('2026-03-31'); await f.add('2026-04-01');
  const result = await list(db, { search: f.collaborator.name }, { now: new Date('2026-03-31T23:30:00Z') });
  assert.equal(result.monthFrom, '2026-04-01');
  assert.equal(result.items[0].confirmedServices, 1);
  assert.equal((await list(db, { search: 'Name that does not exist' })).items.length, 0);
});

test('confirmed-only filter runs before search totals and pagination, excluding every ineligible-only roster', async () => {
  const fixtures = [];
  for (let i = 0; i < 12; i++) {
    const f = await fixture(); fixtures.push(f);
    await db.collaborator.update({ where: { id: f.collaborator.id }, data: {
      name: `Rosterfilter ${String(i).padStart(2, '0')}`, shortName: i === 5 ? 'Unique confirmed match' : null,
    } });
    if (i === 0) continue;
    if (i === 1 || i === 2 || i === 11) {
      await f.add('2026-11-15', { status: i === 1 ? 'pending_confirmation' : i === 2 ? 'missed_justified' : 'missed_unjustified' });
    } else if (i === 8) { await f.add('2026-10-31'); await f.add('2026-12-01'); }
    else {
      const row = await f.add('2026-11-15');
      if (i === 3) await db.event.update({ where: { id: f.event.id }, data: { cancelledDays: JSON.stringify(['2026-11-15']) } });
      if (i === 4) await db.collaborator.update({ where: { id: f.collaborator.id }, data: { status: 'inactive' } });
      if (i === 5) await f.add('2026-11-16');
      if (i === 9) {
        const qr = await ensureAssignmentQr(db, row.id);
        await db.qrCheckCode.update({ where: { id: qr.id }, data: { revokedAt: new Date() } });
      }
      if (i === 10) await db.event.update({ where: { id: f.event.id }, data: { status: 'cancelled' } });
    }
  }
  const now = at('2026-11-15'), query = { search: 'Rosterfilter', pageSize: 2 };
  const first = await list(db, query, { now }), second = await list(db, { ...query, page: 2 }, { now });
  assert.equal(first.total, 3); assert.equal(first.totalPages, 2);
  assert.deepEqual(first.items.map((item) => item.id), [fixtures[5].collaborator.id, fixtures[6].collaborator.id]);
  assert.deepEqual(first.items.map((item) => item.confirmedServices), [2, 1]);
  assert.deepEqual(second.items.map((item) => item.id), [fixtures[7].collaborator.id]);
  const clamped = await list(db, { ...query, page: 99 }, { now });
  assert.equal(clamped.page, 2); assert.deepEqual(clamped.items, second.items);
  const shortName = await list(db, { search: 'Unique confirmed match' }, { now });
  assert.equal(shortName.total, 1); assert.equal(shortName.items[0].id, fixtures[5].collaborator.id);
  const blank = await list(db, { search: 'Rosterfilter 00' }, { now });
  assert.equal(blank.total, 0); assert.deepEqual(blank.items, []);
  assert.equal((await read(db, fixtures[0].link.token, { now })).permanent, true, 'Being absent from the list never revokes an active person\'s permanent link');
  const final = await db.eventAssignment.findFirst({ where: { collaboratorId: fixtures[7].collaborator.id } });
  await db.eventAssignment.update({ where: { id: final.id }, data: { status: 'pending_confirmation' } });
  assert.equal((await list(db, query, { now })).total, 2, 'Removing the last confirmation removes that person on refresh');
});

test('migration is additive and deletion cascades only the access token', () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON; CREATE TABLE Collaborator (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO Collaborator VALUES (1, \'Preserved\');');
  sqlite.exec(readFileSync('prisma/sqlite/migrations/20261031010000_collaborator_attendance_link/migration.sql', 'utf8'));
  assert.equal(sqlite.prepare('SELECT name FROM Collaborator').get().name, 'Preserved');
  sqlite.exec("INSERT INTO CollaboratorAttendanceLink (collaboratorId, token, updatedAt) VALUES (1, 'test', CURRENT_TIMESTAMP); DELETE FROM Collaborator WHERE id=1;");
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM CollaboratorAttendanceLink').get().n, 0);
  sqlite.close();
});

test('HTTP read and POST return neutral 404, no cache, while management generates the same link', async () => {
  process.env.DATABASE_URL = datasourceUrl;
  const { qrPublicRouter, qrCodesRouter } = await import('../routes/qrCheckins.js');
  applicationDb = (await import('../prisma.js')).prisma;
  const { requireAuth } = await import('../middleware/auth.js');
  const f = await fixture();
  const admin = await db.user.create({ data: { name: 'Link manager', email: 'link-manager@example.test', password: 'test-only', role: 'admin' } });
  const profile = await db.accessProfile.create({ data: { key: 'no-links', name: 'No links', permissions: '[]' } });
  const denied = await db.user.create({ data: { name: 'Denied', email: 'link-denied@example.test', password: 'test-only', role: 'operations', accessProfileId: profile.id } });
  const auth = (user) => ({ Authorization: `Bearer ${issueSessionToken(user)}`, 'Content-Type': 'application/json' });
  const app = express(); app.use(express.json());
  app.use('/public', qrPublicRouter);
  app.use('/manage', requireAuth, requirePermission(PERMISSIONS.COMMUNICATION_MANAGE_QR_CODES), qrCodesRouter);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message, code: error.code }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/manage/links', `/manage/links/${f.collaborator.id}`]) {
      const method = path === '/manage/links' ? 'GET' : 'POST';
      assert.equal((await fetch(base + path, { method })).status, 401);
      assert.equal((await fetch(base + path, { method, headers: auth(denied) })).status, 403);
    }
    const create = () => fetch(`${base}/manage/links/${f.collaborator.id}`, { method: 'POST', headers: auth(admin), body: '{}' });
    const first = await (await create()).json(); assert.match(first.attendanceQrUrl, /\/qr\/link\/[\w-]{43}$/);
    assert.deepEqual(await (await create()).json(), first);
    const url = `${base}/public/link/${f.link.token}`;
    assert.equal((await fetch(url)).status, 200);
    await db.collaborator.update({ where: { id: f.collaborator.id }, data: { status: 'inactive' } });
    for (const path of ['', '/check-in', '/check-out']) {
      const response = await fetch(url + path, { method: path ? 'POST' : 'GET' });
      assert.equal(response.status, 404); assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.deepEqual(await response.json(), { message: 'Este endereço não está disponível.', code: 'QR_NOT_FOUND' });
    }
  } finally { await new Promise((done) => server.close(done)); }
});
