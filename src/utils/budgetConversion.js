import { decimalValue } from './serviceFinance.js';
import { calculateTravelAmount } from './travelCalculator.js';

function safeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function dateOnly(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function numberValue(value) {
  return decimalValue(value) || 0;
}

function nullableNumber(value) {
  const parsed = decimalValue(value);
  return parsed === null ? null : parsed;
}

function uniqueSortedDates(values) {
  return [...new Set(values.map(dateOnly).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function budgetCategories(row) {
  return safeArray(row.categoriesParsed).length
    ? safeArray(row.categoriesParsed)
    : safeArray(row.categories || row.categoriesJson);
}

function budgetDays(row) {
  return safeArray(row.paymentPlan)
    .map((item) => ({
      ...item,
      date: dateOnly(item.date),
    }))
    .filter((item) => item.date);
}

export function normalizeBudgetTravelType(row = {}) {
  const hasLegacyKilometers = ['manual', 'long_trip'].includes(row.travelType)
    && (numberValue(row.km) > 0 || numberValue(row.durationHours) > 0);

  if (row.travelType === 'automatic') {
    return row.locationScope === 'outside_lisbon' ? 'outside_lisbon' : 'none';
  }

  if (hasLegacyKilometers) return 'kilometers';
  return row.travelType || 'none';
}

export function buildBudgetConversionDraft(row = {}) {
  const categories = budgetCategories(row);
  const days = budgetDays(row);
  const dates = uniqueSortedDates([
    row.eventDate,
    ...days.map((day) => day.date),
    ...categories.map((item) => item.date),
  ]);
  const firstDate = dates[0] || dateOnly(row.eventDate);
  const firstDay = days.find((day) => day.date === firstDate) || days[0] || {};
  const clientLabel = row.client?.name || row.companyName || row.clientName || row.leadName || '';
  const eventName = row.eventType
    ? `${row.eventType} - ${clientLabel || row.reference || 'Evento'}`
    : (row.description || row.reference || clientLabel || '');
  const uniformsByRole = categories
    .filter((item) => item.role && item.uniform)
    .map((item) => ({ role: String(item.role), uniform: String(item.uniform) }));
  const uniqueUniforms = [...new Set(uniformsByRole.map((item) => item.uniform))];
  const uniformDetails = uniformsByRole.length > 1
    ? `\n\nUniformes (orçamento):\n${uniformsByRole.map((item) => `${item.role}: ${item.uniform}`).join('\n')}`
    : '';
  const travelType = normalizeBudgetTravelType(row);
  const travelAmount = numberValue(row.travelAmount);

  return {
    budgetId: row.id || '',
    budgetReference: row.reference || '',
    clientId: row.clientId ? String(row.clientId) : '',
    clientLabel,
    name: eventName,
    eventType: row.eventType || row.serviceType || '',
    date: firstDate,
    endDate: dates.length > 1 ? dates[dates.length - 1] : '',
    isContinuous: dates.length > 1,
    useDefaultLocation: false,
    location: firstDay.location || row.location || '',
    guestsCount: firstDay.guestsCount ?? row.guestsCount ?? '',
    startTime: firstDay.startTime || row.startTime || '',
    endTime: firstDay.endTime || row.endTime || '',
    description: `${[row.description, row.notes].filter(Boolean).join('\n\n')}${uniformDetails}`,
    uniform: uniqueUniforms.length === 1 ? uniqueUniforms[0] : '',
    requiredRoles: categories
      .filter((item) => item.role)
      .map((item) => ({
        role: item.role || '',
        qty: item.qty ?? '',
        agreedRate: item.rate ?? '',
        day: dateOnly(item.date),
        start: item.start || '',
        end: item.end || '',
      })),
    status: 'drafting',
    billingStatus: 'pending',
    travelExpenseEnabled: travelAmount > 0,
    travelExpenseAmount: travelAmount,
    travelType,
    travelPeople: row.travelPeople ?? '',
    km: row.km ?? '',
    kmRate: row.kmRate ?? '',
    durationHours: row.durationHours ?? '',
    split5050: Boolean(row.split5050),
    travelManualAmount: travelType === 'manual' ? travelAmount : (row.travelManualAmount ?? ''),
    totalRevenue: numberValue(row.totalAmount || row.amount),
  };
}

export function buildEventPayloadFromBudgetConversion(draft = {}, clientId) {
  const travelAmount = calculateTravelAmount(draft);
  const isContinuous = Boolean(draft.isContinuous && draft.endDate);

  return {
    name: String(draft.name || '').trim(),
    eventType: draft.eventType || '',
    clientId,
    date: draft.date || '',
    endDate: isContinuous ? draft.endDate : null,
    isContinuous,
    useDefaultLocation: false,
    location: draft.location || '',
    guestsCount: nullableNumber(draft.guestsCount),
    startTime: draft.startTime || '',
    endTime: draft.endTime || '',
    description: draft.description || '',
    uniform: draft.uniform || '',
    requiredRoles: safeArray(draft.requiredRoles)
      .filter((item) => item.role && numberValue(item.qty) > 0)
      .map((item) => ({
        role: item.role,
        qty: numberValue(item.qty),
        agreedRate: numberValue(item.agreedRate),
        day: item.day || '',
        start: item.start || '',
        end: item.end || '',
      })),
    status: 'drafting',
    billingStatus: 'pending',
    travelExpenseEnabled: travelAmount > 0,
    travelExpenseAmount: travelAmount > 0 ? travelAmount : 0,
    travelType: draft.travelType || 'none',
    travelPeople: nullableNumber(draft.travelPeople),
    km: nullableNumber(draft.km),
    kmRate: nullableNumber(draft.kmRate),
    durationHours: nullableNumber(draft.durationHours),
    split5050: Boolean(draft.split5050),
    travelManualAmount: draft.travelType === 'manual' ? numberValue(draft.travelManualAmount) : 0,
    totalRevenue: numberValue(draft.totalRevenue),
    notes: draft.budgetReference ? `[BUDGET_REF:${draft.budgetReference}]` : '',
  };
}
