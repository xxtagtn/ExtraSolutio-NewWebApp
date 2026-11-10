import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import { buildPendingActions } from '../../src/utils/pendingActions.js';
import { documentSnoozeKey, splitDocumentSnoozes } from '../../shared/dashboardDocumentSnooze.js';
import { createDashboardDocumentSnoozeRouter } from './dashboardDocumentSnooze.js';

test('document snoozes migrate safely, stay private to the account and expire or restore independently', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'es-doc-snooze-'));
  const file = join(directory, 'test.db');
  const sqlite = new DatabaseSync(file);
  sqlite.exec(`CREATE TABLE "NotificationDismissal" (
    "id" INTEGER PRIMARY KEY, "userId" INTEGER NOT NULL, "key" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE ("userId", "key"));
    INSERT INTO "NotificationDismissal" ("userId", "key") VALUES (1, 'legacy-ignored');
    CREATE TABLE "Collaborator" ("id" INTEGER PRIMARY KEY, "status" TEXT NOT NULL, "documentExpiry" DATETIME);
    INSERT INTO "Collaborator" VALUES (1, 'active', '2026-11-01T00:00:00.000Z'), (2, 'active', '2026-11-05T00:00:00.000Z');`);
  sqlite.close();
  const db = new PrismaClient({ datasourceUrl: `file:${file.replaceAll('\\', '/')}` });
  let now = new Date('2026-11-10T10:00:00.000Z');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = Number(req.get('x-user'));
    req.user = id === 3 ? { id, role: 'operations', permissions: ['dashboard.view'] } : { id, role: 'admin' };
    next();
  });
  app.use(createDashboardDocumentSnoozeRouter(db, { clock: () => now }));
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/`;
    const call = (method, body, id = 1) => fetch(url, { method, headers: { 'content-type': 'application/json', 'x-user': String(id) }, body: JSON.stringify(body) });
    const expiry = ['2026-11-01', '2026-11-05'];
    const keys = expiry.map((day, index) => documentSnoozeKey(index + 1, day));
    const read = async (id) => (await call('GET', undefined, id)).json();
    const missingMigration = await call('GET');
    assert.equal(missingMigration.status, 503);
    assert.match((await missingMigration.json()).message, /migração/);
    const migrationDb = new DatabaseSync(file);
    try { migrationDb.exec(readFileSync(new URL('../../prisma/sqlite/migrations/20261110010000_dashboard_document_snooze/migration.sql', import.meta.url), 'utf8')); }
    finally { migrationDb.close(); }
    assert.deepEqual(await read(), []);
    assert.equal((await call('GET', undefined, 3)).status, 403);
    assert.equal((await call('PUT', { keys, days: 3 })).status, 400);
    assert.equal((await call('PUT', { keys, until: now.toISOString() })).status, 400);
    assert.equal((await call('PUT', { keys: ['legacy-ignored'], days: 7 })).status, 400);
    assert.equal((await call('PUT', { keys: [...keys, documentSnoozeKey(2, '2025-01-01')], days: 7 })).status, 409);
    assert.deepEqual(await read(), [], 'Invalid bulk requests do not partially save');
    assert.equal((await call('PUT', { keys, days: 1 })).status, 200);
    const saved = await read();
    assert.deepEqual(saved.sort((a, b) => a.key.localeCompare(b.key)), keys.map((key) => ({ key, snoozedUntil: '2026-11-11T10:00:00.000Z' })));
    assert.deepEqual(await read(2), []);
    assert.equal((await call('DELETE', { keys }, 2)).status, 200);
    assert.equal((await read()).length, 2);

    const collaborators = expiry.map((documentExpiry, i) => ({ id: i + 1, status: 'active', documentExpiry }));
    const current = () => buildPendingActions({ collaborators }, { today: now });
    assert.equal(splitDocumentSnoozes(current(), saved, now).snoozed.length, 2);
    collaborators[0].documentExpiry = '2026-11-30';
    assert.equal(splitDocumentSnoozes(current(), saved, now).pending[0].snoozeKey, documentSnoozeKey(1, '2026-11-30'));
    collaborators[0].documentExpiry = '2028-11-30';
    assert.equal(splitDocumentSnoozes(current(), saved, now).pending.length, 0, 'A resolved document never reappears');
    assert.equal((await call('DELETE', { keys: [keys[0]] })).status, 200);
    assert.equal((await read()).length, 1);
    const custom = '2026-11-10T11:32:00.000Z';
    assert.equal((await call('PUT', { keys: [keys[1]], until: custom })).status, 200);
    assert.deepEqual(await read(), [{ key: keys[1], snoozedUntil: custom }]);
    now = new Date(custom);
    assert.deepEqual(await read(), []);
    assert.equal(splitDocumentSnoozes(current(), [{ key: keys[1], snoozedUntil: custom }], now).pending.length, 1);
    const legacy = await db.notificationDismissal.findUnique({ where: { userId_key: { userId: 1, key: 'legacy-ignored' } } });
    assert.equal(legacy.snoozedUntil, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});
