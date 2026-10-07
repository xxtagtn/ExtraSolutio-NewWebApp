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
  return { year: String(date.getFullYear()), month: date.getMonth() + 1, day: date.getDate() };
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

function evolutionCalendar(period, evolutionMonth, evolutionWeek) {
  const year = Number(period.year) || new Date().getFullYear();
  const requestedMonth = Number(period.month || evolutionMonth);
  const month = Number.isInteger(requestedMonth) && requestedMonth >= 1 && requestedMonth <= 12
    ? requestedMonth : new Date().getMonth() + 1;
  const key = (date) => date.toISOString().slice(0, 10);
  const short = (dateKey) => `${dateKey.slice(8, 10)}/${dateKey.slice(5, 7)}`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const dateKey = key(new Date(Date.UTC(year, month - 1, day)));
    return { day, dateKey, label: short(dateKey) };
  });
  // Weeks are Monday-Sunday, clipped to the selected month so filters stay exact.
  const weeks = [];
  for (let start = 1; start <= daysInMonth;) {
    const weekday = (new Date(Date.UTC(year, month - 1, start)).getUTCDay() + 6) % 7;
    const end = Math.min(daysInMonth, start + 6 - weekday);
    weeks.push({ start, end, label: `${days[start - 1].label} – ${days[end - 1].label}` });
    start = end + 1;
  }
  const activeWeek = weeks.find((week) => week.start === Number(evolutionWeek)) || weeks[0];
  const previousMonth = { start: key(new Date(Date.UTC(year, month - 2, 1))), end: key(new Date(Date.UTC(year, month - 1, 0))) };
  // Compare partial weeks with the same weekdays seven days earlier.
  const previousWeek = { start: key(new Date(Date.UTC(year, month - 1, activeWeek.start - 7))), end: key(new Date(Date.UTC(year, month - 1, activeWeek.end - 7))) };
  const full = (dateKey) => `${short(dateKey)}/${dateKey.slice(0, 4)}`;
  previousMonth.label = `${full(previousMonth.start)} – ${full(previousMonth.end)}`;
  previousWeek.label = `${full(previousWeek.start)} – ${full(previousWeek.end)}`;
  return { month, days, weeks, activeWeek, previousMonth, previousWeek };
}

export function buildStaffBalance({ services = [], period = {}, collaboratorId = 'all', search = '', evolutionMonth, evolutionWeek } = {}) {
  const calendar = evolutionCalendar(period, evolutionMonth, evolutionWeek);
  const inRange = (entry, range) => entry.dateKey >= range.start && entry.dateKey <= range.end;
  const candidateEntries = [];
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
      if (!work) continue;
      const dateKey = `${work.year}-${String(work.month).padStart(2, '0')}-${String(work.day).padStart(2, '0')}`;
      if (period.year && work.year !== String(period.year)
        && !inRange({ dateKey }, calendar.previousMonth) && !inRange({ dateKey }, calendar.previousWeek)) continue;
      const balance = staffAssignmentOutstandingPay(withEvent);
      candidateEntries.push({
        collaboratorId: String(assignment.collaboratorId),
        name: assignment.collaborator?.shortName || assignment.collaborator?.name || '-',
        nif: assignment.collaborator?.nif || '-',
        month: work.month,
        day: work.day,
        year: work.year,
        dateKey,
        hours: staffPaymentHours(assignment),
        cost: staffAssignmentCostTotal(withEvent),
        paid: assignment.paymentStatus === 'paid' ? balance : 0,
        unpaid: assignment.paymentStatus === 'paid' ? 0 : balance,
      });
    }
  }
  const annualEntries = candidateEntries.filter((entry) => !period.year || entry.year === String(period.year));
  const collaborators = [...new Map(annualEntries.map((entry) => [entry.collaboratorId, {
    id: entry.collaboratorId, name: entry.name, nif: entry.nif,
  }])).values()].sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  const normalize = (value) => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const query = normalize(search.trim());
  const selectedCandidates = candidateEntries.filter((entry) => (collaboratorId === 'all'
    || entry.collaboratorId === String(collaboratorId)) && normalize(`${entry.name} ${entry.nif}`).includes(query));
  const selectedEntries = selectedCandidates.filter((entry) => !period.year || entry.year === String(period.year));
  const periodEntries = selectedEntries.filter((entry) => !period.month || entry.month === Number(period.month));
  const groups = new Map();
  for (const entry of periodEntries) {
    const group = groups.get(entry.collaboratorId) || [];
    group.push(entry);
    groups.set(entry.collaboratorId, group);
  }
  const { month, days, weeks, activeWeek } = calendar;
  const monthEntries = selectedEntries.filter((entry) => entry.month === month);
  const dailySeries = days.map((day) => ({ ...day, ...summarize(monthEntries.filter((entry) => entry.day === day.day)) }));
  const weekEntries = monthEntries.filter((entry) => entry.day >= activeWeek.start && entry.day <= activeWeek.end);
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
    evolution: {
      month, weeks, activeWeek,
      dailySeries,
      weeklySeries: dailySeries.filter((row) => row.day >= activeWeek.start && row.day <= activeWeek.end),
      monthTotals: summarize(monthEntries),
      weekTotals: summarize(weekEntries),
      previousMonth: { ...calendar.previousMonth, totals: summarize(selectedCandidates.filter((entry) => inRange(entry, calendar.previousMonth))) },
      previousWeek: { ...calendar.previousWeek, totals: summarize(selectedCandidates.filter((entry) => inRange(entry, calendar.previousWeek))) },
    },
  };
}
