import { hoursValidationState } from './hourValidationStatus.js';

export function buildAcceptedValidation(row, draft = {}) {
  const merged = { ...(row?.assignment || {}), ...(draft || {}) };
  const staffComplete = Boolean(merged.checkIn && merged.checkOut);
  const clientComplete = Boolean(merged.clientCheckIn && merged.clientCheckOut);
  const validatedCheckIn = clientComplete ? merged.clientCheckIn : '';
  const validatedCheckOut = clientComplete ? merged.clientCheckOut : '';

  return {
    row,
    merged: {
      ...merged,
      validatedCheckIn,
      validatedCheckOut,
    },
    canValidate: staffComplete && clientComplete,
  };
}

export function buildBulkValidationCandidates(rows = [], drafts = {}) {
  return rows.reduce((result, row) => {
    if (hoursValidationState(row?.assignment).isValidated) return result;

    const candidate = buildAcceptedValidation(row, drafts[row?.id] || drafts[row?.assignment?.id]);
    if (candidate.canValidate) {
      result.ready.push(candidate);
    } else {
      result.missing.push(candidate);
    }
    return result;
  }, { ready: [], missing: [] });
}
