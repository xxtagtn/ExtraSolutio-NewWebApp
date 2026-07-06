import '../server/config/env.js';
import { createDatabaseBackup } from '../server/utils/backups.js';

const result = await createDatabaseBackup();
console.log(JSON.stringify(result, null, 2));

if (result.status !== 'created') {
  process.exitCode = 1;
}
