import { readClientPaymentRecord } from './clientPaymentRecord.js';
import { calculateEventSalesTax, eventStaffVatRate } from './eventSalesTax.js';
import { normalizeExternalCosts } from './externalCosts.js';
import { clientBillingAdjustment, clientPaymentTax, clientPaymentTotal } from './clientPaymentTotal.js';

const cents = (value) => Math.round(Number(value) * 100);
const amount = (value) => value / 100;

// Snapshot the existing sales totals, never reverse a gross balance using a guessed VAT rate.
export function paymentFinancialSnapshot(event = {}) {
  if (event.taxAmount == null || event.totalRevenue == null) return null;
  const total = cents(clientPaymentTotal(event)), tax = cents(clientPaymentTax(event));
  if (![total, tax].every(Number.isSafeInteger) || total < 0 || tax < 0 || tax > total) return null;
  const base = total - tax;
  const partners = normalizeExternalCosts(event.externalCosts);
  const partnerBase = partners.reduce((sum, row) => sum + cents(row.chargeAmount), 0);
  const partnerTax = partners.reduce((sum, row) => sum + cents(row.taxAmount), 0);
  const travel = event.travelExpenseEnabled ? cents(event.travelExpenseAmount || 0) : 0;
  const adjustment = clientBillingAdjustment(event);
  const staff = base - partnerBase - travel - cents(adjustment.base);
  const calculated = calculateEventSalesTax(event, {
    staffSale: amount(staff), travelSale: amount(travel), partnerTax: amount(partnerTax),
  });
  let components = [];
  if (staff >= 0 && cents(calculated.taxAmount) + cents(adjustment.tax) === tax) {
    components = [
      { key: 'staff', label: 'Staff', rate: String(eventStaffVatRate(event)), base: amount(staff), tax: amount(cents(calculated.staffTax)) },
      { key: 'travel', label: 'Deslocações', rate: String(Number(event.vatRateSnapshot || 0)), base: amount(travel), tax: amount(cents(calculated.travelTax)) },
      ...partners.map((row) => ({ key: `partner:${row.id}`, label: row.supplier || row.type || 'Parceiro',
        rate: row.vatType === 'exempt' ? '0' : row.vatType === 'catering' ? '13% / 23%' : '23',
        base: row.chargeAmount, tax: row.taxAmount })),
      ...(adjustment.base ? [{ key: 'billing-adjustment', label: 'Ajuste de faturação', rate: String(adjustment.rate),
        base: adjustment.base, tax: adjustment.tax }] : []),
    ];
    const rounding = tax - components.reduce((sum, row) => sum + cents(row.tax), 0);
    if (rounding) components.push({ key: 'rounding', label: 'Arredondamento de IVA', rate: '', base: 0, tax: amount(rounding) });
  }
  return { total: amount(total), base: amount(base), tax: amount(tax), components };
}

function validSnapshot(value) {
  return value && ['total', 'base', 'tax'].every((field) => Number.isFinite(value[field]))
    && cents(value.base) + cents(value.tax) === cents(value.total);
}

export function clientPaymentAdjustment(event = {}, received = 0) {
  const record = readClientPaymentRecord(event.clientPaymentRecord);
  const reference = record?.settledFinancials;
  const current = paymentFinancialSnapshot(event);
  const outstanding = cents(clientPaymentTotal(event)) - cents(received);
  if (outstanding <= 0) return null;
  if (!validSnapshot(reference) || !current) return { available: false };
  const total = cents(current.total) - cents(reference.total);
  const receivedTowards = cents(received) - cents(reference.total);
  if (total <= 0 || receivedTowards < 0 || receivedTowards >= total) return { available: false };
  const previous = new Map((reference.components || []).map((row) => [`${row.key}|${row.rate}`, row]));
  const following = new Map(current.components.map((row) => [`${row.key}|${row.rate}`, row]));
  const components = reference.components?.length && current.components.length
    ? [...new Set([...previous.keys(), ...following.keys()])].map((key) => {
      const before = previous.get(key), after = following.get(key);
      return { key, label: (after || before).label, rate: (after || before).rate,
        base: amount(cents(after?.base || 0) - cents(before?.base || 0)),
        tax: amount(cents(after?.tax || 0) - cents(before?.tax || 0)) };
    }).filter((row) => row.base || row.tax) : [];
  return { available: true, base: amount(cents(current.base) - cents(reference.base)),
    tax: amount(cents(current.tax) - cents(reference.tax)), total: amount(total),
    receivedTowards: amount(receivedTowards), outstanding: amount(outstanding), components };
}
