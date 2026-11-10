import { billingDayKey } from './clientBillingCalendar.js';

export const DOCUMENT_SNOOZE_PREFIX = 'dashboard-document:';
export const DOCUMENT_SNOOZE_DAYS = [1, 7, 30];
export const DOCUMENT_SNOOZE_BATCH_LIMIT = 100;

export function documentSnoozeKey(collaboratorId, expiry) {
  const id = Number(collaboratorId);
  const day = billingDayKey(expiry);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 && day ? `${DOCUMENT_SNOOZE_PREFIX}${id}:${day}` : null;
}

export function parseDocumentSnoozeKey(key) {
  if (typeof key !== 'string' || !key.startsWith(DOCUMENT_SNOOZE_PREFIX)) return null;
  const [id, day] = key.slice(DOCUMENT_SNOOZE_PREFIX.length).split(':');
  return documentSnoozeKey(id, day) === key ? Number(id) : null;
}

export function splitDocumentSnoozes(actions, snoozes, now = Date.now()) {
  const untilByKey = new Map(snoozes.map(({ key, snoozedUntil }) => [key, snoozedUntil]));
  const pending = [], snoozed = [];
  let nextExpiry = Infinity;
  for (const action of actions) {
    const until = untilByKey.get(action.snoozeKey);
    const expiry = Date.parse(until);
    if (expiry > now) {
      snoozed.push({ ...action, snoozedUntil: until });
      nextExpiry = Math.min(nextExpiry, expiry);
    } else pending.push(action);
  }
  return { pending, snoozed, nextExpiry };
}
