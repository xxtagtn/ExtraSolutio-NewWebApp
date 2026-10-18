import { clientPaymentSummary } from './clientPayment.js';
import { readClientPaymentRecord } from './clientPaymentRecord.js';
import { invoiceIsIssued, invoiceIsPaid } from '../../shared/invoiceLifecycle.js';
import { paidInvoiceCoverage } from '../../shared/invoicePaymentCoverage.js';

export function clientFinancialState(event = {}) {
  const invoices = (event.invoices || (event.invoice ? [event.invoice] : [])).filter(invoiceIsIssued);
  const summary = clientPaymentSummary(event);
  const covered = Math.round(paidInvoiceCoverage(event) * 100) / 100;
  const invoiceSettled = summary.total > 0 && covered >= summary.total && invoices.every(invoiceIsPaid);
  const received = Math.max(summary.received, covered);
  const outstanding = Math.max(0, Math.round((summary.total - received) * 100) / 100);
  const record = readClientPaymentRecord(event.clientPaymentRecord);
  const manual = record?.commercialStatus === 'invoiced';
  const status = summary.total > 0 && outstanding === 0 ? 'paid'
    : invoices.length || manual || record?.legacyInvoiced || event.billingStatus === 'invoiced' ? 'invoiced'
      : received > summary.signal && received > 0 ? 'partial'
        : summary.signal > 0 && received > 0 ? 'signaled' : 'pending';
  const labels = { paid: 'Totalmente Pago', invoiced: 'Faturado', partial: 'Parcialmente Pago', signaled: 'Sinalizado', pending: 'Pendente' };
  return { ...summary, received, outstanding, status, label: labels[status], manual,
    missingPayment: outstanding > 0, invoiceSettled };
}
