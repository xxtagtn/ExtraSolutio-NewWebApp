import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { setInterval } from 'node:timers';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../prisma.js';
import { validatePasswordStrength } from '../security/passwordPolicy.js';
import { publicRole } from '../security/roles.js';
import { effectivePermissionsForUser } from '../../src/utils/accessPermissions.js';
import { asyncHandler } from '../utils/http.js';

export const authRouter = Router();

const LOGIN_WINDOW_MS = Number(process.env.LOGIN_WINDOW_MINUTES || 15) * 60 * 1000;
const LOGIN_MAX_FAILURES = Number(process.env.LOGIN_MAX_FAILURES || 5);
const TOKEN_TTL = process.env.JWT_EXPIRES_IN || '4h';
const authUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  accessProfileId: true,
  permissionOverrides: true,
  accessProfile: {
    select: { id: true, key: true, name: true, description: true, permissions: true },
  },
};

function createLoginThrottle({ windowMs = LOGIN_WINDOW_MS, maxFailures = LOGIN_MAX_FAILURES, now = () => Date.now() } = {}) {
  const failures = new Map();

  function isBlocked(key) {
    const entry = failures.get(key);
    if (!entry) return false;
    if (now() - entry.firstAt > windowMs) {
      failures.delete(key);
      return false;
    }
    return entry.count >= maxFailures;
  }

  function registerFailure(key) {
    const timestamp = now();
    const entry = failures.get(key);
    if (!entry || timestamp - entry.firstAt > windowMs) {
      failures.set(key, { count: 1, firstAt: timestamp });
      return;
    }
    entry.count += 1;
  }

  function clear(key) {
    failures.delete(key);
  }

  function cleanup() {
    const timestamp = now();
    for (const [key, entry] of failures) {
      if (timestamp - entry.firstAt > windowMs) failures.delete(key);
    }
  }

  return { isBlocked, registerFailure, clear, cleanup };
}

const loginThrottle = createLoginThrottle();

setInterval(() => {
  loginThrottle.cleanup();
}, LOGIN_WINDOW_MS).unref?.();

function loginKey(req, email) {
  return `${req.ip || 'unknown'}|${String(email || '').trim().toLowerCase()}`;
}

export const __loginThrottleForTests = { createLoginThrottle };

function publicUser(user) {
  const output = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: publicRole(user.role),
    accessProfileId: user.accessProfileId ?? null,
    accessProfile: user.accessProfile
      ? {
          id: user.accessProfile.id,
          key: user.accessProfile.key,
          name: user.accessProfile.name,
          description: user.accessProfile.description,
        }
      : null,
  };
  return { ...output, permissions: effectivePermissionsForUser(user) };
}

function issueToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: publicRole(user.role) },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL },
  );
}

authRouter.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email e password são obrigatórios.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const key = loginKey(req, normalizedEmail);
  if (loginThrottle.isBlocked(key)) {
    return res.status(429).json({ message: 'Demasiadas tentativas falhadas. Tenta novamente dentro de 15 minutos.' });
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { accessProfile: true },
  });
  const validPassword = user ? await bcrypt.compare(password, user.password) : false;

  if (!user || !validPassword) {
    loginThrottle.registerFailure(key);
    return res.status(401).json({ message: 'Credenciais inválidas.' });
  }

  loginThrottle.clear(key);

  const token = issueToken(user);

  return res.json({
    token,
    user: publicUser(user),
  });
}));

authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  return res.json({ user: req.user });
}));

authRouter.post('/refresh', requireAuth, asyncHandler(async (req, res) => {
  const token = issueToken(req.user);
  return res.json({ token, user: publicUser(req.user) });
}));

authRouter.put('/profile', requireAuth, asyncHandler(async (req, res) => {
  const { name } = req.body;

  if (!name || name.trim().length < 2) {
    return res.status(400).json({ message: 'Nome invalido.' });
  }

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { name: name.trim() },
    select: authUserSelect,
  });

  return res.json({ user: publicUser(user) });
}));

authRouter.put('/password', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Password atual e nova password sao obrigatorias.' });
  }

  const passwordStrength = validatePasswordStrength(newPassword);
  if (!passwordStrength.valid) return res.status(400).json({ message: passwordStrength.message });

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const validPassword = user ? await bcrypt.compare(currentPassword, user.password) : false;

  if (!user || !validPassword) {
    return res.status(401).json({ message: 'Password atual invalida.' });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashedPassword },
  });

  return res.json({ message: 'Password alterada com sucesso.' });
}));
