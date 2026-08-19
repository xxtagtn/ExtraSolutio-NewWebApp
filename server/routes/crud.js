import { Router } from 'express';
import {
  BUDGET_COMPOSITION_ERROR,
  isBudgetCompositionValid,
} from '../../src/utils/budgetComposition.js';
import { normalizeExternalCosts } from '../../src/utils/externalCosts.js';
import { normalizeAssignmentDrafts } from '../../src/utils/serviceAssignmentDrafts.js';
import { normalizeTravelCars } from '../../src/utils/travelCalculator.js';
import { requireAdmin } from '../middleware/auth.js';
import { pick, toDate, asyncHandler } from '../utils/http.js';
import { buildPaginatedPayload, parsePaginationQuery } from '../utils/listQuery.js';

function parseId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ message: 'ID inválido.' });
    return null;
  }
  return id;
}

export function createCrudRouter(model, fields, options = {}) {
  const router = Router();
  const include = options.include;
  const readMiddleware = options.readMiddleware ?? [];
  const writeMiddleware = options.writeMiddleware ?? [];
  const createMiddleware = options.createMiddleware ?? writeMiddleware;
  const updateMiddleware = options.updateMiddleware ?? writeMiddleware;
  const deleteMiddleware = options.deleteMiddleware ?? [requireAdmin];
  const readMiddlewares = Array.isArray(readMiddleware) ? readMiddleware : [readMiddleware];
  const createMiddlewares = Array.isArray(createMiddleware) ? createMiddleware : [createMiddleware];
  const updateMiddlewares = Array.isArray(updateMiddleware) ? updateMiddleware : [updateMiddleware];
  const deleteMiddlewares = Array.isArray(deleteMiddleware) ? deleteMiddleware : [deleteMiddleware];
  const serializeRow = options.serializeRow ?? ((row) => row);
  const serializeRows = options.serializeRows ?? ((rows, req) => rows.map((row) => serializeRow(row, req)));

  router.get('/', ...readMiddlewares, asyncHandler(async (req, res) => {
    const pagination = parsePaginationQuery(req.query, options.pagination);
    const where = options.buildWhere?.(req.query, req);
    const orderBy = options.buildOrderBy?.(req.query, req) ?? options.orderBy ?? { createdAt: 'desc' };
    const rows = await model.findMany({
      orderBy,
      ...(where ? { where } : {}),
      include,
      ...(pagination.enabled ? { skip: pagination.skip, take: pagination.take } : {}),
    });
    const serializedRows = serializeRows(rows, req);
    if (!pagination.enabled) return res.json(serializedRows);

    const total = await model.count({ ...(where ? { where } : {}) });
    return res.json(buildPaginatedPayload({
      items: serializedRows,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    }));
  }));

  router.get('/:id', ...readMiddlewares, asyncHandler(async (req, res) => {
    const id = parseId(req, res);
    if (!id) return;
    const row = await model.findUnique({ where: { id }, include });
    if (!row) return res.status(404).json({ message: 'Registo não encontrado.' });
    return res.json(serializeRow(row, req));
  }));

  router.post('/', ...createMiddlewares, asyncHandler(async (req, res) => {
    const data = await (options.normalizeCreate?.(req.body) ?? pick(req.body, fields));
    const row = await model.create({ data, include });
    await options.afterCreate?.({ row, data, body: req.body });
    res.status(201).json(serializeRow(row, req));
  }));

  router.put('/:id', ...updateMiddlewares, asyncHandler(async (req, res) => {
    const id = parseId(req, res);
    if (!id) return;
    const existing = options.loadExistingForUpdate
      ? await model.findUnique({ where: { id } })
      : null;
    if (options.loadExistingForUpdate && !existing) return res.status(404).json({ message: 'Registo não encontrado.' });
    const data = await (options.normalizeUpdate?.(req.body, existing) ?? pick(req.body, fields));
    const row = options.performUpdate
      ? await options.performUpdate({ id, data, existing, include, body: req.body, model })
      : await model.update({ where: { id }, data, include });
    await options.afterUpdate?.({ id, row, existing, data, body: req.body });
    res.json(serializeRow(row, req));
  }));

  router.delete('/:id', ...deleteMiddlewares, asyncHandler(async (req, res) => {
    const id = parseId(req, res);
    if (!id) return;
    const existing = options.loadExistingForDelete
      ? await model.findUnique({ where: { id } })
      : null;
    if (options.loadExistingForDelete && !existing) return res.status(404).json({ message: 'Registo não encontrado.' });
    await model.delete({ where: { id } });
    await options.afterDelete?.({ id, existing });
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

function normalizeStatusMode(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value).trim().toLowerCase() === 'manual' ? 'manual' : 'automatic';
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeAdvanceDate(value) {
  if (!value) return '';
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function normalizeAdvancePayments(value) {
  if (value === undefined) return undefined;
  const normalized = parseArray(value)
    .map((item, index) => {
      const amount = parseDecimal(item?.amount) || 0;
      return {
        id: String(item?.id || `advance-${index + 1}`),
        date: normalizeAdvanceDate(item?.date),
        amount: Number(amount.toFixed(2)),
        note: String(item?.note || '').trim(),
        car: Boolean(item?.car),
      };
    })
    .filter((item) => item.amount > 0);
  return normalized.length ? JSON.stringify(normalized) : null;
}

function normalizeTravelCarsForStorage(value) {
  if (value === undefined) return undefined;
  const cars = normalizeTravelCars(value);
  return cars.length ? JSON.stringify(cars) : null;
}

function normalizeAssignmentDraftsForStorage(value) {
  if (value === undefined) return undefined;
  const drafts = normalizeAssignmentDrafts(value);
  return drafts.length ? JSON.stringify(drafts) : null;
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
      'signaledAt',
      'billingPaymentDate', 'remainingPaymentDate', 'status', 'statusMode', 'notes', 'clientName',
    ]),
    ...(input.serviceReference !== undefined
      ? { serviceReference: String(input.serviceReference || '').trim().slice(0, 160) || null }
      : {}),
    workLocationsEnabled: parseBoolean(input.workLocationsEnabled),
    totalCost: parseDecimal(input.totalCost),
    totalRevenue: parseDecimal(input.totalRevenue),
    billingAdjustment: parseDecimal(input.billingAdjustment),
    vatRateSnapshot: parseDecimal(input.vatRateSnapshot),
    taxAmount: parseDecimal(input.taxAmount),
    travelExpenseAmount: parseDecimal(input.travelExpenseAmount),
    travelPeople: asInt(input.travelPeople),
    km: parseDecimal(input.km),
    kmRate: parseDecimal(input.kmRate),
    durationHours: parseDecimal(input.durationHours),
    travelStaffHourlyRate: parseDecimal(input.travelStaffHourlyRate),
    travelManualAmount: parseDecimal(input.travelManualAmount),
    travelCars: normalizeTravelCarsForStorage(input.travelCars),
    assignmentDrafts: normalizeAssignmentDraftsForStorage(input.assignmentDrafts),
    signaledAmount: parseDecimal(input.signaledAmount),
    paidAmount: parseDecimal(input.paidAmount),
    realHours: parseDecimal(input.realHours),
    billableHours: parseDecimal(input.billableHours),
    minimumHoursSnapshot: parseDecimal(input.minimumHoursSnapshot),
    statusMode: normalizeStatusMode(input.statusMode),
    guestsCount: asInt(input.guestsCount),
    requiredRoles: input.requiredRoles === undefined ? undefined : JSON.stringify(
      requiredRoles
        .map((item, index) => {
          const role = item?.role ? String(item.role).trim() : '';
          const day = String(item?.day || item?.date || '').trim().slice(0, 10);
          const start = String(item?.start || '').trim();
          const end = String(item?.end || '').trim();
          const parsedOrder = Number(item?.order);
          return compact({
            role,
            qty: Number(item?.qty || 0),
            agreedRate: parseRate(item?.agreedRate),
            ...(day ? { day } : {}),
            ...(start ? { start } : {}),
            ...(end ? { end } : {}),
            order: Number.isFinite(parsedOrder) ? Math.max(0, Math.trunc(parsedOrder)) : index,
          });
        })
        .filter((item) => item.role && Number.isFinite(item.qty) && item.qty > 0),
    ),
    externalCosts: input.externalCosts === undefined ? undefined : JSON.stringify(normalizeExternalCosts(input.externalCosts)),
    clientId: input.clientId === undefined ? undefined : (asInt(input.clientId) || null),
    ...(input.clientName !== undefined ? { clientName: String(input.clientName || '').trim() || null } : {}),
    ...(input.date ? { date: toDate(input.date) } : {}),
    ...(input.endDate !== undefined ? (input.endDate ? { endDate: toDate(input.endDate) } : { endDate: null }) : {}),
    ...(input.billingPaymentDate !== undefined ? (input.billingPaymentDate ? { billingPaymentDate: toDate(input.billingPaymentDate) } : { billingPaymentDate: null }) : {}),
    ...(input.signaledAt !== undefined ? (input.signaledAt ? { signaledAt: toDate(input.signaledAt) } : { signaledAt: null }) : {}),
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
  const billingMethod = String(input.billingMethod ?? existing?.billingMethod ?? '').trim();
  const paymentTerm = String(input.paymentTerm ?? existing?.paymentTerm ?? '').trim();
  if (!billingMethod || !paymentTerm) {
    const error = new Error('Define o método de faturação e o prazo de pagamento do cliente.');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }

  const paymentTermDays = input.paymentTermDays === undefined
    ? existing?.paymentTermDays
    : asInt(input.paymentTermDays);
  if (paymentTerm === 'custom' && (!Number.isFinite(Number(paymentTermDays)) || Number(paymentTermDays) < 0)) {
    const error = new Error('Define um número de dias válido para o prazo de pagamento personalizado.');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }

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
      'defaultUniform',
      'defaultOnsiteContactName',
      'defaultOnsiteContactPhone',
      'status',
      'notes',
    ]),
    billingMethod,
    paymentTerm,
    paymentTermDays: paymentTerm === 'custom' ? Number(paymentTermDays) : null,
    minimumHours: input.minimumHours === undefined
      ? undefined
      : Math.max(0, parseDecimal(input.minimumHours) || 0),
    prepaymentPercent: input.prepaymentPercent === undefined
      ? undefined
      : Math.max(0, parseDecimal(input.prepaymentPercent) || 0),
    prepaymentRemainingDaysBefore: input.prepaymentRemainingDaysBefore === undefined
      ? undefined
      : Math.max(0, asInt(input.prepaymentRemainingDaysBefore) || 0),
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

export function normalizeCommunicationLog(input) {
    return compact({
      ...pick(input, ['type', 'channel', 'status', 'message', 'response', 'dedupeKey']),
    eventId: asInt(input.eventId),
    assignmentId: asInt(input.assignmentId),
    collaboratorId: asInt(input.collaboratorId),
    ...(input.sentAt !== undefined ? { sentAt: input.sentAt ? toDate(input.sentAt) : null } : {}),
    ...(input.respondedAt !== undefined ? { respondedAt: input.respondedAt ? toDate(input.respondedAt) : null } : {}),
  });
}

export function normalizeAssignment(input) {
  const syncedPaymentNotes = input.paymentNotes !== undefined ? input.paymentNotes : input.validationNotes;
  return compact({
    eventId: asInt(input.eventId),
    collaboratorId: asInt(input.collaboratorId),
    workLocationId: input.workLocationId === undefined
      ? undefined
      : (asInt(input.workLocationId) || null),
    ...(input.assignmentDate !== undefined ? { assignmentDate: input.assignmentDate ? toDate(input.assignmentDate) : null } : {}),
    role: input.role,
    plannedCheckIn: input.plannedCheckIn === undefined ? undefined : input.plannedCheckIn,
    plannedCheckOut: input.plannedCheckOut === undefined ? undefined : input.plannedCheckOut,
    checkIn: input.checkIn === undefined ? undefined : input.checkIn,
    checkOut: input.checkOut === undefined ? undefined : input.checkOut,
    clientCheckIn: input.clientCheckIn === undefined ? undefined : input.clientCheckIn,
    clientCheckOut: input.clientCheckOut === undefined ? undefined : input.clientCheckOut,
    validatedCheckIn: input.validatedCheckIn === undefined ? undefined : input.validatedCheckIn,
    validatedCheckOut: input.validatedCheckOut === undefined ? undefined : input.validatedCheckOut,
    hoursWorked: parseDecimal(input.hoursWorked),
    clientRealHours: parseDecimal(input.clientRealHours),
    clientBillableHours: parseDecimal(input.clientBillableHours),
    staffPayableHours: parseDecimal(input.staffPayableHours),
    hourlyRate: parseDecimal(input.hourlyRate),
    totalPay: parseDecimal(input.totalPay),
    paymentAdjustment: parseDecimal(input.paymentAdjustment),
    paymentNotes: syncedPaymentNotes,
    advancePayments: normalizeAdvancePayments(input.advancePayments),
    validationStatus: input.validationStatus,
    validationNotes: input.validationNotes,
    clientSynced: parseBoolean(input.clientSynced),
    whatsappEnabled: parseBoolean(input.whatsappEnabled),
    isDriver: parseBoolean(input.isDriver),
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
  if (
    input.categories !== undefined
    && input.externalCosts !== undefined
    && !isBudgetCompositionValid({
      categories: input.categories,
      externalCosts: input.externalCosts,
    })
  ) {
    const error = new Error(BUDGET_COMPOSITION_ERROR);
    error.statusCode = 422;
    error.expose = true;
    throw error;
  }
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
    travelCars: normalizeTravelCarsForStorage(input.travelCars),
    categories: input.categories === undefined ? undefined : JSON.stringify(input.categories ?? []),
    externalCosts: input.externalCosts === undefined ? undefined : JSON.stringify(normalizeExternalCosts(input.externalCosts)),
    paymentPlan: input.paymentPlan === undefined ? undefined : JSON.stringify(input.paymentPlan ?? []),
    followUpHistory: input.followUpHistory === undefined ? undefined : JSON.stringify(input.followUpHistory ?? []),
    clientId: asInt(input.clientId),
    ...(input.eventDate ? { eventDate: toDate(input.eventDate) } : {}),
    ...(input.sentAt ? { sentAt: toDate(input.sentAt) } : {}),
  });
}
