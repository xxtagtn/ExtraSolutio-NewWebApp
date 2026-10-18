import { billingDayKey } from '../../shared/clientBillingCalendar.js';
import { buildClientFinanceSnapshot } from './clientFinanceSnapshot.js';

export function normalizeCommercialIssueDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? billingDayKey(value) : null;
}

export function clientPaymentDeadline(event = {}, { today } = {}) {
  const finance = today ? buildClientFinanceSnapshot(event, { now: today }) : event.clientFinance || buildClientFinanceSnapshot(event);
  const unpaidStages = finance.prepaymentStages?.filter((stage) => stage.outstanding > 0) || [];
  const periods = unpaidStages.length ? unpaidStages : event.billingPeriod ? [event.billingPeriod] : finance.periods;
  const selected = [...periods].sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'))).find((row) => row.outstanding > 0) || periods[0];
  return { source: selected?.referenceDate ? 'calendar' : finance.billingStatus === 'invoiced' ? 'commercial' : null,
    issueDate: selected?.referenceDate || null,
    dueDate: selected?.dueDate ? new Date(`${selected.dueDate}T12:00:00`) : null,
    status: selected?.status || 'unknown', overdueDays: selected?.overdueDays || 0,
    label: selected?.label || 'Data por configurar' };
}
