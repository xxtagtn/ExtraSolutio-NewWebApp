import { decimalValue } from './serviceFinance.js';

export const NON_BILLABLE_EVENT_STATUSES = new Set(['missed_justified', 'missed_unjustified', 'cancelled']);

function safeArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizedText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function canonicalRole(value) {
  const normalized = normalizedText(value);
  const aliases = {
    empmesa: 'empmesa',
    empregadomesa: 'empmesa',
    empregadodemesa: 'empmesa',
    chefesala: 'chefesala',
    chefedesala: 'chefesala',
    cortepresunto: 'cortepresunto',
    cortedepresunto: 'cortepresunto',
  };
  return aliases[normalized] || normalized;
}

export function requiredRoleEntries(eventOrRoles = []) {
  const source = eventOrRoles?.requiredRoles ?? eventOrRoles;
  return safeArray(source)
    .map((item) => ({
      ...item,
      role: String(item?.role || '').trim(),
      qty: Number(item?.qty || 0),
      agreedRate: decimalValue(item?.agreedRate ?? item?.rate) || 0,
    }))
    .filter((item) => item.role);
}

export function clientRateForAssignment(assignment = {}, eventOrRoles = []) {
  const entries = requiredRoleEntries(eventOrRoles).filter((item) => item.agreedRate > 0);
  const assignmentRole = canonicalRole(assignment.role);
  const exact = entries.find((item) => canonicalRole(item.role) === assignmentRole);
  if (exact) return exact.agreedRate;

  const roleIsMissing = !assignmentRole || assignmentRole === 'semfuncao';
  if (roleIsMissing && entries.length === 1) return entries[0].agreedRate;
  return 0;
}

export function billableEventAssignments(assignments = []) {
  return (assignments || []).filter((assignment) => (
    !NON_BILLABLE_EVENT_STATUSES.has(String(assignment?.status || '').trim().toLowerCase())
  ));
}

export function calculateFinancialMargin(revenueValue, staffValue, expenseValue) {
  const revenue = decimalValue(revenueValue) || 0;
  const staff = decimalValue(staffValue) || 0;
  const expenses = decimalValue(expenseValue) || 0;
  const margin = Number((revenue - staff - expenses).toFixed(2));
  const marginPct = revenue > 0 ? Number(((margin / revenue) * 100).toFixed(1)) : 0;
  return { margin, marginPct };
}

function dateOnly(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function inclusiveDayCount(startValue, endValue) {
  const start = new Date(startValue || 0);
  const end = new Date(endValue || startValue || 0);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.floor((endDay - startDay) / 86_400_000) + 1;
}

export function eventFinancialWarnings(event = {}, assignments = event.assignments || [], totals = {}) {
  const billable = billableEventAssignments(assignments).filter((assignment) => assignment.collaboratorId || assignment.role);
  const warnings = [];
  const missingRateRows = billable.filter((assignment) => clientRateForAssignment(assignment, event) <= 0);
  const missingRoleRates = requiredRoleEntries(event).filter((item) => item.agreedRate <= 0);
  const revenue = decimalValue(totals.revenue ?? totals.totalRevenue ?? event.totalRevenue) || 0;
  const staff = decimalValue(totals.staff ?? totals.totalCost ?? event.totalCost) || 0;

  if (revenue <= 0 && staff > 0) {
    warnings.push({ code: 'revenue_zero_with_staff', message: 'A receita está a 0,00 € mas existem custos de Staff.' });
  }
  if (missingRateRows.length) {
    warnings.push({
      code: 'assignment_without_client_rate',
      message: `${missingRateRows.length} linha(s) sem valor/hora do cliente associado à função.`,
    });
  }
  if (missingRoleRates.length) {
    warnings.push({
      code: 'role_without_client_rate',
      message: `${missingRoleRates.length} função(ões) sem valor/hora histórico do cliente.`,
    });
  }

  const eventDays = event.isContinuous ? inclusiveDayCount(event.date, event.endDate || event.date) : 1;
  if (eventDays > 1 && billable.length) {
    const coveredDays = new Set(billable.map((assignment) => dateOnly(assignment.assignmentDate || event.date)).filter(Boolean));
    if (coveredDays.size < eventDays) {
      warnings.push({
        code: 'continuous_days_incomplete',
        message: `O evento tem ${eventDays} dias, mas apenas ${coveredDays.size} dia(s) possuem linhas consideradas no cálculo.`,
      });
    }
  }

  return warnings;
}

