import { activeEventDayKeys, eventDayKey } from './eventCancelledDays.js';
import { decimalValue } from './serviceFinance.js';
import { invoiceIsIssued, invoiceIsPaid } from '../../shared/invoiceLifecycle.js';

function configuredRows(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value;
  try {
    const rows = JSON.parse(value);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

export function isExternalOnlyService(event = {}) {
  const roles = configuredRows(event.requiredRoles);
  const drafts = configuredRows(event.assignmentDrafts);
  const costs = configuredRows(event.externalCosts);
  // Missing/malformed team data must not be interpreted as an empty team.
  if (!roles || !drafts || !costs || !Array.isArray(event.assignments)) return false;
  if (event.assignments.length || drafts.length) return false;
  if (roles.some((row) => !row || typeof row !== 'object'
    || String(row.role || '').trim() || Number(row.qty ?? row.quantity ?? 0) !== 0)) return false;
  return costs.some((cost) => cost && typeof cost === 'object' && (decimalValue(cost.costAmount) || 0) > 0)
    || (event.externalCosts == null && event.externalService?.only === true);
}

function clockMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function externalServiceCompletionBlocker(event, now = new Date(), timeZone = 'Europe/Lisbon') {
  if (!isExternalOnlyService(event)) return 'Este evento não é um serviço exclusivamente externo sem Staff.';
  if (String(event.status || '').toLowerCase() === 'cancelled') return 'Não é possível concluir um evento cancelado.';
  const start = eventDayKey(event.date);
  const end = eventDayKey(event.isContinuous ? event.endDate || event.date : event.date);
  const validDay = (day) => /^\d{4}-\d{2}-\d{2}$/.test(day)
    && !Number.isNaN(new Date(`${day}T00:00:00Z`).getTime())
    && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
  if (!validDay(start) || !validDay(end) || end < start) return 'Confirma primeiro as datas do serviço.';
  let lastDay = activeEventDayKeys(event).at(-1);
  if (!lastDay) return 'Este evento não possui dias ativos para concluir.';
  const startMinutes = clockMinutes(event.startTime);
  const endMinutes = clockMinutes(event.endTime);
  if ((event.startTime && startMinutes === null) || (event.endTime && endMinutes === null)) {
    return 'Confirma primeiro o horário previsto do serviço.';
  }
  if (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) {
    const next = new Date(`${lastDay}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    lastDay = next.toISOString().slice(0, 10);
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  if (today < lastDay || (today === lastDay && endMinutes !== null
    && Number(parts.hour) * 60 + Number(parts.minute) < endMinutes)) {
    return 'O serviço só pode ser concluído após o fim previsto do último dia ativo.';
  }
  return '';
}

export function externalServiceIsSettled(event = {}) {
  if (!isExternalOnlyService(event)) return false;
  if (typeof event.externalService?.settled === 'boolean') return event.externalService.settled;
  const issued = (event.invoices || []).filter(invoiceIsIssued);
  return issued.length ? issued.every(invoiceIsPaid) : String(event.billingStatus || '').toLowerCase() === 'paid';
}

export function externalServiceCanArchive(event = {}, now = new Date(), timeZone = 'Europe/Lisbon') {
  if (!externalServiceIsSettled(event) || externalServiceCompletionBlocker(event, now, timeZone)) return false;
  // With no end time, a calendar day passing is not proof that its service is over.
  if (!event.endTime) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return activeEventDayKeys(event).at(-1) < `${parts.year}-${parts.month}-${parts.day}`;
  }
  return true;
}
