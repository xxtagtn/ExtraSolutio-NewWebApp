import { decimalValue } from './serviceFinance.js';

const COLLABORATOR_VAT_RATE = 0.23;

export function staffPaymentTotal(baseAmount, includesVat = false, adjustment = 0) {
  const base = decimalValue(baseAmount) || 0;
  const adjustmentAmount = decimalValue(adjustment) || 0;
  const amountWithVat = includesVat ? base * (1 + COLLABORATOR_VAT_RATE) : base;
  return Number(Math.max(0, amountWithVat + adjustmentAmount).toFixed(2));
}
