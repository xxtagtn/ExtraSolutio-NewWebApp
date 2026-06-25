const FINAL_EVENT_STATUSES = new Set(['finalized', 'completed', 'invoiced', 'paid']);

function numeric(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isFinalizedEvent(event) {
  return FINAL_EVENT_STATUSES.has(String(event?.status || '').trim().toLowerCase());
}

export function minimumHoursForEventUpdate(event, clientMinimumHours) {
  if (isFinalizedEvent(event)) return numeric(event?.minimumHoursSnapshot);
  return Math.max(0, numeric(clientMinimumHours));
}

export function shouldPropagateMinimumHours(existingClient, updatedClient) {
  return numeric(existingClient?.minimumHours) !== numeric(updatedClient?.minimumHours);
}
