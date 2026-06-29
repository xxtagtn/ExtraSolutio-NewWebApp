function parseDraftSource(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function bool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function normalizeAssignmentDrafts(value) {
  return parseDraftSource(value)
    .map((item, index) => ({
      draftId: text(item?.draftId || item?.id || `draft-${index + 1}`),
      role: text(item?.role),
      collaboratorId: text(item?.collaboratorId),
      assignmentDate: text(item?.assignmentDate),
      plannedCheckIn: text(item?.plannedCheckIn),
      plannedCheckOut: text(item?.plannedCheckOut),
      hourlyRate: text(item?.hourlyRate),
      status: text(item?.status) || 'pending_confirmation',
      clientSynced: bool(item?.clientSynced),
      isDriver: bool(item?.isDriver),
      validationNotes: text(item?.validationNotes),
    }))
    .filter((item) => item.role && !item.collaboratorId)
    .map(({ collaboratorId: _collaboratorId, ...item }) => item);
}

export function assignmentDraftsFromRows(rows) {
  const draftRows = (rows || []).filter((row) => row?.role && !row?.collaboratorId);
  return normalizeAssignmentDrafts(draftRows);
}
