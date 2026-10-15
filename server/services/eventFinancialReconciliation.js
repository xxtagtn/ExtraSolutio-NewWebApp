import { acceptedStaffHourCachePatch } from '../../src/utils/assignmentDerivedHours.js';
import { assignmentHasRecordedHours, calculateEventTotals } from '../utils/eventTotals.js';
import { eventRevenueIsLocked, issuedInvoiceForEvent } from '../utils/eventInvoiceProtection.js';
import { serviceListInclude } from '../utils/listPayloads.js';
import { synchronizeEventWorkflow } from './eventWorkflow.js';

export async function eventFinancialsForRead(prisma, row) {
  if (eventRevenueIsLocked(row) || !(row.assignments || []).some(assignmentHasRecordedHours)) return row;
  const totals = calculateEventTotals(row, row.assignments);
  const stale = Object.entries(totals).some(([field, value]) => Number(row[field] || 0) !== value)
    || row.assignments.some((assignment) => Object.keys(acceptedStaffHourCachePatch(assignment, row)).length);
  if (!stale) return row;
  const reconcile = () => prisma.$transaction(async (tx) => {
    const current = await tx.event.findUnique({ where: { id: row.id }, include: { ...serviceListInclude, invoices: true } });
    if (!current) return row;
    if (eventRevenueIsLocked(current) || await issuedInvoiceForEvent(tx, row.id, current.invoices)) {
      const visible = { ...current };
      delete visible.invoices;
      return visible;
    }
    await synchronizeEventWorkflow(tx, row.id, { recalculateTotals: true });
    return tx.event.findUnique({ where: { id: row.id }, include: serviceListInclude });
  }, { isolationLevel: 'Serializable' });
  try {
    return await reconcile();
  } catch (error) {
    if (error.code !== 'P2034') throw error;
    return reconcile();
  }
}
