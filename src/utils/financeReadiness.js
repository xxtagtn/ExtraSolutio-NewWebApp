const FINANCE_READY_EVENT_STATUSES = new Set(['finalized', 'completed', 'invoiced', 'paid']);

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

export function isFinanceReadyEvent(event) {
  const operationalStatus = normalized(event?.status);
  return FINANCE_READY_EVENT_STATUSES.has(operationalStatus);
}

export function splitFinanceReadiness(events = []) {
  return (events || []).reduce((result, event) => {
    if (isFinanceReadyEvent(event)) result.readyEvents.push(event);
    else result.forecastEvents.push(event);
    return result;
  }, { readyEvents: [], forecastEvents: [] });
}
