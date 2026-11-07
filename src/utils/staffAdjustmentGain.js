import { billingDayKey } from '../../shared/clientBillingCalendar.js';
import { roundMoney, sumMoney } from '../../shared/money.js';
import { isBillableEventAssignment } from './eventFinancialRules.js';
import { isAssignmentOnCancelledDay } from './eventCancelledDays.js';
import { decimalValue } from './serviceFinance.js';
import { staffAssignmentPaymentBreakdown } from './staffPayment.js';

export function staffAdjustmentReduction(assignment, event, adjustment) {
  const before = staffAssignmentPaymentBreakdown({ ...assignment, paymentAdjustment: 0 }, event).base;
  const after = staffAssignmentPaymentBreakdown({ ...assignment, paymentAdjustment: adjustment }, event).base;
  return Math.max(0, sumMoney(before, -after));
}

export function staffAdjustmentGainAmount(assignment, event) {
  const amount = decimalValue(assignment.paymentAdjustmentGain) || 0;
  if (amount <= 0 || !assignment.collaboratorId || !isBillableEventAssignment(assignment)
    || isAssignmentOnCancelledDay(assignment, event)) return 0;
  const adjustment = roundMoney(decimalValue(assignment.paymentAdjustment) || 0);
  if (adjustment !== -amount) return 0;
  return Math.min(amount, staffAdjustmentReduction(assignment, event, adjustment));
}

export function staffAdjustmentGainDate(assignment) {
  return assignment.paymentStatus === 'paid' ? billingDayKey(assignment.paymentDate) : null;
}

export function staffAdjustmentGainInvalidated(existing, data) {
  return (data.paymentAdjustment !== undefined
    && roundMoney(data.paymentAdjustment) !== roundMoney(existing?.paymentAdjustment))
    || ['eventId', 'collaboratorId'].some((field) => (
      data[field] !== undefined && data[field] !== existing?.[field]
    ));
}
