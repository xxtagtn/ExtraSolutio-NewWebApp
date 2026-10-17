import { randomUUID } from 'node:crypto';
import { clientPaymentSummary, clientReceiptInvoiceBlocker } from '../../src/utils/clientPayment.js';
import { readClientPaymentRecord } from '../../src/utils/clientPaymentRecord.js';
import { receiptCanDelete, receiptMovements, receiptTypeLabels } from '../../src/utils/clientReceiptMovements.js';
import { receiptFiscal, reconcileReceiptRounding } from '../../src/utils/clientReceiptTax.js';
import { paymentFinancialSnapshot } from '../../src/utils/clientPaymentAdjustment.js';
import { clientPaymentRecordPatch } from './clientPaymentRecord.js';
import { linkedClientInvoices } from './clientPayment.js';
import { eventRevenueIsLocked } from '../utils/eventInvoiceProtection.js';
import { serviceListInclude } from '../utils/listPayloads.js';

const cents = (value) => Math.round(Number(value || 0) * 100);
const fail = (message, statusCode = 422) => Object.assign(new Error(message), { statusCode, expose: true });
const asDate = (value) => value ? new Date(`${value}T00:00:00.000Z`) : null;

export async function changeClientReceipt(prisma, eventId, movementId, input = {}, actor = {}) {
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0 || !['edit', 'reverse', 'delete'].includes(input.action)) throw fail('Indica um recebimento e uma ação válidos.');
  try {
    return await prisma.$transaction(async (tx) => {
      const event = await tx.event.findUnique({ where: { id }, include: { invoices: true } });
      if (!event) return null;
      const oldRecord = readClientPaymentRecord(event.clientPaymentRecord);
      if (!input.updatedAt || new Date(input.updatedAt).getTime() !== event.updatedAt.getTime()
        || input.revision !== (oldRecord?.entries.length || 0)) throw fail('Os recebimentos foram alterados. Atualiza a página antes de continuar.', 409);
      const invoices = await linkedClientInvoices(tx, event);
      const blocker = clientReceiptInvoiceBlocker(event, invoices);
      if (eventRevenueIsLocked(event) || blocker) throw fail(blocker || 'Este evento tem faturação emitida. Corrige o recebimento no Financeiro.', 409);
      const initialized = oldRecord && input.action === 'delete' ? event : { ...event, ...clientPaymentRecordPatch(event) };
      const record = globalThis.structuredClone(readClientPaymentRecord(initialized.clientPaymentRecord));
      const projection = receiptMovements(record);
      if (!record || !projection.reliable || cents(projection.total) !== cents(clientPaymentSummary(initialized).received)) {
        throw fail('O histórico antigo contém correções não individualizadas. Confirma os movimentos no Financeiro antes de os alterar.', 409);
      }
      let targetId = movementId;
      if (!oldRecord && ['legacy-signal', 'legacy-remaining'].includes(movementId)) {
        targetId = projection.rows.find((row) => row.type === movementId.slice(7))?.id;
      }
      const current = projection.rows.find((row) => row.id === targetId);
      if (!current) throw fail('Recebimento não encontrado neste evento.', 404);
      const deletingReverted = current.voided === 'reverse' && input.action === 'delete';
      if (current.voided && !deletingReverted) throw fail('Este recebimento já foi revertido ou eliminado.', 409);
      const projectedSignal = projection.rows.filter((row) => !row.voided && row.type === 'signal').reduce((sum, row) => sum + cents(row.amount), 0);
      if (!deletingReverted && projectedSignal !== cents(event.signaledAmount)) throw fail('A sinalização antiga não está individualizada no histórico. Confirma os movimentos no Financeiro.', 409);
      if (input.confirmedAmount == null || cents(input.confirmedAmount) !== cents(current.amount)) throw fail('O recebimento foi alterado. Atualiza a página antes de continuar.', 409);
      if (input.action === 'delete' && !receiptCanDelete(record, current)) throw fail('Este recebimento já tem histórico financeiro associado. Utiliza Reverter para o preservar.', 409);
      const entry = { id: randomUUID(), type: input.action === 'reverse' ? 'reversal' : 'correction',
        targetId, operation: input.action, amount: deletingReverted ? 0 : -current.amount, receivedAt: null,
        recordedAt: new Date().toISOString(), actor: { id: actor.id, name: String(actor.name || '').slice(0, 150) } };
      if (input.action === 'edit') {
        const amount = Number(String(input.amount ?? '').replace(',', '.'));
        const receivedAt = String(input.receivedAt || '');
        if (!Number.isFinite(amount) || amount <= 0 || amount > 9999999999.99 || Math.abs(amount * 100 - cents(amount)) > 0.0001) throw fail('Indica um valor recebido válido, com até duas casas decimais.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedAt) || Number.isNaN(asDate(receivedAt).getTime()) || asDate(receivedAt).toISOString().slice(0, 10) !== receivedAt) throw fail('Indica uma data de recebimento válida.');
        if (!Object.hasOwn(receiptTypeLabels, input.type)) throw fail('Seleciona um tipo de recebimento válido.');
        if (input.allocations != null && !Array.isArray(input.allocations)) throw fail('Indica uma distribuição válida pelos componentes pagos.');
        const description = String(input.description || '').trim();
        if (description.length > 400) throw fail('A descrição não pode ultrapassar 400 caracteres.');
        const snapshot = current.salesSnapshot || (input.allocations?.length ? paymentFinancialSnapshot(event) : null);
        const fiscal = cents(amount) === cents(current.amount) && !input.allocations?.length ? current.fiscal
          : receiptFiscal(snapshot, amount, input.allocations);
        if (input.allocations?.length && !fiscal) throw fail('A distribuição pelos componentes deve corresponder exatamente ao valor recebido.');
        entry.amount = (cents(amount) - cents(current.amount)) / 100;
        entry.replacement = { amount: cents(amount) / 100, type: input.type, receivedAt, description,
          fiscal: reconcileReceiptRounding(snapshot, fiscal,
            projection.rows.filter((row) => !row.voided && row.id !== targetId)) || null, salesSnapshot: snapshot };
      }
      entry.before = { amount: current.amount, type: current.type, receivedAt: current.receivedAt, description: current.description || '', fiscal: current.fiscal || null,
        ...(deletingReverted ? { voided: current.voided, voidedAt: current.voidedAt } : {}) };
      record.entries.push(entry);
      const next = receiptMovements(record);
      const active = next.rows.filter((row) => !row.voided);
      const signal = active.filter((row) => row.type === 'signal');
      const signalAmount = signal.reduce((sum, row) => sum + cents(row.amount), 0);
      const signalDates = signal.map((row) => row.receivedAt?.slice(0, 10)).filter(Boolean).sort();
      const otherDates = active.filter((row) => row.type !== 'signal').map((row) => row.receivedAt?.slice(0, 10)).filter(Boolean).sort();
      if (!deletingReverted && signalDates.length && otherDates.some((day) => day < signalDates[0])) throw fail('O pagamento restante não pode ser anterior à sinalização.');
      if (!next.reliable || !Number.isSafeInteger(cents(next.total)) || next.total > 9999999999.99) throw fail('O histórico não corresponde ao saldo dos recebimentos.', 409);
      if (!deletingReverted) {
        if (!next.total) delete record.settledFinancials;
        else if (cents(next.total) === cents(clientPaymentSummary(event).total)) record.settledFinancials = paymentFinancialSnapshot(event);
      }
      const data = deletingReverted ? { clientPaymentRecord: JSON.stringify(record) } : { clientPaymentRecord: JSON.stringify(record), paidAmount: next.total,
        signaledAmount: signalAmount / 100, signaledAt: asDate(signalDates[0]), billingPaymentDate: asDate(otherDates.at(-1)),
        billingStatus: next.total > 0 && cents(next.total) >= cents(clientPaymentSummary(event).total) ? 'paid' : signalAmount > 0 ? 'partial70' : 'pending' };
      const updated = await tx.event.updateMany({ where: { id, updatedAt: event.updatedAt,
        clientPaymentRecord: event.clientPaymentRecord, paidAmount: event.paidAmount }, data });
      if (updated.count !== 1) throw fail('Os recebimentos foram alterados. Atualiza a página antes de continuar.', 409);
      return tx.event.findUnique({ where: { id }, include: serviceListInclude });
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error.code === 'P2034') throw fail('Os recebimentos foram alterados. Atualiza a página antes de continuar.', 409);
    throw error;
  }
}
