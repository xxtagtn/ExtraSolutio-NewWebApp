function safeJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function numericQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
}

/**
 * Continuous events can have a different team on each day. In that case the
 * saved rows and empty drafts are the source of the total number of slots.
 */
export function requiredStaffTotal(event = {}) {
  const requiredRolesTotal = safeJsonArray(event.requiredRoles)
    .reduce((sum, role) => sum + numericQuantity(role?.qty), 0);

  if (!event.isContinuous) return requiredRolesTotal;

  const assignmentRows = Array.isArray(event.assignments) ? event.assignments : [];
  const draftRows = safeJsonArray(event.assignmentDrafts);
  const plannedRows = [...assignmentRows, ...draftRows].filter((row) => Boolean(row?.role));

  return Math.max(requiredRolesTotal, plannedRows.length);
}
