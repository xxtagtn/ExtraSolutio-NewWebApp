import { buildAdditionalClientPayment, buildClientReceiptReversal, buildClientSignalReversal } from '../../src/utils/clientPayment.js';
import { invoiceIsIssued } from '../../shared/invoiceLifecycle.js';
import { clientPaymentRecordPatch } from './clientPaymentRecord.js';
import { eventRevenueIsLocked, invoiceEventIds } from '../utils/eventInvoiceProtection.js';
import { serviceListInclude } from '../utils/listPayloads.js';

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

async function reverseClientPayment(prisma, eventId, { updatedAt, confirmedReceived, confirmedSignal } = {}, allReceipts = false) {
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
      Object.assign(data, clientPaymentRecordPatch(event, data, { type: 'reversal' }));
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

export async function receiveAdditionalClientPayment(prisma, eventId, { updatedAt, amount, receivedAt } = {}) {
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0 || !updatedAt) throw reversalError('Atualiza o evento antes de registar o recebimento.', 422);
  try {
    return await prisma.$transaction(async (tx) => {
      const event = await tx.event.findUnique({ where: { id }, include: { invoices: true } });
      if (!event) return null;
      if (new Date(updatedAt).getTime() !== event.updatedAt.getTime()) throw reversalError('O pagamento foi alterado. Atualiza a página antes de registar o recebimento.');
      if (eventRevenueIsLocked(event) || (await linkedClientInvoices(tx, event)).some(invoiceIsIssued)) {
        throw reversalError('Este evento tem uma fatura emitida. Regista o recebimento no Financeiro, na fatura correspondente.');
      }
      const data = buildAdditionalClientPayment(event, { amount, receivedAt });
      data.billingPaymentDate = new Date(`${data.billingPaymentDate}T00:00:00.000Z`);
      Object.assign(data, clientPaymentRecordPatch(event, data, { type: 'adjustment' }));
      const updated = await tx.event.updateMany({ where: { id, updatedAt: event.updatedAt, paidAmount: event.paidAmount }, data });
      if (updated.count !== 1) throw reversalError('O pagamento foi alterado. Atualiza a página antes de registar o recebimento.');
      return tx.event.findUnique({ where: { id }, include: serviceListInclude });
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error.code === 'P2034') throw reversalError('O pagamento foi alterado. Atualiza a página antes de registar o recebimento.');
    throw error;
  }
}
