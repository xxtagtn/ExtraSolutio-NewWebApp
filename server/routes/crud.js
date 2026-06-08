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
    const existing = options.loadExistingForUpdate
      ? await model.findUnique({ where: { id } })
      : null;
    if (options.loadExistingForUpdate && !existing) return res.status(404).json({ message: 'Registo não encontrado.' });
    const data = options.normalizeUpdate?.(req.body, existing) ?? pick(req.body, fields);
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

function parseDecimal(value) {
  if (value === undefined || value === '' || value === null) return undefined;
  const raw = String(value)
    .replace('€', '')
    .replace(/\u00e2\u201a\u00ac/g, '')
    .replace(/\/\s*h(?:ora)?s?/gi, '')
    .replace(/\b(?:eur|euros?)\b/gi, '')
    .replace(/\s/g, '')
    .trim();
  const commaIndex = raw.lastIndexOf(',');
  const dotIndex = raw.lastIndexOf('.');
  let normalized = raw;
  if (commaIndex >= 0 && dotIndex >= 0) {
    normalized = commaIndex > dotIndex
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
  } else if (commaIndex >= 0) {
    normalized = raw.replace(',', '.');
  } else if (dotIndex >= 0) {
    const dotCount = (raw.match(/\./g) || []).length;
    const beforeDot = raw.slice(0, dotIndex);
    const afterDot = raw.slice(dotIndex + 1);
    if (dotCount > 1 || (afterDot.length === 3 && beforeDot.length <= 3)) {
      normalized = raw.replace(/\./g, '');
    }
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBoolean(value) {
  if (value === undefined) return undefined;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return Boolean(value);
}
export function normalizeEvent(input) {
  const requiredRoles = Array.isArray(input.requiredRoles) ? input.requiredRoles : [];
  const parseRate = (value) => {
    const parsed = parseDecimal(value);
    return parsed === undefined ? null : parsed;
  };
  return compact({
    ...pick(input, [
      'name', 'eventType', 'description', 'location', 'useDefaultLocation', 'isContinuous', 'startTime', 'endTime',
      'actualStartTime', 'actualEndTime', 'uniform', 'meetingPoint', 'onsiteContactName',
      'onsiteContactPhone', 'travelExpenseEnabled', 'travelType', 'split5050', 'billingStatus', 'signaledAmount', 'paidAmount',
      'billingPaymentDate', 'remainingPaymentDate', 'status', 'notes',
    ]),
    totalCost: parseDecimal(input.totalCost),
    totalRevenue: parseDecimal(input.totalRevenue),
    travelExpenseAmount: parseDecimal(input.travelExpenseAmount),
    travelPeople: asInt(input.travelPeople),
    km: parseDecimal(input.km),
    kmRate: parseDecimal(input.kmRate),
    durationHours: parseDecimal(input.durationHours),
    travelManualAmount: parseDecimal(input.travelManualAmount),
    signaledAmount: parseDecimal(input.signaledAmount),
    paidAmount: parseDecimal(input.paidAmount),
    billableHours: parseDecimal(input.billableHours),
    guestsCount: asInt(input.guestsCount),
    requiredRoles: input.requiredRoles === undefined ? undefined : JSON.stringify(
      requiredRoles
        .map((item) => ({ role: item?.role ? String(item.role).trim() : '', qty: Number(item?.qty || 0), agreedRate: parseRate(item?.agreedRate) }))
        .filter((item) => item.role && Number.isFinite(item.qty) && item.qty > 0),
    ),
    clientId: asInt(input.clientId),
    ...(input.date ? { date: toDate(input.date) } : {}),
    ...(input.endDate !== undefined ? (input.endDate ? { endDate: toDate(input.endDate) } : { endDate: null }) : {}),
    ...(input.billingPaymentDate !== undefined ? (input.billingPaymentDate ? { billingPaymentDate: toDate(input.billingPaymentDate) } : { billingPaymentDate: null }) : {}),
    ...(input.remainingPaymentDate !== undefined ? (input.remainingPaymentDate ? { remainingPaymentDate: toDate(input.remainingPaymentDate) } : { remainingPaymentDate: null }) : {}),
  });
}

function normalizeRoleRates(value) {
  const source = Array.isArray(value)
    ? value
    : (() => {
        try {
          const parsed = typeof value === 'string' ? JSON.parse(value) : [];
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })();

  return source
    .map((item) => ({
      role: item?.role ? String(item.role).trim() : '',
      rate: parseDecimal(item?.rate ?? item?.agreedRate),
    }))
    .filter((item) => item.role && item.rate !== undefined && item.rate > 0)
    .sort((a, b) => a.role.localeCompare(b.role, 'pt'));
}

export function normalizeClient(input, existing = null) {
  const base = compact({
    ...pick(input, [
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
      'status',
      'notes',
    ]),
    paymentTermDays: asInt(input.paymentTermDays),
  });

  if (input.roleRates !== undefined) {
    const roleRates = normalizeRoleRates(input.roleRates);
    const serialized = JSON.stringify(roleRates);
    base.roleRates = roleRates.length ? serialized : null;

    const previous = existing?.roleRates || null;
    const next = base.roleRates || null;
    if (previous !== next) {
      base.roleRatesUpdatedAt = new Date();
    }
  }

  return base;
}

export function normalizeEventTemplate(input) {
  const payload = typeof input.payload === 'string'
    ? input.payload
    : JSON.stringify(input.payload || {});
  return compact({
    ...pick(input, ['name', 'eventType', 'description']),
    payload,
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
    ...(input.assignmentDate !== undefined ? { assignmentDate: input.assignmentDate ? toDate(input.assignmentDate) : null } : {}),
    role: input.role,
    checkIn: input.checkIn === undefined ? undefined : input.checkIn,
    checkOut: input.checkOut === undefined ? undefined : input.checkOut,
    clientCheckIn: input.clientCheckIn === undefined ? undefined : input.clientCheckIn,
    clientCheckOut: input.clientCheckOut === undefined ? undefined : input.clientCheckOut,
    validatedCheckIn: input.validatedCheckIn === undefined ? undefined : input.validatedCheckIn,
    validatedCheckOut: input.validatedCheckOut === undefined ? undefined : input.validatedCheckOut,
    hoursWorked: parseDecimal(input.hoursWorked),
    clientBillableHours: parseDecimal(input.clientBillableHours),
    staffPayableHours: parseDecimal(input.staffPayableHours),
    hourlyRate: parseDecimal(input.hourlyRate),
    totalPay: parseDecimal(input.totalPay),
    paymentAdjustment: parseDecimal(input.paymentAdjustment),
    paymentNotes: input.paymentNotes,
    validationStatus: input.validationStatus,
    validationNotes: input.validationNotes,
    clientSynced: parseBoolean(input.clientSynced),
    status: input.status,
    paymentStatus: input.paymentStatus,
    paymentDeferredMonth: input.paymentDeferredMonth === undefined ? undefined : input.paymentDeferredMonth || null,
    ...(input.paymentDate !== undefined ? { paymentDate: input.paymentDate ? toDate(input.paymentDate) : null } : {}),
  });
}

export function normalizeTransaction(input) {
  return compact({
    ...pick(input, ['type', 'category', 'amount', 'description', 'supplier', 'documentName', 'documentData', 'sentToAccountant']),
    vatAmount: parseDecimal(input.vatAmount),
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
