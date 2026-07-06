import { Router } from 'express';
import { PERMISSIONS } from '../../src/utils/accessPermissions.js';
import { requirePermission } from '../security/permissions.js';
import { asyncHandler } from '../utils/http.js';
import { createDatabaseBackup, listDatabaseBackups } from '../utils/backups.js';

export const backupsRouter = Router();

backupsRouter.use(requirePermission(PERMISSIONS.BACKUPS_MANAGE));

backupsRouter.get('/', asyncHandler(async (_req, res) => {
  const backups = await listDatabaseBackups();
  return res.json(backups);
}));

backupsRouter.post('/', asyncHandler(async (_req, res) => {
  const result = await createDatabaseBackup();
  return res.status(result.status === 'created' ? 201 : 200).json(result);
}));
