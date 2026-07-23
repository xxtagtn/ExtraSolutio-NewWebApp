import {
  ASSIGNMENT_OVERLAP_MESSAGE,
  assignmentScheduleChanged,
  findOverlappingAssignment,
} from '../../src/utils/assignmentOverlap.js';

export function assignmentConflictNeedsCheck(data, existing = null) {
  return !existing || assignmentScheduleChanged({ ...existing, ...data }, existing);
}

export async function assertNoAssignmentConflict(prisma, data, existing = null) {
  const assignment = { ...(existing || {}), ...data };
  if (!assignment.eventId || !assignment.collaboratorId) return;

  const event = await prisma.event.findUnique({
    where: { id: Number(assignment.eventId) },
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
    },
  });
  if (!event) return;

  const assignments = await prisma.eventAssignment.findMany({
    where: {
      collaboratorId: Number(assignment.collaboratorId),
      status: { not: 'cancelled' },
      ...(assignment.id ? { id: { not: Number(assignment.id) } } : {}),
    },
    include: {
      event: {
        select: {
          id: true,
          date: true,
          startTime: true,
          endTime: true,
        },
      },
    },
  });

  const conflict = findOverlappingAssignment(
    { assignment, event },
    assignments.map((item) => ({ assignment: item, event: item.event })),
  );
  if (!conflict) return;

  const error = new Error(ASSIGNMENT_OVERLAP_MESSAGE);
  error.statusCode = 409;
  error.expose = true;
  throw error;
}
