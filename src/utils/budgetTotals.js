import { decimalValue } from './serviceFinance.js';
import { calculateTravelAmount } from './travelCalculator.js';

function parseTime(value) {
  const [h, m] = String(value || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return (h * 60 + m) / 60;
}

function calcHours(start, end) {
  const s = parseTime(start);
  const e = parseTime(end);
  const hasStart = String(start || '').includes(':');
  const hasEnd = String(end || '').includes(':');
  if (!hasStart || !hasEnd) return 0;
  if (e === s) return 0;
  if (e > s) return e - s;
  return (24 - s) + e;
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
  const subtotal = baseAmount + travelAmount;
  const taxRate = form.vatMode === 'exempt' ? 0 : numberValue(form.vatRate);
  const taxAmount = subtotal * (taxRate / 100);
  const totalWithTax = subtotal + taxAmount;
  const discountAmount = totalWithTax * (numberValue(form.discountRate) / 100);
  const totalAmount = totalWithTax - discountAmount;

  return {
    baseAmount: Number(baseAmount.toFixed(2)),
    travelAmount: Number(travelAmount.toFixed(2)),
    taxAmount: Number(taxAmount.toFixed(2)),
    totalWithTax: Number(totalWithTax.toFixed(2)),
    discountAmount: Number(discountAmount.toFixed(2)),
    totalAmount: Number(totalAmount.toFixed(2)),
  };
}
