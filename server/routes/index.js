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
} from './crud.js';
import { authRouter } from './auth.js';
import { requireAuth } from '../middleware/auth.js';
import { usersRouter } from './users.js';
import { collaboratorsRouter } from './collaborators.js';
import { notificationsRouter } from './notifications.js';

export const apiRouter = Router();

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
  'status',
  'notes',
]));

apiRouter.use('/services', createCrudRouter(prisma.event, [], {
  include: {
    client: true,
    assignments: { include: { collaborator: true } },
  },
  normalizeCreate: normalizeEvent,
  normalizeUpdate: normalizeEvent,
}));

apiRouter.use('/service-templates', createCrudRouter(prisma.eventTemplate, [], {
  normalizeCreate: normalizeEventTemplate,
  normalizeUpdate: normalizeEventTemplate,
}));

apiRouter.use('/assignments', createCrudRouter(prisma.eventAssignment, [
  'eventId',
  'collaboratorId',
  'role',
  'checkIn',
  'checkOut',
  'hoursWorked',
  'hourlyRate',
  'totalPay',
  'status',
], {
  include: { event: true, collaborator: true },
  normalizeCreate: normalizeAssignment,
  normalizeUpdate: normalizeAssignment,
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
