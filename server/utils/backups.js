import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const defaultSchemaPath = fileURLToPath(new URL('../../prisma/sqlite/schema.prisma', import.meta.url));

function timestampForFile(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function getBackupEngine(databaseUrl = process.env.DATABASE_URL || '') {
  const value = String(databaseUrl);
  if (value.startsWith('file:')) return 'sqlite';
  if (value.startsWith('mysql://') || value.startsWith('mysql2://')) return 'mysql';
  return 'unknown';
}

export function resolveSqliteDatabasePath(databaseUrl = process.env.DATABASE_URL || '', schemaPath = defaultSchemaPath) {
  const raw = String(databaseUrl).replace(/^file:/, '');
  if (path.isAbsolute(raw)) return path.normalize(raw);
  return path.resolve(path.dirname(schemaPath), raw);
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createSqliteBackup({ databaseUrl, backupDir, schemaPath, now }) {
  const dbPath = resolveSqliteDatabasePath(databaseUrl, schemaPath);
  if (!(await pathExists(dbPath))) {
    return { engine: 'sqlite', status: 'missing', files: [], message: 'Base de dados SQLite não encontrada.' };
  }

  await mkdir(backupDir, { recursive: true });
  const stamp = timestampForFile(now());
  const baseName = path.basename(dbPath);
  const target = path.join(backupDir, `${stamp}-${baseName}`);
  await copyFile(dbPath, target);

  const files = [target];
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${dbPath}${suffix}`;
    if (await pathExists(sidecar)) {
      const sidecarTarget = path.join(backupDir, `${stamp}-${baseName}${suffix}`);
      await copyFile(sidecar, sidecarTarget);
      files.push(sidecarTarget);
    }
  }

  return { engine: 'sqlite', status: 'created', files };
}

async function createMysqlBackup({ databaseUrl, backupDir, now }) {
  const mysqldumpPath = process.env.MYSQLDUMP_PATH;
  if (mysqldumpPath) {
    await mkdir(backupDir, { recursive: true });
    const url = new URL(databaseUrl);
    const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const target = path.join(backupDir, `${timestampForFile(now())}-${database || 'mysql'}.sql`);
    const output = createWriteStream(target);
    const args = [
      `--host=${url.hostname}`,
      `--port=${url.port || 3306}`,
      `--user=${decodeURIComponent(url.username)}`,
      '--single-transaction',
      '--routines',
      '--triggers',
      database,
    ];

    await new Promise((resolve, reject) => {
      const child = spawn(mysqldumpPath, args, {
        env: { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stdout.pipe(output);
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        output.close();
        if (code === 0) resolve();
        else reject(new Error(stderr || `mysqldump terminou com código ${code}.`));
      });
    });

    return { engine: 'mysql', status: 'created', files: [target] };
  }

  return {
    engine: 'mysql',
    status: 'skipped',
    files: [],
    message: 'Backup MySQL preparado: configura MYSQLDUMP_PATH e credenciais no servidor de produção.',
  };
}

export async function pruneOldBackups({ backupDir, retentionDays = 14, now = () => new Date() } = {}) {
  if (!retentionDays || retentionDays <= 0) return 0;
  if (!(await pathExists(backupDir))) return 0;
  const cutoff = now().getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = await readdir(backupDir, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(backupDir, entry.name);
    const info = await stat(filePath);
    if (info.mtime.getTime() < cutoff) {
      await rm(filePath, { force: true });
      removed += 1;
    }
  }
  return removed;
}

export async function createDatabaseBackup({
  databaseUrl = process.env.DATABASE_URL || 'file:./dev.db',
  backupDir = process.env.BACKUP_DIR || path.resolve(process.cwd(), 'backups'),
  schemaPath = defaultSchemaPath,
  retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 14),
  now = () => new Date(),
} = {}) {
  const engine = getBackupEngine(databaseUrl);
  const result = engine === 'sqlite'
    ? await createSqliteBackup({ databaseUrl, backupDir, schemaPath, now })
    : engine === 'mysql'
      ? await createMysqlBackup({ databaseUrl, backupDir, now })
      : { engine, status: 'skipped', files: [], message: 'Tipo de base de dados não suportado para backup automático.' };

  if (result.status === 'created') {
    result.removedOldBackups = await pruneOldBackups({ backupDir, retentionDays, now });
  }

  return result;
}

export async function listDatabaseBackups(backupDir = process.env.BACKUP_DIR || path.resolve(process.cwd(), 'backups')) {
  if (!(await pathExists(backupDir))) return [];
  const entries = await readdir(backupDir, { withFileTypes: true });
  const files = await Promise.all(entries
    .filter((entry) => entry.isFile())
    .map(async (entry) => {
      const filePath = path.join(backupDir, entry.name);
      const info = await stat(filePath);
      return {
        name: entry.name,
        path: filePath,
        size: info.size,
        createdAt: info.birthtime,
        updatedAt: info.mtime,
      };
    }));
  return files.sort((a, b) => b.updatedAt - a.updatedAt);
}
