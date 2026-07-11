import { decimalValue } from './serviceFinance.js';
import { clientPrepaymentRule } from './clientRules.js';

function dateOnly(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

export function shouldBlockPrepaidStaffAllocation(client, billingStatus, signaledAmount = 0) {
  if (client?.billingMethod !== 'prepaid') return false;
  const status = String(billingStatus || 'pending');
  if (status === 'paid') return false;
  if (status === 'partial70') return (decimalValue(signaledAmount) || 0) <= 0;
  return true;
}

export function prepaymentDepositAmount(totalValue, client = null) {
  const total = decimalValue(totalValue) || 0;
  const rule = clientPrepaymentRule(client);
  return Number((total * (rule.percent / 100)).toFixed(2));
}

export function buildPrepaymentSummary({
  total = 0,
  serviceDate = '',
  billingStatus = 'pending',
  client = null,
  signaledAmount = 0,
  paidAmount: storedPaidAmount = 0,
  remainingPaymentDate = '',
} = {}) {
  const totalAmount = Number(((decimalValue(total) || 0)).toFixed(2));
  const status = String(billingStatus || 'pending');
  const rule = clientPrepaymentRule(client);
  const calculatedSignaledAmount = prepaymentDepositAmount(totalAmount, client);
  const manualSignaledAmount = decimalValue(signaledAmount) || 0;
  const resolvedSignaledAmount = Number(Math.min(
    totalAmount,
    manualSignaledAmount > 0 ? manualSignaledAmount : calculatedSignaledAmount,
  ).toFixed(2));
  const manualPaidAmount = decimalValue(storedPaidAmount) || 0;
  const paidAmount = status === 'paid'
    ? totalAmount
    : status === 'partial70'
      ? Number(Math.min(totalAmount, manualPaidAmount > 0 ? manualPaidAmount : resolvedSignaledAmount).toFixed(2))
      : 0;

  return {
    total: totalAmount,
    status,
    signaledAmount: resolvedSignaledAmount,
    paidAmount,
    remainingAmount: Number(Math.max(0, totalAmount - paidAmount).toFixed(2)),
    remainingPaymentDate: dateOnly(remainingPaymentDate) || defaultPrepaymentRemainingDate(serviceDate, rule.remainingDaysBefore),
  };
}

export function defaultPrepaymentRemainingDate(serviceDate, daysBefore = 7) {
  const normalized = dateOnly(serviceDate);
  if (!normalized) return '';
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() - Math.max(0, Number(daysBefore) || 0));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function prepaymentRemainingReminderDate(service = {}) {
  const manualDate = dateOnly(service.remainingPaymentDate);
  if (manualDate) return manualDate;
  return defaultPrepaymentRemainingDate(
    service.date,
    service.client?.prepaymentRemainingDaysBefore ?? 7,
  );
}
