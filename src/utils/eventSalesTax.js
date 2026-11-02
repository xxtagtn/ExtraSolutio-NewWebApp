import { decimalValue } from './serviceFinance.js';
import { calculateVatAmount, sumMoney, roundMoney } from '../../shared/money.js';

export function eventStaffVatRate(event = {}) {
  return Math.max(0, decimalValue(event.staffVatRateSnapshot ?? event.vatRateSnapshot) || 0);
}

export function normalizeStaffVatRate(value) {
  if (value === undefined || value === null) return value;
  const rate = decimalValue(value);
  if (value === '' || ![0, 23].includes(rate)) {
    const error = new Error('Seleciona IVA de Staff a 23% ou sem acréscimo de IVA.');
    error.statusCode = 422;
    error.expose = true;
    throw error;
  }
  return rate;
}

export function calculateEventSalesTax(event, { staffSale = 0, travelSale = 0, partnerTax = 0 } = {}) {
  const staffRate = eventStaffVatRate(event);
  const staffTax = calculateVatAmount(staffSale, staffRate);
  // The legacy event rate still governs travel; the Staff override must not change it.
  const travelRate = Math.max(0, decimalValue(event.vatRateSnapshot) || 0);
  // Preserve the existing common-rate grouping; carry its rounding cent into travel.
  const travelTax = staffRate === travelRate
    ? sumMoney(calculateVatAmount(sumMoney(staffSale, travelSale), staffRate), -staffTax)
    : calculateVatAmount(travelSale, travelRate);
  const roundedPartnerTax = roundMoney(partnerTax);
  return { staffTax, travelTax, partnerTax: roundedPartnerTax, taxAmount: sumMoney(staffTax, travelTax, roundedPartnerTax) };
}
