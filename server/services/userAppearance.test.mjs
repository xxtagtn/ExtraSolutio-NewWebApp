import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { issueSessionToken } from '../security/sessionTokens.js';
import { publicQrAppearance, updateUserAppearance, withPublicQrAppearance } from './userAppearance.js';
import { ensureAssignmentQr } from './qrCodeGeneration.js';
import { createDailyQrToken } from '../utils/qrDailyToken.js';
import { createMonthlyPunchToken } from '../utils/qrMonthlyToken.js';

const directory = mkdtempSync(join(tmpdir(), 'es-appearance-'));
const database = join(directory, 'test.db');
const datasourceUrl = `file:${database.replaceAll('\\', '/')}`;
const db = new PrismaClient({ datasourceUrl });
let server, applicationDb, base;
process.env.JWT_SECRET = 'isolated-appearance-test-only-secret';
process.env.APP_TIMEZONE = 'Europe/Lisbon';
process.env.DATABASE_URL = datasourceUrl;

before(async () => {
  const result = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/sqlite/schema.prisma', '--script'], {
    env: { ...process.env, DATABASE_URL: datasourceUrl }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const sqlite = new DatabaseSync(database); sqlite.exec(result.stdout); sqlite.close();
  const { authRouter } = await import('../routes/auth.js');
  const { qrPublicRouter } = await import('../routes/qrCheckins.js');
  applicationDb = (await import('../prisma.js')).prisma;
  const app = express(); app.use(express.json());
  app.use('/api/auth', authRouter); app.use('/api/qr-check', qrPublicRouter);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  await new Promise((done) => server?.close(done));
  await applicationDb?.$disconnect(); await db.$disconnect();
  rmSync(database, { force: true }); rmdirSync(directory);
});

test('account-owned themes persist and propagate to all existing QR scopes without changing attendance rules', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-29T12:00:00Z') });
  const admin = await db.user.create({ data: { email: 'owner@example.test', name: 'Owner', role: 'admin', password: 'fake-test-password' } });
  const other = await db.user.create({ data: { email: 'other@example.test', name: 'Other', role: 'admin', password: 'fake-test-password' } });
  const viewer = await db.user.create({ data: { email: 'viewer@example.test', name: 'Viewer', role: 'operations', password: 'fake-test-password' } });
  const send = (user, body, method = 'PUT') => fetch(`${base}/auth/appearance`, {
    method, headers: { ...(user ? { Authorization: `Bearer ${issueSessionToken(user)}` } : {}), 'Content-Type': 'application/json' },
    ...(method === 'PUT' ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal((await send(null, null, 'GET')).status, 401);
  assert.equal((await (await send(admin, null, 'GET')).json()).configured, false);
  assert.equal((await send(viewer, { preference: 'easter', publishToQr: true })).status, 403);
  assert.equal((await send(admin, { preference: 'https://evil.test/art.png' })).status, 400);
  assert.equal((await send(admin, { preference: 'easter', publishToQr: 'yes' })).status, 400);
  assert.equal((await send(admin, { preference: 'easter' })).status, 200, 'The first intentional admin theme save configures public attendance automatically');
  assert.equal((await (await send(admin, null, 'GET')).json()).controlsPublicQr, true);
  await send(other, { preference: 'halloween', userId: admin.id });
  assert.equal((await db.userAppearance.findUnique({ where: { userId: admin.id } })).preference, 'easter');
  assert.deepEqual(await publicQrAppearance(db), { theme: 'easter' });
  const collaborator = await db.collaborator.create({ data: { name: 'Appearance QA', email: 'appearance-staff@example.test' } });
  const event = await db.event.create({ data: { name: 'Appearance QR service', date: new Date('2026-10-29'), startTime: '09:00', endTime: '18:00' } });
  const row = await db.eventAssignment.create({ data: { eventId: event.id, collaboratorId: collaborator.id,
    assignmentDate: new Date('2026-10-29'), plannedCheckIn: '09:00', plannedCheckOut: '18:00', status: 'confirmed' } });
  const qr = await ensureAssignmentQr(db, row.id);
  const urls = [qr.token, `day/${createDailyQrToken(collaborator.id, '2026-10-29')}`,
    `month/${createMonthlyPunchToken(collaborator.id, new Date('2026-10-01'))}`].map((token) => `${base}/qr-check/${token}`);
  for (const url of urls) {
    const response = await fetch(`${url}?theme=christmas`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const payload = await response.json(); assert.deepEqual(payload.appearance, { theme: 'easter' });
    assert.equal(JSON.stringify(payload).includes(admin.email), false);
    assert.equal(JSON.stringify(payload.appearance).includes('userId'), false);
  }
  assert.equal(await db.qrCheckLog.count(), 0, 'Reading a theme never punches');
  await send(admin, { preference: 'christmas' });
  for (const url of urls) assert.deepEqual((await (await fetch(url)).json()).appearance, { theme: 'christmas' });
  const punch = await fetch(`${urls[0]}/check-in`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(punch.status, 200); assert.deepEqual((await punch.json()).appearance, { theme: 'christmas' });
  assert.equal(await db.qrCheckLog.count(), 1);
  const duplicate = await fetch(`${urls[0]}/check-in`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(duplicate.status, 409); assert.equal(await db.qrCheckLog.count(), 1);
  await send(admin, { preference: 'original' });
  assert.deepEqual((await (await fetch(urls[0])).json()).appearance, { theme: 'original' });
  await send(admin, { preference: 'automatic' });
  assert.deepEqual(await publicQrAppearance(db, new Date('2026-10-29T12:00:00Z')), { theme: 'halloween' });
  assert.deepEqual(await publicQrAppearance(db, new Date('2026-12-25T12:00:00Z')), { theme: 'christmas' });
  assert.deepEqual(await publicQrAppearance(db, new Date('2027-03-28T12:00:00Z')), { theme: 'easter' });
  assert.deepEqual(await publicQrAppearance(db, new Date('2027-07-01T12:00:00Z')), { theme: 'original' });
  await updateUserAppearance(db, viewer, { preference: 'easter' });
  assert.deepEqual(await publicQrAppearance(db), { theme: 'halloween' });
  await send(other, { preference: 'christmas', publishToQr: true });
  assert.equal(await db.userAppearance.count({ where: { publicScope: { not: null } } }), 1);
  await send(admin, { preference: 'easter' });
  assert.deepEqual(await publicQrAppearance(db), { theme: 'christmas' }, 'Only explicit transfer changes the controlling account');
  await db.user.update({ where: { id: other.id }, data: { role: 'operations' } });
  assert.deepEqual(await publicQrAppearance(db), { theme: 'original' }, 'A downgraded account cannot keep controlling public appearance');
  await db.user.delete({ where: { id: other.id } });
  assert.deepEqual(await publicQrAppearance(db), { theme: 'easter' }, 'Without a declared controller, the single remaining configured administrator is unambiguous');
  assert.equal((await fetch(`${base}/qr-check/invalid-token`)).status, 404);
});

test('a previously saved sole admin theme works without a separate activation; ambiguity is never guessed', async () => {
  await db.userAppearance.deleteMany();
  const first = await db.user.create({ data: { email: 'legacy-theme@example.test', name: 'Legacy theme', role: 'admin', password: 'test-only' } });
  const second = await db.user.create({ data: { email: 'another-theme@example.test', name: 'Another theme', role: 'admin', password: 'test-only' } });
  await db.userAppearance.create({ data: { userId: first.id, preference: 'christmas' } });
  assert.deepEqual(await publicQrAppearance(db), { theme: 'christmas' });
  assert.equal((await db.userAppearance.findUnique({ where: { userId: first.id } })).publicScope, null, 'Reading a public link does not mutate configuration');
  await updateUserAppearance(db, second, { preference: 'halloween' });
  assert.deepEqual(await publicQrAppearance(db), { theme: 'christmas' }, 'Saving another administrator preference cannot take over an existing effective controller');
  assert.equal((await db.userAppearance.findUnique({ where: { userId: first.id } })).publicScope, 'attendance');
  await db.userAppearance.updateMany({ data: { publicScope: null } });
  assert.deepEqual(await publicQrAppearance(db), { theme: 'original' }, 'Multiple unlinked admin themes require an explicit choice');
  await updateUserAppearance(db, first, { preference: 'easter' });
  assert.deepEqual(await publicQrAppearance(db), { theme: 'original' });
  await updateUserAppearance(db, first, { preference: 'easter', publishToQr: true });
  assert.deepEqual(await publicQrAppearance(db), { theme: 'easter' });
});

test('a failed appearance lookup cannot discard a successful punch response', async (t) => {
  t.mock.method(console, 'error', () => {});
  const payload = { completed: true, checkOut: '18:00', checkoutReceipt: { eventName: 'QA' } };
  const unavailable = { userAppearance: { findUnique() { throw new Error('unavailable'); } } };
  assert.deepEqual(await withPublicQrAppearance(unavailable, payload), { ...payload, appearance: { theme: 'original' } });
});

test('the SQLite migration preserves users, enforces one public controller and cascades only appearance', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('PRAGMA foreign_keys=ON; CREATE TABLE User (id INTEGER PRIMARY KEY); INSERT INTO User VALUES(1),(2);');
    sqlite.exec(readFileSync('prisma/sqlite/migrations/20261029010000_user_appearance/migration.sql', 'utf8'));
    sqlite.exec("INSERT INTO UserAppearance(userId,preference,publicScope,updatedAt) VALUES(1,'easter','attendance',CURRENT_TIMESTAMP);");
    assert.throws(() => sqlite.exec("INSERT INTO UserAppearance(userId,preference,publicScope,updatedAt) VALUES(2,'christmas','attendance',CURRENT_TIMESTAMP);"), /UNIQUE/);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM User').get().n, 2);
    sqlite.exec('DELETE FROM User WHERE id=1;');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM UserAppearance').get().n, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM User').get().n, 1);
  } finally { sqlite.close(); }
});
