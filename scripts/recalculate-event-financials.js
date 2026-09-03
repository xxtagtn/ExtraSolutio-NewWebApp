import { prisma } from '../server/prisma.js';
import { calculateEventTotals } from '../server/utils/eventTotals.js';
import { initialEventRateHistory } from '../server/utils/eventRateSnapshot.js';
import {
  eventRevenueIsLocked,
  issuedInvoiceForEvent,
} from '../server/utils/eventInvoiceProtection.js';
import { eventFinancialWarnings } from '../src/utils/eventFinancialRules.js';

function numberValue(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function changed(current, next) {
  return Math.abs(numberValue(current) - numberValue(next)) >= 0.005;
}

function arrayValue(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const events = await prisma.event.findMany({
  include: {
    client: true,
    assignments: { include: { collaborator: true } },
    invoices: true,
  },
  orderBy: { id: 'asc' },
});

let updated = 0;
let unchanged = 0;
let skipped = 0;

for (const event of events) {
  const issuedInvoice = await issuedInvoiceForEvent(prisma, event.id, event.invoices);
  const totals = calculateEventTotals(event, event.assignments, {
    preserveClientTotals: eventRevenueIsLocked(event) || Boolean(issuedInvoice),
  });
  const warnings = eventFinancialWarnings(event, event.assignments, {
    revenue: totals.totalRevenue,
    staff: Math.max(0, totals.totalCost),
  });
  const ambiguousRate = warnings.some((warning) => (
    warning.code === 'assignment_without_client_rate'
    || warning.code === 'role_without_client_rate'
  ));
  const hasOperationalStructure = event.assignments.length > 0
    || arrayValue(event.requiredRoles).length > 0
    || Boolean(event.travelExpenseEnabled)
    || arrayValue(event.externalCosts).length > 0;

  if ((ambiguousRate && event.assignments.length)
    || (!hasOperationalStructure && numberValue(event.totalRevenue) > 0)) {
    skipped += 1;
    continue;
  }

  const data = {};
  if (changed(event.totalRevenue, totals.totalRevenue)) data.totalRevenue = totals.totalRevenue;
  if (changed(event.totalCost, totals.totalCost)) data.totalCost = totals.totalCost;
  if (changed(event.taxAmount, totals.taxAmount)) data.taxAmount = totals.taxAmount;
  if (changed(event.realHours, totals.realHours)) data.realHours = totals.realHours;
  if (changed(event.billableHours, totals.billableHours)) data.billableHours = totals.billableHours;
  if (!event.rateHistory) {
    const history = initialEventRateHistory(event.requiredRoles, event.createdAt);
    if (history) data.rateHistory = history;
  }

  if (!Object.keys(data).length) {
    unchanged += 1;
    continue;
  }

  await prisma.event.update({ where: { id: event.id }, data });
  updated += 1;
}

console.log(JSON.stringify({ total: events.length, updated, unchanged, skippedForSafety: skipped }, null, 2));
await prisma.$disconnect();
