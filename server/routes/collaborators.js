import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../utils/http.js';

export const collaboratorsRouter = Router();

const ALLOWED_ROLES = new Set(['Emp.Mesa', 'Copa Fina', 'Barman', 'Chefe de Sala', 'Cozinheiro', 'Ajd.Cozinha', 'Logista']);
const ALLOWED_STATUS = new Set(['active', 'inactive', 'paused']);
const ALLOWED_DOCUMENT_TYPES = new Set(['passport', 'citizen_card', 'residence_title']);

function parseId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
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
  const normalized = String(value).trim().replace(',', '.');
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
    ...(input.shortName !== undefined ? { shortName: input.shortName ? String(input.shortName).trim() : null } : {}),
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
    ...(input.photo !== undefined ? { photo: input.photo ? String(input.photo) : null } : {}),
    ...(input.hourlyRate !== undefined ? { hourlyRate } : {}),
    ...(input.includeVat !== undefined ? { includeVat } : {}),
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

function toOutput(row) {
  return { ...row, roles: row.roles.map((item) => item.role) };
}

collaboratorsRouter.get('/', asyncHandler(async (_req, res) => {
  const rows = await prisma.collaborator.findMany({
    orderBy: { createdAt: 'desc' },
    include: { roles: { orderBy: { role: 'asc' } } },
  });
  res.json(rows.map(toOutput));
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
  return res.json(toOutput(row));
}));

collaboratorsRouter.post('/', asyncHandler(async (req, res) => {
  let normalized;
  try {
    normalized = normalizeCollaboratorBody(req.body, { requireCore: true });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const { data, roles } = normalized;
  const row = await prisma.collaborator.create({
    data: { ...data, roles: { create: roles.map((role) => ({ role })) } },
    include: { roles: { orderBy: { role: 'asc' } } },
  });
  return res.status(201).json(toOutput(row));
}));

collaboratorsRouter.put('/:id', asyncHandler(async (req, res) => {
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
  const row = await prisma.collaborator.update({
    where: { id },
    data: {
      ...data,
      ...(hasRoles ? { roles: { deleteMany: {}, create: roles.map((role) => ({ role })) } } : {}),
    },
    include: { roles: { orderBy: { role: 'asc' } } },
  });
  return res.json(toOutput(row));
}));

collaboratorsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;
  await prisma.collaborator.delete({ where: { id } });
  return res.status(204).end();
}));
