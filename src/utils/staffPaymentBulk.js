import { decimalValue } from './serviceFinance.js';

function todayIso(value = new Date()) {
  if (typeof value === 'string' && value.length >= 10) return value.slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

export function buildStaffPaymentStatusPayload(input = {}, today = new Date()) {
  const paymentStatus = String(input.paymentStatus || 'unpaid');
  const payload = {
    paymentStatus,
    paymentDate: paymentStatus === 'paid' ? (input.paymentDate || todayIso(today)) : null,
    paymentAdjustment: decimalValue(input.paymentAdjustment) || 0,
  };

  if (Object.prototype.hasOwnProperty.call(input, 'paymentDeferredMonth')) {
    payload.paymentDeferredMonth = input.paymentDeferredMonth || null;
  }

  return payload;
}

export function buildMoveToPaidPayload(input = {}, today = new Date()) {
  return buildStaffPaymentStatusPayload({
    ...input,
    paymentStatus: 'paid',
  }, today);
}
