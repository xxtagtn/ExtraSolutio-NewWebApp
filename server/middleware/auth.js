import jwt from 'jsonwebtoken';
import { prisma } from '../prisma.js';
import { canAccessRole, normalizeRole, ROLES } from '../security/roles.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Token em falta.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, email: true, name: true, role: true },
    });

    if (!user) {
      return res.status(401).json({ message: 'Utilizador inválido.' });
    }

    req.user = { ...user, role: normalizeRole(user.role) };
    return next();
  } catch (error) {
    if (error?.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Login Expirado' });
    }

    return res.status(401).json({ message: 'Token inválido.' });
  }
}

export function requireAdmin(req, res, next) {
  if (!canAccessRole(req.user, [ROLES.ADMIN])) {
    return res.status(403).json({ message: 'Acesso reservado a administradores.' });
  }

  return next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!canAccessRole(req.user, roles)) {
      return res.status(403).json({ message: 'Sem permissões para aceder a este recurso.' });
    }
    return next();
  };
}
