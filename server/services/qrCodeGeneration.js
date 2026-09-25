import { generateQrToken, qrUsageWindow } from '../utils/qrCheckins.js';

export async function ensureAssignmentQr(db, assignmentOrId) {
  const id = typeof assignmentOrId === 'object' ? assignmentOrId?.id : assignmentOrId;
  if (!id) return null;
  const assignment = typeof assignmentOrId === 'object' && assignmentOrId?.event && assignmentOrId?.collaborator
    ? assignmentOrId
    : await db.eventAssignment.findUnique({ where: { id }, include: { event: true, collaborator: true, qrCheckCode: true } });
  if (!assignment?.collaboratorId || !assignment.eventId || String(assignment.status || '').toLowerCase() === 'cancelled') return null;
  const event = assignment.event || await db.event.findUnique({ where: { id: assignment.eventId } });
  if (!event) return null;
  const { expiresAt } = qrUsageWindow({ event, assignment });
  const eventDate = assignment.assignmentDate || event.date || null;
  const existing = assignment.qrCheckCode || await db.qrCheckCode.findUnique({ where: { assignmentId: id } });
  const data = { eventId: assignment.eventId, assignmentId: id, collaboratorId: assignment.collaboratorId, eventDate, expiresAt, revokedAt: null };
  if (!existing) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await db.qrCheckCode.create({ data: { ...data, token: generateQrToken() } });
      } catch (error) {
        if (error.code !== 'P2002') throw error;
        const concurrent = await db.qrCheckCode.findUnique({ where: { assignmentId: id } });
        if (concurrent) return concurrent;
      }
    }
    throw new Error('Não foi possível gerar um QR Code único.');
  }
  const changed = existing.eventId !== assignment.eventId || existing.assignmentId !== id
    || existing.collaboratorId !== assignment.collaboratorId || String(existing.eventDate || '') !== String(eventDate || '');
  if (!changed && !existing.revokedAt && existing.expiresAt?.getTime() === expiresAt.getTime()) return existing;
  return db.qrCheckCode.update({ where: { id: existing.id }, data: { ...data, ...(changed ? { token: generateQrToken() } : {}) } });
}
