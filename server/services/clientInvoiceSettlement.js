import { buildAdditionalClientPayment } from '../../src/utils/clientPayment.js';
import { clientFinancialState } from '../../src/utils/clientFinancialState.js';
import { buildClientFinanceSnapshot } from '../../src/utils/clientFinanceSnapshot.js';
import { readClientPaymentRecord } from '../../src/utils/clientPaymentRecord.js';
import { hasPermission, PERMISSIONS } from '../../src/utils/accessPermissions.js';
import { billingDayKey, clientBillingPeriodForDay } from '../../shared/clientBillingCalendar.js';
import { invoiceIsIssued, invoiceIsPaid } from '../../shared/invoiceLifecycle.js';
import { paymentInvoiceEventIds } from '../../shared/invoicePaymentCoverage.js';
import { serviceListInclude } from '../utils/listPayloads.js';
import { clientPaymentRecordPatch } from './clientPaymentRecord.js';
import { updateClientFinancialMetadata } from './clientFinancialMetadata.js';
import { withGroupedServiceInvoices } from './invoiceBilling.js';
import { synchronizeEventWorkflow } from './eventWorkflow.js';

const cents = (value) => Math.round(Number(value) * 100);
function fail(message, statusCode = 422) { throw Object.assign(new Error(message), { statusCode, expose: true }); }

export async function settleClientInvoice(db, eventId, input, actor = {}) {
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0) fail('Seleciona um serviço válido.');
  try {
    return await db.$transaction(async (tx) => {
      const loaded = await tx.event.findUnique({ where: { id }, include: serviceListInclude });
      if (!loaded) return null;
      let [event] = await withGroupedServiceInvoices(tx, [loaded]);
      const original = readClientPaymentRecord(event.clientPaymentRecord);
      if (event.clientPaymentRecord && !original) fail('O histórico financeiro não é válido.');
      if (!input.updatedAt || new Date(input.updatedAt).getTime() !== event.updatedAt.getTime()
        || input.revision !== (original?.entries.length || 0)) fail('O serviço foi alterado. Atualiza os dados antes de confirmar.', 409);
      const state = clientFinancialState(event);
      if (state.total <= 0) fail('Confirma primeiro o total final do serviço.');
      if (cents(input.confirmedTotal) !== cents(state.total) || cents(input.confirmedReceived) !== cents(state.received)
        || cents(input.amount) !== cents(state.outstanding)) fail('Confirma o saldo atual antes de marcar a fatura como paga.', 409);
      const receivedAt = billingDayKey(input.receivedAt);
      if (!receivedAt) fail('Indica a data efetiva do recebimento.');
      const issued = event.invoices.filter(invoiceIsIssued);
      if (issued.length) {
        if (!hasPermission(actor, PERMISSIONS.FINANCE_ISSUE_INVOICES)) fail('Sem permissões para alterar o estado das faturas.', 403);
        if (issued.some((invoice) => paymentInvoiceEventIds(invoice).length > 1)) {
          fail('Esta fatura agrupa vários serviços. Gere o pagamento na fatura correspondente para preservar a distribuição dos valores.');
        }
        if (issued.reduce((sum, invoice) => sum + cents(invoice.total), 0) !== cents(state.total)) {
          fail('As faturas associadas não correspondem ao total do serviço. Confirma a faturação antes de liquidar e arquivar.');
        }
      }
      const data = state.outstanding > 0 ? buildAdditionalClientPayment(event, { amount: state.outstanding, receivedAt }) : {};
      if (data.billingPaymentDate) data.billingPaymentDate = new Date(`${data.billingPaymentDate}T00:00:00Z`);
      Object.assign(data, clientPaymentRecordPatch(event, data, { type: 'remaining', actor, description: 'Pagamento de fatura' }));
      const record = readClientPaymentRecord(data.clientPaymentRecord || event.clientPaymentRecord) || { version: 1, entries: [] };
      const at = new Date().toISOString(), author = { id: actor.id, name: String(actor.name || '').slice(0, 150) };
      if (!issued.length && record.commercialStatus !== 'invoiced') {
        const issueDate = clientBillingPeriodForDay(event.date, event.client)?.referenceDate || billingDayKey(input.issueDate);
        if (!issueDate) fail('Indica a data de faturação antes de confirmar o pagamento.');
        record.commercialChanges = [...(record.commercialChanges || []), { from: record.commercialStatus || 'automatic', to: 'invoiced',
          issueDate, recordedAt: at, actor: author }];
        record.commercialStatus = 'invoiced'; record.commercialIssueDate = issueDate;
      }
      record.financeWorkflowVersion = 2;
      record.financeChanges = [...(record.financeChanges || []), { action: 'invoice_paid', recordedAt: at, actor: author,
        receivedAt, amount: state.outstanding, total: state.total, invoiceIds: issued.map((invoice) => invoice.id) }];
      data.clientPaymentRecord = JSON.stringify(record);
      const changed = await tx.event.updateMany({ where: { id, updatedAt: event.updatedAt, clientPaymentRecord: event.clientPaymentRecord }, data });
      if (changed.count !== 1) fail('O serviço foi alterado. Atualiza os dados antes de confirmar.', 409);
      for (const invoice of issued.filter((row) => !invoiceIsPaid(row))) {
        const updated = await tx.invoice.updateMany({ where: { id: invoice.id, status: invoice.status, total: invoice.total }, data: { status: 'paid' } });
        if (updated.count !== 1) fail('A fatura foi alterada. Atualiza os dados antes de confirmar.', 409);
      }
      await synchronizeEventWorkflow(tx, id);
      [event] = await withGroupedServiceInvoices(tx, [await tx.event.findUnique({ where: { id }, include: serviceListInclude })]);
      const finance = buildClientFinanceSnapshot(event);
      if (finance.payment.outstanding > 0) fail('Existe saldo por receber. A liquidação não foi concluída.');
      if (finance.allocationRequired) fail('Confirma primeiro a repartição dos valores por período.');
      if (finance.archive.canArchive && !finance.archive.archived) {
        return updateClientFinancialMetadata(tx, id, { action: 'archive', updatedAt: event.updatedAt,
          revision: readClientPaymentRecord(event.clientPaymentRecord)?.entries.length || 0,
          confirmedTotal: finance.payment.total, confirmedReceived: finance.payment.received }, actor);
      }
      return event;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error.code === 'P2034') fail('O serviço foi alterado. Atualiza os dados antes de confirmar.', 409);
    throw error;
  }
}
