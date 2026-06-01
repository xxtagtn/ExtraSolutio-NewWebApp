import { Router } from 'express';
import { pick, toDate, asyncHandler } from '../utils/http.js';

function parseId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ message: 'ID inválido.' });
    return null;
  }
  return id;
}

export function createCrudRouter(model, fields, options = {}) {
  const router = Router();
  const include = options.include;

  router.get('/', asyncHandler(async (_req, res) => {
    const rows = await model.findMany({
      orderBy: options.orderBy ?? { createdAt: 'desc' },
      include,
    });
    res.json(rows);
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const id = parseId(req, res);
    if (!id) return;
    const row = await model.findUnique({ where: { id }, include });
    if (!row) return res.status(404).json({ message: 'Registo não encontrado.' });
    return res.json(row);
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const data = options.normalizeCreate?.(req.body) ?? pick(req.body, fields);
    const row = await model.create({ data, include });
    res.status(201).json(row);
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const id = parseId(req, res);
    if (!id) return;
    const data = options.normalizeUpdate?.(req.body) ?? pick(req.body, fields);
    const row = await model.update({ where: { id }, data, include });
    res.json(row);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const id = parseId(req, res);
    if (!id) return;
    await model.delete({ where: { id } });
    res.status(204).end();
  }));

  return router;
}

function compact(data) {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined && value !== ''));
}

function asInt(value) {
  return value === undefined || value === '' || value === null ? undefined : Number(value);
}

export function normalizeEvent(input) {
  const requiredRoles = Array.isArray(input.requiredRoles) ? input.requiredRoles : [];
  const parseRate = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const normalized = String(value).replace('€', '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return compact({
    ...pick(input, [
      'name', 'eventType', 'description', 'location', 'useDefaultLocation', 'startTime', 'endTime',
      'actualStartTime', 'actualEndTime', 'uniform', 'meetingPoint', 'onsiteContactName',
      'onsiteContactPhone', 'travelExpenseEnabled', 'billingStatus', 'signaledAmount', 'paidAmount',
      'remainingPaymentDate', 'status', 'totalCost', 'totalRevenue', 'notes',
    ]),
    travelExpenseAmount: input.travelExpenseAmount === undefined || input.travelExpenseAmount === '' || input.travelExpenseAmount === null ? undefined : Number(input.travelExpenseAmount),
    signaledAmount: input.signaledAmount === undefined || input.signaledAmount === '' || input.signaledAmount === null ? undefined : Number(input.signaledAmount),
    paidAmount: input.paidAmount === undefined || input.paidAmount === '' || input.paidAmount === null ? undefined : Number(input.paidAmount),
    billableHours: input.billableHours === undefined || input.billableHours === '' || input.billableHours === null ? undefined : Number(input.billableHours),
    guestsCount: asInt(input.guestsCount),
    requiredRoles: input.requiredRoles === undefined ? undefined : JSON.stringify(
      requiredRoles
        .map((item) => ({ role: item?.role ? String(item.role).trim() : '', qty: Number(item?.qty || 0), agreedRate: parseRate(item?.agreedRate) }))
        .filter((item) => item.role && Number.isFinite(item.qty) && item.qty > 0),
    ),
    clientId: asInt(input.clientId),
    ...(input.date ? { date: toDate(input.date) } : {}),
    ...(input.remainingPaymentDate !== undefined ? (input.remainingPaymentDate ? { remainingPaymentDate: toDate(input.remainingPaymentDate) } : { remainingPaymentDate: null }) : {}),
  });
}

export function normalizeInvoice(input) {
  const subtotal = input.subtotal === undefined || input.subtotal === '' ? undefined : Number(input.subtotal);
  const taxRate = input.taxRate === undefined || input.taxRate === '' ? undefined : Number(input.taxRate);
  const computedTaxAmount = subtotal !== undefined && taxRate !== undefined ? Number((subtotal * (taxRate / 100)).toFixed(2)) : undefined;
  const computedTotal = subtotal !== undefined && computedTaxAmount !== undefined ? Number((subtotal + computedTaxAmount).toFixed(2)) : undefined;
  return compact({
    ...pick(input, ['number', 'status', 'notes', 'eventIds', 'billingPeriodLabel']),
    ...(subtotal !== undefined ? { subtotal } : {}),
    ...(taxRate !== undefined ? { taxRate } : {}),
    ...(computedTaxAmount !== undefined ? { taxAmount: computedTaxAmount } : {}),
    ...(computedTotal !== undefined ? { total: computedTotal } : {}),
    clientId: asInt(input.clientId),
    eventId: asInt(input.eventId),
    ...(input.dueDate ? { dueDate: toDate(input.dueDate) } : {}),
    ...(input.issueDate ? { issueDate: toDate(input.issueDate) } : {}),
  });
}

export function normalizeInvoiceItem(input) {
  return compact({ ...pick(input, ['description', 'quantity', 'unitPrice', 'total']), invoiceId: asInt(input.invoiceId) });
}

export function normalizePayment(input) {
  return compact({ ...pick(input, ['amount', 'description', 'status']), collaboratorId: asInt(input.collaboratorId), ...(input.date ? { date: toDate(input.date) } : {}) });
}

export function normalizeAssignment(input) {
  return compact({
    eventId: asInt(input.eventId),
    collaboratorId: asInt(input.collaboratorId),
    role: input.role,
    checkIn: input.checkIn === undefined ? undefined : input.checkIn,
    checkOut: input.checkOut === undefined ? undefined : input.checkOut,
    clientCheckIn: input.clientCheckIn === undefined ? undefined : input.clientCheckIn,
    clientCheckOut: input.clientCheckOut === undefined ? undefined : input.clientCheckOut,
    validatedCheckIn: input.validatedCheckIn === undefined ? undefined : input.validatedCheckIn,
    validatedCheckOut: input.validatedCheckOut === undefined ? undefined : input.validatedCheckOut,
    hoursWorked: input.hoursWorked === undefined || input.hoursWorked === '' || input.hoursWorked === null ? undefined : Number(input.hoursWorked),
    clientBillableHours: input.clientBillableHours === undefined || input.clientBillableHours === '' || input.clientBillableHours === null ? undefined : Number(input.clientBillableHours),
    staffPayableHours: input.staffPayableHours === undefined || input.staffPayableHours === '' || input.staffPayableHours === null ? undefined : Number(input.staffPayableHours),
    hourlyRate: input.hourlyRate === undefined || input.hourlyRate === '' || input.hourlyRate === null ? undefined : Number(input.hourlyRate),
    totalPay: input.totalPay === undefined || input.totalPay === '' || input.totalPay === null ? undefined : Number(input.totalPay),
    validationStatus: input.validationStatus,
    validationNotes: input.validationNotes,
    status: input.status,
    paymentStatus: input.paymentStatus,
    ...(input.paymentDate !== undefined ? { paymentDate: input.paymentDate ? toDate(input.paymentDate) : null } : {}),
  });
}

export function normalizeTransaction(input) {
  return compact({
    ...pick(input, ['type', 'category', 'amount', 'description', 'supplier', 'documentName', 'documentData', 'sentToAccountant']),
    vatAmount: input.vatAmount === undefined || input.vatAmount === '' || input.vatAmount === null ? undefined : Number(input.vatAmount),
    referenceId: asInt(input.referenceId),
    ...(input.date ? { date: toDate(input.date) } : {}),
  });
}

export function normalizeBudget(input) {
  const amount = input.totalAmount !== undefined ? Number(input.totalAmount) : Number(input.amount ?? 0);
  return compact({
    ...pick(input, [
      'reference', 'description', 'status', 'paymentStatus', 'notes', 'budgetType', 'location', 'travelType',
      'leadName', 'companyName', 'phone', 'email', 'nif', 'eventType', 'startTime', 'endTime', 'leadSource',
      'serviceType', 'eventLevel', 'locationScope', 'lostReason', 'responseTemplate', 'commercialEmailText',
      'commercialWhatsappText', 'commercialPdfText',
    ]),
    amount,
    guestsCount: asInt(input.guestsCount),
    regularClient: input.regularClient === undefined ? undefined : Boolean(input.regularClient),
    minimumHours: input.minimumHours === undefined || input.minimumHours === '' ? undefined : Number(input.minimumHours),
    vatRate: input.vatRate === undefined ? undefined : Number(input.vatRate),
    travelPeople: asInt(input.travelPeople),
    km: input.km === undefined || input.km === '' ? undefined : Number(input.km),
    kmRate: input.kmRate === undefined || input.kmRate === '' ? undefined : Number(input.kmRate),
    durationHours: input.durationHours === undefined || input.durationHours === '' ? undefined : Number(input.durationHours),
    split5050: input.split5050 === undefined ? undefined : Boolean(input.split5050),
    baseAmount: input.baseAmount === undefined ? undefined : Number(input.baseAmount),
    travelAmount: input.travelAmount === undefined ? undefined : Number(input.travelAmount),
    taxAmount: input.taxAmount === undefined ? undefined : Number(input.taxAmount),
    totalWithTax: input.totalWithTax === undefined ? undefined : Number(input.totalWithTax),
    discountRate: input.discountRate === undefined ? undefined : Number(input.discountRate),
    discountAmount: input.discountAmount === undefined ? undefined : Number(input.discountAmount),
    totalAmount: input.totalAmount === undefined ? undefined : Number(input.totalAmount),
    marginAmount: input.marginAmount === undefined ? undefined : Number(input.marginAmount),
    categories: input.categories === undefined ? undefined : JSON.stringify(input.categories ?? []),
    paymentPlan: input.paymentPlan === undefined ? undefined : JSON.stringify(input.paymentPlan ?? []),
    followUpHistory: input.followUpHistory === undefined ? undefined : JSON.stringify(input.followUpHistory ?? []),
    clientId: asInt(input.clientId),
    ...(input.eventDate ? { eventDate: toDate(input.eventDate) } : {}),
    ...(input.sentAt ? { sentAt: toDate(input.sentAt) } : {}),
  });
}
