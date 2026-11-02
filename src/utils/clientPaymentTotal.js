import { decimalValue } from './serviceFinance.js';
import { eventStaffVatRate } from './eventSalesTax.js';
import { calculateVatAmount, moneyCents } from '../../shared/money.js';

const cents = (value) => moneyCents(decimalValue(value) || 0);

export function clientBillingAdjustment(event = {}) {
  const linked = event.invoices || (event.invoice ? [event.invoice] : []);
  const hasInvoice = event.financial?.hasInvoice || event.externalService?.settledByInvoice === true
    || linked.some((row) => !['cancelled', 'void'].includes(row.status));
  const base = hasInvoice ? 0 : cents(event.billingAdjustment);
  const rate = eventStaffVatRate(event);
  // Round the VAT in cents, symmetrically for positive and negative adjustments.
  const tax = moneyCents(calculateVatAmount(base / 100, rate));
  return { base: base / 100, rate, tax: tax / 100, total: (base + tax) / 100 };
}

export function clientPaymentTax(event = {}) {
  return Math.max(0, (cents(event.taxAmount) + cents(clientBillingAdjustment(event).tax)) / 100);
}

// Reuse the existing Finance Clients rule: a billing adjustment applies only before an invoice exists.
export function clientPaymentTotal(event = {}) {
  return Math.max(0, (cents(event.totalRevenue) + cents(clientBillingAdjustment(event).total)) / 100);
}
