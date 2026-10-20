import { buildEditableTeamRows, editableTeamRowsToAssignmentDrafts, editableTeamRowsToAssignmentPayloads, normalizeDailyRoleRequirements } from './serviceDetail.js';

function sourceKey(service) {
  return JSON.stringify({ id: service.id, date: service.date, endDate: service.endDate, isContinuous: service.isContinuous,
    startTime: service.startTime, endTime: service.endTime, requiredRoles: service.requiredRoles,
    assignments: service.assignments, assignmentDrafts: service.assignmentDrafts });
}

export function teamDraftKey(draft) {
  return JSON.stringify({ roles: draft.roles,
    assignments: editableTeamRowsToAssignmentPayloads(draft.rows, { id: draft.serviceId }),
    drafts: editableTeamRowsToAssignmentDrafts(draft.rows) });
}

export function createServiceTeamDraft(service) {
  const roles = normalizeDailyRoleRequirements(service);
  const draft = { serviceId: service.id, roles, rows: buildEditableTeamRows({ ...service, requiredRoles: roles }), sourceKey: sourceKey(service) };
  return { ...draft, savedKey: teamDraftKey(draft) };
}

export function refreshServiceTeamDraft(current, service) {
  if (!service) return current;
  if (String(current?.serviceId) !== String(service.id)) return createServiceTeamDraft(service);
  // A refreshed calculation, notification or another API write must not erase local edits.
  if (current.savedKey !== teamDraftKey(current) || current.sourceKey === sourceKey(service)) return current;
  return createServiceTeamDraft(service);
}
