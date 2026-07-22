import { decimalValue } from './serviceFinance.js';

function parseAdvanceCollection(value) {
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
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function normalizeStaffAdvances(value) {
  return parseAdvanceCollection(value)
    .map((item, index) => {
      const amount = decimalValue(item?.amount) || 0;
      return {
        id: String(item?.id || `advance-${index + 1}`),
        date: normalizeAdvanceDate(item?.date),
        amount: Number(amount.toFixed(2)),
        note: String(item?.note || '').trim(),
        car: Boolean(item?.car),
      };
    })
    .filter((item) => item.amount > 0);
}

export function serializeStaffAdvances(value) {
  const normalized = normalizeStaffAdvances(value);
  return normalized.length ? JSON.stringify(normalized) : null;
}

export function staffAdvancesTotal(value) {
  return Number(normalizeStaffAdvances(value)
    .filter((item) => !item.car)
    .reduce((sum, item) => sum + (decimalValue(item.amount) || 0), 0)
    .toFixed(2));
}

export function staffCarAdvancesTotal(value) {
  return Number(normalizeStaffAdvances(value)
    .filter((item) => item.car)
    .reduce((sum, item) => sum + (decimalValue(item.amount) || 0), 0)
    .toFixed(2));
}

export function staffPaymentRemaining(total, advances) {
  const gross = decimalValue(total) || 0;
  const salaryRemaining = Math.max(0, gross - staffAdvancesTotal(advances));
  return Number((salaryRemaining + staffCarAdvancesTotal(advances)).toFixed(2));
}
