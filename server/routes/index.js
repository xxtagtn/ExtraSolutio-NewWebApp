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
import { whatsappRouter } from './whatsapp.js';
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
  'travelExpenseAmount',
  'travelStaffHourlyRate',
  'travelManualAmount',
  'billingStatus',
  'billingPaymentDate',
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

async function normalizeServiceCreate(input) {
  const data = normalizeEvent(input);
  if (!data.clientId) return data;
  const client = await prisma.client.findUnique({
    where: { id: data.clientId },
    select: { minimumHours: true },
  });
  return {
    ...data,
    minimumHoursSnapshot: minimumHoursForEventUpdate(null, client?.minimumHours),
  };
}

async function normalizeServiceUpdate(input, existing) {
  const data = normalizeEvent(input);
  const clientId = data.clientId ?? existing?.clientId;
  if (!clientId) return data;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { minimumHours: true },
  });
  return {
    ...data,
    minimumHoursSnapshot: minimumHoursForEventUpdate(existing, client?.minimumHours),
  };
}

async function normalizeAssignmentCreate(input) {
  const data = normalizeAssignment(input);
  await assertNoAssignmentConflict(prisma, data);
  return data;
}

async function normalizeAssignmentUpdate(input, existing) {
  const data = normalizeAssignment(input);
  if (assignmentConflictNeedsCheck(data, existing)) {
    await assertNoAssignmentConflict(prisma, data, existing);
  }
  return data;
}

apiRouter.use('/auth', authRouter);
apiRouter.use('/qr-check', qrPublicRouter);
apiRouter.use('/calendar-feed', calendarFeedPublicRouter);

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'extrasolutio-api' });
});

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
}));

apiRouter.use('/service-templates', createCrudRouter(prisma.eventTemplate, [], {
  readMiddleware: servicesRead,
  createMiddleware: servicesCreate,
  updateMiddleware: servicesUpdate,
  deleteMiddleware: servicesDelete,
  normalizeCreate: normalizeEventTemplate,
  normalizeUpdate: normalizeEventTemplate,
}));

apiRouter.use('/assignments', createCrudRouter(prisma.eventAssignment, [
  'eventId',
  'collaboratorId',
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
  include: { event: true, collaborator: true },
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
  },
  afterUpdate: async ({ id }) => {
    await ensureQrCodeForAssignmentId(id);
  },
}));

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
  normalizeCreate: normalizeInvoice,
  normalizeUpdate: normalizeInvoice,
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
