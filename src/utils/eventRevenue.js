import { decimalValue } from './serviceFinance.js';

function numberValue(value) {
  return decimalValue(value) || 0;
}

export function resolveEventRevenue({
  calculatedTotalRevenue = 0,
  calculatedExpectedRevenue = 0,
  storedTotalRevenue = 0,
} = {}) {
  const calculatedTotal = numberValue(calculatedTotalRevenue);
  if (calculatedTotal > 0) return Number(calculatedTotal.toFixed(2));

  const expected = numberValue(calculatedExpectedRevenue);
  if (expected > 0) return Number(expected.toFixed(2));

  const stored = numberValue(storedTotalRevenue);
  return Number(stored.toFixed(2));
}
