import { clientPaymentTermDays } from './clientPaymentTerms.js';

export function billingDayKey(value) {
  if (!value) return null;
  if (value instanceof Date && Number.isNaN(value.getTime())) return null;
  const key = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const parsed = new Date(`${key}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === key ? key : null;
}

export function addBillingDays(value, days) {
  const key = billingDayKey(value);
  if (!key || !Number.isInteger(days)) return null;
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function billingToday(now = new Date(), timeZone = 'Europe/Lisbon') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(now)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function clientBillingPeriodForDay(value, client = {}) {
  const day = billingDayKey(value);
  if (!day) return null;
  const month = day.slice(0, 7), year = Number(day.slice(0, 4)), monthNumber = Number(day.slice(5, 7));
  const last = new Date(Date.UTC(year, monthNumber, 0, 12)).toISOString().slice(0, 10);
  const method = client.billingMethod || 'unconfigured';
  if (method === 'monthly') return { key: `monthly:${month}`, method, start: `${month}-01`, end: last, referenceDate: last };
  if (method === 'biweekly') {
    const first = Number(day.slice(8)) <= 15;
    return { key: `biweekly:${month}:${first ? 1 : 2}`, method, start: `${month}-${first ? '01' : '16'}`,
      end: first ? `${month}-15` : last, referenceDate: first ? `${month}-15` : last };
  }
  // Free-text custom conditions do not constitute an executable calendar rule.
  return { key: `${method}:${day}`, method, start: day, end: day, referenceDate: method === 'per_event' ? addBillingDays(day, 1) : null };
}

export function billingDueDate(referenceDate, client) {
  const days = clientPaymentTermDays(client);
  return days === null ? null : addBillingDays(referenceDate, days);
}

export function billingTiming(referenceDate, client, { outstanding = 0, now = new Date(), timeZone } = {}) {
  const dueDate = billingDueDate(referenceDate, client);
  const today = billingToday(now, timeZone);
  const overdueDays = dueDate && dueDate < today
    ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${dueDate}T12:00:00Z`)) / 86400000) : 0;
  const status = outstanding <= 0 ? 'paid' : !referenceDate || !dueDate ? 'unknown'
    : overdueDays ? 'overdue' : today === dueDate ? 'due_today' : 'within_term';
  return { referenceDate: billingDayKey(referenceDate), dueDate, overdueDays, status,
    label: status === 'overdue' ? `Vencida há ${overdueDays} ${overdueDays === 1 ? 'dia' : 'dias'}`
      : { paid: 'Pago', unknown: 'Data por configurar', due_today: 'Vence hoje', within_term: 'A aguardar pagamento' }[status] };
}
