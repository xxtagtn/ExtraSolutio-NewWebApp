import { decimalValue } from './serviceFinance.js';

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

export function prepaymentDepositAmount(totalValue) {
  const total = decimalValue(totalValue) || 0;
  return Number((total * 0.7).toFixed(2));
}

export function buildPrepaymentSummary({
  total = 0,
  serviceDate = '',
  billingStatus = 'pending',
} = {}) {
  const totalAmount = Number(((decimalValue(total) || 0)).toFixed(2));
  const status = String(billingStatus || 'pending');
  const signaledAmount = prepaymentDepositAmount(totalAmount);
  const paidAmount = status === 'paid'
    ? totalAmount
    : status === 'partial70'
      ? signaledAmount
      : 0;

  return {
    total: totalAmount,
    status,
    signaledAmount,
    paidAmount,
    remainingAmount: Number(Math.max(0, totalAmount - paidAmount).toFixed(2)),
    remainingPaymentDate: defaultPrepaymentRemainingDate(serviceDate),
  };
}

export function defaultPrepaymentRemainingDate(serviceDate) {
  const normalized = dateOnly(serviceDate);
  if (!normalized) return '';
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() - 7);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
