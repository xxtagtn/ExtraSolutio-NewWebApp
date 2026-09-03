import { Router } from 'express';
import { prisma } from '../prisma.js';
import {
  createCrudRouter,
  normalizeEvent,
  normalizeInvoice,
  normalizeInvoiceItem,
  normalizePayment,
  normalizeCommunicationLog,
  normalizeAssignment,
  normalizeTransaction,
  normalizeBudget,
  normalizeEventTemplate,
  normalizeClient,
} from './crud.js';
import { authRouter } from './auth.js';
import { backupsRouter } from './backups.js';
import { requireAuth } from '../middleware/auth.js';
import { canViewFinancialData, canViewSensitiveCollaboratorData } from '../security/roles.js';
import { PERMISSIONS } from '../../src/utils/accessPermissions.js';
import { requireAnyPermission, requirePermission } from '../security/permissions.js';
import { usersRouter } from './users.js';
import { collaboratorsRouter } from './collaborators.js';
import { notificationsRouter } from './notifications.js';
import { timeValidationImportsRouter } from './timeValidationImports.js';
import { whatsappRouter, whatsappWebhookRouter } from './whatsapp.js';
import { calendarFeedPublicRouter, calendarFeedRouter } from './calendarFeed.js';
import {
  ensureQrCodeForAssignmentId,
  qrCodesRouter,
  qrPublicRouter,
} from './qrCheckins.js';
import {
  minimumHoursForEventUpdate,
  shouldPropagateMinimumHours,
} from '../utils/minimumHours.js';
import {
  assertNoAssignmentConflict,
  assignmentConflictNeedsCheck,
} from '../utils/assignmentConflict.js';
import { serviceListInclude } from '../utils/listPayloads.js';
import {
  appendEventRateHistory,
  initialEventRateHistory,
  snapshotEventRoleRates,
} from '../utils/eventRateSnapshot.js';
import { asyncHandler } from '../utils/http.js';
import {
  cancelEventDay,
  markEventValidated,
  reactivateEventDay,
  reopenEventValidation,
  setManualEventStatus,
  synchronizeEventWorkflow,
} from '../services/eventWorkflow.js';
import {
  eventDayKey,
  isEventDayCancelled,
} from '../../src/utils/eventCancelledDays.js';
import {
  dueDateFromInvoiceIssue,
  invoiceIsIssued,
} from '../../shared/invoiceLifecycle.js';
import { updateAssignmentsInBulk } from '../services/assignmentBulkUpdate.js';
import {
  partitionAssignmentsOutsideEventRange,
  reconcileEventRangeData,
} from '../utils/eventRangeReconciliation.js';

export const apiRouter = Router();
const CLOSED_EVENT_STATUSES = ['finalized', 'completed', 'invoiced', 'paid'];
const clientsRead = requirePermission(PERMISSIONS.CLIENTS_VIEW);
const clientsCreate = requirePermission(PERMISSIONS.CLIENTS_CREATE);
const clientsUpdate = requirePermission(PERMISSIONS.CLIENTS_UPDATE);
const clientsDelete = requirePermission(PERMISSIONS.CLIENTS_DELETE);
const servicesRead = requirePermission(PERMISSIONS.SERVICES_VIEW);
const servicesCreate = requirePermission(PERMISSIONS.SERVICES_CREATE);
const servicesUpdate = requirePermission(PERMISSIONS.SERVICES_UPDATE);
const servicesDelete = requirePermission(PERMISSIONS.SERVICES_DELETE);
const assignmentsRead = requireAnyPermission([
  PERMISSIONS.SERVICES_VIEW,
  PERMISSIONS.TIME_VALIDATION_VIEW,
  PERMISSIONS.FINANCE_VIEW,
]);
const assignmentsWrite = requireAnyPermission([
  PERMISSIONS.SERVICES_ASSIGN_STAFF,
  PERMISSIONS.TIME_VALIDATION_UPDATE,
]);
const financeRead = requirePermission(PERMISSIONS.FINANCE_VIEW);
const financeUpdatePayments = requirePermission(PERMISSIONS.FINANCE_UPDATE_PAYMENTS);
const financeIssueInvoices = requirePermission(PERMISSIONS.FINANCE_ISSUE_INVOICES);
const budgetsRead = requirePermission(PERMISSIONS.BUDGETS_VIEW);
const budgetsCreate = requirePermission(PERMISSIONS.BUDGETS_CREATE);
const budgetsUpdate = requirePermission(PERMISSIONS.BUDGETS_UPDATE);
const budgetsDelete = requirePermission(PERMISSIONS.BUDGETS_DELETE);
const communicationRead = requirePermission(PERMISSIONS.COMMUNICATION_VIEW);
const communicationSend = requirePermission(PERMISSIONS.COMMUNICATION_SEND);
const communicationQr = requirePermission(PERMISSIONS.COMMUNICATION_MANAGE_QR_CODES);
const financialEventFields = [
  'totalCost',
  'totalRevenue',
  'billingAdjustment',
  'vatRateSnapshot',
  'taxAmount',
  'rateHistory',
  'travelExpenseAmount',
  'travelStaffHourlyRate',
  'travelManualAmount',
  'billingStatus',
  'billingPaymentDate',
  'signaledAt',
  'signaledAmount',
  'paidAmount',
  'remainingPaymentDate',
];
const financialAssignmentFields = [
  'hourlyRate',
  'totalPay',
  'paymentAdjustment',
  'paymentNotes',
  'advancePayments',
  'paymentStatus',
  'paymentDate',
  'paymentDeferredMonth',
];
const sensitiveCollaboratorFields = [
  'nif',
  'iban',
  'birthDate',
  'documentType',
  'documentNumber',
  'documentExpiry',
  'hourlyRate',
  'includeVat',
  'greenReceipt',
];

function stringContains(value) {
  const text = String(value || '').trim();
  return text ? { contains: text } : null;
}

function queryInt(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function queryDate(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) date.setHours(23, 59, 59, 999);
  else date.setHours(0, 0, 0, 0);
  return date;
}

function buildClientWhere(query = {}) {
  const where = {};
  const search = stringContains(query.search || query.q || query.name);
  if (search) {
    where.OR = [
      { name: search },
      { email: search },
      { phone: search },
      { nif: search },
      { representativeName: search },
    ];
  }
  if (query.status) where.status = String(query.status);
  if (query.type) where.type = String(query.type);
  if (query.billingMethod) where.billingMethod = String(query.billingMethod);
  return where;
}

function buildServiceWhere(query = {}) {
  const where = {};
  const and = [];
  const search = stringContains(query.search || query.q || query.name);
  if (search) {
    and.push({
      OR: [
        { name: search },
        { location: search },
        { clientName: search },
        { client: { is: { name: search } } },
      ],
    });
  }
  const clientId = queryInt(query.clientId);
  if (clientId) and.push({ clientId });
  if (query.status) and.push({ status: String(query.status) });
  const from = queryDate(query.from || query.startDate);
  const to = queryDate(query.to || query.endDate, true);
  if (from || to) {
    and.push({
      AND: [
        ...(to ? [{ date: { lte: to } }] : []),
        ...(from ? [{
          OR: [
            { endDate: { gte: from } },
            { endDate: null, date: { gte: from } },
          ],
        }] : []),
      ],
    });
  }
  if (and.length) where.AND = and;
  return where;
}

function buildBudgetWhere(query = {}) {
  const where = {};
  const and = [];
  const search = stringContains(query.search || query.q || query.name);
  if (search) {
    and.push({
      OR: [
        { reference: search },
        { leadName: search },
        { companyName: search },
        { email: search },
        { phone: search },
        { location: search },
        { client: { is: { name: search } } },
      ],
    });
  }
  const clientId = queryInt(query.clientId);
  if (clientId) and.push({ clientId });
  if (query.status) and.push({ status: String(query.status) });
  const from = queryDate(query.from || query.startDate);
  const to = queryDate(query.to || query.endDate, true);
  if (from || to) {
    and.push({ eventDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } });
  }
  if (and.length) where.AND = and;
  return where;
}

function maskClientForRole(client, user) {
  if (!client || canViewSensitiveCollaboratorData(user)) return client;
  return { ...client, nif: null };
}

function maskCollaboratorForRole(collaborator, user) {
  if (!collaborator || canViewSensitiveCollaboratorData(user)) return collaborator;
  const output = { ...collaborator };
  for (const field of sensitiveCollaboratorFields) {
    if (field in output) output[field] = null;
  }
  return output;
}

function maskAssignmentForRole(assignment, user) {
  const output = {
    ...assignment,
    collaborator: maskCollaboratorForRole(assignment.collaborator, user),
  };
  if (!canViewFinancialData(user)) {
    for (const field of financialAssignmentFields) {
      if (field in output) output[field] = null;
    }
  }
  return output;
}

function maskEventForRole(event, user) {
  const output = {
    ...event,
    client: maskClientForRole(event.client, user),
    assignments: Array.isArray(event.assignments)
      ? event.assignments.map((assignment) => maskAssignmentForRole(assignment, user))
      : event.assignments,
  };
  if (!canViewFinancialData(user)) {
    for (const field of financialEventFields) {
      if (field in output) output[field] = null;
    }
  }
  return output;
}

function normalizeWorkLocationName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeWorkLocationInputs(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((item, index) => ({
      name: normalizeWorkLocationName(item?.name ?? item),
      sortOrder: Number.isFinite(Number(item?.sortOrder))
        ? Math.max(0, Math.trunc(Number(item.sortOrder)))
        : index,
    }))
    .filter((item) => {
      const key = item.name.toLocaleLowerCase('pt');
      if (!item.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function normalizeServiceCreate(input) {
  const data = normalizeEvent(input);
  const client = data.clientId ? await prisma.client.findUnique({
    where: { id: data.clientId },
    select: { minimumHours: true, roleRates: true },
  }) : null;
  const requiredRoles = snapshotEventRoleRates(data.requiredRoles, client?.roleRates);
  const workLocations = data.workLocationsEnabled
    ? normalizeWorkLocationInputs(input.workLocations)
    : [];
  return {
    ...data,
    minimumHoursSnapshot: minimumHoursForEventUpdate(null, client?.minimumHours),
    ...(data.requiredRoles !== undefined ? {
      requiredRoles: JSON.stringify(requiredRoles),
      rateHistory: initialEventRateHistory(requiredRoles),
    } : {}),
    ...(workLocations.length ? {
      workLocations: { create: workLocations },
    } : {}),
  };
}

async function normalizeServiceUpdate(input, existing) {
  const data = normalizeEvent(input);
  if (existing?.statusMode === 'manual' && input.status !== undefined && input.statusMode === undefined) {
    data.status = existing.status;
  }
  const clientId = data.clientId !== undefined ? data.clientId : existing?.clientId;
  const client = clientId ? await prisma.client.findUnique({
    where: { id: clientId },
    select: { minimumHours: true, roleRates: true },
  }) : null;
  const clientChanged = Number(existing?.clientId || 0) !== Number(clientId || 0);
  const requiredRoles = data.requiredRoles === undefined
    ? undefined
    : snapshotEventRoleRates(data.requiredRoles, client?.roleRates, existing?.requiredRoles, {
      preserveExisting: !clientChanged,
    });
  return {
    ...data,
    minimumHoursSnapshot: minimumHoursForEventUpdate(existing, client?.minimumHours),
    ...(requiredRoles !== undefined ? {
      requiredRoles: JSON.stringify(requiredRoles),
      rateHistory: appendEventRateHistory(existing?.rateHistory, existing?.requiredRoles, requiredRoles),
    } : {}),
  };
}

async function normalizeAssignmentCreate(input) {
  const data = normalizeAssignment(input);
  await assertAssignmentDayIsActive(data);
  await assertAssignmentWorkLocationIsValid(data);
  await assertNoAssignmentConflict(prisma, data);
  return data;
}

async function normalizeAssignmentUpdate(input, existing) {
  const data = normalizeAssignment(input);
  const merged = { ...existing, ...data };
  await assertAssignmentDayIsActive(merged);
  if (data.workLocationId !== undefined || data.eventId !== undefined) {
    await assertAssignmentWorkLocationIsValid(merged);
  }
  if (assignmentConflictNeedsCheck(data, existing)) {
    await assertNoAssignmentConflict(prisma, data, existing);
  }
  return data;
}

async function updateServiceWithRangeReconciliation({ id, data, existing, include }) {
  const reconciled = reconcileEventRangeData(existing, data);
  return prisma.$transaction(async (tx) => {
    const assignments = await tx.eventAssignment.findMany({ where: { eventId: id } });
    const { removable, blocking } = partitionAssignmentsOutsideEventRange(
      assignments,
      reconciled.nextEvent,
    );
    if (blocking.length) {
      const error = new Error(
        `Não é possível reduzir o período: existem ${blocking.length} colaborador(es) associado(s) aos dias que seriam removidos. Remove esses registos antes de alterar a data final.`,
      );
      error.statusCode = 409;
      error.expose = true;
      throw error;
    }
    if (removable.length) {
      await tx.eventAssignment.deleteMany({
        where: { id: { in: removable.map((assignment) => assignment.id) } },
      });
    }
    return tx.event.update({ where: { id }, data: reconciled.data, include });
  });
}

async function assertAssignmentWorkLocationIsValid(assignment = {}) {
  if (assignment.workLocationId === undefined || assignment.workLocationId === null) return;
  const eventId = Number(assignment.eventId);
  const workLocationId = Number(assignment.workLocationId);
  if (!Number.isInteger(eventId) || eventId <= 0 || !Number.isInteger(workLocationId) || workLocationId <= 0) {
    const error = new Error('Local de Trabalho inválido.');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }
  const [event, workLocation] = await Promise.all([
    prisma.event.findUnique({
      where: { id: eventId },
      select: { workLocationsEnabled: true },
    }),
    prisma.eventWorkLocation.findUnique({
      where: { id: workLocationId },
      select: { eventId: true },
    }),
  ]);
  if (!event?.workLocationsEnabled || Number(workLocation?.eventId) !== eventId) {
    const error = new Error('O Local de Trabalho selecionado não pertence a este evento.');
    error.statusCode = 409;
    error.expose = true;
    throw error;
  }
}

async function assertAssignmentDayIsActive(assignment = {}) {
  const eventId = Number(assignment.eventId);
  if (!Number.isInteger(eventId) || eventId <= 0) return;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      date: true,
      endDate: true,
      isContinuous: true,
      cancelledDays: true,
    },
  });
  if (!event) return;
  const day = eventDayKey(assignment.assignmentDate || event.date);
  if (!isEventDayCancelled(event, day)) return;
  const error = new Error('Este dia do evento está cancelado. Reativa o dia antes de atribuir colaboradores.');
  error.statusCode = 409;
  error.expose = true;
  throw error;
}

async function synchronizeEventAfterAssignmentMutation(eventId, { recalculateTotals = false } = {}) {
  await synchronizeEventWorkflow(prisma, eventId, { recalculateTotals });
}

apiRouter.use('/auth', authRouter);
apiRouter.use('/qr-check', qrPublicRouter);
apiRouter.use('/calendar-feed', calendarFeedPublicRouter);

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'extrasolutio-api' });
});

apiRouter.use('/whatsapp', whatsappWebhookRouter);

apiRouter.use(requireAuth);

apiRouter.use('/users', usersRouter);
apiRouter.use('/backups', backupsRouter);
apiRouter.use('/notifications', notificationsRouter);
apiRouter.use('/calendar-feed', requirePermission(PERMISSIONS.CALENDAR_VIEW), calendarFeedRouter);

apiRouter.use('/collaborators', collaboratorsRouter);
apiRouter.use('/time-validation-imports', requirePermission(PERMISSIONS.TIME_VALIDATION_IMPORT), timeValidationImportsRouter);
apiRouter.use('/whatsapp', communicationSend, whatsappRouter);
apiRouter.use('/qr-codes', communicationQr, qrCodesRouter);

apiRouter.use('/clients', createCrudRouter(prisma.client, [
  'name',
  'email',
  'phone',
  'nif',
  'address',
  'postalCode',
  'city',
  'contactPerson',
  'representativeName',
  'type',
  'billingMethod',
  'billingCustomRule',
  'paymentTerm',
  'paymentTermDays',
  'minimumHours',
  'roleRates',
  'roleRatesUpdatedAt',
  'defaultUniform',
  'defaultOnsiteContactName',
  'defaultOnsiteContactPhone',
  'prepaymentPercent',
  'prepaymentRemainingDaysBefore',
  'status',
  'notes',
], {
  readMiddleware: clientsRead,
  createMiddleware: clientsCreate,
  updateMiddleware: clientsUpdate,
  deleteMiddleware: clientsDelete,
  buildWhere: buildClientWhere,
  buildOrderBy: () => ({ name: 'asc' }),
  normalizeCreate: normalizeClient,
  normalizeUpdate: normalizeClient,
  loadExistingForUpdate: true,
  afterUpdate: async ({ id, row, existing }) => {
    if (!shouldPropagateMinimumHours(existing, row)) return;
    await prisma.event.updateMany({
      where: {
        clientId: id,
        status: { notIn: CLOSED_EVENT_STATUSES },
      },
      data: {
        minimumHoursSnapshot: row.minimumHours,
      },
    });
  },
}));

const workflowWrite = requireAnyPermission([
  PERMISSIONS.SERVICES_UPDATE,
  PERMISSIONS.TIME_VALIDATION_UPDATE,
]);

function workflowEventId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ message: 'ID inválido.' });
    return null;
  }
  return id;
}

apiRouter.post('/services/:id/workflow/synchronize', workflowWrite, asyncHandler(async (req, res) => {
  const id = workflowEventId(req, res);
  if (!id) return;
  const event = await synchronizeEventWorkflow(prisma, id, {
    recalculateTotals: Boolean(req.body?.recalculateTotals),
  });
  if (!event) return res.status(404).json({ message: 'Evento/Serviço não encontrado.' });
  return res.json(maskEventForRole(event, req.user));
}));

apiRouter.post('/services/:id/workflow/status', servicesUpdate, asyncHandler(async (req, res) => {
  const id = workflowEventId(req, res);
  if (!id) return;
  const event = await setManualEventStatus(prisma, id, req.body?.status, {
    notes: req.body?.notes,
  });
  if (!event) return res.status(404).json({ message: 'Evento/Serviço não encontrado.' });
  return res.json(maskEventForRole(event, req.user));
}));

apiRouter.post('/services/:id/workflow/finalize', workflowWrite, asyncHandler(async (req, res) => {
  const id = workflowEventId(req, res);
  if (!id) return;
  const event = await markEventValidated(prisma, id, req.body?.notes);
  if (!event) return res.status(404).json({ message: 'Evento/Serviço não encontrado.' });
  return res.json(maskEventForRole(event, req.user));
}));

apiRouter.post('/services/:id/workflow/reopen', workflowWrite, (req, res, next) => (
  req.body?.assignmentIds !== undefined ? assignmentsWrite(req, res, next) : next()
), asyncHandler(async (req, res) => {
  const id = workflowEventId(req, res);
  if (!id) return;
  const event = await reopenEventValidation(prisma, id, req.body?.notes, {
    assignmentIds: req.body?.assignmentIds,
  });
  if (!event) return res.status(404).json({ message: 'Evento/Serviço não encontrado.' });
  return res.json(maskEventForRole(event, req.user));
}));

apiRouter.post('/services/:id/days/:date/cancel', servicesUpdate, asyncHandler(async (req, res) => {
  const id = workflowEventId(req, res);
  if (!id) return;
  const event = await cancelEventDay(prisma, id, req.params.date);
  if (!event) return res.status(404).json({ message: 'Evento/Serviço não encontrado.' });
  return res.json(maskEventForRole(event, req.user));
}));

apiRouter.post('/services/:id/days/:date/reactivate', servicesUpdate, asyncHandler(async (req, res) => {
  const id = workflowEventId(req, res);
  if (!id) return;
  const event = await reactivateEventDay(prisma, id, req.params.date);
  if (!event) return res.status(404).json({ message: 'Evento/Serviço não encontrado.' });
  return res.json(maskEventForRole(event, req.user));
}));

apiRouter.get('/services/:id/work-locations', servicesRead, asyncHandler(async (req, res) => {
  const id = workflowEventId(req, res);
  if (!id) return;
  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!event) return res.status(404).json({ message: 'Evento/Serviço não encontrado.' });
  const rows = await prisma.eventWorkLocation.findMany({
    where: { eventId: id },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  return res.json(rows);
}));

apiRouter.post('/services/:id/work-locations', servicesUpdate, asyncHandler(async (req, res) => {
  const id = workflowEventId(req, res);
  if (!id) return;
  const name = normalizeWorkLocationName(req.body?.name);
  if (!name) return res.status(400).json({ message: 'Indica o nome do Local de Trabalho.' });
  const event = await prisma.event.findUnique({
    where: { id },
    select: {
      id: true,
      workLocationsEnabled: true,
      workLocations: { select: { name: true, sortOrder: true } },
    },
  });
  if (!event) return res.status(404).json({ message: 'Evento/Serviço não encontrado.' });
  if (!event.workLocationsEnabled) {
    return res.status(409).json({ message: 'Ativa primeiro os Locais/Áreas de Trabalho neste evento.' });
  }
  const duplicate = event.workLocations.some(
    (item) => item.name.toLocaleLowerCase('pt') === name.toLocaleLowerCase('pt'),
  );
  if (duplicate) return res.status(409).json({ message: 'Este Local de Trabalho já existe no evento.' });
  const maxSortOrder = event.workLocations.reduce(
    (maximum, item) => Math.max(maximum, Number(item.sortOrder) || 0),
    -1,
  );
  const row = await prisma.eventWorkLocation.create({
    data: {
      eventId: id,
      name,
      sortOrder: maxSortOrder + 1,
    },
  });
  return res.status(201).json(row);
}));

apiRouter.put('/work-locations/:id', servicesUpdate, asyncHandler(async (req, res) => {
  const id = workflowEventId(req, res);
  if (!id) return;
  const existing = await prisma.eventWorkLocation.findUnique({
    where: { id },
    select: { id: true, eventId: true },
  });
  if (!existing) return res.status(404).json({ message: 'Local de Trabalho não encontrado.' });
  const name = normalizeWorkLocationName(req.body?.name);
  if (!name) return res.status(400).json({ message: 'Indica o nome do Local de Trabalho.' });
  const duplicate = await prisma.eventWorkLocation.findFirst({
    where: {
      eventId: existing.eventId,
      id: { not: id },
    },
    select: { id: true, name: true },
  });
  const allLocations = await prisma.eventWorkLocation.findMany({
    where: { eventId: existing.eventId, id: { not: id } },
    select: { id: true, name: true },
  });
  if (duplicate && allLocations.some(
    (item) => item.name.toLocaleLowerCase('pt') === name.toLocaleLowerCase('pt'),
  )) {
    return res.status(409).json({ message: 'Este Local de Trabalho já existe no evento.' });
  }
  const row = await prisma.eventWorkLocation.update({
    where: { id },
    data: { name },
  });
  return res.json(row);
}));

apiRouter.delete('/work-locations/:id', servicesUpdate, asyncHandler(async (req, res) => {
  const id = workflowEventId(req, res);
  if (!id) return;
  const existing = await prisma.eventWorkLocation.findUnique({
    where: { id },
    include: { _count: { select: { assignments: true } } },
  });
  if (!existing) return res.status(404).json({ message: 'Local de Trabalho não encontrado.' });
  if (existing._count.assignments > 0) {
    return res.status(409).json({
      message: 'Este local ainda tem colaboradores atribuídos. Altera primeiro essas alocações.',
    });
  }
  await prisma.eventWorkLocation.delete({ where: { id } });
  return res.status(204).end();
}));

apiRouter.put('/services/:id/work-locations/reorder', servicesUpdate, asyncHandler(async (req, res) => {
  const id = workflowEventId(req, res);
  if (!id) return;
  const requestedIds = Array.isArray(req.body?.ids)
    ? req.body.ids.map(Number).filter((value) => Number.isInteger(value) && value > 0)
    : [];
  const existing = await prisma.eventWorkLocation.findMany({
    where: { eventId: id },
    select: { id: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  const existingIds = existing.map((item) => item.id);
  if (
    requestedIds.length !== existingIds.length
    || new Set(requestedIds).size !== requestedIds.length
    || existingIds.some((value) => !requestedIds.includes(value))
  ) {
    return res.status(400).json({ message: 'A ordem indicada não corresponde aos locais deste evento.' });
  }
  await prisma.$transaction(
    requestedIds.map((workLocationId, sortOrder) => prisma.eventWorkLocation.update({
      where: { id: workLocationId },
      data: { sortOrder },
    })),
  );
  const rows = await prisma.eventWorkLocation.findMany({
    where: { eventId: id },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  return res.json(rows);
}));

apiRouter.use('/services', createCrudRouter(prisma.event, [], {
  include: serviceListInclude,
  readMiddleware: servicesRead,
  createMiddleware: servicesCreate,
  updateMiddleware: servicesUpdate,
  deleteMiddleware: servicesDelete,
  buildWhere: buildServiceWhere,
  buildOrderBy: () => ({ date: 'desc' }),
  serializeRow: (row, req) => maskEventForRole(row, req.user),
  normalizeCreate: normalizeServiceCreate,
  normalizeUpdate: normalizeServiceUpdate,
  loadExistingForUpdate: true,
  performUpdate: updateServiceWithRangeReconciliation,
  afterUpdate: async ({ id }) => {
    await synchronizeEventWorkflow(prisma, id, { recalculateTotals: true });
  },
}));

apiRouter.use('/service-templates', createCrudRouter(prisma.eventTemplate, [], {
  readMiddleware: servicesRead,
  createMiddleware: servicesCreate,
  updateMiddleware: servicesUpdate,
  deleteMiddleware: servicesDelete,
  normalizeCreate: normalizeEventTemplate,
  normalizeUpdate: normalizeEventTemplate,
}));

apiRouter.put('/assignments/bulk', assignmentsWrite, asyncHandler(async (req, res) => {
  const rows = await updateAssignmentsInBulk({
    prisma,
    updates: req.body?.updates,
    include: { event: true, collaborator: true, workLocation: true },
    normalizeUpdate: normalizeAssignmentUpdate,
    synchronizeEvent: (eventId, client) => synchronizeEventWorkflow(client, eventId, {
      recalculateTotals: true,
    }),
  });
  res.json(rows.map((row) => maskAssignmentForRole(row, req.user)));
}));

apiRouter.use('/assignments', createCrudRouter(prisma.eventAssignment, [
  'eventId',
  'collaboratorId',
  'workLocationId',
  'role',
  'plannedCheckIn',
  'plannedCheckOut',
  'checkIn',
  'checkOut',
  'hoursWorked',
  'hourlyRate',
  'totalPay',
  'paymentAdjustment',
  'paymentNotes',
  'advancePayments',
  'status',
], {
  include: { event: true, collaborator: true, workLocation: true },
  readMiddleware: assignmentsRead,
  createMiddleware: assignmentsWrite,
  updateMiddleware: assignmentsWrite,
  deleteMiddleware: assignmentsWrite,
  serializeRow: (row, req) => maskAssignmentForRole(row, req.user),
  normalizeCreate: normalizeAssignmentCreate,
  normalizeUpdate: normalizeAssignmentUpdate,
  loadExistingForUpdate: true,
  afterCreate: async ({ row }) => {
    await ensureQrCodeForAssignmentId(row.id);
    await synchronizeEventAfterAssignmentMutation(row.eventId, {
      recalculateTotals: true,
    });
  },
  afterUpdate: async ({ id, row, existing }) => {
    await ensureQrCodeForAssignmentId(id);
    await synchronizeEventAfterAssignmentMutation(row.eventId, {
      recalculateTotals: true,
    });
    if (Number(existing?.eventId) !== Number(row.eventId)) {
      await synchronizeEventAfterAssignmentMutation(existing?.eventId, {
        recalculateTotals: true,
      });
    }
  },
  loadExistingForDelete: true,
  afterDelete: async ({ existing }) => {
    await synchronizeEventAfterAssignmentMutation(existing?.eventId, {
      recalculateTotals: true,
    });
  },
}));

async function normalizeInvoiceLifecycle(input, existing = null) {
  const normalized = normalizeInvoice(input);
  const nextStatus = String(input?.status ?? existing?.status ?? 'draft').trim().toLowerCase();
  const wasIssued = invoiceIsIssued(existing);
  const willBeIssued = !['draft', 'cancelled', 'void'].includes(nextStatus);

  if (!willBeIssued) {
    return {
      ...normalized,
      status: nextStatus,
      dueDate: null,
    };
  }

  const suppliedIssueDate = input?.issueDate ? new Date(input.issueDate) : null;
  const issueDate = suppliedIssueDate && !Number.isNaN(suppliedIssueDate.getTime())
    ? suppliedIssueDate
    : wasIssued && existing?.issueDate
      ? existing.issueDate
      : new Date();
  const clientId = normalized.clientId ?? existing?.clientId;
  const client = clientId
    ? await prisma.client.findUnique({ where: { id: Number(clientId) } })
    : null;
  if (!client?.billingMethod || !client?.paymentTerm) {
    const error = new Error('Configura o método de faturação e o prazo de pagamento do cliente antes de emitir a fatura.');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }
  const dueDate = dueDateFromInvoiceIssue(issueDate, client);
  if (!dueDate) {
    const error = new Error('O prazo de pagamento configurado no cliente não é válido.');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }

  return {
    ...normalized,
    status: nextStatus,
    issueDate,
    dueDate,
  };
}

apiRouter.use('/invoices', createCrudRouter(prisma.invoice, [
  'number',
  'clientId',
  'eventId',
  'dueDate',
  'subtotal',
  'taxRate',
  'taxAmount',
  'total',
  'status',
  'notes',
], {
  include: { client: true, event: true, items: true },
  readMiddleware: financeRead,
  createMiddleware: financeIssueInvoices,
  updateMiddleware: financeIssueInvoices,
  deleteMiddleware: financeIssueInvoices,
  normalizeCreate: normalizeInvoiceLifecycle,
  normalizeUpdate: normalizeInvoiceLifecycle,
  loadExistingForUpdate: true,
}));

apiRouter.use('/invoice-items', createCrudRouter(prisma.invoiceItem, [
  'invoiceId',
  'description',
  'quantity',
  'unitPrice',
  'total',
], {
  readMiddleware: financeRead,
  createMiddleware: financeIssueInvoices,
  updateMiddleware: financeIssueInvoices,
  deleteMiddleware: financeIssueInvoices,
  normalizeCreate: normalizeInvoiceItem,
  normalizeUpdate: normalizeInvoiceItem,
}));

apiRouter.use('/payments', createCrudRouter(prisma.payment, [], {
  include: { collaborator: true },
  readMiddleware: financeRead,
  createMiddleware: financeUpdatePayments,
  updateMiddleware: financeUpdatePayments,
  deleteMiddleware: financeUpdatePayments,
  normalizeCreate: normalizePayment,
  normalizeUpdate: normalizePayment,
}));

apiRouter.use('/communication-logs', createCrudRouter(prisma.communicationLog, [], {
  readMiddleware: communicationRead,
  createMiddleware: communicationSend,
  updateMiddleware: communicationSend,
  deleteMiddleware: communicationSend,
  normalizeCreate: normalizeCommunicationLog,
  normalizeUpdate: normalizeCommunicationLog,
  orderBy: { createdAt: 'desc' },
}));

apiRouter.use('/transactions', createCrudRouter(prisma.transaction, [
  'type',
  'category',
  'amount',
  'description',
  'date',
  'referenceId',
], {
  readMiddleware: financeRead,
  createMiddleware: financeUpdatePayments,
  updateMiddleware: financeUpdatePayments,
  deleteMiddleware: financeUpdatePayments,
  normalizeCreate: normalizeTransaction,
  normalizeUpdate: normalizeTransaction,
}));

apiRouter.use('/budgets', createCrudRouter(prisma.budget, [], {
  include: { client: true },
  readMiddleware: budgetsRead,
  createMiddleware: budgetsCreate,
  updateMiddleware: budgetsUpdate,
  deleteMiddleware: budgetsDelete,
  buildWhere: buildBudgetWhere,
  buildOrderBy: () => ({ createdAt: 'desc' }),
  normalizeCreate: normalizeBudget,
  normalizeUpdate: normalizeBudget,
}));
