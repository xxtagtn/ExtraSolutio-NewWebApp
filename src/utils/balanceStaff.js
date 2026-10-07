import { isFinanceReadyEvent } from './financeReadiness.js';
import { isBillableEventAssignment } from './eventFinancialRules.js';
import { staffPaymentHours } from './serviceFinance.js';
import { assignmentWorkDateValue, staffAssignmentCostTotal, staffAssignmentOutstandingPay } from './staffPayment.js';

const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const finalizedStatuses = new Set(['finalized', 'completed', 'invoiced', 'paid']);

function workPeriod(assignment) {
  const value = assignmentWorkDateValue(assignment);
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return { year: String(date.getFullYear()), month: date.getMonth() + 1 };
}

export function staffAnalysisYears(services = []) {
  return [...new Set(services.flatMap((event) => (event.assignments || [])
    .map((assignment) => workPeriod({ ...assignment, event })?.year).filter(Boolean)))];
}

function summarize(entries) {
  const cents = (field) => entries.reduce((sum, entry) => sum + Math.round(entry[field] * 100), 0) / 100;
  return {
    services: entries.length,
    hours: Number(entries.reduce((sum, entry) => sum + entry.hours, 0).toFixed(2)),
    cost: cents('cost'),
    paid: cents('paid'),
    unpaid: cents('unpaid'),
  };
}

export function buildStaffBalance({ services = [], period = {}, collaboratorId = 'all', search = '' } = {}) {
  const annualEntries = [];
  for (const event of services) {
    if (!isFinanceReadyEvent(event) || String(event.status || '').toLowerCase() === 'cancelled') continue;
    if (period.clientId && period.clientId !== 'all'
      && String(event.clientId || event.client?.id || '') !== String(period.clientId)) continue;
    const status = String(event.status || '').trim().toLowerCase();
    const normalizedStatus = finalizedStatuses.has(status) ? 'finalized' : status;
    if (period.status && period.status !== 'all' && normalizedStatus !== period.status) continue;
    for (const assignment of event.assignments || []) {
      if (!assignment.collaboratorId || !isBillableEventAssignment(assignment)) continue;
      const withEvent = { ...assignment, event };
      const work = workPeriod(withEvent);
      if (!work || (period.year && work.year !== String(period.year))) continue;
      const balance = staffAssignmentOutstandingPay(withEvent);
      annualEntries.push({
        collaboratorId: String(assignment.collaboratorId),
        name: assignment.collaborator?.shortName || assignment.collaborator?.name || '-',
        nif: assignment.collaborator?.nif || '-',
        month: work.month,
        hours: staffPaymentHours(assignment),
        cost: staffAssignmentCostTotal(withEvent),
        paid: assignment.paymentStatus === 'paid' ? balance : 0,
        unpaid: assignment.paymentStatus === 'paid' ? 0 : balance,
      });
    }
  }
  const collaborators = [...new Map(annualEntries.map((entry) => [entry.collaboratorId, {
    id: entry.collaboratorId, name: entry.name, nif: entry.nif,
  }])).values()].sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  const normalize = (value) => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const query = normalize(search.trim());
  const selectedEntries = annualEntries.filter((entry) => (collaboratorId === 'all'
    || entry.collaboratorId === String(collaboratorId)) && normalize(`${entry.name} ${entry.nif}`).includes(query));
  const periodEntries = selectedEntries.filter((entry) => !period.month || entry.month === Number(period.month));
  const groups = new Map();
  for (const entry of periodEntries) {
    const group = groups.get(entry.collaboratorId) || [];
    group.push(entry);
    groups.set(entry.collaboratorId, group);
  }
  return {
    collaborators,
    rows: [...groups.entries()].map(([id, entries]) => ({
      id, name: entries[0].name, nif: entries[0].nif, ...summarize(entries),
    })).sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name, 'pt') || a.id.localeCompare(b.id)),
    totals: summarize(periodEntries),
    annualTotals: summarize(selectedEntries),
    monthlySeries: monthNames.map((month, index) => ({
      month, ...summarize(selectedEntries.filter((entry) => entry.month === index + 1)),
    })),
  };
}
