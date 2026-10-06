import { qrSummaryDate, recordedIntervalLabel } from './qrConsultationSummary.js';

export const MONTHLY_DAYS_PER_PAGE = 5;

function searchable(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-PT');
}

export function monthlyServiceDays(services, query = '') {
  const days = new Map();
  for (const service of services) {
    if (!days.has(service.assignmentDate)) days.set(service.assignmentDate, []);
    days.get(service.assignmentDate).push(service);
  }
  const terms = searchable(query).trim().split(/\s+/).filter(Boolean);
  return [...days].sort(([left], [right]) => left.localeCompare(right)).filter(([day, rows]) => {
    return rows.some((service) => {
      const text = searchable([day, qrSummaryDate(day), service.eventName, service.clientName,
        service.role, service.location, service.workLocation].join(' '));
      return terms.every((term) => text.includes(term));
    });
  });
}

export function monthlyDaysPage(days, requestedPage = 1) {
  const totalPages = Math.max(1, Math.ceil(days.length / MONTHLY_DAYS_PER_PAGE));
  const page = Math.min(totalPages, Math.max(1, requestedPage));
  const start = (page - 1) * MONTHLY_DAYS_PER_PAGE;
  return { page, totalPages, items: days.slice(start, start + MONTHLY_DAYS_PER_PAGE),
    from: days.length ? start + 1 : 0, to: Math.min(days.length, start + MONTHLY_DAYS_PER_PAGE), total: days.length };
}

// Sum the existing consultation intervals only, never billed or validated hours.
export function monthlyDayInterval(services) {
  let minutes = 0;
  for (const service of services) {
    const label = recordedIntervalLabel(service.checkIn, service.checkOut);
    if (label === 'Incompleto') return label;
    const [hours, remainder] = label.slice(0, -1).split(':').map(Number);
    minutes += hours * 60 + remainder;
  }
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}h`;
}
