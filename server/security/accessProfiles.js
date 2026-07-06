import {
  accessProfileTemplates,
  normalizePermissionList,
  parsePermissionOverrides,
  serializePermissionOverrides,
} from '../../src/utils/accessPermissions.js';

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

export function profilePayload(input = {}) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Nome do perfil é obrigatório.');
  const key = slugify(input.key || name);
  if (!key) throw new Error('Chave do perfil inválida.');
  const permissions = normalizePermissionList(input.permissions);
  return {
    key,
    name,
    description: input.description ? String(input.description).trim() : null,
    permissions: JSON.stringify(permissions),
    isSystem: Boolean(input.isSystem),
  };
}

export function userPermissionOverridesPayload(value) {
  const serialized = serializePermissionOverrides(value);
  if (!serialized) return null;
  return JSON.stringify(parsePermissionOverrides(serialized));
}

export async function ensureSystemAccessProfiles(prisma) {
  await Promise.all(accessProfileTemplates.map((template) => prisma.accessProfile.upsert({
    where: { key: template.key },
    update: {
      name: template.name,
      description: template.description,
      permissions: JSON.stringify(normalizePermissionList(template.permissions)),
      isSystem: true,
    },
    create: {
      key: template.key,
      name: template.name,
      description: template.description,
      permissions: JSON.stringify(normalizePermissionList(template.permissions)),
      isSystem: true,
    },
  })));
}

export async function auditPermissionChange(prisma, {
  actorId,
  targetUserId = null,
  accessProfileId = null,
  action,
  before = null,
  after = null,
}) {
  await prisma.permissionAuditLog.create({
    data: {
      actorId: actorId || null,
      targetUserId,
      accessProfileId,
      action,
      changes: JSON.stringify({ before, after }),
    },
  });
}

export function publicProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    key: profile.key,
    name: profile.name,
    description: profile.description,
    permissions: normalizePermissionList(profile.permissions),
    isSystem: profile.isSystem,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}
