import test from 'node:test';
import assert from 'node:assert/strict';
import { communicationQrWindow, isCommunicationQrRelevant, communicationQrCandidateWhere } from './communicationQrWindow.js';
import { eventStartInstant } from './eventTime.js';

const event = { date: '2026-09-24', startTime: '18:00', endTime: '23:00' };
const zone = 'Europe/Lisbon';
const instant = (day, time) => eventStartInstant(day, time, zone);
const visible = (day, time, assignment = {}, service = event) => isCommunicationQrRelevant(assignment, service, { now: instant(day, time), timeZone: zone });

test('individual service appears 23 hours before its start', () => assert.equal(visible('2026-09-23', '19:00'), true));
test('exactly 24 hours before start is included, but an earlier instant is not', () => {
  assert.equal(visible('2026-09-23', '18:00'), true);
  assert.equal(visible('2026-09-23', '17:59'), false);
});
test('ongoing service stays visible', () => assert.equal(visible('2026-09-24', '20:00'), true));
test('service ended 2 hours ago stays visible', () => assert.equal(visible('2026-09-25', '01:00'), true));
test('service ended 23 hours ago stays visible', () => assert.equal(visible('2026-09-25', '22:00'), true));
test('service disappears exactly 24 hours after end, and stays hidden afterwards', () => {
  assert.equal(visible('2026-09-25', '23:00'), false);
  assert.equal(visible('2026-09-25', '23:01'), false);
});
test('different people and shifts of the same event use their individual schedules', () => {
  assert.equal(visible('2026-09-23', '18:00', { plannedCheckIn: '17:00', plannedCheckOut: '22:00' }), true);
  assert.equal(visible('2026-09-23', '18:00', { plannedCheckIn: '19:00', plannedCheckOut: '23:00' }), false);
  assert.equal(visible('2026-09-25', '22:30', { plannedCheckIn: '17:00', plannedCheckOut: '22:00' }), false);
  assert.equal(visible('2026-09-25', '22:30', { plannedCheckIn: '19:00', plannedCheckOut: '23:00' }), true);
});
test('continuous events use the assigned day rather than the event start/end dates', () => {
  const continuous = { ...event, date: '2026-09-01', endDate: '2026-09-30', isContinuous: true };
  assert.equal(visible('2026-09-23', '18:00', { assignmentDate: '2026-09-24' }, continuous), true);
  assert.equal(visible('2026-09-23', '18:00', { assignmentDate: '2026-09-25' }, continuous), false);
});
test('actual punches override planned times independently; missing punches fall back to planned/event times', () => {
  const assignment = { plannedCheckIn: '18:00', plannedCheckOut: '23:00', checkIn: '17:00', checkOut: '22:00' };
  assert.equal(visible('2026-09-23', '17:00', assignment), true);
  assert.equal(visible('2026-09-25', '22:00', assignment), false);
  assert.equal(visible('2026-09-25', '22:00', { ...assignment, checkOut: null }), true);
  assert.equal(visible('2026-09-23', '17:00', { ...assignment, checkIn: '' }), false);
  assert.equal(visible('2026-09-25', '23:15', { checkOut: '23:30' }), true);
});
test('overnight exit is on the following calendar day, including actual late entry', () => {
  const assignment = { plannedCheckIn: '22:00', plannedCheckOut: '02:00' };
  assert.equal(visible('2026-09-25', '01:00', assignment), true);
  assert.equal(visible('2026-09-26', '01:59', assignment), true);
  assert.equal(visible('2026-09-26', '02:00', assignment), false);
  const late = communicationQrWindow({ ...assignment, checkIn: '00:15', checkOut: '02:30' }, event, zone);
  assert.equal(late.startsAt.toISOString(), '2026-09-24T23:15:00.000Z');
  assert.equal(late.endsAt.toISOString(), '2026-09-25T01:30:00.000Z');
});
test('midnight exits and identical entry/exit are not extended by an extra day', () => {
  const overnight = communicationQrWindow({ plannedCheckOut: '00:00' }, event, zone);
  assert.equal(overnight.endsAt.toISOString(), '2026-09-24T23:00:00.000Z');
  const zero = communicationQrWindow({ checkIn: '18:00', checkOut: '18:00' }, event, zone);
  assert.equal(zero.endsAt.getTime(), zero.startsAt.getTime());
});
test('24-hour margins are elapsed hours across daylight saving, not calendar-day arithmetic', () => {
  const window = communicationQrWindow({}, { date: '2026-03-28', startTime: '22:00', endTime: '04:00' }, zone);
  assert.equal(window.endsAt.toISOString(), '2026-03-29T03:00:00.000Z');
  assert.equal(window.visibleUntil.getTime() - window.endsAt.getTime(), 86400000);
  assert.equal(window.startsAt.getTime() - window.visibleFrom.getTime(), 86400000);
});
test('missing/invalid schedules are not guessed from the event date alone', () => {
  assert.equal(communicationQrWindow({}, { date: '2026-09-24' }, zone), null);
  assert.equal(communicationQrWindow({ plannedCheckIn: '99:00' }, event, zone), null);
  assert.equal(communicationQrWindow({ plannedCheckOut: '23:90' }, event, zone), null);
});
test('SQL candidates are bounded by assignment dates with fallback only for undated assignments', () => {
  const where = communicationQrCandidateWhere({ now: instant('2026-09-24', '00:00'), timeZone: zone });
  assert.equal(where.OR[0].assignmentDate.gte.toISOString(), '2026-09-21T00:00:00.000Z');
  assert.equal(where.OR[1].assignmentDate, null);
  assert.deepEqual(where.OR[0].assignmentDate, where.OR[1].event.date);
});
