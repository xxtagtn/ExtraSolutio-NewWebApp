import { Router } from 'express';
import { prisma } from '../prisma.js';
import {
  createCrudRouter,
  normalizeEvent,
  normalizeInvoice,
  normalizeInvoiceItem,
  normalizePayment,
  normalizeAssignment,
  normalizeTransaction,
  normalizeBudget,
  normalizeEventTemplate,
  normalizeClient,
} from './crud.js';
import { authRouter } from './auth.js';
import { requireAuth } from '../middleware/auth.js';
import { usersRouter } from './users.js';
import { collaboratorsRouter } from './collaborators.js';
import { notificationsRouter } from './notifications.js';
import {
  minimumHoursForEventUpdate,
  shouldPropagateMinimumHours,
} from '../utils/minimumHours.js';
import {
  assertNoAssignmentConflict,
  assignmentConflictNeedsCheck,
} from '../utils/assignmentConflict.js';

export const apiRouter = Router();
const CLOSED_EVENT_STATUSES = ['finalized', 'completed', 'invoiced', 'paid'];

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
apiRouter.use('/notifications', notificationsRouter);

apiRouter.use('/collaborators', collaboratorsRouter);

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
  'status',
  'notes',
], {
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
  include: {
    client: true,
    assignments: { include: { collaborator: true } },
  },
  normalizeCreate: normalizeServiceCreate,
  normalizeUpdate: normalizeServiceUpdate,
  loadExistingForUpdate: true,
}));

apiRouter.use('/service-templates', createCrudRouter(prisma.eventTemplate, [], {
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
  normalizeCreate: normalizeInvoiceItem,
  normalizeUpdate: normalizeInvoiceItem,
}));

apiRouter.use('/payments', createCrudRouter(prisma.payment, [], {
  include: { collaborator: true },
  normalizeCreate: normalizePayment,
  normalizeUpdate: normalizePayment,
}));

apiRouter.use('/transactions', createCrudRouter(prisma.transaction, [
  'type',
  'category',
  'amount',
  'description',
  'date',
  'referenceId',
], {
  normalizeCreate: normalizeTransaction,
  normalizeUpdate: normalizeTransaction,
}));

apiRouter.use('/budgets', createCrudRouter(prisma.budget, [], {
  include: { client: true },
  normalizeCreate: normalizeBudget,
  normalizeUpdate: normalizeBudget,
}));
