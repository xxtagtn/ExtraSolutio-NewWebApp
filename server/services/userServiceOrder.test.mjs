import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { issueSessionToken } from '../security/sessionTokens.js';

const directory = mkdtempSync(join(tmpdir(), 'es-service-order-'));
const database = join(directory, 'test.db');
process.env.DATABASE_URL = `file:${database.replaceAll('\\', '/')}`;
process.env.JWT_SECRET = 'isolated-service-order-tests-only';
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
let server, applicationDb, base;
before(async () => {
  const schema = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/sqlite/schema.prisma', '--script'],
    { env: process.env, encoding: 'utf8', windowsHide: true });
  assert.equal(schema.status, 0, schema.stderr);
  const sqlite = new DatabaseSync(database); sqlite.exec(schema.stdout); sqlite.close();
  const { authRouter } = await import('../routes/auth.js');
  applicationDb = (await import('../prisma.js')).prisma;
  const app = express(); app.use(express.json()); app.use('/auth', authRouter);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/auth/service-order`;
});
after(async () => {
  await new Promise((done) => server?.close(done));
  await db.$disconnect(); await applicationDb?.$disconnect();
  rmSync(database, { force: true });
  // Only the temporary test directory is removed; never the project database.
  rmdirSync(directory);
});
const send = (user, scope, body) => fetch(`${base}${scope ? `/${scope}` : ''}`, {
  method: body ? 'PUT' : 'GET', headers: { ...(user ? { Authorization: `Bearer ${issueSessionToken(user)}` } : {}), 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test('authenticated personal order persists without touching event, assignment or financial data', async () => {
  const user = await db.user.create({ data: { email: 'order1@example.test', name: 'Order one', password: 'test-only', role: 'operations' } });
  const other = await db.user.create({ data: { email: 'order2@example.test', name: 'Order two', password: 'test-only', role: 'operations' } });
  const a = await db.event.create({ data: { name: 'Order A', date: new Date('2026-10-30'), totalRevenue: 252 } });
  const b = await db.event.create({ data: { name: 'Order B', date: new Date('2026-10-31'), totalRevenue: 500 } });
  const snapshot = await db.event.findMany({ orderBy: { id: 'asc' }, include: { assignments: true } });
  assert.equal((await send(null)).status, 401);
  assert.deepEqual((await (await send(user)).json()).active, { mode: 'date', ids: [], version: 0 });
  const response = await send(user, 'active', { mode: 'manual', ids: [a.id, b.id, 999999], version: 0, userId: other.id });
  assert.equal(response.status, 200);
  const saved = await response.json(); assert.deepEqual(saved.ids, [a.id, b.id]); assert.equal(saved.version, 1);
  assert.deepEqual((await (await send(user)).json()).active, saved);
  assert.equal((await (await send(other)).json()).active.mode, 'date', 'The client cannot choose another owner');
  assert.equal((await (await send(user)).json()).archive.version, 0, 'Active and archive preferences are independent');
  assert.equal((await send(user, 'active', { ...saved, version: 0 })).status, 409, 'Stale tabs cannot overwrite another save');
  const changed = await send(user, 'active', { ...saved, mode: 'date' });
  assert.equal(changed.status, 200);
  assert.deepEqual((await changed.json()).ids, saved.ids, 'Date mode preserves the custom order');
  assert.deepEqual(await db.event.findMany({ orderBy: { id: 'asc' }, include: { assignments: true } }), snapshot);
});
test('invalid payloads and denied permissions cannot write preferences', async () => {
  const user = await db.user.findFirst();
  for (const patch of [{ mode: 'bad' }, { ids: [1, 1] }, { ids: ['1'] }, { ids: [-2] }, { version: -1 }]) {
    assert.equal((await send(user, 'active', { mode: 'manual', ids: [], version: 2, ...patch })).status, 400);
  }
  assert.equal((await send(user, 'invalid-scope', { mode: 'date', ids: [], version: 0 })).status, 400);
  const profile = await db.accessProfile.create({ data: { key: 'no-services-order-test', name: 'No services', permissions: '[]' } });
  const denied = await db.user.create({ data: { name: 'Denied', email: 'denied@example.test', password: 'test-only', role: 'operations', accessProfileId: profile.id } });
  assert.equal((await send(denied)).status, 403);
  assert.equal((await send(denied, 'active', { mode: 'manual', ids: [], version: 0 })).status, 403);
});
test('migration adds only personal ordering and preserves existing records', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('PRAGMA foreign_keys=ON; CREATE TABLE User(id INTEGER PRIMARY KEY); INSERT INTO User VALUES(1); CREATE TABLE Event(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO Event VALUES(4,\'Preserved\');');
    sqlite.exec(readFileSync('prisma/sqlite/migrations/20261030010000_user_service_order/migration.sql', 'utf8'));
    sqlite.exec("INSERT INTO UserServiceOrder VALUES(1,'active','manual','[4]',1,CURRENT_TIMESTAMP)");
    assert.equal(sqlite.prepare('SELECT name FROM Event').get().name, 'Preserved');
    assert.throws(() => sqlite.exec("INSERT INTO UserServiceOrder VALUES(1,'active','manual','[]',1,CURRENT_TIMESTAMP)"), /UNIQUE/);
    sqlite.exec('DELETE FROM User WHERE id=1');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM UserServiceOrder').get().total, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM Event').get().total, 1);
  } finally { sqlite.close(); }
});
