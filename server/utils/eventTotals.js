import { externalCostsTotals } from '../../src/utils/externalCosts.js';
import {
  clientChargeHours,
  clientRealHours,
  decimalValue,
  staffWorkedHours,
} from '../../src/utils/serviceFinance.js';
import { staffCarAdvancesTotal } from '../../src/utils/staffAdvances.js';

const NON_BILLABLE_STATUSES = new Set(['missed_justified', 'missed_unjustified', 'cancelled']);

function numberValue(value) {
  return decimalValue(value) || 0;
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isBillable(assignment = {}) {
  return !NON_BILLABLE_STATUSES.has(String(assignment.status || '').trim().toLowerCase());
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
  const billableAssignments = (assignments || []).filter(isBillable);
  const roleRates = new Map(
    jsonArray(event.requiredRoles).map((item) => [String(item?.role || ''), numberValue(item?.agreedRate)]),
  );
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
    assignmentRevenue += clientHours * (roleRates.get(String(assignment.role || '')) || 0);
    assignmentCost += (staffHours * numberValue(assignment.hourlyRate))
      + staffCarAdvancesTotal(assignment.advancePayments);
    realHours += clientRealHours(assignment);
    billableHours += clientHours;
  }

  const travelRevenue = event.travelExpenseEnabled ? numberValue(event.travelExpenseAmount) : 0;
  const externalTotals = externalCostsTotals(event.externalCosts);
  const calculatedRevenue = assignmentRevenue + travelRevenue + externalTotals.chargeAmount;
  const calculatedCost = assignmentCost + externalTotals.costAmount;

  // Preserve a commercial total imported from a budget when hourly client/staff
  // rates are not available to rebuild that value safely.
  const totalRevenue = billableAssignments.length > 0 && assignmentRevenue <= 0
    ? Math.max(numberValue(event.totalRevenue), calculatedRevenue)
    : calculatedRevenue;
  const totalCost = billableAssignments.length > 0 && assignmentCost <= 0
    ? Math.max(numberValue(event.totalCost), calculatedCost)
    : calculatedCost;

  return {
    totalRevenue: Number(totalRevenue.toFixed(2)),
    totalCost: Number(totalCost.toFixed(2)),
    realHours: Number(realHours.toFixed(2)),
    billableHours: Number(billableHours.toFixed(2)),
  };
}
