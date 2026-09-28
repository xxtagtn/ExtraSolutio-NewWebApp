import { decimalValue } from './serviceFinance.js';
import { assignmentEventDay, isAssignmentOnCancelledDay } from './eventCancelledDays.js';
import { isBillableEventAssignment } from './eventFinancialRules.js';
import { normalizeTravelCars } from './travelCalculator.js';

function entries(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeStaffTravel(value) {
  return entries(value).filter((item) => item?.kind === 'staff_compensation').map((item) => ({
    kind: 'staff_compensation',
    assignmentId: Number(item.assignmentId),
    collaboratorId: Number(item.collaboratorId),
    carId: String(item.carId || ''),
    durationHours: Math.max(0, decimalValue(item.durationHours) || 0),
  })).filter((item) => Number.isInteger(item.assignmentId) && item.assignmentId > 0
    && Number.isInteger(item.collaboratorId) && item.collaboratorId > 0);
}

// Keep commercial cars and staff compensation in the existing JSON column.
// The commercial calculator deliberately ignores compensation entries.
export function travelConfiguration(cars, compensation = normalizeStaffTravel(cars)) {
  return [...normalizeTravelCars(cars), ...normalizeStaffTravel(compensation)];
}

export function staffTravelGroupKey(assignment, event) {
  return `${assignment.collaboratorId}|${assignmentEventDay(assignment, event)}`;
}

function assignmentStartTime(assignment = {}) {
  return String(assignment.plannedCheckIn || assignment.checkIn || assignment.clientCheckIn || '');
}

function sameAssignment(left, right, index) {
  if (left.id !== undefined && right.id !== undefined) return Number(left.id) === Number(right.id);
  if (Number.isInteger(right.index)) return index === right.index;
  if (right.rowKey) return left.rowKey === right.rowKey;
  return left === right;
}

function compensationForEntry(assignment, event, entry) {
  const car = entry.carId
    ? normalizeTravelCars(event.travelCars).find((item) => item.id === entry.carId)
    : null;
  const durationHours = entry.carId ? Math.max(0, car?.durationHours || 0) : entry.durationHours;
  const payableHours = durationHours * (event.split5050 ? 0.5 : 1);
  const rate = Math.max(0, decimalValue(assignment.hourlyRate) || 0);
  return { durationHours, payableHours, amount: Number((payableHours * rate).toFixed(2)) };
}

export function automaticStaffTravelCompensation(assignment = {}, event = assignment.event || {}, assignments) {
  const empty = { durationHours: 0, payableHours: 0, amount: 0 };
  if (!isBillableEventAssignment(assignment) || event.status === 'cancelled'
    || String(assignment.status || '').toLowerCase() !== 'confirmed'
    || isAssignmentOnCancelledDay(assignment, event)) return empty;
  const paidMarkerExists = normalizeStaffTravel(event.travelCars).some((item) => (
    item.assignmentId === Number(assignment.id)
    && item.collaboratorId === Number(assignment.collaboratorId)
  ));
  if (assignment.paymentStatus === 'paid' && !paidMarkerExists) return empty;
  const candidates = assignments ?? event.assignments ?? [assignment];
  if (!candidates.length) return empty;
  const eventDay = assignmentEventDay(assignment, event);
  const paidTravelExistsForDay = candidates.some((row) => (
    Number(row.collaboratorId) === Number(assignment.collaboratorId)
    && assignmentEventDay(row, event) === eventDay
    && row.paymentStatus === 'paid'
    && normalizeStaffTravel(event.travelCars).some((item) => (
      item.assignmentId === Number(row.id)
      && item.collaboratorId === Number(row.collaboratorId)
    ))
  ));
  if (assignment.paymentStatus !== 'paid' && paidTravelExistsForDay) return empty;
  const eligible = candidates
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => Number(row.collaboratorId) === Number(assignment.collaboratorId)
      && assignmentEventDay(row, event) === assignmentEventDay(assignment, event)
      && String(row.status || '').toLowerCase() === 'confirmed'
      && isBillableEventAssignment(row)
      && (row.paymentStatus !== 'paid' || normalizeStaffTravel(event.travelCars).some((item) => (
        item.assignmentId === Number(row.id)
        && item.collaboratorId === Number(row.collaboratorId)
      )))
      && !isAssignmentOnCancelledDay(row, event))
    .sort((left, right) => {
      const byTime = assignmentStartTime(left.row).localeCompare(assignmentStartTime(right.row));
      if (byTime) return byTime;
      const leftId = Number(left.row.id);
      const rightId = Number(right.row.id);
      return Number.isInteger(leftId) && Number.isInteger(rightId)
        ? leftId - rightId
        : left.index - right.index;
    });
  if (eligible.length && !sameAssignment(eligible[0].row, assignment, eligible[0].index)) return empty;
  const car = normalizeTravelCars(event.travelCars)[0];
  const durationHours = Math.max(0, car?.durationHours || 0);
  if (!durationHours) return empty;
  const payableHours = durationHours * (event.split5050 ? 0.5 : 1);
  const rate = Math.max(0, decimalValue(assignment.hourlyRate) || 0);
  return { durationHours, payableHours, amount: Number((payableHours * rate).toFixed(2)) };
}

export function staffTravelCompensation(assignment = {}, event = assignment.event || {}, assignments) {
  const empty = { durationHours: 0, payableHours: 0, amount: 0 };
  if (!isBillableEventAssignment(assignment) || event.status === 'cancelled'
    || isAssignmentOnCancelledDay(assignment, event)) return empty;
  if (assignment.paymentStatus === 'paid') {
    const entry = normalizeStaffTravel(event.travelCars).find((item) => (
      item.assignmentId === Number(assignment.id)
      && item.collaboratorId === Number(assignment.collaboratorId)
    ));
    return entry ? compensationForEntry(assignment, event, entry) : empty;
  }
  return automaticStaffTravelCompensation(assignment, event, assignments);
}

export function automaticStaffTravelSnapshotEntry(assignment, event, assignments) {
  const unpaidAssignment = { ...assignment, paymentStatus: 'unpaid' };
  const sourceAssignments = assignments ?? event.assignments;
  const unpaidAssignments = sourceAssignments?.map((row) => (
    Number(row.id) === Number(assignment.id) ? { ...row, paymentStatus: 'unpaid' } : row
  ));
  const compensation = automaticStaffTravelCompensation(unpaidAssignment, event, unpaidAssignments);
  const car = normalizeTravelCars(event.travelCars)[0];
  if (!compensation.payableHours || !car?.id || !assignment.id || !assignment.collaboratorId) return null;
  return {
    kind: 'staff_compensation',
    assignmentId: Number(assignment.id),
    collaboratorId: Number(assignment.collaboratorId),
    carId: car.id,
    durationHours: 0,
  };
}

export function staffTravelHoursConfigured(event = {}) {
  return normalizeTravelCars(event.travelCars).some((car) => car.durationHours > 0);
}
