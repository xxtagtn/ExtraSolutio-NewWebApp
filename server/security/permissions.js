import {
  hasAnyPermission,
  hasPermission,
} from '../../src/utils/accessPermissions.js';

export function requirePermission(permission) {
  return (req, res, next) => {
    if (hasPermission(req.user, permission)) return next();
    return res.status(403).json({ message: 'Sem permissões para aceder a este recurso.' });
  };
}

export function requireAnyPermission(permissions) {
  return (req, res, next) => {
    if (hasAnyPermission(req.user, permissions)) return next();
    return res.status(403).json({ message: 'Sem permissões para aceder a este recurso.' });
  };
}
