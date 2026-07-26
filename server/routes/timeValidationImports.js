import { Buffer } from 'node:buffer';
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../utils/http.js';
import { validationStatusAfterClientImport } from '../../src/utils/hourValidationStatus.js';
import {
  reopenEventValidation,
  synchronizeEventWorkflow,
} from '../services/eventWorkflow.js';
import {
  assignmentUpdateFromPreviewRow,
  buildImportPreview,
  EVENT_NAME_MAPPING_PREFIX,
  normalizeImportMappings,
  parseTimeValidationWorkbook,
} from '../utils/timeValidationExcelImport.js';

const SOURCE = 'time_validation_excel';
const GLOBAL_SCOPE = 'global';
const CLIENT_SCOPE_PREFIX = 'client:';

export const timeValidationImportsRouter = Router();

function base64ToBuffer(fileData = '') {
  const text = String(fileData || '');
  const base64 = text.includes(',') ? text.split(',').pop() : text;
  if (!base64) {
    const error = new Error('Ficheiro Excel em falta.');
    error.statusCode = 422;
    throw error;
  }
  return Buffer.from(base64, 'base64');
}

async function importContext() {
  const [services, collaborators, mappings, clients] = await Promise.all([
    prisma.event.findMany({
      include: {
        client: true,
        assignments: { include: { collaborator: true } },
      },
    }),
    prisma.collaborator.findMany({
      select: { id: true, name: true, shortName: true, nif: true },
    }),
    prisma.importMapping.findMany({
      where: { source: SOURCE },
      orderBy: [{ field: 'asc' }, { externalValue: 'asc' }],
    }),
    prisma.client.findMany({
      select: { id: true, name: true, status: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  return { services, collaborators, mappings, clients };
}

function profileScopeKey(clientId) {
  const parsed = Number(clientId);
  return Number.isInteger(parsed) && parsed > 0 ? `${CLIENT_SCOPE_PREFIX}${parsed}` : GLOBAL_SCOPE;
}

function mappingsForProfile(mappings = [], clientId = null) {
  const scopeKey = profileScopeKey(clientId);
  const globalMappings = mappings.filter((mapping) => mapping.scopeKey === GLOBAL_SCOPE);
  if (scopeKey === GLOBAL_SCOPE) return globalMappings;
  const clientMappings = mappings.filter((mapping) => mapping.scopeKey === scopeKey);
  return [...globalMappings, ...clientMappings];
}

function servicesForProfile(services = [], clientId = null) {
  const parsed = Number(clientId);
  if (!Number.isInteger(parsed) || parsed <= 0) return services;
  return services.filter((event) => Number(event.clientId || event.client?.id) === parsed);
}

function detectedClientId(preview, services = []) {
  const eventClients = new Map(services.map((event) => [Number(event.id), Number(event.clientId || event.client?.id)]));
  const ids = new Set((preview?.rows || [])
    .map((row) => eventClients.get(Number(row.eventId)))
    .filter((id) => Number.isInteger(id) && id > 0));
  return ids.size === 1 ? [...ids][0] : null;
}

function profileDetails(clientId, context, autoDetected = false) {
  const parsed = Number(clientId);
  const client = context.clients.find((item) => item.id === parsed) || null;
  const scopeKey = profileScopeKey(parsed);
  return {
    clientId: client?.id || null,
    clientName: client?.name || '',
    scopeKey,
    autoDetected,
    savedMappings: context.mappings.filter((mapping) => mapping.scopeKey === scopeKey).length,
  };
}

async function reusableMappings(mappings = [], scopeKey = GLOBAL_SCOPE) {
  const normalized = normalizeImportMappings(mappings, SOURCE, scopeKey);
  const eventIds = normalized
    .filter((mapping) => mapping.field === 'session' && /^\d+$/.test(mapping.internalValue))
    .map((mapping) => Number(mapping.internalValue));
  const events = eventIds.length
    ? await prisma.event.findMany({
      where: { id: { in: [...new Set(eventIds)] } },
      select: { id: true, name: true },
    })
    : [];
  const eventsById = new Map(events.map((event) => [event.id, event]));
  return normalized.map((mapping) => {
    if (mapping.field !== 'session' || !/^\d+$/.test(mapping.internalValue)) return mapping;
    const event = eventsById.get(Number(mapping.internalValue));
    return event?.name
      ? { ...mapping, internalValue: `${EVENT_NAME_MAPPING_PREFIX}${event.name}` }
      : mapping;
  });
}

async function saveMappings(mappings = [], clientId = null) {
  const normalized = await reusableMappings(mappings, profileScopeKey(clientId));
  await Promise.all(normalized.map((mapping) => prisma.importMapping.upsert({
    where: {
      source_scopeKey_field_externalValue: {
        source: mapping.source,
        scopeKey: mapping.scopeKey,
        field: mapping.field,
        externalValue: mapping.externalValue,
      },
    },
    create: mapping,
    update: { internalValue: mapping.internalValue },
  })));
}

const FINALIZED_EVENT_STATUSES = new Set(['finalized', 'completed', 'invoiced', 'paid']);

async function updateAffectedEvents(eventIds = [], revalidationEventIds = []) {
  const uniqueIds = [...new Set(eventIds.map(Number).filter(Boolean))];
  const revalidationIds = new Set(revalidationEventIds.map(Number).filter(Boolean));
  const events = uniqueIds.length
    ? await prisma.event.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, status: true, notes: true },
    })
    : [];
  const eventsById = new Map(events.map((event) => [event.id, event]));

  for (const eventId of uniqueIds) {
    const event = eventsById.get(eventId);
    const status = String(event?.status || '').trim().toLowerCase();
    if (event && revalidationIds.has(eventId) && FINALIZED_EVENT_STATUSES.has(status)) {
      await reopenEventValidation(prisma, eventId, event.notes);
    }
    await synchronizeEventWorkflow(prisma, eventId, { recalculateTotals: true });
  }
}

timeValidationImportsRouter.post('/preview', asyncHandler(async (req, res) => {
  const buffer = base64ToBuffer(req.body?.fileData);
  const parsed = parseTimeValidationWorkbook(buffer, {
    fileName: req.body?.fileName || '',
  });
  const context = await importContext();
  const requestedClientId = Number(req.body?.profileClientId) || null;
  const buildForClient = (clientId) => buildImportPreview(parsed.rows, {
    ...context,
    services: servicesForProfile(context.services, clientId),
    mappings: [
      ...mappingsForProfile(context.mappings, clientId),
      ...(req.body?.mappings || []),
    ],
  });
  let appliedClientId = requestedClientId;
  let preview = buildForClient(appliedClientId);
  let autoDetected = false;

  if (!appliedClientId) {
    const inferredClientId = detectedClientId(preview, context.services);
    if (inferredClientId) {
      appliedClientId = inferredClientId;
      autoDetected = true;
      preview = buildForClient(appliedClientId);
    }
  }

  res.json({
    source: SOURCE,
    fileName: req.body?.fileName || '',
    sheetName: parsed.sheetName,
    headerRowNumber: parsed.headerRowNumber,
    columns: parsed.columns,
    profile: profileDetails(appliedClientId, context, autoDetected),
    ...preview,
  });
}));

timeValidationImportsRouter.post('/commit', asyncHandler(async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const importableRows = rows.filter((row) => (
    ['valid', 'warning'].includes(row.status)
    && Number(row.assignmentId)
    && row.clientCheckIn
    && row.clientCheckOut
  ));

  await saveMappings(req.body?.mappings || [], req.body?.profileClientId);

  const rowsByAssignmentId = new Map(importableRows.map((row) => [Number(row.assignmentId), row]));
  const assignmentIds = [...rowsByAssignmentId.keys()];
  const existingAssignments = assignmentIds.length
    ? await prisma.eventAssignment.findMany({
      where: { id: { in: assignmentIds } },
      select: {
        id: true,
        eventId: true,
        clientCheckIn: true,
        clientCheckOut: true,
        validatedCheckIn: true,
        validatedCheckOut: true,
        validationStatus: true,
      },
    })
    : [];
  const existingById = new Map(existingAssignments.map((assignment) => [assignment.id, assignment]));
  const updates = [...rowsByAssignmentId.entries()]
    .map(([assignmentId, row]) => {
      const existing = existingById.get(assignmentId);
      if (!existing) return null;
      const update = assignmentUpdateFromPreviewRow(row);
      const clientTimesChanged = (
        String(existing.clientCheckIn || '') !== String(update.data.clientCheckIn || '')
        || String(existing.clientCheckOut || '') !== String(update.data.clientCheckOut || '')
      );
      const preserveValidation = (
        !clientTimesChanged
        && existing.validationStatus === 'validated'
        && existing.validatedCheckIn === update.data.clientCheckIn
        && existing.validatedCheckOut === update.data.clientCheckOut
      );
      return {
        existing,
        requiresRevalidation: !preserveValidation,
        data: {
          ...update.data,
          validatedCheckIn: preserveValidation ? existing.validatedCheckIn : null,
          validatedCheckOut: preserveValidation ? existing.validatedCheckOut : null,
          validationStatus: preserveValidation
            ? 'validated'
            : validationStatusAfterClientImport(existing.validationStatus),
        },
      };
    })
    .filter(Boolean);

  const updatedAssignments = updates.length
    ? await prisma.$transaction(updates.map(({ existing, data }) => prisma.eventAssignment.update({
      where: { id: existing.id },
      data,
      select: {
        id: true,
        eventId: true,
        clientCheckIn: true,
        clientCheckOut: true,
        clientRealHours: true,
        clientBillableHours: true,
        staffPayableHours: true,
        validatedCheckIn: true,
        validatedCheckOut: true,
        validationStatus: true,
      },
    })))
    : [];
  const eventIds = updatedAssignments.map((assignment) => assignment.eventId);
  const revalidationEventIds = updates
    .filter((update) => update.requiresRevalidation)
    .map((update) => update.existing.eventId);

  await updateAffectedEvents(eventIds, revalidationEventIds);

  res.json({
    imported: updatedAssignments.length,
    skipped: rows.length - updatedAssignments.length,
    assignments: updatedAssignments,
    assignmentIds: updatedAssignments.map((assignment) => assignment.id),
    eventIds: [...new Set(eventIds)],
  });
}));
