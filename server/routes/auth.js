import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../utils/http.js';

export const authRouter = Router();

const PASSWORD_MIN_LENGTH = 10;

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

authRouter.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email e password sao obrigatorios.' });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const validPassword = user ? await bcrypt.compare(password, user.password) : false;

  if (!user || !validPassword) {
    return res.status(401).json({ message: 'Credenciais invalidas.' });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '4h' },
  );

  return res.json({
    token,
    user: publicUser(user),
  });
}));

authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  return res.json({ user: req.user });
}));

authRouter.put('/profile', requireAuth, asyncHandler(async (req, res) => {
  const { name } = req.body;

  if (!name || name.trim().length < 2) {
    return res.status(400).json({ message: 'Nome invalido.' });
  }

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { name: name.trim() },
  });

  return res.json({ user: publicUser(user) });
}));

authRouter.put('/password', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Password atual e nova password sao obrigatorias.' });
  }

  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({ message: `A nova password deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.` });
  }

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
