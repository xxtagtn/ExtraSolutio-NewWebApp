const NON_BILLABLE_ASSIGNMENT = new Set(['missed_justified', 'missed_unjustified', 'cancelled']);
const CLOSED_BILLING_STATUSES = new Set(['partial70', 'invoiced', 'paid']);
const FINANCE_READY_EVENT_STATUSES = new Set(['to_validate_client', 'paid']);
const VALIDATED_EVENT_MARKER = '[EVENT_VALIDATED_HOURS]';

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

export function isFinanceReadyEvent(event) {
  const operationalStatus = normalized(event?.status);
  const billingStatus = normalized(event?.billingStatus);

  if (FINANCE_READY_EVENT_STATUSES.has(operationalStatus)) return true;
  if (CLOSED_BILLING_STATUSES.has(billingStatus)) return true;
  if (String(event?.notes || '').includes(VALIDATED_EVENT_MARKER)) return true;

  const billableAssignments = (event?.assignments || [])
    .filter((assignment) => !NON_BILLABLE_ASSIGNMENT.has(normalized(assignment?.status)));

  return billableAssignments.length > 0
    && billableAssignments.every((assignment) => normalized(assignment?.validationStatus) === 'validated');
}
