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
import { requireAuth, requireRole } from '../middleware/auth.js';
import { canViewFinancialData, canViewSensitiveCollaboratorData, ROLES } from '../security/roles.js';
import { usersRouter } from './users.js';
import { collaboratorsRouter } from './collaborators.js';
import { notificationsRouter } from './notifications.js';
import { timeValidationImportsRouter } from './timeValidationImports.js';
import { whatsappRouter } from './whatsapp.js';
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
const managementAccess = requireRole(ROLES.MANAGEMENT);
const financeAccess = requireRole(ROLES.MANAGEMENT, ROLES.FINANCE);
const operationsAccess = requireRole(ROLES.MANAGEMENT, ROLES.OPERATIONS);
const communicationAccess = requireRole(ROLES.MANAGEMENT, ROLES.OPERATIONS);
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

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'extrasolutio-api' });
});

apiRouter.use(requireAuth);

apiRouter.use('/users', usersRouter);
apiRouter.use('/backups', backupsRouter);
apiRouter.use('/notifications', notificationsRouter);

apiRouter.use('/collaborators', collaboratorsRouter);
apiRouter.use('/time-validation-imports', operationsAccess, timeValidationImportsRouter);
apiRouter.use('/whatsapp', communicationAccess, whatsappRouter);

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
  readMiddleware: financeAccess,
  writeMiddleware: managementAccess,
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
  writeMiddleware: operationsAccess,
  serializeRow: (row, req) => maskEventForRole(row, req.user),
  normalizeCreate: normalizeServiceCreate,
  normalizeUpdate: normalizeServiceUpdate,
  loadExistingForUpdate: true,
}));

apiRouter.use('/service-templates', createCrudRouter(prisma.eventTemplate, [], {
  writeMiddleware: operationsAccess,
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
  writeMiddleware: operationsAccess,
  serializeRow: (row, req) => maskAssignmentForRole(row, req.user),
  normalizeCreate: normalizeAssignmentCreate,
  normalizeUpdate: normalizeAssignmentUpdate,
  loadExistingForUpdate: true,
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
  readMiddleware: financeAccess,
  writeMiddleware: financeAccess,
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
  readMiddleware: financeAccess,
  writeMiddleware: financeAccess,
  normalizeCreate: normalizeInvoiceItem,
  normalizeUpdate: normalizeInvoiceItem,
}));

apiRouter.use('/payments', createCrudRouter(prisma.payment, [], {
  include: { collaborator: true },
  readMiddleware: financeAccess,
  writeMiddleware: financeAccess,
  normalizeCreate: normalizePayment,
  normalizeUpdate: normalizePayment,
}));

apiRouter.use('/communication-logs', createCrudRouter(prisma.communicationLog, [], {
  writeMiddleware: communicationAccess,
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
  readMiddleware: financeAccess,
  writeMiddleware: financeAccess,
  normalizeCreate: normalizeTransaction,
  normalizeUpdate: normalizeTransaction,
}));

apiRouter.use('/budgets', createCrudRouter(prisma.budget, [], {
  include: { client: true },
  readMiddleware: managementAccess,
  writeMiddleware: managementAccess,
  normalizeCreate: normalizeBudget,
  normalizeUpdate: normalizeBudget,
}));
