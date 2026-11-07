import { roundMoney } from '../../shared/money.js';
import { isAssignmentOnCancelledDay } from '../../src/utils/eventCancelledDays.js';
import { isBillableEventAssignment } from '../../src/utils/eventFinancialRules.js';
import { isFinanceReadyEvent } from '../../src/utils/financeReadiness.js';
import { staffAdjustmentReduction } from '../../src/utils/staffAdjustmentGain.js';
import { serviceListInclude } from '../utils/listPayloads.js';
import { synchronizeEventWorkflow } from './eventWorkflow.js';

function adjustmentError(message, statusCode = 409) {
  return Object.assign(new Error(message), { statusCode, expose: true });
}

export async function saveStaffPaymentAdjustment(prisma, assignmentId, { amount, asGain, updatedAt } = {}) {
  const id = Number(assignmentId);
  if (!Number.isSafeInteger(id) || id <= 0) throw adjustmentError('Registo inválido.', 400);
  if (typeof amount !== 'number' || !Number.isFinite(amount) || Math.abs(amount) > 9999999999.99
    || amount !== roundMoney(amount) || typeof asGain !== 'boolean') {
    throw adjustmentError('Indica um ajuste válido com até duas casas decimais.', 422);
  }
  if (asGain && amount >= 0) throw adjustmentError('Só um ajuste negativo pode ser registado como ganho.', 422);
  const stale = () => adjustmentError('O pagamento foi alterado. Volta a abrir o ajuste e tenta novamente.');
  try {
    return await prisma.$transaction(async (tx) => {
      const assignment = await tx.eventAssignment.findUnique({
        where: { id }, include: { event: { include: serviceListInclude } },
      });
      if (!assignment) return null;
      const { event, ...storedAssignment } = assignment;
      const row = event.assignments.find((item) => item.id === id);
      if (!updatedAt || new Date(updatedAt).getTime() !== assignment.updatedAt.getTime()) throw stale();
      if (!row?.collaboratorId || !isBillableEventAssignment(row) || !isFinanceReadyEvent(event)
        || event.status === 'cancelled' || isAssignmentOnCancelledDay(row, event)) {
        throw adjustmentError('Este serviço não está disponível para ajustar o pagamento.');
      }
      const amountChanged = amount !== roundMoney(assignment.paymentAdjustment);
      if (asGain && amountChanged && assignment.paymentStatus === 'paid') {
        throw adjustmentError('Num pagamento concluído, só podes designar como ganho o ajuste já guardado.');
      }
      if (asGain && staffAdjustmentReduction(row, event, amount) < -amount) {
        throw adjustmentError('O ganho não pode exceder o valor base a ajustar.', 422);
      }
      const gain = asGain ? -amount : null;
      if (!amountChanged && gain === (assignment.paymentAdjustmentGain == null ? null : Number(assignment.paymentAdjustmentGain))) return storedAssignment;
      const changed = await tx.eventAssignment.updateMany({ where: { id, updatedAt: assignment.updatedAt },
        data: { paymentAdjustment: amount, paymentAdjustmentGain: gain } });
      if (changed.count !== 1) throw stale();
      if (amountChanged) await synchronizeEventWorkflow(tx, event.id, { recalculateTotals: true });
      return tx.eventAssignment.findUnique({ where: { id } });
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error.code === 'P2034') throw stale();
    throw error;
  }
}
