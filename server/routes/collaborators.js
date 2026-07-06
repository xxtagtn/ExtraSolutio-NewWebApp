import { Router } from 'express';
import { prisma } from '../prisma.js';
import { canViewSensitiveCollaboratorData } from '../security/roles.js';
import { PERMISSIONS } from '../../src/utils/accessPermissions.js';
import { requirePermission } from '../security/permissions.js';
import { asyncHandler } from '../utils/http.js';
import { collaboratorLightSelect } from '../utils/listPayloads.js';
import { buildPaginatedPayload, parsePaginationQuery } from '../utils/listQuery.js';
import { deleteStoredPhoto, resolvePhotoForStorage, resolvePhotoThumbForStorage } from '../utils/photoStorage.js';
import { computeShortName } from '../../src/utils/collaboratorName.js';
import { collaboratorRoleOptions } from '../../src/utils/collaboratorRoles.js';

export const collaboratorsRouter = Router();

const ALLOWED_ROLES = new Set(collaboratorRoleOptions);
const ALLOWED_STATUS = new Set(['active', 'inactive', 'paused']);
const ALLOWED_DOCUMENT_TYPES = new Set(['passport', 'citizen_card', 'residence_title']);
const SENSITIVE_FIELDS = [
  'nif',
  'iban',
  'birthDate',
  'gender',
  'documentType',
  'documentNumber',
  'documentExpiry',
  'documentExtended',
  'residenceArea',
  'insurancePolicy',
  'allergies',
  'greenReceipt',
  'hourlyRate',
  'includeVat',
  'notes',
];

collaboratorsRouter.use(requirePermission(PERMISSIONS.COLLABORATORS_VIEW));

function stringContains(value) {
  const text = String(value || '').trim();
  return text ? { contains: text } : null;
}

function toOptionalBoolean(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return value === true || value === 'true' || value === '1' || value === 1;
}

function buildCollaboratorWhere(query) {
  const where = {};
  const search = stringContains(query.search || query.q || query.name);
  if (search) {
    where.OR = [
      { name: search },
      { shortName: search },
      { email: search },
      { phone: search },
      { nif: search },
    ];
  }
  if (query.status) where.status = String(query.status);
  if (query.role) where.roles = { some: { role: String(query.role) } };
  const hasOwnCar = toOptionalBoolean(query.ownCar);
  if (hasOwnCar !== undefined) where.hasOwnCar = hasOwnCar;
  return where;
}

function parseId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ message: 'ID inválido.' });
    return null;
  }
  return id;
}

function normalizeRoles(inputRoles) {
  const list = Array.isArray(inputRoles) ? inputRoles : [];
  const unique = [...new Set(list.map((role) => String(role).trim()).filter(Boolean))];
  return unique.filter((role) => ALLOWED_ROLES.has(role));
}

function toDateOrNull(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} inválida.`);
  return date;
}

function toDecimalOrDefault(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const raw = String(value)
    .replace('€', '')
    .replace(/\u00e2\u201a\u00ac/g, '')
    .replace(/\/\s*h(?:ora)?s?/gi, '')
    .replace(/\b(?:eur|euros?)\b/gi, '')
    .replace(/\s/g, '')
    .trim();
  const commaIndex = raw.lastIndexOf(',');
  const dotIndex = raw.lastIndexOf('.');
  let normalized = raw;
  if (commaIndex >= 0 && dotIndex >= 0) {
    normalized = commaIndex > dotIndex
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
  } else if (commaIndex >= 0) {
    normalized = raw.replace(',', '.');
  } else if (dotIndex >= 0) {
    const dotCount = (raw.match(/\./g) || []).length;
    const beforeDot = raw.slice(0, dotIndex);
    const afterDot = raw.slice(dotIndex + 1);
    if (dotCount > 1 || (afterDot.length === 3 && beforeDot.length <= 3)) {
      normalized = raw.replace(/\./g, '');
    }
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) throw new Error('Valor/h inválido.');
  return parsed;
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeCollaboratorBody(input, { requireCore = false } = {}) {
  const roles = normalizeRoles(input.roles);
  const rawDocumentType = input.documentType === undefined ? undefined : String(input.documentType).trim();
  const documentType = rawDocumentType && ALLOWED_DOCUMENT_TYPES.has(rawDocumentType) ? rawDocumentType : null;
  const documentNumber = input.documentNumber ? String(input.documentNumber).trim() : null;
  const documentExpiry = toDateOrNull(input.documentExpiry, 'Validade do documento');
  const documentExtended = input.documentExtended === true || input.documentExtended === 'true';
  const includeVat = toBoolean(input.includeVat);
  const birthDate = toDateOrNull(input.birthDate, 'Data de nascimento');
  const hourlyRate = toDecimalOrDefault(input.hourlyRate, 0);

  if (rawDocumentType !== undefined && rawDocumentType !== '' && !documentType) {
    throw new Error('Tipo de documento inválido.');
  }
  if (documentType && (!documentNumber || !documentExpiry)) {
    throw new Error('Número e validade do documento são obrigatórios.');
  }
  if (input.status !== undefined && !ALLOWED_STATUS.has(String(input.status))) {
    throw new Error('Estado inválido.');
  }

  const data = {
    ...(input.name !== undefined ? { name: String(input.name).trim() } : {}),
    ...(input.email !== undefined ? { email: String(input.email).trim().toLowerCase() } : {}),
    ...(input.name !== undefined || input.shortName !== undefined
      ? { shortName: input.shortName ? String(input.shortName).trim() : computeShortName(input.name) || null }
      : {}),
    ...(input.birthDate !== undefined ? { birthDate } : {}),
    ...(input.gender !== undefined ? { gender: input.gender ? String(input.gender).trim() : null } : {}),
    ...(input.phone !== undefined ? { phone: input.phone ? String(input.phone).trim() : null } : {}),
    ...(input.nif !== undefined ? { nif: input.nif ? String(input.nif).trim() : null } : {}),
    ...(input.iban !== undefined ? { iban: input.iban ? String(input.iban).trim() : null } : {}),
    ...(input.documentType !== undefined ? { documentType } : {}),
    ...(input.documentNumber !== undefined ? { documentNumber: documentType ? documentNumber : null } : {}),
    ...(input.documentExpiry !== undefined ? { documentExpiry: documentType ? documentExpiry : null } : {}),
    ...(input.documentExtended !== undefined ? { documentExtended: documentType ? documentExtended : false } : {}),
    ...(input.residenceArea !== undefined ? { residenceArea: input.residenceArea ? String(input.residenceArea).trim() : null } : {}),
    ...(input.insurancePolicy !== undefined ? { insurancePolicy: input.insurancePolicy ? String(input.insurancePolicy).trim() : null } : {}),
    ...(input.allergies !== undefined ? { allergies: input.allergies ? String(input.allergies).trim() : null } : {}),
    ...(input.greenReceipt !== undefined ? { greenReceipt: input.greenReceipt ? String(input.greenReceipt).trim() : null } : {}),
    ...(input.availability !== undefined ? { availability: input.availability ? String(input.availability).trim() : null } : {}),
    ...(input.hourlyRate !== undefined ? { hourlyRate } : {}),
    ...(input.includeVat !== undefined ? { includeVat } : {}),
    ...(input.hasOwnCar !== undefined ? { hasOwnCar: toBoolean(input.hasOwnCar) } : {}),
    ...(input.isPreferred !== undefined ? { isPreferred: Boolean(input.isPreferred) } : {}),
    ...(input.status !== undefined ? { status: String(input.status) } : {}),
    ...(input.notes !== undefined ? { notes: input.notes ? String(input.notes).trim() : null } : {}),
    ...(roles.length > 0 ? { category: roles[0] } : {}),
  };

  if (requireCore && (!data.name || !data.email)) {
    throw new Error('Nome completo e email são obrigatórios.');
  }
  if (requireCore && roles.length === 0) {
    throw new Error('Seleciona pelo menos uma função.');
  }
  return { data, roles };
}

function toOutput(row, user) {
  const output = { ...row, roles: row.roles.map((item) => item.role) };
  if (!canViewSensitiveCollaboratorData(user)) {
    for (const field of SENSITIVE_FIELDS) {
      if (field in output) output[field] = null;
    }
  }
  return output;
}

collaboratorsRouter.get('/', asyncHandler(async (req, res) => {
  const light = req.query.light === '1' || req.query.light === 'true';
  const pagination = parsePaginationQuery(req.query, { defaultPageSize: 10, maxPageSize: 100 });
  const where = buildCollaboratorWhere(req.query);
  const rows = await prisma.collaborator.findMany({
    where,
    orderBy: [{ isPreferred: 'desc' }, { name: 'asc' }],
    ...(pagination.enabled ? { skip: (pagination.page - 1) * pagination.pageSize, take: pagination.pageSize } : {}),
    ...(light
      ? { select: collaboratorLightSelect }
      : { include: { roles: { orderBy: { role: 'asc' } } } }),
  });
  const items = rows.map((row) => toOutput(row, req.user));
  if (!pagination.enabled) return res.json(items);
  const total = await prisma.collaborator.count({ where });
  return res.json(buildPaginatedPayload({ items, total, page: pagination.page, pageSize: pagination.pageSize }));
}));

collaboratorsRouter.get('/roles', asyncHandler(async (_req, res) => {
  const rows = await prisma.collaboratorRole.findMany({
    distinct: ['role'],
    select: { role: true },
    orderBy: { role: 'asc' },
  });
  const dynamic = rows.map((row) => row.role).filter(Boolean);
  const merged = [...new Set([...ALLOWED_ROLES, ...dynamic])].sort((a, b) => a.localeCompare(b));
  res.json(merged);
}));

collaboratorsRouter.get('/:id', asyncHandler(async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;
  const row = await prisma.collaborator.findUnique({
    where: { id },
    include: { roles: { orderBy: { role: 'asc' } } },
  });
  if (!row) return res.status(404).json({ message: 'Registo não encontrado.' });
  return res.json(toOutput(row, req.user));
}));

collaboratorsRouter.post('/', requirePermission(PERMISSIONS.COLLABORATORS_CREATE), asyncHandler(async (req, res) => {
  let normalized;
  try {
    normalized = normalizeCollaboratorBody(req.body, { requireCore: true });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const { data, roles } = normalized;
  const photo = await resolvePhotoForStorage(req.body.photo);
  if (photo !== undefined) data.photo = photo;
  const photoThumb = await resolvePhotoThumbForStorage(req.body.photoThumb);
  if (photoThumb !== undefined) data.photoThumb = photoThumb;
  const row = await prisma.collaborator.create({
    data: { ...data, roles: { create: roles.map((role) => ({ role })) } },
    include: { roles: { orderBy: { role: 'asc' } } },
  });
  return res.status(201).json(toOutput(row, req.user));
}));

collaboratorsRouter.put('/:id', requirePermission(PERMISSIONS.COLLABORATORS_UPDATE), asyncHandler(async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;
  let normalized;
  try {
    normalized = normalizeCollaboratorBody(req.body);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const { data, roles } = normalized;
  const hasRoles = Array.isArray(req.body.roles);
  if (hasRoles && roles.length === 0) return res.status(400).json({ message: 'Seleciona pelo menos uma função.' });
  if (req.body.photo !== undefined || req.body.photoThumb !== undefined) {
    const existing = await prisma.collaborator.findUnique({ where: { id }, select: { photo: true, photoThumb: true } });
    if (!existing) return res.status(404).json({ message: 'Registo não encontrado.' });
    if (req.body.photo !== undefined) {
      data.photo = await resolvePhotoForStorage(req.body.photo, existing.photo);
    }
    if (req.body.photoThumb !== undefined) {
      data.photoThumb = await resolvePhotoThumbForStorage(req.body.photoThumb, existing.photoThumb);
    } else if (req.body.photo !== undefined && req.body.photo !== existing.photo && existing.photoThumb) {
      await deleteStoredPhoto(existing.photoThumb);
      data.photoThumb = null;
    }
  }
  const row = await prisma.collaborator.update({
    where: { id },
    data: {
      ...data,
      ...(hasRoles ? { roles: { deleteMany: {}, create: roles.map((role) => ({ role })) } } : {}),
    },
    include: { roles: { orderBy: { role: 'asc' } } },
  });
  return res.json(toOutput(row, req.user));
}));

collaboratorsRouter.delete('/:id', requirePermission(PERMISSIONS.COLLABORATORS_DELETE), asyncHandler(async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;
  const existing = await prisma.collaborator.findUnique({ where: { id }, select: { photo: true, photoThumb: true } });
  await prisma.collaborator.delete({ where: { id } });
  await deleteStoredPhoto(existing?.photo);
  await deleteStoredPhoto(existing?.photoThumb);
  return res.status(204).end();
}));
