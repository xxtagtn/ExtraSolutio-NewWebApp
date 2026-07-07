import { decimalValue } from './serviceFinance.js';

function asText(value) {
  return String(value || '').trim();
}

function asNumber(value) {
  return decimalValue(value) || 0;
}

function precisePercent(value) {
  return Number(value.toFixed(6));
}

function parseArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeExternalCosts(value = []) {
  return parseArray(value)
    .map((item, index) => {
      const costAmount = asNumber(item?.costAmount);
      const marginPercent = asNumber(item?.marginPercent);
      const marginAmount = costAmount * (marginPercent / 100);
      const chargeAmount = costAmount + marginAmount;
      return {
        id: asText(item?.id) || `external-${index + 1}`,
        type: asText(item?.type),
        supplier: asText(item?.supplier),
        description: asText(item?.description),
        costAmount: Number(costAmount.toFixed(2)),
        marginPercent: precisePercent(marginPercent),
        marginAmount: Number(marginAmount.toFixed(2)),
        chargeAmount: Number(chargeAmount.toFixed(2)),
        status: asText(item?.status) || 'pending',
      };
    })
    .filter((item) => item.type || item.supplier || item.description || item.costAmount > 0);
}

export function externalCostsTotals(value = []) {
  return normalizeExternalCosts(value).reduce((totals, item) => ({
    costAmount: Number((totals.costAmount + item.costAmount).toFixed(2)),
    marginAmount: Number((totals.marginAmount + item.marginAmount).toFixed(2)),
    chargeAmount: Number((totals.chargeAmount + item.chargeAmount).toFixed(2)),
  }), {
    costAmount: 0,
    marginAmount: 0,
    chargeAmount: 0,
  });
}
