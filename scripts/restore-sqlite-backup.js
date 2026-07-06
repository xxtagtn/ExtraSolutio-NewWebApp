import '../server/config/env.js';
import { copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  getBackupEngine,
  listDatabaseBackups,
  resolveSqliteDatabasePath,
} from '../server/utils/backups.js';

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const confirmed = process.argv.includes('--confirm');
const backupArg = readArg('--backup');
const engine = getBackupEngine(process.env.DATABASE_URL);

if (engine !== 'sqlite') {
  console.error('Reposição automática disponível apenas para SQLite. Em MySQL, usa o dump validado pelo servidor de produção.');
  process.exit(1);
}

const backups = await listDatabaseBackups();
const selectedBackup = backupArg
  ? path.resolve(backupArg)
  : backups.find((backup) => backup.name.endsWith('.db'))?.path;

if (!selectedBackup) {
  console.error('Não foi encontrado nenhum backup SQLite para repor.');
  process.exit(1);
}

await stat(selectedBackup);
const dbPath = resolveSqliteDatabasePath(process.env.DATABASE_URL);

if (!confirmed) {
  console.log(`Modo simulação: ${selectedBackup} seria reposto em ${dbPath}.`);
  console.log('Para confirmar a reposição, executa: npm run db:restore -- --confirm');
  process.exit(0);
}

const safetyBackup = path.join(
  path.dirname(selectedBackup),
  `${new Date().toISOString().replace(/[:.]/g, '-')}-pre-restore-${path.basename(dbPath)}`,
);

await copyFile(dbPath, safetyBackup);
await copyFile(selectedBackup, dbPath);

console.log(`Base de dados reposta a partir de: ${selectedBackup}`);
console.log(`Cópia de segurança antes da reposição: ${safetyBackup}`);
