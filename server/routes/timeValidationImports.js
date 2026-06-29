import { Buffer } from 'node:buffer';
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../utils/http.js';
import { nextTimeValidationServiceStatus } from '../../src/utils/serviceStatus.js';
import { clientChargeHours, decimalValue } from '../../src/utils/serviceFinance.js';
import { externalCostsTotals } from '../../src/utils/externalCosts.js';
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

function requiredRolesFor(event = {}) {
  try {
    return JSON.parse(event.requiredRoles || '[]');
  } catch {
    return [];
  }
}

function billableStatus(status) {
  return !['missed_justified', 'missed_unjustified', 'cancelled'].includes(String(status || '').toLowerCase());
}

function eventTotals(event, assignments) {
  const roleRates = new Map(requiredRolesFor(event).map((item) => [item.role, decimalValue(item.agreedRate)]));
  let totalRevenue = 0;
  let totalCost = 0;
  let realHours = 0;
  let billableHours = 0;

  for (const assignment of assignments || []) {
    if (!billableStatus(assignment.status)) continue;
    const clientHours = clientChargeHours(
      assignment,
      event.startTime,
      event.endTime,
      event.minimumHoursSnapshot,
    );
    const staffHours = decimalValue(assignment.staffPayableHours || assignment.hoursWorked);
    const rate = decimalValue(assignment.hourlyRate);
    totalRevenue += clientHours * (roleRates.get(assignment.role) || 0);
    totalCost += staffHours * rate;
    realHours += decimalValue(assignment.clientRealHours);
    billableHours += clientHours;
  }

  if (event.travelExpenseEnabled) totalRevenue += decimalValue(event.travelExpenseAmount);
  const externalTotals = externalCostsTotals(event.externalCosts);
  totalRevenue += externalTotals.chargeAmount;
  totalCost += externalTotals.costAmount;
  return {
    totalRevenue: Number(totalRevenue.toFixed(2)),
    totalCost: Number(totalCost.toFixed(2)),
    realHours: Number(realHours.toFixed(2)),
    billableHours: Number(billableHours.toFixed(2)),
  };
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
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { assignments: true },
    });
    if (!event) continue;
    const totals = eventTotals(event, event.assignments);
    const nextStatus = nextTimeValidationServiceStatus(event);
    await prisma.event.update({
      where: { id: eventId },
      data: {
        ...totals,
        status: nextStatus,
      },
    });
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
      select: { id: true, eventId: true },
    });
    if (!existing) continue;
    await prisma.eventAssignment.update({
      where: { id: existing.id },
      data: {
        ...update.data,
        validatedCheckIn: null,
        validatedCheckOut: null,
        validationStatus: 'pending',
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
