import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  createDatabaseBackup,
  getBackupEngine,
  resolveSqliteDatabasePath,
} from './backups.js';

test('detects sqlite database urls', () => {
  assert.equal(getBackupEngine('file:./dev.db'), 'sqlite');
  assert.equal(getBackupEngine('mysql://user:pass@localhost/db'), 'mysql');
});

test('resolves sqlite database paths relative to the prisma sqlite folder', () => {
  const resolved = resolveSqliteDatabasePath('file:./dev.db', 'C:/app/prisma/sqlite/schema.prisma');
  assert.equal(resolved.replaceAll('\\', '/'), 'C:/app/prisma/sqlite/dev.db');
});

test('creates a sqlite database backup copy', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'extrasolutio-backup-'));
  try {
    const dbPath = path.join(temp, 'dev.db');
    const backupDir = path.join(temp, 'backups');
    await writeFile(dbPath, 'sqlite-content');

    const result = await createDatabaseBackup({
      databaseUrl: `file:${dbPath}`,
      backupDir,
      schemaPath: path.join(temp, 'schema.prisma'),
      now: () => new Date('2026-07-06T10:20:30.000Z'),
    });

    assert.equal(result.engine, 'sqlite');
    assert.equal(result.status, 'created');
    assert.equal((await readFile(result.files[0], 'utf8')), 'sqlite-content');
    assert.equal((await stat(result.files[0])).isFile(), true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
