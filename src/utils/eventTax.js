import { decimalValue } from './serviceFinance.js';
import { externalCostsTotals } from './externalCosts.js';

function numberValue(value) {
  return decimalValue(value) || 0;
}

export function eventTaxAmount(event = {}) {
  const explicitTax = Math.max(0, numberValue(event.taxAmount));
  const externalTax = externalCostsTotals(event.externalCosts).taxAmount;
  return Number(Math.max(explicitTax, externalTax).toFixed(2));
}

export function expensesIncludingEventTax(event = {}, operationalExpenses = 0) {
  return Number((Math.max(0, numberValue(operationalExpenses)) + eventTaxAmount(event)).toFixed(2));
}
