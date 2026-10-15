import { applyExternalCostChange, removeExternalCost } from '../../src/utils/externalCostEditing.js';
import { externalCostsTotals } from '../../src/utils/externalCosts.js';
import { assertEventRevenueEditable } from '../utils/eventInvoiceProtection.js';
import { checkedEventFinancialTotals } from './eventFinancialChange.js';
import { serviceListInclude } from '../utils/listPayloads.js';
import { synchronizeEventWorkflow } from './eventWorkflow.js';
import { clientPaymentRecordPatch } from './clientPaymentRecord.js';

function editError(message, statusCode = 409) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

async function changeEventExternalCost(prisma, eventId, { cost, costId = null, updatedAt, remove = false } = {}) {
  const id = Number(eventId);
  if (!Number.isInteger(id) || id <= 0) throw editError('Seleciona um evento válido.', 400);
  if (!remove && (!cost || typeof cost !== 'object' || Array.isArray(cost))) throw editError('Indica os dados do custo externo.', 422);
  try {
    return await prisma.$transaction(async (tx) => {
      const event = await tx.event.findUnique({ where: { id }, include: { ...serviceListInclude, invoices: true } });
      if (!event) return null;
      const change = remove ? removeExternalCost(event.externalCosts, costId) : applyExternalCostChange(event.externalCosts, cost, { costId });
      if (change.unchanged) return tx.event.findUnique({ where: { id }, include: serviceListInclude });
      await assertEventRevenueEditable(tx, id, event.invoices, event);
      if (!updatedAt || Number.isNaN(new Date(updatedAt).getTime()) || new Date(updatedAt).getTime() !== event.updatedAt.getTime()) {
        throw editError('O evento foi alterado. Atualiza a página antes de guardar o custo externo.');
      }
      const externalCosts = JSON.stringify(change.rows);
      const before = externalCostsTotals(event.externalCosts);
      const after = externalCostsTotals(externalCosts);
      const totals = checkedEventFinancialTotals(event, { ...event, externalCosts }, {
        requireCompletePricing: ['costAmount', 'chargeAmount', 'taxAmount'].some((field) => before[field] !== after[field]),
        preserveUnstructuredBudget: !remove,
        requireKnownPreviousTotal: remove && !change.rows.length,
      });
      const changed = await tx.event.updateMany({ where: { id, updatedAt: event.updatedAt },
        data: { externalCosts, ...totals, ...clientPaymentRecordPatch(event, totals) } });
      if (changed.count !== 1) throw editError('O evento foi alterado. Atualiza a página antes de guardar o custo externo.');
      if (!remove) await synchronizeEventWorkflow(tx, id);
      return tx.event.findUnique({ where: { id }, include: serviceListInclude });
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error.code === 'P2034') throw editError('O evento foi alterado. Atualiza a página antes de guardar o custo externo.');
    throw error;
  }
}

export const saveEventExternalCost = (prisma, eventId, options) => changeEventExternalCost(prisma, eventId, options);
export const deleteEventExternalCost = (prisma, eventId, options) => changeEventExternalCost(prisma, eventId, { ...options, remove: true });
