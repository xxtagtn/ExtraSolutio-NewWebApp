import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createECDH, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import webPush from 'web-push';
import express from 'express';
import { once } from 'node:events';
import { runAttendancePush, attendancePushPayload } from './attendancePush.js';
import { savePushSubscription, validatePushSubscription, pushConfig } from './pushSubscriptions.js';
import { createPushRouter } from '../routes/push.js';
import { ensureAssignmentQr } from './qrCodeGeneration.js';
import { registerPublicQr } from './qrAttendance.js';
import { setupWebPush } from '../../scripts/setup-web-push.js';
import { canReceiveAttendancePush, pushReturnPath } from '../../src/utils/pushPermissions.js';

const dir = mkdtempSync(join(tmpdir(), 'es-push-test-'));
const file = join(dir, 'test.db');
const datasourceUrl = `file:${file.replaceAll('\\', '/')}`;
const db = new PrismaClient({ datasourceUrl });
const date = '2026-09-25';
const at = (hour) => new Date(`${date}T${hour}+01:00`);
const now = at('18:00:00');
const vapid = webPush.generateVAPIDKeys();
const config = pushConfig({ WEB_PUSH_SUBJECT: 'https://example.test', WEB_PUSH_PUBLIC_KEY: vapid.publicKey, WEB_PUSH_PRIVATE_KEY: vapid.privateKey });
let sequence = 0;
process.env.APP_TIMEZONE = 'Europe/Lisbon';

before(() => {
  const schema = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/sqlite/schema.prisma', '--script'], { env: { ...process.env, DATABASE_URL: datasourceUrl }, encoding: 'utf8', windowsHide: true });
  assert.equal(schema.status, 0, schema.stderr);
  const sqlite = new DatabaseSync(file); sqlite.exec(schema.stdout); sqlite.close();
});
beforeEach(async () => { await db.pushSubscription.deleteMany(); await db.qrCheckLog.deleteMany(); });
after(async () => { await db.$disconnect(); for (const name of ['test.db', 'setup.env']) rmSync(join(dir, name), { force: true }); rmdirSync(dir); });

function subscription() {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  return { endpoint: `https://fcm.googleapis.com/fcm/send/test-${++sequence}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
}
async function user(role = 'admin') { return db.user.create({ data: { email: `push-${++sequence}@example.test`, name: 'Push tester', password: 'test-only', role } }); }
async function subscribe(owner, prefs = {}) {
  return savePushSubscription(db, (owner || await user()).id, { subscription: subscription(), notifyEntry: true, notifyExit: true, ...prefs });
}
async function fixture({ continuous = false, start = '09:00', end = '12:00' } = {}) {
  const collaborator = await db.collaborator.create({ data: { name: 'Ana Teste', email: `person-${++sequence}@example.test` } });
  const event = await db.event.create({ data: { name: 'Servico Teste', date: new Date(continuous ? '2026-09-01' : date), endDate: continuous ? new Date('2026-09-30') : null, isContinuous: continuous } });
  const row = await db.eventAssignment.create({ data: { collaboratorId: collaborator.id, eventId: event.id, assignmentDate: continuous ? new Date(date) : null, status: 'confirmed', plannedCheckIn: start, plannedCheckOut: end, hourlyRate: 10 } });
  const qr = await ensureAssignmentQr(db, row.id);
  return { row, qr, event, collaborator };
}
const punch = (f, action, time) => registerPublicQr(db, f.qr.token, action, { now: at(time) });
async function run(options = {}) {
  const sent = [];
  const result = await runAttendancePush(db, { now, config, send: async (_s, payload) => { sent.push(payload); }, ...options });
  return { sent, result };
}

test('committed entry and exit each notify once; failed double taps/cooldown create no alert; finance unchanged', async () => {
  await subscribe(); const f = await fixture();
  await punch(f, 'check_in', '09:00:00');
  await assert.rejects(punch(f, 'check_in', '09:00:01'));
  await assert.rejects(punch(f, 'check_out', '09:10:00'));
  assert.equal((await run()).sent.length, 1);
  assert.equal((await run()).sent.length, 0);
  await punch(f, 'check_out', '12:00:00');
  const beforeRow = await db.eventAssignment.findUnique({ where: { id: f.row.id } });
  const { sent } = await run();
  assert.equal(sent.length, 1); assert.equal(sent[0].title, 'Saída registada');
  assert.match(sent[0].body, /Ana Teste\nServico Teste \(09:00 - 12:00\)/);
  assert.equal(sent[0].url, `/services/${f.event.id}?tab=team&day=${date}&push=1`);
  assert.equal((await run()).sent.length, 0);
  assert.deepEqual(await db.eventAssignment.findUnique({ where: { id: f.row.id } }), beforeRow);
  assert.equal(Number(beforeRow.totalPay), 30);
  assert.equal(beforeRow.validationStatus, 'pending');
});

test('no historical blast on activation; preference boundary does not replay old punches', async () => {
  const f = await fixture(); await punch(f, 'check_in', '09:00:00');
  const sub = await subscribe(); assert.equal((await run()).sent.length, 0);
  await punch(f, 'check_out', '12:00:00');
  const data = { subscription: { endpoint: sub.endpoint, keys: sub }, notifyEntry: false, notifyExit: true };
  await savePushSubscription(db, sub.userId, data);
  assert.equal((await run()).sent.length, 0);
  assert.equal(await db.pushSubscription.count(), 1);
});

test('entry/exit preferences work independently and only authorized users receive', async () => {
  await subscribe(undefined, { notifyExit: false });
  await subscribe(await user('operations'), { notifyEntry: false });
  await subscribe(await user('viewer'));
  await subscribe(undefined, { notifyEntry: false, notifyExit: false });
  const f = await fixture(); await punch(f, 'check_in', '09:00:00'); await punch(f, 'check_out', '12:00:00');
  assert.deepEqual((await run()).sent.map((p) => p.title).sort(), ['Entrada registada', 'Saída registada'].sort());
});

test('manual correction produces no alert, repunch creates a distinct alert and retains history', async () => {
  await subscribe(); const f = await fixture();
  await punch(f, 'check_in', '09:00:00'); await punch(f, 'check_out', '12:00:00'); await run();
  const oldLogs = await db.qrCheckLog.findMany();
  await db.eventAssignment.update({ where: { id: f.row.id }, data: { checkOut: null } });
  assert.equal((await run()).sent.length, 0);
  await punch(f, 'check_out', '12:05:00');
  assert.equal((await run()).sent.length, 1);
  assert.deepEqual((await db.qrCheckLog.findMany()).slice(0, 2), oldLogs);
});

test('continuous and split services keep the correct day, shift and independent notification tags', async () => {
  await subscribe(); const f = await fixture({ continuous: true });
  const row = await db.eventAssignment.create({ data: { eventId: f.event.id, collaboratorId: f.collaborator.id, assignmentDate: new Date(date), plannedCheckIn: '15:00', plannedCheckOut: '18:00', status: 'confirmed' } });
  const second = { qr: await ensureAssignmentQr(db, row.id) };
  await punch(f, 'check_in', '09:00:00'); await punch(f, 'check_out', '12:00:00');
  await punch(second, 'check_in', '15:00:00'); await punch(second, 'check_out', '18:00:00');
  const { sent } = await run(); assert.equal(sent.length, 4);
  assert.equal(new Set(sent.map((p) => p.tag)).size, 4);
  for (const payload of sent) assert.equal(payload.url, `/services/${f.event.id}?tab=team&day=${date}&push=1`);
  assert.match(sent[2].body, /15:00 - 18:00/);
});

test('transport failure is durable; restarting worker retries with the same tag and no attendance modification', async () => {
  await subscribe(); const f = await fixture(); await punch(f, 'check_in', '09:00:00');
  const row = await db.eventAssignment.findUnique({ where: { id: f.row.id } });
  let first;
  await run({ send: async (_s, p) => { first = p; throw new Error('private endpoint must not leak'); } });
  const pending = await db.pushDelivery.findFirst(); assert.equal(pending.status, 'pending'); assert.equal(pending.lastError, 'TRANSPORT_ERROR');
  assert.equal((await run()).sent.length, 0);
  const retried = await run({ now: new Date(now.getTime() + 61000) });
  assert.deepEqual(retried.sent, [first]);
  assert.deepEqual(await db.eventAssignment.findUnique({ where: { id: f.row.id } }), row);
});

test('provider 410 removes expired subscription; forbidden or repeated errors stop retrying', async () => {
  await subscribe(); const f = await fixture(); await punch(f, 'check_in', '09:00:00');
  await run({ send: async () => { throw Object.assign(new Error(), { statusCode: 410 }); } });
  assert.equal(await db.pushSubscription.count(), 0);
  const sub = await subscribe(); await db.pushSubscription.update({ where: { id: sub.id }, data: { sinceLogId: 0 } });
  await run({ send: async () => { throw Object.assign(new Error(), { statusCode: 403 }); } });
  assert.equal((await db.pushDelivery.findFirst()).status, 'failed');
  assert.equal((await run()).sent.length, 0);
});

test('concurrent workers use a lease instead of sending a pending notification twice', async () => {
  await subscribe(); const f = await fixture(); await punch(f, 'check_in', '09:00:00');
  let entered, release;
  const started = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const first = run({ send: async () => { entered(); await gate; } });
  await started;
  const second = await run(); assert.equal(second.sent.length, 0);
  release(); await first;
  assert.equal((await run()).sent.length, 0);
});

test('revoked permissions, expired logs and opt-out skip pending retries', async () => {
  const owner = await user(); await subscribe(owner);
  const f = await fixture(); await punch(f, 'check_in', '09:00:00');
  await run({ send: async () => { throw new Error(); } });
  await db.user.update({ where: { id: owner.id }, data: { role: 'viewer' } });
  assert.equal((await run({ now: new Date(now.getTime() + 61000) })).sent.length, 0);
  assert.equal((await db.pushDelivery.findFirst()).status, 'skipped');
  await db.user.update({ where: { id: owner.id }, data: { role: 'admin' } });
  await punch(f, 'check_out', '12:00:00');
  assert.equal((await run({ now: new Date(now.getTime() + 2 * 86400000) })).sent.length, 0);
});

test('unconfigured push performs no database or network calls', async () => {
  assert.deepEqual(await runAttendancePush({}, { config: null }), { sent: 0, failed: 0 });
  assert.equal(pushConfig({}), null);
});

test('a rolled-back punch never reaches the notification queue', async () => {
  await subscribe(); const f = await fixture();
  const failingDb = { $transaction: (callback) => db.$transaction(async (tx) => {
    await callback(tx);
    throw new Error('simulated rollback');
  }) };
  await assert.rejects(registerPublicQr(failingDb, f.qr.token, 'check_in', { now: at('09:00:00') }), /simulated rollback/);
  assert.equal((await db.eventAssignment.findUnique({ where: { id: f.row.id } })).checkIn, null);
  assert.equal(await db.qrCheckLog.count(), 0);
  assert.equal((await run()).sent.length, 0);
});

test('pending retry respects opt-out and subscriptions deleted on logout', async () => {
  const sub = await subscribe(); const f = await fixture(); await punch(f, 'check_in', '09:00:00');
  await run({ send: async () => { throw new Error(); } });
  await savePushSubscription(db, sub.userId, { subscription: { endpoint: sub.endpoint, keys: sub }, notifyEntry: false, notifyExit: false });
  assert.equal((await run({ now: new Date(now.getTime() + 61000) })).sent.length, 0);
  assert.equal((await db.pushDelivery.findFirst()).status, 'skipped');
  await db.pushSubscription.delete({ where: { id: sub.id } });
  assert.equal(await db.pushDelivery.count(), 0);
  assert.equal(await db.qrCheckLog.count(), 1);
});

test('expired worker lease is recovered and transport retries stop at five attempts', async () => {
  const sub = await subscribe(); const f = await fixture(); await punch(f, 'check_in', '09:00:00');
  const log = await db.qrCheckLog.findFirst();
  await db.pushDelivery.create({ data: { subscriptionId: sub.id, logId: log.id, nextAttemptAt: now, lockedUntil: new Date(now.getTime() + 60000), leaseId: 'abandoned' } });
  assert.equal((await run()).sent.length, 0);
  assert.equal((await run({ now: new Date(now.getTime() + 61000) })).sent.length, 1);
  await punch(f, 'check_out', '12:00:00');
  let attempts = 0;
  for (let i = 0; i < 6; i++) await run({ now: new Date(now.getTime() + i * 3600000), send: async () => { attempts++; throw new Error(); } });
  assert.equal(attempts, 5);
  assert.equal((await db.pushDelivery.findFirst({ where: { status: 'failed' } })).attempts, 5);
});

test('subscription validation rejects SSRF, bad keys, account transfer and malformed preferences', async () => {
  const valid = subscription(); assert.ok(validatePushSubscription(valid));
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com.evil.test/x', 'https://evil.test/x', 'https://fcm.googleapis.com:8443/x', 'https://x:y@fcm.googleapis.com/x']) assert.throws(() => validatePushSubscription({ ...valid, endpoint }));
  assert.throws(() => validatePushSubscription({ ...valid, keys: { ...valid.keys, auth: 'bad' } }));
  const owner = await user(); await savePushSubscription(db, owner.id, { subscription: valid, notifyEntry: true, notifyExit: true });
  await assert.rejects(savePushSubscription(db, (await user()).id, { subscription: valid, notifyEntry: true, notifyExit: true }), { statusCode: 409 });
  await assert.rejects(savePushSubscription(db, owner.id, { subscription: valid, notifyEntry: 'true', notifyExit: false }), { statusCode: 400 });
  assert.equal((await db.pushSubscription.findFirst()).userId, owner.id);
});

test('payload is minimal and return paths cannot redirect off-site', async () => {
  const f = await fixture(); await punch(f, 'check_in', '09:00:00');
  const log = await db.qrCheckLog.findFirst({ include: { assignment: true, collaborator: true, event: true } });
  const payload = attendancePushPayload(log, 1);
  assert.deepEqual(Object.keys(payload).sort(), ['body', 'receiverId', 'tag', 'title', 'url']);
  assert.equal(pushReturnPath(payload.url), payload.url);
  for (const value of ['https://evil.test', '//evil.test', '/services/1?tab=team&day=2026-09-25&push=1&next=https://evil.test', '/admin']) assert.equal(pushReturnPath(value), null);
  assert.equal(canReceiveAttendancePush({ role: 'admin' }), true);
  assert.equal(canReceiveAttendancePush({ permissions: ['services.view'] }), false);
});

test('authenticated routes enforce ownership, permission and test rate limit', async () => {
  const owner = await user(); const outsider = await user(); let current = owner; const sent = [];
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = current; next(); });
  app.use(createPushRouter(db, { getConfig: () => config, send: async (_s, p) => { sent.push(p); } }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.expose ? error.message : 'Error' }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const call = (path, method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    current = null; assert.equal((await call('/config')).status, 401);
    current = { ...owner, role: 'viewer' }; assert.equal((await call('/config')).status, 403);
    current = owner; const result = await (await call('/config')).json(); assert.deepEqual(result, { configured: true, publicKey: vapid.publicKey });
    const sub = subscription(); const body = { endpoint: sub.endpoint };
    assert.equal((await call('/device', 'PUT', { subscription: sub, notifyEntry: true, notifyExit: false })).status, 200);
    assert.equal((await call('/test', 'POST', body)).status, 200); assert.equal(sent.length, 1);
    assert.equal((await call('/test', 'POST', body)).status, 429);
    current = outsider;
    assert.equal(await (await call('/device', 'POST', body)).json(), null);
    assert.equal((await call('/test', 'POST', body)).status, 404);
    await call('/device', 'DELETE', body); assert.equal(await db.pushSubscription.count(), 1);
    current = owner; await call('/device', 'DELETE', body); assert.equal(await db.pushSubscription.count(), 0);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('setup creates private keys once, preserves other env values and never prints private key', () => {
  const env = join(dir, 'setup.env');
  writeFileSync(env, 'UNRELATED="preserve-me"\nWEB_PUSH_PUBLIC_KEY=""\n', { mode: 0o600 });
  const first = setupWebPush(env, 'https://example.test'); const content = readFileSync(env, 'utf8');
  assert.match(content, /WEB_PUSH_PRIVATE_KEY=/); assert.doesNotMatch(first, /WEB_PUSH_PRIVATE_KEY=/);
  assert.match(content, /UNRELATED="preserve-me"/);
  setupWebPush(env, 'https://example.test'); assert.equal(readFileSync(env, 'utf8'), content);
  assert.throws(() => setupWebPush(env, 'https://bad\nINJECT=value'));
  const wrongPair = { WEB_PUSH_SUBJECT: 'https://example.test', WEB_PUSH_PUBLIC_KEY: vapid.publicKey, WEB_PUSH_PRIVATE_KEY: webPush.generateVAPIDKeys().privateKey };
  assert.equal(pushConfig(wrongPair), null);
});

test('SQLite migration adds only technical tables and retains existing data', () => {
  const sql = readFileSync('prisma/sqlite/migrations/20260925000000_attendance_push_notifications/migration.sql', 'utf8');
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE User(id INTEGER PRIMARY KEY); CREATE TABLE QrCheckLog(id INTEGER PRIMARY KEY); INSERT INTO User VALUES(5); INSERT INTO QrCheckLog VALUES(10);');
  sqlite.exec(sql);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM QrCheckLog').get().n, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM User').get().n, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM PushSubscription').get().n, 0);
  sqlite.close();
});
