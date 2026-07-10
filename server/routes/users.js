import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { prisma } from '../prisma.js';
import {
  PERMISSIONS,
  effectivePermissionsForUser,
  parsePermissionOverrides,
  permissionCatalog,
} from '../../src/utils/accessPermissions.js';
import {
  auditPermissionChange,
  ensureSystemAccessProfiles,
  profilePayload,
  publicProfile,
  userPermissionOverridesPayload,
} from '../security/accessProfiles.js';
import { requirePermission } from '../security/permissions.js';
import { validatePasswordStrength } from '../security/passwordPolicy.js';
import { normalizeRole, publicRole } from '../security/roles.js';
import { asyncHandler } from '../utils/http.js';
import { normalizeUserPhoto } from '../../src/utils/userProfile.js';

export const usersRouter = Router();

const publicSelect = {
  id: true,
  email: true,
  name: true,
  photo: true,
  role: true,
  accessProfileId: true,
  permissionOverrides: true,
  accessProfile: true,
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
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    photo: user.photo,
    role: publicRole(user.role),
    accessProfileId: user.accessProfileId,
    accessProfile: publicProfile(user.accessProfile),
    permissionOverrides: parsePermissionOverrides(user.permissionOverrides),
    permissions: effectivePermissionsForUser(user),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

usersRouter.use(requirePermission(PERMISSIONS.ADMIN_VIEW));

usersRouter.get('/permission-catalog', requirePermission(PERMISSIONS.ADMIN_MANAGE_PERMISSIONS), asyncHandler(async (_req, res) => {
  await ensureSystemAccessProfiles(prisma);
  const profiles = await prisma.accessProfile.findMany({ orderBy: [{ isSystem: 'desc' }, { name: 'asc' }] });
  res.json({ catalog: permissionCatalog, profiles: profiles.map(publicProfile) });
}));

usersRouter.get('/access-profiles', requirePermission(PERMISSIONS.ADMIN_MANAGE_PERMISSIONS), asyncHandler(async (_req, res) => {
  await ensureSystemAccessProfiles(prisma);
  const profiles = await prisma.accessProfile.findMany({ orderBy: [{ isSystem: 'desc' }, { name: 'asc' }] });
  res.json(profiles.map(publicProfile));
}));

usersRouter.post('/access-profiles', requirePermission(PERMISSIONS.ADMIN_MANAGE_PERMISSIONS), asyncHandler(async (req, res) => {
  let data;
  try {
    data = profilePayload(req.body);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const profile = await prisma.accessProfile.create({ data: { ...data, isSystem: false } });
  await auditPermissionChange(prisma, {
    actorId: req.user.id,
    accessProfileId: profile.id,
    action: 'access_profile_created',
    after: publicProfile(profile),
  });
  res.status(201).json(publicProfile(profile));
}));

usersRouter.put('/access-profiles/:id', requirePermission(PERMISSIONS.ADMIN_MANAGE_PERMISSIONS), asyncHandler(async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;
  const existing = await prisma.accessProfile.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ message: 'Perfil não encontrado.' });
  let data;
  try {
    data = profilePayload({ ...req.body, key: existing.isSystem ? existing.key : req.body.key });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const profile = await prisma.accessProfile.update({
    where: { id },
    data: {
      key: existing.isSystem ? existing.key : data.key,
      name: data.name,
      description: data.description,
      permissions: data.permissions,
    },
  });
  await auditPermissionChange(prisma, {
    actorId: req.user.id,
    accessProfileId: id,
    action: 'access_profile_updated',
    before: publicProfile(existing),
    after: publicProfile(profile),
  });
  res.json(publicProfile(profile));
}));

usersRouter.delete('/access-profiles/:id', requirePermission(PERMISSIONS.ADMIN_MANAGE_PERMISSIONS), asyncHandler(async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;
  const existing = await prisma.accessProfile.findUnique({
    where: { id },
    include: { users: { select: { id: true }, take: 1 } },
  });
  if (!existing) return res.status(404).json({ message: 'Perfil não encontrado.' });
  if (existing.isSystem) return res.status(400).json({ message: 'Perfis de sistema não podem ser eliminados.' });
  if (existing.users.length) return res.status(400).json({ message: 'Este perfil está atribuído a utilizadores.' });
  await auditPermissionChange(prisma, {
    actorId: req.user.id,
    accessProfileId: id,
    action: 'access_profile_deleted',
    before: publicProfile(existing),
  });
  await prisma.accessProfile.delete({ where: { id } });
  res.status(204).end();
}));

usersRouter.get('/permission-audit', requirePermission(PERMISSIONS.ADMIN_VIEW_AUDIT), asyncHandler(async (_req, res) => {
  const rows = await prisma.permissionAuditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      actor: { select: { id: true, name: true, email: true } },
      targetUser: { select: { id: true, name: true, email: true } },
      accessProfile: { select: { id: true, key: true, name: true } },
    },
  });
  res.json(rows.map((row) => ({
    ...row,
    changes: (() => {
      try {
        return JSON.parse(row.changes);
      } catch {
        return { raw: row.changes };
      }
    })(),
  })));
}));

usersRouter.get('/', requirePermission(PERMISSIONS.ADMIN_MANAGE_USERS), asyncHandler(async (_req, res) => {
  await ensureSystemAccessProfiles(prisma);
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: publicSelect,
  });
  res.json(users.map(toPublicUser));
}));

usersRouter.post('/', requirePermission(PERMISSIONS.ADMIN_MANAGE_USERS), asyncHandler(async (req, res) => {
  const { email, name, password, role, accessProfileId, permissionOverrides, photo } = req.body;

  if (!email || !name || !password) {
    return res.status(400).json({ message: 'Nome, email e password sao obrigatorios.' });
  }

  const passwordStrength = validatePasswordStrength(password);
  if (!passwordStrength.valid) return res.status(400).json({ message: passwordStrength.message });

  const profileId = accessProfileId ? Number(accessProfileId) : null;
  if (profileId) {
    const profile = await prisma.accessProfile.findUnique({ where: { id: profileId } });
    if (!profile) return res.status(400).json({ message: 'Perfil de acesso inválido.' });
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  let normalizedPhoto;
  try {
    normalizedPhoto = normalizeUserPhoto(photo);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const user = await prisma.user.create({
    data: {
      email: email.trim().toLowerCase(),
      name: name.trim(),
      photo: normalizedPhoto ?? null,
      password: hashedPassword,
      role: normalizeRole(role),
      accessProfileId: profileId,
      permissionOverrides: userPermissionOverridesPayload(permissionOverrides),
    },
    select: publicSelect,
  });

  await auditPermissionChange(prisma, {
    actorId: req.user.id,
    targetUserId: user.id,
    action: 'user_created',
    after: toPublicUser(user),
  });

  return res.status(201).json(toPublicUser(user));
}));

usersRouter.put('/:id', requirePermission(PERMISSIONS.ADMIN_MANAGE_USERS), asyncHandler(async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  const existing = await prisma.user.findUnique({ where: { id }, select: publicSelect });
  if (!existing) return res.status(404).json({ message: 'Utilizador não encontrado.' });

  const { email, name, password, role, accessProfileId, permissionOverrides, photo } = req.body;
  const data = {};

  if (email !== undefined) data.email = email.trim().toLowerCase();
  if (name !== undefined) data.name = name.trim();
  if (photo !== undefined) {
    try {
      data.photo = normalizeUserPhoto(photo);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
  }
  if (role !== undefined) data.role = normalizeRole(role);
  if (accessProfileId !== undefined) {
    const profileId = accessProfileId ? Number(accessProfileId) : null;
    if (profileId) {
      const profile = await prisma.accessProfile.findUnique({ where: { id: profileId } });
      if (!profile) return res.status(400).json({ message: 'Perfil de acesso inválido.' });
    }
    data.accessProfileId = profileId;
  }
  if (permissionOverrides !== undefined) {
    data.permissionOverrides = userPermissionOverridesPayload(permissionOverrides);
  }

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

  const sensitiveChanged = ['role', 'accessProfileId', 'permissionOverrides'].some((field) => field in data);
  if (sensitiveChanged) {
    await auditPermissionChange(prisma, {
      actorId: req.user.id,
      targetUserId: user.id,
      action: 'user_permissions_updated',
      before: toPublicUser(existing),
      after: toPublicUser(user),
    });
  }

  return res.json(toPublicUser(user));
}));

usersRouter.delete('/:id', requirePermission(PERMISSIONS.ADMIN_MANAGE_USERS), asyncHandler(async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;

  if (id === req.user.id) {
    return res.status(400).json({ message: 'Não podes eliminar o teu próprio utilizador.' });
  }

  await prisma.user.delete({ where: { id } });
  return res.status(204).end();
}));
