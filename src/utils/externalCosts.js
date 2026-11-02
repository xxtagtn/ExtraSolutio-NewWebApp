import { decimalValue } from './serviceFinance.js';
import { calculateVatAmount, roundMoney, sumMoney } from '../../shared/money.js';

export const EXTERNAL_COST_VAT_OPTIONS = [
  { value: 'exempt', label: 'Isento' },
  { value: 'standard_23', label: '23%' },
  { value: 'catering', label: 'Catering (85% sujeito a IVA 13% + 15% sujeito a IVA 23%)' },
];

export const DEFAULT_EXTERNAL_COST_VAT_TYPE = 'standard_23';

export const EXTERNAL_COST_TYPE_OPTIONS = [
  'Catering',
  'Bebidas',
  'Material',
  'Aluguer',
  'Transporte',
  'Outro',
];

export function createEmptyExternalCost() {
  return {
    type: '',
    supplier: '',
    description: '',
    costAmount: '',
    marginPercent: 0,
    vatType: DEFAULT_EXTERNAL_COST_VAT_TYPE,
  };
}

function asText(value) {
  return String(value || '').trim();
}

function asNumber(value) {
  return decimalValue(value) || 0;
}

function precisePercent(value) {
  return Number(value.toFixed(6));
}

function roundAmount(value) {
  return roundMoney(value || 0);
}

function normalizeVatType(value) {
  if (value === 'exempt' || value === 'catering' || value === 'standard_23') return value;
  return DEFAULT_EXTERNAL_COST_VAT_TYPE;
}

export function externalCostVatBreakdown(chargeAmount, vatType = DEFAULT_EXTERNAL_COST_VAT_TYPE) {
  const netAmount = roundAmount(Math.max(0, asNumber(chargeAmount)));
  const resolvedVatType = normalizeVatType(vatType);

  if (resolvedVatType === 'exempt') {
    return {
      vatType: resolvedVatType,
      exemptBase: roundAmount(netAmount),
      vat13Base: 0,
      vat13Amount: 0,
      vat23Base: 0,
      vat23Amount: 0,
      taxAmount: 0,
      grossAmount: roundAmount(netAmount),
    };
  }

  const vat13Base = resolvedVatType === 'catering' ? roundAmount(netAmount * 0.85) : 0;
  const vat23Base = sumMoney(netAmount, -vat13Base);
  const vat13Amount = calculateVatAmount(vat13Base, 13);
  const vat23Amount = calculateVatAmount(vat23Base, 23);
  const taxAmount = sumMoney(vat13Amount, vat23Amount);

  return {
    vatType: resolvedVatType,
    exemptBase: 0,
    vat13Base: roundAmount(vat13Base),
    vat13Amount: roundAmount(vat13Amount),
    vat23Base: roundAmount(vat23Base),
    vat23Amount: roundAmount(vat23Amount),
    taxAmount: roundAmount(taxAmount),
    grossAmount: sumMoney(netAmount, taxAmount),
  };
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
      const vatType = normalizeVatType(item?.vatType);
      const vat = externalCostVatBreakdown(chargeAmount, vatType);
      return {
        id: asText(item?.id) || `external-${index + 1}`,
        type: asText(item?.type),
        supplier: asText(item?.supplier),
        description: asText(item?.description),
        costAmount: roundAmount(costAmount),
        marginPercent: precisePercent(marginPercent),
        marginAmount: roundAmount(marginAmount),
        chargeAmount: roundAmount(chargeAmount),
        vatType,
        ...vat,
        status: asText(item?.status) || 'pending',
      };
    })
    .filter((item) => item.type || item.supplier || item.description || item.costAmount > 0);
}

export function externalCostsTotals(value = []) {
  return normalizeExternalCosts(value).reduce((totals, item) => ({
    costAmount: roundAmount(totals.costAmount + item.costAmount),
    marginAmount: roundAmount(totals.marginAmount + item.marginAmount),
    chargeAmount: roundAmount(totals.chargeAmount + item.chargeAmount),
    exemptBase: roundAmount(totals.exemptBase + item.exemptBase),
    vat13Base: roundAmount(totals.vat13Base + item.vat13Base),
    vat13Amount: roundAmount(totals.vat13Amount + item.vat13Amount),
    vat23Base: roundAmount(totals.vat23Base + item.vat23Base),
    vat23Amount: roundAmount(totals.vat23Amount + item.vat23Amount),
    taxAmount: roundAmount(totals.taxAmount + item.taxAmount),
    grossAmount: roundAmount(totals.grossAmount + item.grossAmount),
  }), {
    costAmount: 0,
    marginAmount: 0,
    chargeAmount: 0,
    exemptBase: 0,
    vat13Base: 0,
    vat13Amount: 0,
    vat23Base: 0,
    vat23Amount: 0,
    taxAmount: 0,
    grossAmount: 0,
  });
}
