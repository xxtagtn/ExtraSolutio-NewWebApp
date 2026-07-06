import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import { createDatabaseBackup } from './backups.js';

export function startBackupScheduler({
  enabled = process.env.BACKUP_ENABLED !== 'false',
  intervalHours = Number(process.env.BACKUP_INTERVAL_HOURS || 24),
  startupDelayMs = Number(process.env.BACKUP_STARTUP_DELAY_MS || 60_000),
  logger = console,
} = {}) {
  if (!enabled) return null;
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) return null;

  const intervalMs = intervalHours * 60 * 60 * 1000;
  let running = false;

  async function runBackup() {
    if (running) return;
    running = true;
    try {
      const result = await createDatabaseBackup();
      if (result.status === 'created') {
        logger.info?.(`[backup] Backup criado: ${result.files.join(', ')}`);
      } else {
        logger.warn?.(`[backup] Backup não criado: ${result.message || result.status}`);
      }
    } catch (error) {
      logger.error?.('[backup] Falha ao criar backup automático.', error);
    } finally {
      running = false;
    }
  }

  const startupTimer = setTimeout(runBackup, startupDelayMs);
  startupTimer.unref?.();
  const interval = setInterval(runBackup, intervalMs);
  interval.unref?.();

  return {
    stop() {
      clearTimeout(startupTimer);
      clearInterval(interval);
    },
    runNow: runBackup,
  };
}
