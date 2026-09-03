import { externalCostsTotals } from '../../src/utils/externalCosts.js';
import {
  assignmentEventDay,
  activeEventAssignments,
  activeEventDayKeys,
  activeEventRequiredRoles,
  eventDayKey,
} from '../../src/utils/eventCancelledDays.js';
import {
  clientChargeHours,
  clientRealHours,
  decimalValue,
  roundedBillableHours,
  staffWorkedHours,
} from '../../src/utils/serviceFinance.js';
import {
  billableEventAssignments,
  clientRateForAssignment,
  eventRoleKey,
  requiredRoleEntries,
} from '../../src/utils/eventFinancialRules.js';
import { staffCarAdvancesTotal } from '../../src/utils/staffAdvances.js';
import { staffPaymentTotal } from '../../src/utils/staffPayment.js';

function numberValue(value) {
  return decimalValue(value) || 0;
}

const ACTUAL_ONLY_STATUSES = new Set([
  'to_validate_staff',
  'to_validate_client',
  'finalized',
  'completed',
  'invoiced',
  'paid',
  'cancelled',
]);

function requirementDay(requirement = {}) {
  return eventDayKey(requirement.day || requirement.date || requirement.workDate);
}

function requirementKey(role, day = '') {
  return `${day}|${eventRoleKey(role)}`;
}

function expandedRequirements(event = {}) {
  const activeDays = activeEventDayKeys(event);
  return requiredRoleEntries(activeEventRequiredRoles(event)).flatMap((requirement) => {
    const explicitDay = requirementDay(requirement);
    const days = event.isContinuous
      ? (explicitDay ? [explicitDay] : activeDays)
      : [''];
    return days.map((day) => ({ ...requirement, day }));
  });
}

function includeUnfilledRequirements(event = {}) {
  return !ACTUAL_ONLY_STATUSES.has(String(event.status || '').trim().toLowerCase());
}

function requiredVacancies(event = {}, assignments = []) {
  if (!includeUnfilledRequirements(event)) return [];
  const requirements = expandedRequirements(event);
  const assignedByRequirement = new Map();
  const requirementsByDay = new Map();

  for (const requirement of requirements) {
    const day = event.isContinuous ? requirement.day : '';
    if (!requirementsByDay.has(day)) requirementsByDay.set(day, []);
    requirementsByDay.get(day).push(requirement);
  }

  for (const assignment of assignments) {
    const day = event.isContinuous ? assignmentEventDay(assignment, event) : '';
    const role = eventRoleKey(assignment.role);
    let key = role ? requirementKey(assignment.role, day) : '';
    if (!key || !requirements.some((requirement) => requirementKey(requirement.role, requirement.day) === key)) {
      const dayRequirements = requirementsByDay.get(day) || [];
      if (dayRequirements.length === 1) key = requirementKey(dayRequirements[0].role, day);
    }
    if (key) assignedByRequirement.set(key, (assignedByRequirement.get(key) || 0) + 1);
  }

  return requirements.flatMap((requirement) => {
    const key = requirementKey(requirement.role, requirement.day);
    const assigned = assignedByRequirement.get(key) || 0;
    assignedByRequirement.set(key, Math.max(0, assigned - requirement.qty));
    const missing = Math.max(0, requirement.qty - assigned);
    return Array.from({ length: missing }, () => requirement);
  });
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

export function calculateEventTotals(event = {}, assignments = event.assignments || [], {
  preserveClientTotals = false,
} = {}) {
  const billableAssignments = billableEventAssignments(activeEventAssignments(event, assignments));
  const vacancies = requiredVacancies(event, billableAssignments);
  let assignmentRevenue = 0;
  let assignmentCost = 0;
  let realHours = 0;
  let billableHours = 0;
  let clientPricingComplete = true;
  let staffPricingComplete = true;

  for (const assignment of billableAssignments) {
    const clientHours = clientChargeHours(
      assignment,
      event.startTime,
      event.endTime,
      event.minimumHoursSnapshot,
    );
    const staffHours = staffWorkedHours(assignment, event.startTime, event.endTime);
    const clientRate = clientRateForAssignment(assignment, event);
    const staffRate = numberValue(assignment.hourlyRate);
    const explicitStaffTotal = numberValue(assignment.totalPay);
    const baseStaffCost = staffRate > 0 ? staffHours * staffRate : explicitStaffTotal;
    if (clientHours > 0 && clientRate <= 0) clientPricingComplete = false;
    if (staffHours > 0 && staffRate <= 0 && explicitStaffTotal <= 0) staffPricingComplete = false;
    assignmentRevenue += clientHours * clientRate;
    assignmentCost += staffPaymentTotal(
      baseStaffCost,
      Boolean(assignment.collaborator?.includeVat),
      assignment.paymentAdjustment,
    ) + staffCarAdvancesTotal(assignment.advancePayments);
    realHours += clientRealHours(assignment);
    billableHours += clientHours;
  }

  for (const requirement of vacancies) {
    const plannedHours = Math.max(
      roundedBillableHours(
        requirement.start || event.startTime,
        requirement.end || event.endTime,
      ),
      numberValue(event.minimumHoursSnapshot),
    );
    const clientRate = clientRateForAssignment({ role: requirement.role }, event);
    if (plannedHours > 0 && clientRate <= 0) clientPricingComplete = false;
    assignmentRevenue += plannedHours * clientRate;
    billableHours += plannedHours;
  }

  const travelRevenue = event.travelExpenseEnabled ? numberValue(event.travelExpenseAmount) : 0;
  const externalTotals = externalCostsTotals(event.externalCosts);
  const ownServicesRevenue = assignmentRevenue + travelRevenue;
  const calculatedNetRevenue = ownServicesRevenue + externalTotals.chargeAmount;
  const calculatedTax = (ownServicesRevenue * (numberValue(event.vatRateSnapshot) / 100))
    + externalTotals.taxAmount;
  const calculatedGrossRevenue = calculatedNetRevenue + calculatedTax;
  const calculatedCost = assignmentCost + externalTotals.costAmount;

  const hasRevenueStructure = billableAssignments.length > 0
    || vacancies.length > 0
    || travelRevenue > 0
    || externalTotals.chargeAmount > 0;
  const hasCostStructure = billableAssignments.length > 0 || externalTotals.costAmount > 0;
  const importedBudgetWithoutStructure = !hasRevenueStructure
    && /\[BUDGET_REF:[^\]]+\]/i.test(String(event.notes || ''));
  const preserveCommercialSnapshot = preserveClientTotals
    || importedBudgetWithoutStructure
    || (!clientPricingComplete && numberValue(event.totalRevenue) > 0);
  const preserveCostSnapshot = !staffPricingComplete
    && hasCostStructure
    && numberValue(event.totalCost) > 0;
  const taxAmount = preserveCommercialSnapshot ? numberValue(event.taxAmount) : calculatedTax;
  const totalRevenue = preserveCommercialSnapshot ? numberValue(event.totalRevenue) : calculatedGrossRevenue;
  const totalCost = preserveCostSnapshot ? numberValue(event.totalCost) : calculatedCost;

  return {
    totalRevenue: Number(totalRevenue.toFixed(2)),
    totalCost: Number(totalCost.toFixed(2)),
    taxAmount: Number(taxAmount.toFixed(2)),
    realHours: Number((preserveClientTotals ? numberValue(event.realHours) : realHours).toFixed(2)),
    billableHours: Number((preserveClientTotals ? numberValue(event.billableHours) : billableHours).toFixed(2)),
  };
}
