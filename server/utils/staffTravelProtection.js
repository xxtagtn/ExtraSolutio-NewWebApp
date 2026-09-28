import {
  automaticStaffTravelSnapshotEntry,
  normalizeStaffTravel,
  staffTravelCompensation,
  travelConfiguration,
} from '../../src/utils/staffTravel.js';

function reject(message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.expose = true;
  throw error;
}

export function assertPaidStaffTravelUnchanged(before, after, previousEvent, nextEvent = previousEvent) {
  if (before?.paymentStatus !== 'paid') return;
  const previous = staffTravelCompensation(before, previousEvent);
  const next = staffTravelCompensation(after || {}, nextEvent);
  if (previous.amount !== next.amount || previous.payableHours !== next.payableHours) {
    reject('A deslocação deste colaborador já foi paga. Regista um ajuste manual antes de alterar a compensação.');
  }
}

export function assertStaffTravelConfiguration(previousEvent, nextEvent, assignments) {
  for (const assignment of assignments) {
    assertPaidStaffTravelUnchanged(assignment, assignment, previousEvent || {}, nextEvent);
  }
}

export async function persistPaidStaffTravelSnapshot(prisma, assignment) {
  if (assignment?.paymentStatus !== 'paid' || !assignment.eventId || !assignment.id) return false;
  const event = await prisma.event.findUnique({
    where: { id: Number(assignment.eventId) },
    include: { assignments: true },
  });
  if (!event) return false;
  const existing = normalizeStaffTravel(event.travelCars);
  if (existing.some((item) => item.assignmentId === Number(assignment.id))) return false;
  const snapshot = automaticStaffTravelSnapshotEntry(assignment, event, event.assignments);
  if (!snapshot) return false;
  await prisma.event.update({
    where: { id: event.id },
    data: { travelCars: JSON.stringify(travelConfiguration(event.travelCars, [...existing, snapshot])) },
  });
  return true;
}
