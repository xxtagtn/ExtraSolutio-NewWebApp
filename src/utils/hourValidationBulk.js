import { hoursValidationState } from './hourValidationStatus.js';

export function buildAcceptedValidation(row, draft = {}) {
  const merged = { ...(row?.assignment || {}), ...(draft || {}) };
  const validatedCheckIn = merged.validatedCheckIn || merged.clientCheckIn || merged.checkIn || row?.event?.startTime || '';
  const validatedCheckOut = merged.validatedCheckOut || merged.clientCheckOut || merged.checkOut || row?.event?.endTime || '';

  return {
    row,
    merged: {
      ...merged,
      validatedCheckIn,
      validatedCheckOut,
    },
    canValidate: Boolean(validatedCheckIn && validatedCheckOut),
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
