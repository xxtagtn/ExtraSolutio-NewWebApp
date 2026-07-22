import { decimalValue } from './serviceFinance.js';

const COLLABORATOR_VAT_RATE = 0.23;
const STAFF_PAYMENT_START_DAY = 8;
const STAFF_PAYMENT_END_DAY = 14;

export function staffPaymentTotal(baseAmount, includesVat = false, adjustment = 0) {
  const base = decimalValue(baseAmount) || 0;
  const adjustmentAmount = decimalValue(adjustment) || 0;
  const amountWithVat = includesVat ? base * (1 + COLLABORATOR_VAT_RATE) : base;
  return Number(Math.max(0, amountWithVat + adjustmentAmount).toFixed(2));
}

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function defaultStaffPaymentMonth(serviceDate) {
  const date = parseDate(serviceDate);
  if (!date) return '';
  const paymentDate = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}`;
}

export function assignmentWorkDateValue(assignment = {}) {
  return assignment.assignmentDate || assignment.eventDate || assignment.event?.date || '';
}

function paymentTimeLabel(value) {
  const normalized = String(value || '').trim();
  return /^\d{2}:\d{2}/.test(normalized) ? normalized.slice(0, 5) : normalized;
}

export function validatedClientScheduleLabel(assignment = {}) {
  const start = paymentTimeLabel(assignment.validatedCheckIn || assignment.clientCheckIn);
  const end = paymentTimeLabel(assignment.validatedCheckOut || assignment.clientCheckOut);
  return start && end ? `${start} - ${end}` : '-';
}

export function nextStaffPaymentMonth(paymentMonth) {
  const [year, month] = String(paymentMonth || '').split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return '';
  const date = new Date(year, month, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function staffPaymentWindow(paymentMonth) {
  const [year, month] = String(paymentMonth || '').split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return { start: null, end: null };
  return {
    start: new Date(year, month - 1, STAFF_PAYMENT_START_DAY),
    end: new Date(year, month - 1, STAFF_PAYMENT_END_DAY),
  };
}

export function staffPaymentTiming(assignment = {}, today = new Date()) {
  const serviceDate = assignmentWorkDateValue(assignment);
  const defaultMonth = defaultStaffPaymentMonth(serviceDate);
  const paymentMonth = assignment.paymentDeferredMonth || defaultMonth;
  const { start, end } = staffPaymentWindow(paymentMonth);
  const reference = parseDate(today);

  if (!paymentMonth || !start || !end || !reference) {
    return {
      paymentMonth,
      defaultMonth,
      status: 'unknown',
      deferred: Boolean(assignment.paymentDeferredMonth),
      start,
      end,
    };
  }

  const current = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  let status = 'open';
  if (current < start) status = 'not_open';
  if (current > end) status = 'overdue';
  if (assignment.paymentStatus === 'paid') status = 'paid';

  return {
    paymentMonth,
    defaultMonth,
    status,
    deferred: Boolean(assignment.paymentDeferredMonth && assignment.paymentDeferredMonth !== defaultMonth),
    start,
    end,
  };
}

export function staffPaymentRequiresAttention(assignment = {}, today = new Date()) {
  const status = staffPaymentTiming(assignment, today).status;
  return status === 'open' || status === 'overdue';
}
