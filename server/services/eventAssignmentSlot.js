import { normalizeDailyRoleRequirements } from '../../src/utils/serviceDetail.js';
import { releasedTeamSlot } from '../../src/utils/releasedTeamSlot.js';
import { eventDayKey, isAssignmentOnCancelledDay } from '../../src/utils/eventCancelledDays.js';
import { assertEventRevenueEditable } from '../utils/eventInvoiceProtection.js';
import { assertStaffTravelConfiguration } from '../utils/staffTravelProtection.js';
import { serviceListInclude } from '../utils/listPayloads.js';
import { deriveEventWorkflowStatus } from './eventWorkflow.js';
import { calculateEventTotals } from '../utils/eventTotals.js';
import { clientPaymentRecordPatch } from './clientPaymentRecord.js';

function reject(message, statusCode = 409) {
  throw Object.assign(new Error(message), { statusCode, expose: true });
}
const roleKey = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const stamp = (value) => value ? new Date(value).getTime() : 0;

export async function setEventAssignmentSlotReleased(db, eventId, assignmentId, {
  released, eventUpdatedAt, assignmentUpdatedAt, now = new Date(),
} = {}) {
  if (typeof released !== 'boolean') reject('Indica se pretendes retirar ou repor o lugar.', 422);
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const event = await tx.event.findUnique({ where: { id: Number(eventId) }, include: serviceListInclude });
        if (!event) reject('Evento/Serviço não encontrado.', 404);
        const assignment = event.assignments.find((row) => row.id === Number(assignmentId));
        if (!assignment) reject('Esta alocação não pertence ao evento.', 404);
        const previous = releasedTeamSlot(assignment);
        if (Boolean(previous) === released) return event;
        if ((eventUpdatedAt && stamp(event.updatedAt) !== stamp(eventUpdatedAt))
          || (assignmentUpdatedAt && stamp(assignment.updatedAt) !== stamp(assignmentUpdatedAt))) {
          reject('A equipa foi alterada entretanto. Atualiza o evento e tenta novamente.');
        }
        if (assignment.status !== 'cancelled') reject('Marca o colaborador como Cancelado e guarda a equipa antes de retirar o lugar.');
        if (isAssignmentOnCancelledDay(assignment, event)) reject('Reativa o dia antes de alterar a necessidade de equipa.');
        await assertEventRevenueEditable(tx, event.id, event.invoices, event);
        const requirements = normalizeDailyRoleRequirements({ ...event,
          date: eventDayKey(event.date), endDate: eventDayKey(event.endDate),
          assignments: event.assignments.map((row) => ({ ...row, assignmentDate: eventDayKey(row.assignmentDate) })),
        });
        const day = event.isContinuous ? eventDayKey(assignment.assignmentDate || event.date) : '';
        const index = requirements.findIndex((item) => roleKey(item.role) === roleKey(assignment.role)
          && (!event.isContinuous || item.day === day));
        if (released && (index < 0 || requirements[index].qty < 1)) reject('Define primeiro a necessidade desta função no respetivo dia.');
        const record = released ? { version: 1, releasedAt: now.toISOString(), requirement: { ...requirements[index], day } } : null;
        const nextRequirements = requirements.map((item, i) => i === index
          ? { ...item, qty: item.qty + (released ? -1 : 1) } : item).filter((item) => item.qty > 0);
        if (!released && index < 0) nextRequirements.push({ ...previous.requirement, day, qty: 1 });
        const nextEvent = { ...event, requiredRoles: JSON.stringify(nextRequirements) };
        assertStaffTravelConfiguration(event, nextEvent, event.assignments);
        const changed = await tx.event.updateMany({ where: { id: event.id, updatedAt: event.updatedAt },
          data: { requiredRoles: nextEvent.requiredRoles } });
        if (changed.count !== 1) reject('A equipa foi alterada entretanto. Atualiza o evento e tenta novamente.');
        const slotRelease = record ? JSON.stringify(record) : null;
        await tx.eventAssignment.update({ where: { id: assignment.id }, data: { slotRelease } });
        const nextAssignments = event.assignments.map((row) => row.id === assignment.id ? { ...row, slotRelease } : row);
        const recalculated = { ...nextEvent, assignments: nextAssignments };
        const totals = calculateEventTotals(recalculated, nextAssignments);
        await tx.event.update({ where: { id: event.id }, data: {
          ...totals, status: deriveEventWorkflowStatus(recalculated, now), ...clientPaymentRecordPatch(event, totals),
        } });
        return tx.event.findUnique({ where: { id: event.id }, include: serviceListInclude });
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (attempt < 2 && ['P2034', 'P1008'].includes(error.code)) continue;
      throw error;
    }
  }
}

export function assertReleasedSlotUpdate(input, existing) {
  if (Object.hasOwn(input, 'slotRelease')) reject('Utiliza a ação Retirar/Repor lugar para alterar a necessidade de equipa.', 422);
  if (!existing?.slotRelease) return;
  for (const field of ['eventId', 'collaboratorId', 'assignmentDate', 'role', 'status']) {
    const before = field === 'assignmentDate' ? eventDayKey(existing[field]) : String(existing[field] ?? '');
    const after = field === 'assignmentDate' ? eventDayKey(input[field]) : String(input[field] ?? '');
    if (Object.hasOwn(input, field) && before !== after) reject('Repõe primeiro este lugar antes de alterar o colaborador, a função, a data ou o estado.');
  }
}
