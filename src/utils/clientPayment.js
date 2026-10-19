import { decimalValue } from './serviceFinance.js';
import { invoiceIsIssued, invoiceIsPaid } from '../../shared/invoiceLifecycle.js';
import { readClientPaymentRecord } from './clientPaymentRecord.js';
import { clientBillingAdjustment, clientPaymentTotal } from './clientPaymentTotal.js';

export const CLIENT_PAYMENT_FIELDS = ['billingStatus', 'signaledAmount', 'paidAmount', 'signaledAt', 'remainingPaymentDate', 'billingPaymentDate'];

function cents(value) {
  return Math.round((decimalValue(value) || 0) * 100);
}

function dateOnly(value) {
  if (!value) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function clientPaymentFieldsUnchanged(draft = {}, existing = {}) {
  return CLIENT_PAYMENT_FIELDS.every((field) => {
    if (draft[field] === undefined) return true;
    if (field === 'signaledAmount' || field === 'paidAmount') return cents(draft[field]) === cents(existing[field]);
    if (field === 'billingStatus') return (draft[field] || 'pending') === (existing[field] || 'pending');
    return dateOnly(draft[field]) === dateOnly(existing[field]);
  });
}

function validDate(value) {
  const day = dateOnly(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`))
    && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}

function paymentError(message) {
  const error = new Error(message);
  error.statusCode = 422;
  error.expose = true;
  return error;
}

function moneyInput(value, label) {
  const amount = value === '' || value == null ? 0 : decimalValue(value);
  if (amount === null || !Number.isFinite(amount) || amount < 0) throw paymentError(`Indica um ${label} válido, igual ou superior a zero.`);
  return Math.round(amount * 100);
}

export function clientPaymentSummary(event = {}) {
  const total = cents(clientPaymentTotal(event));
  const signal = Math.max(0, cents(event.signaledAmount));
  const stored = Math.max(0, cents(event.paidAmount));
  // Older status-only payments recorded settlement without a cumulative amount.
  const legacySettled = event.externalService?.settledByInvoice === true || (!readClientPaymentRecord(event.clientPaymentRecord)
    && event.billingStatus === 'paid' && (stored === 0 || stored === signal));
  // Legacy status-only settlements predate VAT on adjustments: do not invent extra cash.
  const legacyReceived = Math.max(0, cents(event.totalRevenue) + cents(clientBillingAdjustment(event).base));
  const received = legacySettled ? legacyReceived : stored > 0 ? stored : event.billingStatus === 'partial70' ? signal : 0;
  return { total: total / 100, signal: signal / 100, received: received / 100,
    remainingReceived: Math.max(0, received - signal) / 100, outstanding: Math.max(0, total - received) / 100 };
}

export function clientPaymentDraft(event = {}) {
  const summary = clientPaymentSummary(event);
  return { billingStatus: event.billingStatus || 'pending',
    signaledAmount: summary.signal ? String(summary.signal).replace('.', ',') : '',
    signaledAt: dateOnly(event.signaledAt), remainingPaymentDate: dateOnly(event.remainingPaymentDate),
    remainingReceived: summary.remainingReceived ? String(summary.remainingReceived).replace('.', ',') : '',
    billingPaymentDate: dateOnly(event.billingPaymentDate) };
}

export function clientSignalReversalBlocker(event = {}, invoices = event.invoices || []) {
  if (cents(event.signaledAmount) <= 0) return 'Este serviço não tem uma sinalização registada para reverter.';
  if (event.billingStatus === 'paid' || event.billingPaymentDate || cents(event.paidAmount) > cents(event.signaledAmount)
    || invoices.some((invoice) => invoiceIsIssued(invoice) && invoiceIsPaid(invoice))) {
    return 'A sinalização tem uma liquidação ou pagamentos posteriores. Corrige primeiro esses movimentos; a reversão foi bloqueada para preservar o histórico.';
  }
  if (cents(event.paidAmount) < 0 || (cents(event.paidAmount) > 0 && cents(event.paidAmount) !== cents(event.signaledAmount))) {
    return 'O total recebido não coincide com a sinalização. Corrige primeiro os valores antes de reverter este pagamento.';
  }
  return '';
}

export function buildClientSignalReversal(event, invoices = event.invoices || []) {
  const blocker = clientSignalReversalBlocker(event, invoices);
  if (blocker) throw paymentError(blocker);
  return { billingStatus: invoices.some(invoiceIsIssued) || event.billingStatus === 'invoiced' ? 'invoiced' : 'pending',
    signaledAmount: 0, paidAmount: 0, signaledAt: null };
}

export function clientReceiptInvoiceBlocker(event = {}, invoices = event.invoices || []) {
  if (event.billingStatus === 'invoiced' || readClientPaymentRecord(event.clientPaymentRecord)?.legacyInvoiced || invoices.some(invoiceIsIssued)) {
    return 'Este serviço tem faturação emitida. A correção dos recebimentos deve ser tratada no Financeiro, mantendo a fatura.';
  }
  return '';
}

export function clientReceiptRegistrationBlocker(event = {}, invoices = event.invoices || []) {
  // A legacy invoiced label locks pricing/corrections, not new incoming cash.
  return invoices.some(invoiceIsIssued) ? clientReceiptInvoiceBlocker(event, invoices) : '';
}

export function clientReceiptReversalBlocker(event = {}, invoices = event.invoices || []) {
  const invoiceBlocker = clientReceiptInvoiceBlocker(event, invoices);
  if (invoiceBlocker) return invoiceBlocker;
  const summary = clientPaymentSummary(event);
  if (summary.received <= 0 && summary.signal <= 0) return 'Este serviço não tem recebimentos registados para reverter.';
  return '';
}

export function buildClientReceiptReversal(event, invoices = event.invoices || [], confirmation = {}) {
  const blocker = clientReceiptReversalBlocker(event, invoices);
  if (blocker) throw paymentError(blocker);
  const summary = clientPaymentSummary(event);
  if (confirmation.confirmedReceived == null || confirmation.confirmedSignal == null
    || moneyInput(confirmation.confirmedReceived, 'total recebido') !== cents(summary.received)
    || moneyInput(confirmation.confirmedSignal, 'valor sinalizado') !== cents(summary.signal)) {
    throw paymentError('Confirma os valores atuais da sinalização e do total recebido antes de reverter os recebimentos.');
  }
  return { billingStatus: 'pending', signaledAmount: 0, paidAmount: 0, signaledAt: null, billingPaymentDate: null };
}

export function assertClientSignalHistoryPreserved(input, existing, invoices = existing.invoices || []) {
  const previous = clientPaymentSummary(existing);
  const hasLaterReceipt = previous.remainingReceived > 0 || existing.billingStatus === 'paid' || existing.billingPaymentDate
    || invoices.some((invoice) => invoiceIsIssued(invoice) && invoiceIsPaid(invoice));
  if (!hasLaterReceipt) return;
  if ((input.paidAmount !== undefined && cents(input.paidAmount) < cents(previous.received))
    || (input.signaledAmount !== undefined && cents(existing.signaledAmount) > 0 && cents(input.signaledAmount) === 0)
    || (input.signaledAt !== undefined && existing.signaledAt && !input.signaledAt)) {
    throw paymentError('Este pagamento tem uma liquidação ou recebimentos posteriores. Não é possível apagá-los ao corrigir a sinalização.');
  }
}

export function buildClientPaymentPayload(draft, event = {}) {
  const status = draft.billingStatus || 'pending';
  const total = cents(clientPaymentTotal(event));
  const signal = moneyInput(draft.signaledAmount, 'valor sinalizado');
  const signaledAt = dateOnly(draft.signaledAt);
  const dueDate = dateOnly(draft.remainingPaymentDate);
  if (signal > total && signal !== cents(event.signaledAmount)) throw paymentError('O valor sinalizado não pode exceder o valor total do serviço.');
  if (signaledAt && !validDate(signaledAt)) throw paymentError('Indica uma data da sinalização válida.');
  if (dueDate && !validDate(dueDate)) throw paymentError('Indica uma data prevista válida.');
  if (['partial70', 'paid'].includes(status) && signal > 0 && !signaledAt
    && !(cents(event.signaledAmount) === signal && !event.signaledAt)) {
    throw paymentError('Indica a data da sinalização.');
  }
  if (status === 'partial70' && signal <= 0) throw paymentError('Indica o valor sinalizado pelo cliente.');

  let received = signal;
  let paidDate = null;
  let billingStatus = status;
  if (status === 'partial70') {
    const following = clientPaymentSummary(event).remainingReceived;
    received += cents(following);
    if (following > 0) paidDate = dateOnly(event.billingPaymentDate) || null;
  }
  if (status === 'paid') {
    const finalReceipt = moneyInput(draft.remainingReceived, 'valor restante recebido');
    received = signal + finalReceipt;
    const unchangedReceipts = event.billingStatus === 'paid'
      && received === cents(clientPaymentSummary(event).received) && signal === cents(event.signaledAmount);
    if (received !== total && !unchangedReceipts) throw paymentError('Para marcar como Pago, a sinalização e o restante recebido devem corresponder ao valor total do serviço.');
    paidDate = dateOnly(draft.billingPaymentDate);
    const legacyUnchanged = event.billingStatus === 'paid' && !event.billingPaymentDate
      && cents(clientPaymentSummary(event).received) === received && cents(event.signaledAmount) === signal;
    if (!paidDate && !legacyUnchanged) throw paymentError('Indica a data efetiva do recebimento.');
    if (paidDate && !validDate(paidDate)) throw paymentError('Indica uma data efetiva do recebimento válida.');
    if (paidDate && signaledAt && paidDate < signaledAt) throw paymentError('O pagamento restante não pode ser anterior à sinalização.');
  } else if (status === 'partial70' && signal === total && signaledAt) {
    billingStatus = 'paid';
    paidDate = signaledAt;
  } else if (status !== 'partial70') {
    // Changing an unrelated financial state must not erase existing receipts.
    received = cents(event.paidAmount);
    paidDate = dateOnly(event.billingPaymentDate);
  }
  return { billingStatus, signaledAmount: signal / 100, paidAmount: received / 100,
    signaledAt: signaledAt || null, remainingPaymentDate: dueDate || null, billingPaymentDate: paidDate || null };
}

export function buildAdditionalClientPayment(event, { amount, receivedAt } = {}) {
  const summary = clientPaymentSummary(event);
  const additional = moneyInput(amount, 'valor recebido');
  const date = dateOnly(receivedAt);
  if (additional <= 0 || additional > cents(summary.outstanding)) throw paymentError('Indica um recebimento superior a zero e que não exceda o valor em falta.');
  if (!validDate(date)) throw paymentError('Indica a data efetiva do recebimento.');
  const previousDate = dateOnly(event.billingPaymentDate || event.signaledAt);
  if (previousDate && date < previousDate) throw paymentError('O novo recebimento não pode ser anterior aos pagamentos registados.');
  const received = cents(summary.received) + additional;
  return { paidAmount: received / 100, billingPaymentDate: date,
    billingStatus: received === cents(summary.total) ? 'paid' : summary.signal > 0 ? 'partial70' : 'pending' };
}

export function isClientPaymentOnlyUpdate(input = {}) {
  return Object.keys(input).length > 0 && Object.keys(input).every((field) => CLIENT_PAYMENT_FIELDS.includes(field));
}

export function isDetailedClientPaymentUpdate(input = {}) {
  return input.billingPaymentDate !== undefined && (input.paidAmount !== undefined || input.billingStatus === 'paid')
    && isClientPaymentOnlyUpdate(input);
}

export function validateClientPaymentUpdate(input, existing) {
  // Preserve compatibility with existing status-only/invoice/prepayment callers.
  if (!isDetailedClientPaymentUpdate(input)) return;
  const merged = { ...existing, ...input };
  const draft = clientPaymentDraft(merged);
  const received = input.paidAmount === undefined ? cents(clientPaymentTotal(existing)) : moneyInput(input.paidAmount, 'valor recebido');
  draft.remainingReceived = (received - moneyInput(merged.signaledAmount, 'valor sinalizado')) / 100;
  const canonical = buildClientPaymentPayload(draft, existing);
  if (cents(canonical.paidAmount) !== received) {
    throw paymentError('O total recebido não corresponde aos pagamentos registados.');
  }
  assertClientSignalHistoryPreserved(canonical, existing);
  const previous = clientPaymentSummary(existing);
  if (previous.remainingReceived > 0 || existing.billingStatus === 'paid' || existing.billingPaymentDate) {
    if (cents(canonical.paidAmount) < cents(previous.received)
      || (cents(existing.signaledAmount) > 0 && cents(canonical.signaledAmount) === 0)
      || (existing.billingPaymentDate && !canonical.billingPaymentDate)) {
      throw paymentError('Este pagamento tem uma liquidação ou recebimentos posteriores. Não é possível apagá-los ao corrigir a sinalização.');
    }
  }
  return canonical;
}
