import { activeEventAssignments } from './eventCancelledDays.js';
import { billableEventAssignments } from './eventFinancialRules.js';
import { externalCostsTotals } from './externalCosts.js';
import { decimalValue, staffPaymentHours } from './serviceFinance.js';
import { staffCarAdvancesTotal } from './staffAdvances.js';
import { staffPaymentTotal } from './staffPayment.js';
import { staffTravelCompensation } from './staffTravel.js';

const amount = (value) => decimalValue(value) || 0;
const money = (value) => Number(value.toFixed(2));

export function internalAssignmentCostParts(work, travel, includesVat, adjustment, advances) {
  const total = staffPaymentTotal(work + travel, includesVat, adjustment);
  const staffCost = staffPaymentTotal(work, includesVat, adjustment);
  // Use the difference of the existing rounded totals, including VAT and the
  // adjustment floor. Taxing travel separately can introduce a one-cent drift.
  const travelTimeCost = money(total - staffCost);
  const travelCarCost = staffCarAdvancesTotal(advances);
  return { staffCost, travelTimeCost, travelCarCost, travelCost: money(travelTimeCost + travelCarCost) };
}

export function eventInternalCosts(event = {}, inclusiveCost) {
  const assignments = billableEventAssignments(activeEventAssignments(event));
  let calculated = 0;
  let travelTimeCost = 0;
  let travelCarCost = 0;
  for (const assignment of assignments) {
    const rate = amount(assignment.hourlyRate);
    const work = rate > 0
      ? staffPaymentHours(assignment, event.startTime, event.endTime) * rate
      : amount(assignment.totalPay);
    const parts = internalAssignmentCostParts(work,
      staffTravelCompensation(assignment, event, assignments).amount,
      Boolean(assignment.collaborator?.includeVat), assignment.paymentAdjustment, assignment.advancePayments);
    calculated += parts.staffCost + parts.travelCost;
    travelTimeCost += parts.travelTimeCost;
    travelCarCost += parts.travelCarCost;
  }
  const staffInclusiveCost = money(Math.max(0, inclusiveCost === undefined
    ? amount(event.totalCost) - externalCostsTotals(event.externalCosts).costAmount
    : amount(inclusiveCost)));
  const costBreakdownComplete = Math.round(money(calculated) * 100) === Math.round(staffInclusiveCost * 100);
  // Do not manufacture a split for retained historical snapshots or partial payloads.
  const travelCost = costBreakdownComplete ? money(travelTimeCost + travelCarCost) : 0;
  return {
    staffInclusiveCost,
    staffCost: money(staffInclusiveCost - travelCost),
    travelCost,
    travelTimeCost: costBreakdownComplete ? money(travelTimeCost) : 0,
    travelCarCost: costBreakdownComplete ? money(travelCarCost) : 0,
    costBreakdownComplete,
  };
}
