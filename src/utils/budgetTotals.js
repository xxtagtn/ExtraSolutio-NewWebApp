import { decimalValue, roundedBillableHours } from './serviceFinance.js';
import { calculateTravelAmount } from './travelCalculator.js';
import { externalCostsTotals } from './externalCosts.js';
import { calculateVatAmount, roundMoney, sumMoney } from '../../shared/money.js';

function calcHours(start, end) {
  return roundedBillableHours(start, end);
}

function numberValue(value) {
  return decimalValue(value) || 0;
}

export function calculateBudgetTotals(form = {}) {
  const allDaysRaw = form.eventDays || [];
  const allDaysWithDate = allDaysRaw.filter((day) => day.date);
  const dayByDate = new Map(allDaysWithDate.map((day) => [day.date, day]));

  function categoryHours(category) {
    if (category.start || category.end) {
      const explicitHours = calcHours(category.start, category.end);
      if (explicitHours > 0) return explicitHours;
    }

    if (category.date) {
      const day = dayByDate.get(category.date);
      if (day) return calcHours(day.startTime, day.endTime);
      const fallbackDay = allDaysRaw.find((item) => item.startTime || item.endTime);
      if (fallbackDay) return calcHours(fallbackDay.startTime, fallbackDay.endTime);
      return calcHours(form.startTime, form.endTime);
    }

    if (allDaysRaw.length) {
      const totalFromDays = allDaysRaw.reduce((sum, day) => sum + calcHours(day.startTime, day.endTime), 0);
      if (totalFromDays > 0) return totalFromDays;
    }

    return calcHours(form.startTime, form.endTime);
  }

  const baseAmount = (form.categories || []).reduce((sum, category) => {
    const hours = categoryHours(category);
    return sum + (numberValue(category.qty) * numberValue(category.rate) * hours);
  }, 0);

  const travelAmount = calculateTravelAmount(form);
  const externalTotals = externalCostsTotals(form.externalCosts);
  const externalCostsAmount = externalTotals.chargeAmount;
  const grossSubtotal = baseAmount + travelAmount + externalCostsAmount;
  const discountAmount = grossSubtotal * (numberValue(form.discountRate) / 100);
  const subtotalAmount = Math.max(0, grossSubtotal - discountAmount);
  const discountFactor = grossSubtotal > 0 ? subtotalAmount / grossSubtotal : 1;
  const ownServicesBase = (baseAmount + travelAmount) * discountFactor;
  const externalExemptBase = externalTotals.exemptBase * discountFactor;
  const externalVat13Base = externalTotals.vat13Base * discountFactor;
  const externalVat23Base = externalTotals.vat23Base * discountFactor;
  const ownVatRate = form.vatMode === 'exempt' ? 0 : (numberValue(form.vatRate) || 23);
  const ownExemptBase = ownVatRate === 0 ? ownServicesBase : 0;
  const ownVat13Base = ownVatRate === 13 ? ownServicesBase : 0;
  const ownVat23Base = ownVatRate === 23 ? ownServicesBase : 0;
  const vatBreakdown = {
    exempt: {
      base: roundMoney(ownExemptBase + externalExemptBase),
      tax: 0,
    },
    13: {
      base: roundMoney(ownVat13Base + externalVat13Base),
      tax: 0,
    },
    23: {
      base: roundMoney(ownVat23Base + externalVat23Base),
      tax: 0,
    },
  };
  // Keep the existing rate groups and discount split; reconcile their base rounding into the last nonempty group.
  const baseRounding = sumMoney(subtotalAmount, ...Object.values(vatBreakdown).map((part) => -part.base));
  const lastRate = [23, 13, 'exempt'].find((key) => vatBreakdown[key].base > 0 && sumMoney(vatBreakdown[key].base, baseRounding) >= 0) || 'exempt';
  vatBreakdown[lastRate].base = sumMoney(vatBreakdown[lastRate].base, baseRounding);
  vatBreakdown[13].tax = calculateVatAmount(vatBreakdown[13].base, 13);
  vatBreakdown[23].tax = calculateVatAmount(vatBreakdown[23].base, 23);
  const taxAmount = sumMoney(vatBreakdown[13].tax, vatBreakdown[23].tax);
  const ownServicesTaxAmount = sumMoney(
    calculateVatAmount(Math.min(ownVat13Base, vatBreakdown[13].base), 13),
    calculateVatAmount(Math.min(ownVat23Base, vatBreakdown[23].base), 23));
  const externalCostsTaxAmount = sumMoney(taxAmount, -ownServicesTaxAmount);
  const externalCostsGrossAmount = sumMoney(externalCostsAmount * discountFactor, externalCostsTaxAmount);
  const totalWithTax = sumMoney(subtotalAmount, taxAmount);
  const totalAmount = totalWithTax;

  return {
    baseAmount: roundMoney(baseAmount),
    travelAmount: roundMoney(travelAmount),
    externalCostsAmount: roundMoney(externalCostsAmount),
    externalCostsBaseAmount: externalTotals.costAmount,
    externalCostsMarginAmount: externalTotals.marginAmount,
    externalCostsTaxAmount,
    externalCostsGrossAmount,
    ownServicesAmount: roundMoney(baseAmount + travelAmount),
    ownServicesTaxAmount,
    subtotalAmount: roundMoney(subtotalAmount),
    taxAmount,
    vatBreakdown,
    totalWithTax,
    discountAmount: roundMoney(discountAmount),
    totalAmount: roundMoney(totalAmount),
  };
}
