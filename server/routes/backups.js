import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { createDatabaseBackup, listDatabaseBackups } from '../utils/backups.js';

export const backupsRouter = Router();

backupsRouter.use(requireAdmin);

backupsRouter.get('/', asyncHandler(async (_req, res) => {
  const backups = await listDatabaseBackups();
  return res.json(backups);
}));

backupsRouter.post('/', asyncHandler(async (_req, res) => {
  const result = await createDatabaseBackup();
  return res.status(result.status === 'created' ? 201 : 200).json(result);
}));
