import { isAssignmentOnCancelledDay } from '../../src/utils/eventCancelledDays.js';
import { isBillableEventAssignment } from '../../src/utils/eventFinancialRules.js';
import { isFinanceReadyEvent } from '../../src/utils/financeReadiness.js';
import { isStaffPaymentDeferredDate } from '../../src/utils/staffPayment.js';

function deferralError(message, statusCode = 409) {
  return Object.assign(new Error(message), { statusCode, expose: true });
}

export async function saveStaffPaymentDeferral(prisma, assignmentId, { date, updatedAt } = {}) {
  const id = Number(assignmentId);
  if (!Number.isSafeInteger(id) || id <= 0) throw deferralError('Registo inválido.', 400);
  if (date !== null && !isStaffPaymentDeferredDate(date)) throw deferralError('Indica uma data de pagamento válida.', 422);
  const stale = () => deferralError('O pagamento foi alterado. Volta a abrir a janela e tenta novamente.');

  try {
    return await prisma.$transaction(async (tx) => {
      const assignment = await tx.eventAssignment.findUnique({
        where: { id }, include: { event: { include: { assignments: true } } },
      });
      if (!assignment) return null;
      const { event, ...row } = assignment;
      if (!Object.hasOwn(row, 'paymentDeferredDate')) {
        throw deferralError('O cliente Prisma está desatualizado. É necessário gerá-lo novamente e reiniciar a API.', 503);
      }
      if (!updatedAt || new Date(updatedAt).getTime() !== assignment.updatedAt.getTime()) throw stale();
      if (row.paymentStatus !== 'unpaid' || !row.collaboratorId || !isBillableEventAssignment(row)
        || !isFinanceReadyEvent(event) || event.status === 'cancelled' || isAssignmentOnCancelledDay(row, event)) {
        throw deferralError('Só podes adiar pagamentos por pagar de serviços validados.');
      }
      if (date === row.paymentDeferredDate && row.paymentDeferredMonth === null) return row;

      const changed = await tx.eventAssignment.updateMany({
        where: { id, updatedAt: row.updatedAt, paymentStatus: 'unpaid' },
        data: { paymentDeferredDate: date, paymentDeferredMonth: null },
      });
      if (changed.count !== 1) throw stale();
      return tx.eventAssignment.findUnique({ where: { id } });
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error.code === 'P2034') throw stale();
    if (error.code === 'P2022' && String(error.meta?.column).split('.').at(-1) === 'paymentDeferredDate') {
      throw Object.assign(
        deferralError('Falta aplicar a migração dos adiamentos de pagamento na base de dados.', 503),
        { cause: error },
      );
    }
    throw error;
  }
}
