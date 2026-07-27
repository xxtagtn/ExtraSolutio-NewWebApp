const FINANCE_READY_EVENT_STATUSES = new Set(['finalized', 'completed', 'invoiced', 'paid']);
const FINANCE_CLOSED_BILLING_STATUSES = new Set(['invoiced', 'paid']);
const VALIDATED_EVENT_MARKER = '[EVENT_VALIDATED_HOURS]';
const NON_BILLABLE_ASSIGNMENT_STATUSES = new Set(['missed_justified', 'missed_unjustified', 'cancelled']);

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function parsedExternalCosts(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isProcessedExternalOnlyEvent(event) {
  const hasAssignedStaff = (event?.assignments || []).some((assignment) => assignment?.collaboratorId);
  const hasExternalCosts = parsedExternalCosts(event?.externalCosts).length > 0;

  return !hasAssignedStaff
    && hasExternalCosts
    && FINANCE_CLOSED_BILLING_STATUSES.has(normalized(event?.billingStatus));
}

function hasCompleteValidatedClientRows(event) {
  const assignments = (event?.assignments || []).filter((assignment) => (
    assignment?.collaboratorId
    && !NON_BILLABLE_ASSIGNMENT_STATUSES.has(normalized(assignment.status))
  ));

  return assignments.length > 0 && assignments.every((assignment) => (
    normalized(assignment.validationStatus) === 'validated'
    && Boolean(
      (assignment.clientCheckIn && assignment.clientCheckOut)
      || (assignment.validatedCheckIn && assignment.validatedCheckOut)
    )
  ));
}

export function isFinanceReadyEvent(event) {
  const operationalStatus = normalized(event?.status);
  if (FINANCE_READY_EVENT_STATUSES.has(operationalStatus)) return true;
  if (isProcessedExternalOnlyEvent(event)) return true;

  // Older records may keep an operational status from before the event-level
  // validation action updated it. The marker is only written by that explicit
  // action, so it is safe to use it as a reconciliation fallback when every
  // billable row also contains a validated client schedule.
  return String(event?.notes || '').includes(VALIDATED_EVENT_MARKER)
    && hasCompleteValidatedClientRows(event);
}

export function splitFinanceReadiness(events = []) {
  return (events || []).reduce((result, event) => {
    if (isFinanceReadyEvent(event)) result.readyEvents.push(event);
    else result.forecastEvents.push(event);
    return result;
  }, { readyEvents: [], forecastEvents: [] });
}
