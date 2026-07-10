import { URL } from 'node:url';

const DEFAULT_PRODUCT_ID = '-//ExtraSolutio//Calendario//PT';
const DEFAULT_TIMEZONE = 'Europe/Lisbon';

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const withoutTrailingSlash = raw.replace(/\/+$/, '');
  if (/\/api$/i.test(withoutTrailingSlash)) return withoutTrailingSlash;
  return `${withoutTrailingSlash}/api`;
}

function localOrPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '127.0.0.1' || host === '::1') return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  const private172 = host.match(/^172\.(\d+)\./);
  if (private172) {
    const second = Number(private172[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

function isLocalFeedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol !== 'https:' || localOrPrivateHost(url.hostname);
  } catch {
    return true;
  }
}

export function buildCalendarFeedUrls({
  token,
  requestProtocol = 'http',
  requestHost,
  publicBaseUrl,
} = {}) {
  if (!token) return { feedUrl: null, webcalUrl: null, isLocalUrl: true };
  const configuredBase = normalizeBaseUrl(publicBaseUrl);
  const requestBase = requestHost ? `${requestProtocol}://${requestHost}/api` : null;
  const baseUrl = configuredBase || requestBase;
  if (!baseUrl) return { feedUrl: null, webcalUrl: null, isLocalUrl: true };
  const feedUrl = `${baseUrl}/calendar-feed/${token}.ics`;
  return {
    feedUrl,
    webcalUrl: feedUrl.replace(/^https?:/i, 'webcal:'),
    isLocalUrl: isLocalFeedUrl(feedUrl),
  };
}

function dateParts(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
    };
  }
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function dateFromParts(parts) {
  if (!parts) return null;
  return new Date(parts.year, parts.month - 1, parts.day);
}

function compactDate(parts) {
  if (!parts) return '';
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('');
}

function addDays(parts, amount) {
  const date = dateFromParts(parts);
  if (!date) return null;
  date.setDate(date.getDate() + amount);
  return dateParts(date);
}

function datesBetween(startValue, endValue) {
  const start = dateParts(startValue);
  const end = dateParts(endValue || startValue);
  const startDate = dateFromParts(start);
  const endDate = dateFromParts(end);
  if (!startDate || !endDate || startDate > endDate) return [];

  const result = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    result.push(dateParts(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function normalizeTime(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] || '0');
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function timeCompact(time) {
  return `${String(time.hour).padStart(2, '0')}${String(time.minute).padStart(2, '0')}00`;
}

function timeMinutes(time) {
  return (time.hour * 60) + time.minute;
}

function utcStamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const valid = Number.isNaN(date.getTime()) ? new Date() : date;
  return [
    valid.getUTCFullYear(),
    String(valid.getUTCMonth() + 1).padStart(2, '0'),
    String(valid.getUTCDate()).padStart(2, '0'),
    'T',
    String(valid.getUTCHours()).padStart(2, '0'),
    String(valid.getUTCMinutes()).padStart(2, '0'),
    String(valid.getUTCSeconds()).padStart(2, '0'),
    'Z',
  ].join('');
}

function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldLine(line) {
  if (line.length <= 75) return [line];
  const chunks = [];
  let remaining = line;
  let first = true;
  while (remaining.length > 0) {
    const size = first ? 75 : 74;
    chunks.push(`${first ? '' : ' '}${remaining.slice(0, size)}`);
    remaining = remaining.slice(size);
    first = false;
  }
  return chunks;
}

function property(name, value) {
  if (value === undefined || value === null || value === '') return [];
  return foldLine(`${name}:${escapeText(value)}`);
}

function rawProperty(name, value) {
  if (value === undefined || value === null || value === '') return [];
  return foldLine(`${name}:${value}`);
}

function eventDateProperties({ date, startTime, endTime, timezone = DEFAULT_TIMEZONE }) {
  const start = normalizeTime(startTime);
  const end = normalizeTime(endTime);
  const dateKey = compactDate(date);
  if (!start || !end) {
    return [
      `DTSTART;VALUE=DATE:${dateKey}`,
      `DTEND;VALUE=DATE:${compactDate(addDays(date, 1))}`,
    ];
  }

  const endDate = timeMinutes(end) <= timeMinutes(start) ? addDays(date, 1) : date;
  return [
    `DTSTART;TZID=${timezone}:${dateKey}T${timeCompact(start)}`,
    `DTEND;TZID=${timezone}:${compactDate(endDate)}T${timeCompact(end)}`,
  ];
}

function vevent({
  uid,
  stamp,
  summary,
  description,
  location,
  date,
  startTime,
  endTime,
  allDay = false,
  rrule,
  timezone,
}) {
  const dateKey = compactDate(date);
  const lines = [
    'BEGIN:VEVENT',
    ...rawProperty('UID', uid),
    ...rawProperty('DTSTAMP', stamp),
  ];

  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${dateKey}`);
    lines.push(`DTEND;VALUE=DATE:${compactDate(addDays(date, 1))}`);
  } else {
    lines.push(...eventDateProperties({ date, startTime, endTime, timezone }));
  }

  if (rrule) lines.push(...rawProperty('RRULE', rrule));
  lines.push(...property('SUMMARY', summary));
  lines.push(...property('DESCRIPTION', description));
  lines.push(...property('LOCATION', location));
  lines.push('END:VEVENT');
  return lines;
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function collaboratorDisplayName(collaborator) {
  return collaborator?.shortName || collaborator?.name || 'Colaborador';
}

function serviceDescription(service) {
  const rows = [
    service?.client?.name ? `Cliente: ${service.client.name}` : '',
    service?.status ? `Estado: ${service.status}` : '',
  ].filter(Boolean);
  return rows.join('\n');
}

function buildServiceEvents(services, stamp, timezone) {
  const rows = [];
  for (const service of services || []) {
    if (!service?.id || !service?.date) continue;
    const endDate = service.isContinuous && service.endDate ? service.endDate : service.date;
    for (const day of datesBetween(service.date, endDate)) {
      rows.push(...vevent({
        uid: `service-${service.id}-${compactDate(day)}@extrasolutio`,
        stamp,
        summary: service.name || 'Evento/Serviço',
        description: serviceDescription(service),
        location: service.location,
        date: day,
        startTime: service.startTime,
        endTime: service.endTime,
        timezone,
      }));
    }

    const paymentDate = dateParts(service.remainingPaymentDate);
    if (service.billingStatus === 'partial70' && paymentDate) {
      rows.push(...vevent({
        uid: `payment-${service.id}-${compactDate(paymentDate)}@extrasolutio`,
        stamp,
        summary: `Restante pagamento: ${service.name || 'Evento/Serviço'}`,
        description: service.client?.name ? `Cliente: ${service.client.name}` : '',
        date: paymentDate,
        allDay: true,
      }));
    }
  }
  return rows;
}

function buildBudgetFollowUps(budgets, stamp) {
  const rows = [];
  for (const budget of budgets || []) {
    for (const item of parseJsonArray(budget.followUpHistory)) {
      const reminderDate = dateParts(item?.reminderDate);
      if (!reminderDate) continue;
      const clientName = budget.client?.name || budget.companyName || budget.leadName || 'Cliente';
      rows.push(...vevent({
        uid: `budget-followup-${budget.id}-${compactDate(reminderDate)}@extrasolutio`,
        stamp,
        summary: `Follow-up: ${budget.reference || 'Orçamento'}`,
        description: [`Cliente: ${clientName}`, item.text || 'Follow-up'].filter(Boolean).join('\n'),
        date: reminderDate,
        allDay: true,
      }));
    }
  }
  return rows;
}

function buildBirthdayEvents(collaborators, stamp) {
  const rows = [];
  for (const collaborator of collaborators || []) {
    const birthDate = dateParts(collaborator.birthDate);
    if (!birthDate || !collaborator.id) continue;
    rows.push(...vevent({
      uid: `birthday-${collaborator.id}@extrasolutio`,
      stamp,
      summary: `Aniversário: ${collaboratorDisplayName(collaborator)}`,
      description: `Aniversário de ${collaboratorDisplayName(collaborator)}`,
      date: birthDate,
      allDay: true,
      rrule: 'FREQ=YEARLY',
    }));
  }
  return rows;
}

export function buildCalendarFeed({
  services = [],
  budgets = [],
  collaborators = [],
  generatedAt = new Date(),
  productId = DEFAULT_PRODUCT_ID,
  timezone = DEFAULT_TIMEZONE,
} = {}) {
  const stamp = utcStamp(generatedAt);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${productId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:ExtraSolutio',
    'X-WR-CALDESC:Eventos, serviços e lembretes da ExtraSolutio',
    `X-WR-TIMEZONE:${timezone}`,
    ...buildServiceEvents(services, stamp, timezone),
    ...buildBudgetFollowUps(budgets, stamp),
    ...buildBirthdayEvents(collaborators, stamp),
    'END:VCALENDAR',
  ];

  return `${lines.join('\r\n')}\r\n`;
}
