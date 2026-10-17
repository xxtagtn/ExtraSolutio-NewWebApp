import { decimalValue } from './serviceFinance.js';

// Reuse the existing Finance Clients rule: a billing adjustment applies only before an invoice exists.
export function clientPaymentTotal(event = {}) {
  const number = (value) => decimalValue(value) || 0;
  const linked = event.invoices || (event.invoice ? [event.invoice] : []);
  const hasInvoice = event.financial?.hasInvoice || event.externalService?.settledByInvoice === true
    || linked.some((row) => !['cancelled', 'void'].includes(row.status));
  return Math.max(0, Math.round((number(event.totalRevenue) + (hasInvoice ? 0 : number(event.billingAdjustment))) * 100) / 100);
}
