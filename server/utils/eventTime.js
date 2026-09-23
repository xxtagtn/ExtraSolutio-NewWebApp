import { eventDayKey } from '../../src/utils/eventCancelledDays.js';

export const reminderDayKey = eventDayKey;

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

export function applicationWallClock(value = new Date(), timeZone = process.env.APP_TIMEZONE || 'Europe/Lisbon') {
  const parts = zonedParts(value, timeZone);
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

export function eventStartInstant(dayValue, timeValue, timeZone = 'Europe/Lisbon') {
  const day = eventDayKey(dayValue).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const time = String(timeValue || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!day || !time || Number(time[1]) > 23 || Number(time[2]) > 59) return null;
  const targetUtc = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), Number(time[1]), Number(time[2]));
  let instant = new Date(targetUtc);
  // Resolve the timezone offset again after shifting across a daylight-saving boundary.
  for (let pass = 0; pass < 2; pass += 1) {
    const represented = zonedParts(instant, timeZone);
    const representedUtc = Date.UTC(represented.year, represented.month - 1, represented.day,
      represented.hour, represented.minute, represented.second);
    instant = new Date(instant.getTime() + targetUtc - representedUtc);
  }
  return Number.isNaN(instant.getTime()) ? null : instant;
}
