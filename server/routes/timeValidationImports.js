import { Buffer } from 'node:buffer';
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../utils/http.js';
import { validationStatusAfterClientImport } from '../../src/utils/hourValidationStatus.js';
import { synchronizeEventWorkflow } from '../services/eventWorkflow.js';
import {
  assignmentUpdateFromPreviewRow,
  buildImportPreview,
  normalizeImportMappings,
  parseTimeValidationWorkbook,
} from '../utils/timeValidationExcelImport.js';

const SOURCE = 'time_validation_excel';

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
  const [services, collaborators, mappings] = await Promise.all([
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
  ]);
  return { services, collaborators, mappings };
}

async function saveMappings(mappings = []) {
  const normalized = normalizeImportMappings(mappings, SOURCE);
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

async function updateAffectedEvents(eventIds = []) {
  const uniqueIds = [...new Set(eventIds.map(Number).filter(Boolean))];
  for (const eventId of uniqueIds) {
    await synchronizeEventWorkflow(prisma, eventId, { recalculateTotals: true });
  }
}

timeValidationImportsRouter.post('/preview', asyncHandler(async (req, res) => {
  const buffer = base64ToBuffer(req.body?.fileData);
  const parsed = parseTimeValidationWorkbook(buffer);
  const context = await importContext();
  const preview = buildImportPreview(parsed.rows, {
    ...context,
    mappings: [...context.mappings, ...(req.body?.mappings || [])],
  });

  res.json({
    source: SOURCE,
    fileName: req.body?.fileName || '',
    sheetName: parsed.sheetName,
    headerRowNumber: parsed.headerRowNumber,
    columns: parsed.columns,
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

  await saveMappings(req.body?.mappings || []);

  const eventIds = [];
  for (const row of importableRows) {
    const update = assignmentUpdateFromPreviewRow(row);
    const existing = await prisma.eventAssignment.findUnique({
      where: { id: update.assignmentId },
      select: { id: true, eventId: true, validationStatus: true },
    });
    if (!existing) continue;
    await prisma.eventAssignment.update({
      where: { id: existing.id },
      data: {
        ...update.data,
        validatedCheckIn: null,
        validatedCheckOut: null,
        validationStatus: validationStatusAfterClientImport(existing.validationStatus),
      },
    });
    eventIds.push(existing.eventId);
  }

  await updateAffectedEvents(eventIds);

  res.json({
    imported: importableRows.length,
    skipped: rows.length - importableRows.length,
    eventIds: [...new Set(eventIds)],
  });
}));
