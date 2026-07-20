const controlledScalarFields = [
  'reference',
  'clientId',
  'leadName',
  'companyName',
  'phone',
  'email',
  'nif',
  'budgetType',
  'eventDate',
  'eventType',
  'location',
  'guestsCount',
  'startTime',
  'endTime',
  'description',
  'leadSource',
  'serviceType',
  'eventLevel',
  'locationScope',
  'vatRate',
  'vatMode',
  'discountRate',
  'travelType',
  'travelPeople',
  'km',
  'kmRate',
  'durationHours',
  'travelManualAmount',
  'status',
  'paymentStatus',
  'sentAt',
  'lostReason',
  'responseTemplate',
  'commercialEmailText',
  'commercialWhatsappText',
  'commercialPdfText',
  'notes',
];

const categoryFields = ['role', 'qty', 'rate', 'date', 'start', 'end', 'uniform'];
const eventDayFields = ['date', 'location', 'guestsCount', 'startTime', 'endTime'];
const externalCostFields = ['type', 'supplier', 'description', 'costAmount', 'marginPercent', 'vatType'];
const travelCarFields = ['label', 'km', 'kmRate', 'durationHours', 'travelPeople', 'travelStaffHourlyRate'];

function controlledValue(value) {
  return value === null || value === undefined ? '' : value;
}

function normalizeControlledObject(item, fields) {
  const normalized = { ...(item || {}) };
  fields.forEach((field) => {
    normalized[field] = controlledValue(normalized[field]);
  });
  return normalized;
}

function normalizeControlledList(list, fields) {
  return Array.isArray(list)
    ? list.map((item) => normalizeControlledObject(item, fields))
    : list;
}

export function normalizeBudgetFormState(form = {}) {
  const normalized = { ...form };

  controlledScalarFields.forEach((field) => {
    normalized[field] = controlledValue(normalized[field]);
  });

  normalized.categories = normalizeControlledList(normalized.categories, categoryFields);
  normalized.eventDays = normalizeControlledList(normalized.eventDays, eventDayFields);
  normalized.externalCosts = normalizeControlledList(normalized.externalCosts, externalCostFields);
  normalized.travelCars = normalizeControlledList(normalized.travelCars, travelCarFields);

  return normalized;
}
