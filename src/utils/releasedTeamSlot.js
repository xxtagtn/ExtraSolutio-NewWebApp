export function releasedTeamSlot(assignment = {}) {
  if (String(assignment.status || '').toLowerCase() !== 'cancelled' || !assignment.slotRelease) return null;
  try {
    const record = typeof assignment.slotRelease === 'string' ? JSON.parse(assignment.slotRelease) : assignment.slotRelease;
    return record?.version === 1 && Number.isFinite(Date.parse(record.releasedAt)) && record.requirement?.role
      ? record : null;
  } catch {
    return null;
  }
}
