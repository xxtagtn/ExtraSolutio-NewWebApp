import { clientPaymentTermDays } from '../../shared/invoiceLifecycle.js';
import { clientFinancialState } from './clientFinancialState.js';
import { clientPaymentDeadline } from './clientPaymentDeadline.js';
import { prepaymentRemainingReminderDate } from './prepaymentPolicy.js';

function isPastDue(value, today) {
  if (!value) return false;
  const due = new Date(value), current = new Date(today);
  due.setHours(0, 0, 0, 0);
  current.setHours(0, 0, 0, 0);
  return due < current;
}

// Presentation only: a receivable is not necessarily an overdue payment.
export function shouldShowClientPaymentAlert(event = {}, { today = new Date(), payment = clientFinancialState(event) } = {}) {
  if (!payment.missingPayment) return false;
  const client = event.client || {};
  const deadline = clientPaymentDeadline(event, { today, payment });
  if (deadline.source) return deadline.status === 'overdue';

  // Billing-period dates are forecasts, not the actual invoice issue date.
  const paymentDays = clientPaymentTermDays(client);
  if (['monthly', 'biweekly', 'custom'].includes(client.billingMethod) || paymentDays > 0
    || (client.paymentTerm && paymentDays === null)) return false;

  const hasRemainingPaymentRule = payment.signal > 0 && (client.billingMethod === 'prepaid' || event.billingStatus === 'partial70');
  if (event.remainingPaymentDate || hasRemainingPaymentRule) {
    return isPastDue(prepaymentRemainingReminderDate(event), today);
  }

  // Preserve the existing alert for clients without a deferred commercial rule.
  return true;
}
