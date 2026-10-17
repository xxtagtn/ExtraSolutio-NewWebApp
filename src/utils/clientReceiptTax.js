import { paymentFinancialSnapshot } from './clientPaymentAdjustment.js';
import { readClientPaymentRecord } from './clientPaymentRecord.js';
import { receiptMovements } from './clientReceiptMovements.js';

const cents = (value) => Math.round(Number(value || 0) * 100);
export function validReceiptFiscal(fiscal, total) {
  return fiscal && ['base', 'tax', 'total'].every((key) => Number.isFinite(fiscal[key]) && fiscal[key] >= 0)
    && cents(fiscal.base) + cents(fiscal.tax) === cents(total) && cents(fiscal.total) === cents(total);
}

export function receiptFiscal(snapshot, value, allocations) {
  const gross = cents(value);
  if (!snapshot || gross <= 0) return null;
  const components = (snapshot.components || []).filter((row) => cents(row.base) + cents(row.tax) > 0);
  if (allocations?.length) {
    const known = new Map(components.map((row) => [row.key, row]));
    let allocated = 0, base = 0;
    const seen = new Set();
    for (const part of allocations) {
      if (!part || typeof part !== 'object') return null;
      const component = known.get(part.key), partGross = cents(part.amount);
      if (!component || seen.has(part.key) || !Number.isSafeInteger(partGross) || partGross < 0) return null;
      seen.add(part.key); allocated += partGross;
      base += Math.round(partGross * cents(component.base) / (cents(component.base) + cents(component.tax)));
    }
    if (allocated !== gross) return null;
    return { base: base / 100, tax: (gross - base) / 100, total: gross / 100, method: 'components', allocations };
  }
  if (gross === cents(snapshot.total)) return { base: snapshot.base, tax: snapshot.tax, total: gross / 100, method: 'snapshot' };
  const rates = new Set(components.map((row) => row.rate));
  if (snapshot.tax === 0 || (components.length && rates.size === 1)) {
    const base = Math.round(gross * cents(snapshot.base) / cents(snapshot.total));
    return { base: base / 100, tax: (gross - base) / 100, total: gross / 100, method: 'single-treatment' };
  }
  return null;
}

// Carry a rounding cent into the last uniform-tax receipt, never into an older journal entry.
export function reconcileReceiptRounding(snapshot, fiscal, previous) {
  if (!snapshot || !validReceiptFiscal(fiscal, fiscal?.total)) return fiscal;
  const components = (snapshot.components || []).filter((row) => cents(row.base) + cents(row.tax) > 0);
  if (!components.length || new Set(components.map((row) => row.rate)).size !== 1
    || previous.some((row) => !validReceiptFiscal(row.fiscal, row.amount))) return fiscal;
  const gross = previous.reduce((sum, row) => sum + cents(row.amount), cents(fiscal.total));
  if (gross !== cents(snapshot.total)) return fiscal;
  const base = cents(snapshot.base) - previous.reduce((sum, row) => sum + cents(row.fiscal.base), 0);
  const tax = cents(fiscal.total) - base;
  if (base < 0 || tax < 0 || Math.abs(base - cents(fiscal.base)) > 1) return fiscal;
  return { ...fiscal, base: base / 100, tax: tax / 100 };
}

export function clientReceiptTaxSummary(event, received) {
  const total = paymentFinancialSnapshot(event);
  if (!total) return { total: null, received: null, outstanding: null };
  const record = readClientPaymentRecord(event.clientPaymentRecord);
  const projected = receiptMovements(record), active = projected.rows.filter((row) => !row.voided);
  const reference = record?.settledFinancials;
  // Reversing another receipt does not invalidate an untouched receipt's uniform fiscal reference.
  const fiscalFor = (row) => validReceiptFiscal(row.fiscal, row.amount) ? row.fiscal
    : !row.lastCorrection ? receiptFiscal(row.salesSnapshot || reference, row.amount) : null;
  let base = 0, tax = 0, knownGross = 0;
  for (const row of active) {
    const fiscal = fiscalFor(row);
    if (validReceiptFiscal(fiscal, row.amount)) {
      base += cents(fiscal.base); tax += cents(fiscal.tax); knownGross += cents(row.amount);
    }
  }
  const unknown = active.filter((row) => !validReceiptFiscal(fiscalFor(row), row.amount));
  const untouchedUnknown = unknown.length && unknown.every((row) => !row.lastCorrection);
  if (untouchedUnknown && reference && cents(reference.total) === unknown.reduce((sum, row) => sum + cents(row.amount), 0)) {
    base += cents(reference.base); tax += cents(reference.tax); knownGross += cents(reference.total);
  }
  let paid = null;
  if (!cents(received)) paid = { base: 0, tax: 0, total: 0 };
  else if (projected.reliable && knownGross === cents(received)) paid = { base: base / 100, tax: tax / 100, total: received };
  // A fully covered original snapshot is also reliable when its legacy entries lacked per-receipt VAT.
  else if (!record?.entries.some((row) => row.operation) && reference && cents(reference.total) === cents(received)) paid = { base: reference.base, tax: reference.tax, total: received };
  let outstanding = paid && received <= total.total ? {
    base: (cents(total.base) - cents(paid.base)) / 100,
    tax: (cents(total.tax) - cents(paid.tax)) / 100,
    total: (cents(total.total) - cents(received)) / 100,
  } : null;
  if (outstanding && (outstanding.base < 0 || outstanding.tax < 0)) outstanding = null;
  return { total, received: paid, outstanding };
}
