import { activeEventAssignments } from './eventCancelledDays.js';
import { buildClientEventReconciliation } from './clientFinancialSummary.js';
import { calculateFinancialMargin } from './eventFinancialRules.js';
import { eventTaxAmount, expensesIncludingEventTax } from './eventTax.js';
import { externalCostsTotals } from './externalCosts.js';
import { financeEventOperationalSummary } from './financeEventIdentity.js';
import { decimalValue } from './serviceFinance.js';
import { calculateEventSalesTax } from './eventSalesTax.js';

export function eventCostSummary(event = {}) {
  const external = externalCostsTotals(event.externalCosts);
  const revenue = decimalValue(event.totalRevenue) || 0;
  const totalCost = decimalValue(event.totalCost) || 0;
  const staffCost = Math.max(0, totalCost - external.costAmount);
  const tax = eventTaxAmount(event);
  const operational = financeEventOperationalSummary({ ...event, assignments: activeEventAssignments(event) });
  const reconciliation = buildClientEventReconciliation(event, operational);
  const pricingComplete = operational.days.length ? reconciliation.dailyPricingComplete : Math.abs(reconciliation.undiscriminated) < 0.01;
  // Reuse the client-facing itemization; never infer a sale price from internal staff costs.
  const staffSale = pricingComplete ? reconciliation.dailyServiceSubtotal : null;
  const breakdown = calculateEventSalesTax(event, { staffSale: staffSale || 0, travelSale: reconciliation.travel, partnerTax: external.taxAmount });
  const taxBreakdown = staffSale !== null && Math.abs(breakdown.taxAmount - tax) < 0.01 ? breakdown : null;
  const financialMargin = calculateFinancialMargin(revenue, staffCost, expensesIncludingEventTax(event, external.costAmount));
  return {
    staffCost,
    staffSale,
    partnerCost: external.costAmount,
    partnerSale: external.chargeAmount,
    travelSale: reconciliation.travel,
    netSale: Number((revenue - tax).toFixed(2)),
    tax,
    taxBreakdown,
    revenue,
    expenses: Number((staffCost + external.costAmount).toFixed(2)),
    undiscriminated: reconciliation.undiscriminated,
    ...financialMargin,
  };
}
