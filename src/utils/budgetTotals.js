import { decimalValue, roundedBillableHours } from './serviceFinance.js';
import { calculateTravelAmount } from './travelCalculator.js';
import { externalCostsTotals } from './externalCosts.js';

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
      base: Number((ownExemptBase + externalExemptBase).toFixed(2)),
      tax: 0,
    },
    13: {
      base: Number((ownVat13Base + externalVat13Base).toFixed(2)),
      tax: Number(((ownVat13Base * 0.13) + (externalVat13Base * 0.13)).toFixed(2)),
    },
    23: {
      base: Number((ownVat23Base + externalVat23Base).toFixed(2)),
      tax: Number(((ownVat23Base * 0.23) + (externalVat23Base * 0.23)).toFixed(2)),
    },
  };
  const taxAmount = vatBreakdown[13].tax + vatBreakdown[23].tax;
  const externalCostsTaxAmount = Number((
    (externalVat13Base * 0.13) + (externalVat23Base * 0.23)
  ).toFixed(2));
  const externalCostsGrossAmount = Number((externalCostsAmount * discountFactor + externalCostsTaxAmount).toFixed(2));
  const totalWithTax = subtotalAmount + taxAmount;
  const totalAmount = totalWithTax;

  return {
    baseAmount: Number(baseAmount.toFixed(2)),
    travelAmount: Number(travelAmount.toFixed(2)),
    externalCostsAmount: Number(externalCostsAmount.toFixed(2)),
    externalCostsBaseAmount: externalTotals.costAmount,
    externalCostsMarginAmount: externalTotals.marginAmount,
    externalCostsTaxAmount,
    externalCostsGrossAmount,
    ownServicesAmount: Number((baseAmount + travelAmount).toFixed(2)),
    ownServicesTaxAmount: Number((
      (ownVat13Base * 0.13) + (ownVat23Base * 0.23)
    ).toFixed(2)),
    subtotalAmount: Number(subtotalAmount.toFixed(2)),
    taxAmount: Number(taxAmount.toFixed(2)),
    vatBreakdown,
    totalWithTax: Number(totalWithTax.toFixed(2)),
    discountAmount: Number(discountAmount.toFixed(2)),
    totalAmount: Number(totalAmount.toFixed(2)),
  };
}
