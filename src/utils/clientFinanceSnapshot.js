import { clientBillingPeriodForDay, billingDayKey, billingToday, billingTiming, addBillingDays } from '../../shared/clientBillingCalendar.js';
import { invoiceIsIssued } from '../../shared/invoiceLifecycle.js';
import { clientFinancialState } from './clientFinancialState.js';
import { clientPaymentTotal } from './clientPaymentTotal.js';
import { readClientPaymentRecord } from './clientPaymentRecord.js';
import { activeEventDayKeys, activeEventAssignments, assignmentEventDay } from './eventCancelledDays.js';
import { billableEventAssignments, clientRateForAssignment } from './eventFinancialRules.js';
import { clientChargeHours } from './serviceFinance.js';
import { eventStaffVatRate } from './eventSalesTax.js';
import { isFinanceReadyEvent } from './financeReadiness.js';
import { isExternalOnlyService, externalServiceCanArchive } from './externalServiceWorkflow.js';

const cents = (value) => Math.round(Number(value || 0) * 100);
const amount = (value) => value / 100;
const same = (left, right) => cents(left) === cents(right);

export function clientArchiveState(event, { now = new Date() } = {}) {
  const record = readClientPaymentRecord(event.clientPaymentRecord), payment = clientFinancialState(event);
  const ended = (billingDayKey(event.isContinuous ? event.endDate || event.date : event.date) || '9999') < billingToday(now);
  const ready = isFinanceReadyEvent(event) && (isExternalOnlyService(event) ? externalServiceCanArchive(event, now) : ended);
  const canArchive = ready && payment.total > 0 && payment.outstanding === 0;
  const explicit = record?.financeArchive;
  const legacy = record?.financeWorkflowVersion !== 2 && !explicit;
  const legacyAllowed = !(!event.clientId && !event.client?.id && !event.financial?.hasInvoice
    && !(event.invoices || []).some(invoiceIsIssued) && !isExternalOnlyService(event));
  const legacyArchived = legacy && legacyAllowed && payment.total > 0 && payment.outstanding === 0 && isFinanceReadyEvent(event)
    && (!isExternalOnlyService(event) || externalServiceCanArchive(event, now));
  const archived = legacyArchived || canArchive && Boolean(explicit?.archivedAt) && same(explicit.confirmedTotal, payment.total)
    && (explicit.receiptRevision == null || explicit.receiptRevision === (record?.entries.length || 0));
  return { canArchive, archived, legacy: archived && legacy, needsConfirmation: canArchive && !archived,
    blocker: payment.outstanding > 0 ? 'Existe saldo por receber.' : !ready ? 'O serviço tem de terminar e estar operacionalmente concluído.' : payment.total <= 0 ? 'Confirma primeiro o total final do serviço.' : null };
}

export function buildClientFinanceSnapshot(event = {}, { now = new Date() } = {}) {
  const record = readClientPaymentRecord(event.clientPaymentRecord), payment = clientFinancialState(event);
  const client = event.client || {}, budget = /\[BUDGET_REF:[^\]]+\]/i.test(String(event.notes || ''));
  const registeredRules = Boolean((event.clientId || client.id) && client.billingMethod && client.paymentTerm);
  const prepaid = client.billingMethod === 'prepaid' || (budget && !registeredRules);
  const days = activeEventDayKeys(event);
  const groups = new Map();
  for (const day of days) {
    const calendar = clientBillingPeriodForDay(['monthly', 'biweekly'].includes(client.billingMethod) ? day : event.date, client);
    if (!calendar) continue;
    if (!groups.has(calendar.key)) groups.set(calendar.key, { ...calendar, days: [], staffBase: 0, staffTax: 0 });
    groups.get(calendar.key).days.push(day);
  }
  const periods = [...groups.values()];
  for (const assignment of billableEventAssignments(activeEventAssignments(event, event.assignments || []))) {
    const group = periods.find((period) => period.days.includes(assignmentEventDay(assignment, event)));
    if (!group) continue;
    group.staffBase += clientChargeHours(assignment, event.startTime, event.endTime, event.minimumHoursSnapshot) * clientRateForAssignment(assignment, event);
  }
  let accumulatedStaffBase = 0, accumulatedStaffTax = 0;
  for (const period of periods) {
    period.staffBase = cents(period.staffBase);
    accumulatedStaffBase += period.staffBase;
    const cumulativeTax = Math.round(accumulatedStaffBase * eventStaffVatRate(event) / 100);
    period.staffTax = cumulativeTax - accumulatedStaffTax;
    accumulatedStaffTax = cumulativeTax;
  }
  const total = cents(clientPaymentTotal(event)), tax = cents(event.taxAmount);
  if (periods.reduce((sum, period) => sum + period.staffBase + period.staffTax, 0) > total
    || periods.reduce((sum, period) => sum + period.staffTax, 0) > tax) {
    for (const period of periods) { period.staffBase = 0; period.staffTax = 0; }
  }
  const unassignedTotal = total - periods.reduce((sum, period) => sum + period.staffBase + period.staffTax, 0);
  const unassignedTax = tax - periods.reduce((sum, period) => sum + period.staffTax, 0);
  const allocationBasis = periods.map(({ key, staffBase, staffTax, days }) => ({ key, staffBase, staffTax, days }));
  const allocation = record?.billingAllocation;
  const priceAllocationValid = periods.length < 2 || (unassignedTotal === 0 && unassignedTax === 0) || (same(allocation?.total, payment.total) && same(allocation?.tax, event.taxAmount)
    && JSON.stringify(allocation?.basis) === JSON.stringify(allocationBasis)
    && periods.every((period) => allocation?.periods?.some((row) => row.key === period.key))
    && periods.reduce((sum, period) => sum + cents(allocation.periods.find((row) => row.key === period.key)?.globalTotal), 0) === unassignedTotal
    && periods.reduce((sum, period) => sum + cents(allocation.periods.find((row) => row.key === period.key)?.globalTax), 0) === unassignedTax);
  const receiptAllocationValid = payment.received === 0 || same(payment.received, payment.total)
    || (same(allocation?.receivedTotal, payment.received) && allocation?.receiptRevision === (record?.entries.length || 0)
      && JSON.stringify(allocation?.basis) === JSON.stringify(allocationBasis)
      && periods.reduce((sum, period) => sum + cents(allocation?.periods?.find((row) => row.key === period.key)?.received), 0) === cents(payment.received));
  const issued = (event.invoices || (event.invoice ? [event.invoice] : [])).filter(invoiceIsIssued);
  const invoiced = Boolean(issued.length || record?.commercialStatus === 'invoiced' || record?.legacyInvoiced || event.billingStatus === 'invoiced');
  const manualReference = record?.commercialIssueDate || issued[0]?.issueDate || null;
  const afterAdjustment = isFinanceReadyEvent(event) && record?.settledFinancials && cents(payment.total) > cents(record.settledFinancials.total)
    && cents(payment.received) >= cents(record.settledFinancials.total) && payment.outstanding > 0;
  const completed = isFinanceReadyEvent(event) && (billingDayKey(event.endDate || event.date) || '9999') < billingToday(now);
  const forecastTotal = Number(record?.budgetForecastTotal ?? record?.expectedTotal ?? record?.settledFinancials?.total ?? payment.total);
  const depositCents = Math.round(cents(forecastTotal) * Number(client.prepaymentPercent ?? 70) / 100);
  const depositOutstanding = Math.max(0, depositCents - cents(payment.received));
  const prepaymentStages = prepaid && !afterAdjustment ? [
    { key: 'deposit', label: 'Sinalização na adjudicação', total: amount(depositCents), outstanding: amount(depositOutstanding),
      ...billingTiming(record?.budgetAdjudicatedAt, { paymentTerm: 'immediate' }, { outstanding: amount(depositOutstanding), now }) },
    { key: 'remaining', label: 'Restante previsto', total: amount(cents(forecastTotal) - depositCents),
      outstanding: amount(Math.max(0, cents(forecastTotal) - cents(payment.received) - depositOutstanding)),
      ...billingTiming(event.remainingPaymentDate || addBillingDays(event.date, -(client.prepaymentRemainingDaysBefore ?? 7)),
        { paymentTerm: 'immediate' }, { outstanding: amount(Math.max(0, cents(forecastTotal) - cents(payment.received) - depositOutstanding)), now }) },
  ] : [];
  for (const period of periods) {
    const saved = allocation?.periods?.find((row) => row.key === period.key);
    period.referenceDate = ['monthly', 'biweekly'].includes(client.billingMethod) ? period.referenceDate
      : prepaid ? event.remainingPaymentDate || addBillingDays(event.date, -(client.prepaymentRemainingDaysBefore ?? 7))
        : client.billingMethod === 'custom' ? billingDayKey(manualReference) : period.referenceDate || billingDayKey(manualReference);
    const exactSingle = periods.length === 1;
    period.total = exactSingle ? payment.total : priceAllocationValid ? amount(period.staffBase + period.staffTax + cents(saved?.globalTotal)) : null;
    period.tax = exactSingle ? Number(event.taxAmount || 0) : priceAllocationValid ? amount(period.staffTax + cents(saved?.globalTax)) : null;
    period.received = exactSingle ? payment.received : receiptAllocationValid && period.total !== null
      ? payment.received === 0 ? 0 : same(payment.received, payment.total) ? period.total : Number(saved?.received || 0) : null;
    period.outstanding = period.total !== null && period.received !== null ? amount(Math.max(0, cents(period.total) - cents(period.received))) : null;
    const timingClient = prepaid ? { paymentTerm: 'immediate' } : client;
    Object.assign(period, billingTiming(period.referenceDate, timingClient, { outstanding: period.outstanding ?? payment.outstanding, now }));
    if (period.outstanding === null) { period.status = 'allocation_required'; period.label = 'Repartição por confirmar'; }
    period.staffBase = amount(period.staffBase); period.staffTax = amount(period.staffTax);
    period.billingLabel = invoiced ? 'Faturado' : 'Por faturar';
  }
  const overdue = invoiced && payment.outstanding > 0 && periods.some((period) => period.status === 'overdue');
  const prepaymentDue = prepaymentStages.some((stage) => stage.outstanding > 0 && stage.status === 'overdue');
  const paymentStatus = payment.total > 0 && payment.outstanding === 0 ? completed ? 'paid' : 'prepaid'
    : afterAdjustment ? 'adjustment_due' : overdue ? 'overdue' : prepaymentDue ? 'payment_due' : payment.received > 0 ? 'partial' : 'pending';
  return { version: 2, calculatedAt: new Date(now).toISOString(), billingStatus: invoiced ? 'invoiced' : 'unbilled', billingLabel: invoiced ? 'Faturado' : 'Por faturar',
    paymentStatus, paymentLabel: { paid: 'Pago', prepaid: 'Previsto totalmente recebido', adjustment_due: 'Pagamento em falta', payment_due: 'Pagamento em falta', overdue: 'Fatura vencida', partial: 'Parcialmente pago', pending: 'A aguardar pagamento' }[paymentStatus],
    payment, prepaid, budget, completed, afterAdjustment: Boolean(afterAdjustment), overdue, periods, prepaymentStages, allocationBasis,
    allocationRequired: periods.length > 1 && (!priceAllocationValid || !receiptAllocationValid), unassignedTotal: amount(unassignedTotal), unassignedTax: amount(unassignedTax),
    archive: clientArchiveState(event, { now }) };
}
