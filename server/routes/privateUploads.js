import { fileURLToPath, URL } from 'node:url';
import express, { Router } from 'express';
import { PERMISSIONS } from '../../src/utils/accessPermissions.js';
import { requirePermission } from '../security/permissions.js';

export function createPrivateUploadsRouter({ root = fileURLToPath(new URL('../../public/uploads/collaborators', import.meta.url)) } = {}) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  router.use(requirePermission(PERMISSIONS.COLLABORATORS_VIEW));
  router.use('/collaborators', express.static(root, {
    dotfiles: 'deny', index: false, redirect: false, fallthrough: true,
    cacheControl: false, etag: false, lastModified: false,
    setHeaders(res) { res.setHeader('Cache-Control', 'private, no-store'); },
  }));
  router.use((_req, res) => res.sendStatus(404));
  return router;
}
