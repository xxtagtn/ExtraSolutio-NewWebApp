import { clientPaymentSummary } from '../../src/utils/clientPayment.js';
import { calculateEventTotals } from '../utils/eventTotals.js';

export function checkedEventFinancialTotals(event, nextEvent, { requireCompletePricing = true, preserveUnstructuredBudget = true,
  requireKnownPreviousTotal = false } = {}) {
  const options = { preserveUnstructuredBudget };
  const totals = calculateEventTotals(nextEvent, nextEvent.assignments || event.assignments, options);
  const error = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode, expose: true });
  if (requireKnownPreviousTotal) {
    const known = calculateEventTotals({ ...event, totalRevenue: 0, totalCost: 0, taxAmount: 0 }, event.assignments);
    if (['totalRevenue', 'taxAmount'].some((field) => Number(event[field]) !== known[field])) {
      throw error('O total guardado inclui valores por discriminar. Confirma os valores antes de eliminar o último parceiro.');
    }
  }
  if (['totalCost', 'totalRevenue', 'taxAmount'].some((field) => !Number.isFinite(totals[field]) || Math.abs(totals[field]) > 9999999999.99)) {
    throw error('Os totais ultrapassam o limite monetário suportado. Confirma o custo e a margem.', 422);
  }
  if (requireCompletePricing) {
    const calculated = calculateEventTotals({ ...nextEvent, totalRevenue: 0, totalCost: 0, taxAmount: 0 }, nextEvent.assignments || event.assignments, options);
    if (['totalCost', 'totalRevenue', 'taxAmount'].some((field) => totals[field] !== calculated[field])) {
      throw error('Não é possível atualizar os totais com os preços de Staff incompletos. Confirma os valores/hora antes de alterar os dados financeiros.');
    }
  }
  const received = clientPaymentSummary(event).received;
  if (Math.round(totals.totalRevenue * 100) < Math.round(received * 100)) {
    throw error('O novo total seria inferior ao valor já recebido. Corrige primeiro os recebimentos ou regista o acerto no Financeiro.');
  }
  return totals;
}
