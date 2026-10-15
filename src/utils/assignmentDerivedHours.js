import { isStaffAcceptedValidationStatus } from './hourValidationStatus.js';
import { clientChargeHours, clientRealHours, decimalValue, roundedClockTime, staffWorkedHours } from './serviceFinance.js';

const CLOCK_FIELDS = ['checkIn', 'checkOut', 'clientCheckIn', 'clientCheckOut', 'validatedCheckIn', 'validatedCheckOut'];
const pair = (start, end) => Boolean(roundedClockTime(start) && roundedClockTime(end));

export function assignmentDerivedHours(assignment, event = {}) {
  // These numbers are caches of the current sources, not inputs to their own recalculation.
  const current = { ...assignment, clientRealHours: 0, clientBillableHours: 0, hoursWorked: 0, staffPayableHours: 0 };
  const hours = pair(current.checkIn, current.checkOut) ? staffWorkedHours(current) : 0;
  const hasRecordedPair = pair(current.checkIn, current.checkOut)
    || pair(current.clientCheckIn, current.clientCheckOut)
    || pair(current.validatedCheckIn, current.validatedCheckOut);
  const rate = decimalValue(current.hourlyRate) || 0;
  return {
    hoursWorked: hours,
    staffPayableHours: hours,
    clientRealHours: clientRealHours(current),
    clientBillableHours: hasRecordedPair
      ? clientChargeHours(current, event.startTime, event.endTime, event.minimumHoursSnapshot) : 0,
    ...(rate > 0 ? { totalPay: Number((hours * rate).toFixed(2)) } : {}),
  };
}

export function assignmentHoursSourceChanged(input, existing = {}) {
  return CLOCK_FIELDS.some((field) => input[field] !== undefined && String(input[field] || '') !== String(existing[field] || ''));
}

export function acceptedStaffHourCachePatch(assignment, event = {}) {
  if (!isStaffAcceptedValidationStatus(assignment.validationStatus)
    || pair(assignment.clientCheckIn, assignment.clientCheckOut)
    || pair(assignment.validatedCheckIn, assignment.validatedCheckOut)
    || !pair(assignment.checkIn, assignment.checkOut)) return {};
  return Object.fromEntries(Object.entries(assignmentDerivedHours(assignment, event)).filter(([field, value]) => (
    Object.hasOwn(assignment, field) && (decimalValue(assignment[field]) || 0) !== value
  )));
}
