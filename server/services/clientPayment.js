import { buildAdditionalClientPayment, buildClientReceiptReversal, buildClientSignalReversal } from '../../src/utils/clientPayment.js';
import { invoiceIsIssued } from '../../shared/invoiceLifecycle.js';
import { clientPaymentRecordPatch } from './clientPaymentRecord.js';
import { eventRevenueIsLocked, invoiceEventIds } from '../utils/eventInvoiceProtection.js';
import { serviceListInclude } from '../utils/listPayloads.js';
import { readClientPaymentRecord } from '../../src/utils/clientPaymentRecord.js';
import { clientPaymentSummary } from '../../src/utils/clientPayment.js';
import { receiptTypeLabels } from '../../src/utils/clientReceiptMovements.js';
import { normalizeCommercialIssueDate } from '../../src/utils/clientPaymentDeadline.js';
import { clientBillingPeriodForDay } from '../../shared/clientBillingCalendar.js';

function reversalError(message, statusCode = 409) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

export async function linkedClientInvoices(tx, event) {
  const candidates = await tx.invoice.findMany({
    where: { OR: [{ eventId: event.id }, { eventIds: { contains: String(event.id) } }] },
    select: { id: true, eventId: true, eventIds: true, status: true, issueDate: true },
  });
  const linked = new Map((event.invoices || []).map((invoice) => [invoice.id, invoice]));
  for (const invoice of candidates) if (invoiceEventIds(invoice).includes(event.id)) linked.set(invoice.id, invoice);
  return [...linked.values()];
}

export function reverseClientSignal(prisma, eventId, options = {}) {
  return reverseClientPayment(prisma, eventId, options);
}

export function reverseClientReceipts(prisma, eventId, options = {}) {
  return reverseClientPayment(prisma, eventId, options, true);
}

async function reverseClientPayment(prisma, eventId, { updatedAt, confirmedReceived, confirmedSignal, actor } = {}, allReceipts = false) {
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0) throw reversalError('Seleciona um evento válido.', 400);
  if (allReceipts && !updatedAt) throw reversalError('Atualiza a página antes de reverter os recebimentos.', 422);
  try {
    return await prisma.$transaction(async (tx) => {
      const event = await tx.event.findUnique({ where: { id }, include: { invoices: true } });
      if (!event) return null;
      if (updatedAt != null && (Number.isNaN(new Date(updatedAt).getTime())
        || new Date(updatedAt).getTime() !== event.updatedAt.getTime())) {
        throw reversalError('O pagamento foi alterado. Atualiza a página antes de reverter a sinalização.');
      }
      const invoices = await linkedClientInvoices(tx, event);
      const data = allReceipts
        ? buildClientReceiptReversal(event, invoices, { confirmedReceived, confirmedSignal })
        : buildClientSignalReversal(event, invoices);
      Object.assign(data, clientPaymentRecordPatch(event, data, { type: 'reversal', actor }));
      const result = await tx.event.updateMany({
        where: { id, updatedAt: event.updatedAt, billingStatus: event.billingStatus,
          signaledAmount: event.signaledAmount, paidAmount: event.paidAmount }, data,
      });
      if (result.count !== 1) throw reversalError('O pagamento foi alterado. Atualiza a página antes de reverter a sinalização.');
      return tx.event.findUnique({ where: { id }, include: serviceListInclude });
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error.code === 'P2034') throw reversalError('O pagamento foi alterado. Atualiza a página antes de reverter a sinalização.');
    throw error;
  }
}

export async function receiveAdditionalClientPayment(prisma, eventId, { updatedAt, amount, receivedAt, receiptAllocations, actor, type = 'adjustment', description = '', revision } = {}) {
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0 || !updatedAt) throw reversalError('Atualiza o evento antes de registar o recebimento.', 422);
  try {
    return await prisma.$transaction(async (tx) => {
      const event = await tx.event.findUnique({ where: { id }, include: { invoices: true } });
      if (!event) return null;
      if (!Object.hasOwn(receiptTypeLabels, type) || String(description).length > 400) throw reversalError('Indica um tipo e uma descrição válidos.', 422);
      if (revision !== undefined && revision !== (readClientPaymentRecord(event.clientPaymentRecord)?.entries.length || 0)) throw reversalError('Os recebimentos foram alterados. Atualiza a página.');
      if (new Date(updatedAt).getTime() !== event.updatedAt.getTime()) throw reversalError('O pagamento foi alterado. Atualiza a página antes de registar o recebimento.');
      if ((await linkedClientInvoices(tx, event)).some(invoiceIsIssued)) {
        throw reversalError('Este evento tem uma fatura emitida. Regista o recebimento no Financeiro, na fatura correspondente.');
      }
      const data = buildAdditionalClientPayment(event, { amount, receivedAt });
      data.billingPaymentDate = new Date(`${data.billingPaymentDate}T00:00:00.000Z`);
      if (type === 'signal') {
        const summary = clientPaymentSummary(event);
        data.signaledAmount = Number((summary.signal + data.paidAmount - summary.received).toFixed(2));
        data.signaledAt = event.signaledAt || data.billingPaymentDate;
        if (data.billingStatus !== 'paid') data.billingPaymentDate = event.billingPaymentDate;
        if (data.billingStatus !== 'paid') data.billingStatus = 'partial70';
      }
      Object.assign(data, clientPaymentRecordPatch(event, data, { type, legacyInvoiced: eventRevenueIsLocked(event),
        allocations: receiptAllocations, actor, description: String(description).trim() }));
      const updated = await tx.event.updateMany({ where: { id, updatedAt: event.updatedAt, paidAmount: event.paidAmount }, data });
      if (updated.count !== 1) throw reversalError('O pagamento foi alterado. Atualiza a página antes de registar o recebimento.');
      return tx.event.findUnique({ where: { id }, include: serviceListInclude });
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error.code === 'P2034') throw reversalError('O pagamento foi alterado. Atualiza a página antes de registar o recebimento.');
    throw error;
  }
}

export async function setClientCommercialStatus(prisma, eventId, { updatedAt, revision, status, issueDate } = {}, actor = {}) {
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0 || !['automatic', 'invoiced'].includes(status)) throw reversalError('Seleciona um estado financeiro válido.', 422);
  try {
    return await prisma.$transaction(async (tx) => {
      const event = await tx.event.findUnique({ where: { id }, include: serviceListInclude });
      if (!event) return null;
      const calendar = clientBillingPeriodForDay(event.date, event.client || {});
      const date = status !== 'invoiced' ? null : calendar?.referenceDate || normalizeCommercialIssueDate(issueDate);
      if (status === 'invoiced' && !date) throw reversalError('Indica uma data de emissão válida para estas condições comerciais.', 422);
      const original = readClientPaymentRecord(event.clientPaymentRecord);
      if (!updatedAt || new Date(updatedAt).getTime() !== event.updatedAt.getTime() || revision !== (original?.commercialChanges?.length || 0)) {
        throw reversalError('O evento foi alterado. Atualiza a página antes de continuar.');
      }
      if ((await linkedClientInvoices(tx, event)).some(invoiceIsIssued) || (eventRevenueIsLocked(event) && status !== 'invoiced')) {
        throw reversalError('Este evento tem faturação emitida. Gere o estado da fatura no Financeiro.');
      }
      const initial = original ? {} : clientPaymentRecordPatch(event, {}, { legacyInvoiced: eventRevenueIsLocked(event) });
      const record = globalThis.structuredClone(original || readClientPaymentRecord(initial.clientPaymentRecord) || { version: 1, entries: [] });
      const next = status === 'invoiced' ? 'invoiced' : null;
      if ((record.commercialStatus || null) === next && (record.commercialIssueDate || null) === date) return tx.event.findUnique({ where: { id }, include: serviceListInclude });
      record.commercialChanges = [...(record.commercialChanges || []), { from: record.commercialStatus || 'automatic', to: status,
        previousIssueDate: record.commercialIssueDate || null, issueDate: date,
        recordedAt: new Date().toISOString(), actor: { id: actor.id, name: String(actor.name || '').slice(0, 150) } }];
      record.commercialStatus = next;
      record.commercialIssueDate = date;
      const changed = await tx.event.updateMany({ where: { id, updatedAt: event.updatedAt, clientPaymentRecord: event.clientPaymentRecord },
        data: { ...initial, clientPaymentRecord: JSON.stringify(record) } });
      if (changed.count !== 1) throw reversalError('O evento foi alterado. Atualiza a página antes de continuar.');
      return tx.event.findUnique({ where: { id }, include: serviceListInclude });
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error.code === 'P2034') throw reversalError('O evento foi alterado. Atualiza a página antes de continuar.');
    throw error;
  }
}
