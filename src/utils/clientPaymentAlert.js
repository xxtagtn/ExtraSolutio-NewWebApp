import { buildClientFinanceSnapshot } from './clientFinanceSnapshot.js';

export function shouldShowClientPaymentAlert(event = {}, { today } = {}) {
  const finance = today ? buildClientFinanceSnapshot(event, { now: today }) : event.clientFinance || buildClientFinanceSnapshot(event);
  if (finance.payment.outstanding <= 0) return false;
  if (finance.afterAdjustment) return true;
  if (finance.prepaymentStages?.some((stage) => stage.outstanding > 0 && stage.status === 'overdue')) return true;
  const periods = event.billingPeriod ? [event.billingPeriod] : finance.periods;
  return (finance.billingStatus === 'invoiced' || finance.prepaid) && periods.some((row) => row.status === 'overdue');
}
