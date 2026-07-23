import { externalCostsTotals } from '../../src/utils/externalCosts.js';
import {
  clientChargeHours,
  clientRealHours,
  decimalValue,
  staffWorkedHours,
} from '../../src/utils/serviceFinance.js';
import {
  billableEventAssignments,
  clientRateForAssignment,
} from '../../src/utils/eventFinancialRules.js';
import { staffCarAdvancesTotal } from '../../src/utils/staffAdvances.js';
import { staffPaymentTotal } from '../../src/utils/staffPayment.js';

function numberValue(value) {
  return decimalValue(value) || 0;
}

export function assignmentHasRecordedHours(assignment = {}) {
  return Boolean(
    assignment.checkIn
    || assignment.checkOut
    || assignment.clientCheckIn
    || assignment.clientCheckOut
    || assignment.validatedCheckIn
    || assignment.validatedCheckOut
    || numberValue(assignment.hoursWorked) > 0
    || numberValue(assignment.clientRealHours) > 0
    || numberValue(assignment.clientBillableHours) > 0
    || numberValue(assignment.staffPayableHours) > 0
  );
}

export function calculateEventTotals(event = {}, assignments = event.assignments || []) {
  const billableAssignments = billableEventAssignments(assignments);
  let assignmentRevenue = 0;
  let assignmentCost = 0;
  let realHours = 0;
  let billableHours = 0;

  for (const assignment of billableAssignments) {
    const clientHours = clientChargeHours(
      assignment,
      event.startTime,
      event.endTime,
      event.minimumHoursSnapshot,
    );
    const staffHours = staffWorkedHours(assignment, event.startTime, event.endTime);
    const clientRate = clientRateForAssignment(assignment, event);
    const baseStaffCost = staffHours * numberValue(assignment.hourlyRate);
    assignmentRevenue += clientHours * clientRate;
    assignmentCost += staffPaymentTotal(
      baseStaffCost,
      Boolean(assignment.collaborator?.includeVat),
      assignment.paymentAdjustment,
    ) + staffCarAdvancesTotal(assignment.advancePayments);
    realHours += clientRealHours(assignment);
    billableHours += clientHours;
  }

  const travelRevenue = event.travelExpenseEnabled ? numberValue(event.travelExpenseAmount) : 0;
  const externalTotals = externalCostsTotals(event.externalCosts);
  const ownServicesRevenue = assignmentRevenue + travelRevenue;
  const calculatedNetRevenue = ownServicesRevenue + externalTotals.chargeAmount;
  const calculatedTax = (ownServicesRevenue * (numberValue(event.vatRateSnapshot) / 100))
    + externalTotals.taxAmount;
  const calculatedGrossRevenue = calculatedNetRevenue + calculatedTax;
  const calculatedCost = assignmentCost + externalTotals.costAmount;

  // Preserve a commercial total imported from a budget when hourly client/staff
  // rates are not available to rebuild that value safely.
  const preserveStoredTotals = assignments.length === 0 || billableAssignments.length > 0;
  const preserveCommercialSnapshot = preserveStoredTotals && assignmentRevenue <= 0;
  const taxAmount = preserveCommercialSnapshot
    ? Math.max(numberValue(event.taxAmount), calculatedTax)
    : calculatedTax;
  const totalRevenue = preserveCommercialSnapshot
    ? Math.max(numberValue(event.totalRevenue), calculatedNetRevenue + taxAmount)
    : calculatedGrossRevenue;
  const totalCost = preserveStoredTotals && assignmentCost <= 0
    ? Math.max(numberValue(event.totalCost), calculatedCost)
    : calculatedCost;

  return {
    totalRevenue: Number(totalRevenue.toFixed(2)),
    totalCost: Number(totalCost.toFixed(2)),
    taxAmount: Number(taxAmount.toFixed(2)),
    realHours: Number(realHours.toFixed(2)),
    billableHours: Number(billableHours.toFixed(2)),
  };
}
