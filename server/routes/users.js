import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { prisma } from '../prisma.js';
import { validatePasswordStrength } from '../security/passwordPolicy.js';
import { normalizeRole, publicRole } from '../security/roles.js';
import { asyncHandler } from '../utils/http.js';

export const usersRouter = Router();

const publicSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
  updatedAt: true,
};

function parseId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ message: 'ID inválido.' });
    return null;
  }
  return id;
}

function toPublicUser(user) {
  return { ...user, role: publicRole(user.role) };
}

usersRouter.use(requireAdmin);

usersRouter.get('/', asyncHandler(async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: publicSelect,
  });
  res.json(users.map(toPublicUser));
}));

usersRouter.post('/', asyncHandler(async (req, res) => {
  const { email, name, password, role } = req.body;

  if (!email || !name || !password) {
    return res.status(400).json({ message: 'Nome, email e password sao obrigatorios.' });
  }

  const passwordStrength = validatePasswordStrength(password);
  if (!passwordStrength.valid) return res.status(400).json({ message: passwordStrength.message });

  const hashedPassword = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      email: email.trim().toLowerCase(),
      name: name.trim(),
      password: hashedPassword,
      role: normalizeRole(role),
    },
    select: publicSelect,
  });

  return res.status(201).json(toPublicUser(user));
}));

usersRouter.put('/:id', asyncHandler(async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  const { email, name, password, role } = req.body;
  const data = {};

  if (email !== undefined) data.email = email.trim().toLowerCase();
  if (name !== undefined) data.name = name.trim();
  if (role !== undefined) data.role = normalizeRole(role);

  if (password) {
    const passwordStrength = validatePasswordStrength(password);
    if (!passwordStrength.valid) return res.status(400).json({ message: passwordStrength.message });
    data.password = await bcrypt.hash(password, 12);
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ message: 'Sem alteracoes para guardar.' });
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: publicSelect,
  });

  return res.json(toPublicUser(user));
}));

usersRouter.delete('/:id', asyncHandler(async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  if (id === req.user.id) {
    return res.status(400).json({ message: 'Não podes eliminar o teu próprio utilizador.' });
  }

  await prisma.user.delete({ where: { id } });
  return res.status(204).end();
}));
