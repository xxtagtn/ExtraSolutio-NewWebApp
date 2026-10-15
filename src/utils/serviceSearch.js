import { eventDayKey } from './eventCancelledDays.js';

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function calendarDay(year, month, day) {
  const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${key}T00:00:00Z`);
  return year > 0 && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === key ? key : '';
}

function searchTerm(value) {
  const portugal = value.match(/^(\d{1,2})([/-])(\d{1,2})(?:\2(\d{4}))?$/);
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (portugal || iso) {
    const year = iso ? Number(iso[1]) : portugal[4] ? Number(portugal[4]) : null;
    const month = Number(iso ? iso[2] : portugal[3]);
    const day = Number(iso ? iso[3] : portugal[1]);
    return { type: 'date', year, month, day, valid: Boolean(calendarDay(year ?? 2000, month, day)) };
  }
  // Numeric fragments may match references/names, never a date, price or a partial ID.
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${/^\d/.test(value) ? '(?<!\\d)' : ''}${escaped}${/\d$/.test(value) ? '(?!\\d)' : ''}`);
  return { type: 'text', value, pattern };
}

function eventRange(event) {
  const key = eventDayKey(event.date);
  const [year, month, day] = key.split('-').map(Number);
  const start = calendarDay(year, month, day);
  const endKey = event.isContinuous ? eventDayKey(event.endDate || event.date) : start;
  const [endYear, endMonth, endDay] = endKey.split('-').map(Number);
  const end = calendarDay(endYear, endMonth, endDay);
  return { start, end: end && end >= start ? end : start };
}

function matchesDate(range, term) {
  if (!term.valid || !range.start) return false;
  const firstYear = term.year ?? Number(range.start.slice(0, 4));
  const lastYear = term.year ?? Number(range.end.slice(0, 4));
  for (let year = firstYear; year <= lastYear; year += 1) {
    const day = calendarDay(year, term.month, term.day);
    if (day && day >= range.start && day <= range.end) return true;
  }
  return false;
}

export function searchServices(services = [], query = '') {
  const text = normalize(query);
  if (!text) return services;
  const terms = text.split(/\s+/u).map(searchTerm);
  const hasDates = terms.some((term) => term.type === 'date');
  return services.map((event, index) => {
    const name = normalize(event.name);
    const reference = normalize(event.serviceReference);
    const id = normalize(event.id);
    const range = hasDates ? eventRange(event) : null;
    const matches = terms.every((term) => term.type === 'date' ? matchesDate(range, term)
      : term.value === id || term.pattern.test(name) || term.pattern.test(reference));
    const priority = terms.reduce((score, term) => term.type === 'text'
      ? score + (term.value === id ? 2 : term.value === reference ? 1 : 0) : score, 0);
    return { event, index, matches, priority };
  }).filter((result) => result.matches)
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
    .map((result) => result.event);
}
