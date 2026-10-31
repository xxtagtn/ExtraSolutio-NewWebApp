import { activeEventAssignments } from './eventCancelledDays.js';
import { requiredStaffTotal } from './serviceRequirements.js';

const COVERED_STATUSES = new Set(['confirmed', 'missed_justified', 'missed_unjustified']);
const normalize = (value) => String(value || '').trim().toLowerCase();

// Roster coverage is distinct from attendance and financial eligibility.
export function serviceTeamCoverage(event = {}) {
  const assignments = activeEventAssignments(event)
    .filter((row) => (row.collaboratorId || row.collaborator?.id) && normalize(row.status) !== 'cancelled');
  const required = requiredStaffTotal(event);
  const confirmed = assignments.filter((row) => normalize(row.status) === 'confirmed').length;
  const missed = assignments.filter((row) => ['missed_justified', 'missed_unjustified'].includes(normalize(row.status))).length;
  const covered = assignments.filter((row) => COVERED_STATUSES.has(normalize(row.status))).length;
  const pending = assignments.filter((row) => normalize(row.status) === 'pending_confirmation').length;
  return { required, confirmed, missed, covered, pending, assigned: assignments.length,
    missing: Math.max(0, required - covered), complete: required > 0 && covered >= required };
}
