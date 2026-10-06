import { eventStartInstant } from './eventTime.js';
import { qrUsageWindow } from './qrCheckins.js';

export const QR_CONSULTATION_DAYS = 31;

export function qrConsultationAccess({ event = {}, assignment = {}, now = new Date(), timeZone = process.env.APP_TIMEZONE || 'Europe/Lisbon' } = {}) {
  const { startsAt, expiresAt } = qrUsageWindow({ event, assignment, timeZone });
  // Add calendar days in the application timezone, not 31 fixed 24-hour blocks.
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(expiresAt.getTime() + 1));
  const day = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const untilDay = new Date(Date.UTC(Number(day.year), Number(day.month) - 1, Number(day.day) + QR_CONSULTATION_DAYS));
  const consultationExpiresAt = new Date(eventStartInstant(untilDay, '00:00', timeZone).getTime() - 1);
  const current = new Date(now);
  return {
    timeZone,
    punchStartsAt: startsAt,
    punchExpiresAt: expiresAt,
    consultationExpiresAt,
    readOnly: current > expiresAt,
  };
}

export function publicQrValidation(assignment = {}) {
  const validated = ['validated', 'approved'].includes(String(assignment.validationStatus || '').toLowerCase());
  const hasValidatedPair = assignment.validatedCheckIn && assignment.validatedCheckOut;
  return {
    validationStatus: validated ? 'validated' : 'pending',
    validatedCheckIn: validated ? (hasValidatedPair ? assignment.validatedCheckIn : assignment.clientCheckIn) || '' : '',
    validatedCheckOut: validated ? (hasValidatedPair ? assignment.validatedCheckOut : assignment.clientCheckOut) || '' : '',
  };
}
