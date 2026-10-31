import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceTeamCoverage } from './serviceTeamCoverage.js';
import { serviceChecklist, serviceDetailMetrics } from './serviceDetail.js';
import { nextAutomaticServiceStatus, nextTimeValidationServiceStatus, isArchivedService } from './serviceStatus.js';
import { buildDashboardCommandCenter } from './dashboardCommandCenter.js';
import { buildPendingActions } from './pendingActions.js';
import { isFinanceReadyEvent } from './financeReadiness.js';
import { calculateEventTotals } from '../../server/utils/eventTotals.js';

const today = new Date('2026-10-31T12:00:00');
function continuousEvent() {
  return { id: 41, name: 'JOGO - SLB - ALVERCA', status: 'drafting', date: '2026-11-01', endDate: '2026-11-02', isContinuous: true,
    requiredRoles: [
      { role: 'Emp.Mesa', day: '2026-11-01', qty: 1 },
      { role: 'Emp.Mesa', day: '2026-11-02', qty: 32 },
      { role: 'Chefe de Sala', day: '2026-11-02', qty: 1 },
    ], assignments: [
      { id: 1, collaboratorId: 1, role: 'Emp.Mesa', assignmentDate: '2026-11-01', status: 'confirmed' },
      ...Array.from({ length: 32 }, (_, index) => ({ id: index + 2, collaboratorId: index + 2, role: 'Emp.Mesa', assignmentDate: '2026-11-02',
        status: index === 0 ? 'missed_justified' : index === 1 ? 'missed_unjustified' : 'confirmed', clientSynced: index > 1 })),
      { id: 34, collaboratorId: 34, role: 'Chefe de Sala', assignmentDate: '2026-11-02', status: 'confirmed' },
    ] };
}
test('both kinds of absence fill roster slots consistently across the two-day service', () => {
  const event = continuousEvent(), before = structuredClone(event);
  assert.deepEqual(serviceTeamCoverage(event), { required: 34, confirmed: 32, missed: 2, covered: 34, pending: 0, assigned: 34, missing: 0, complete: true });
  const overview = buildDashboardCommandCenter({ services: [event] }, { today });
  assert.equal(overview.next48Items[0].badge, 'Equipa completa');
  assert.equal(overview.next48Items[0].actionLabel, 'Abrir');
  assert.equal(buildPendingActions({ services: [event] }, { today }).some((action) => action.id === 'service-team-41'), false);
  const metrics = serviceDetailMetrics(event);
  assert.equal(metrics.teamFilled, 34); assert.equal(metrics.teamComplete, true);
  assert.equal(metrics.confirmed, 32, 'Absences are not relabeled as confirmed attendance');
  assert.equal(metrics.assigned, 32, 'Existing hour denominators exclude absences');
  assert.equal(metrics.staffHoursComplete, false); assert.equal(metrics.validationComplete, false);
  assert.equal(serviceChecklist(event)[0].detail, '34/34 lugares preenchidos');
  assert.equal(nextAutomaticServiceStatus(event, today), 'team_complete');
  assert.equal(isFinanceReadyEvent(event), false);
  assert.equal(isArchivedService(event), false);
  assert.deepEqual(event, before, 'No persisted assignment state is rewritten');
});
test('planned hours and client synchronization are independent of roster coverage', () => {
  const event = continuousEvent();
  const changed = { ...event, assignments: event.assignments.map((row) => ({ ...row, clientSynced: true, plannedCheckIn: '09:00', plannedCheckOut: '18:00' })) };
  assert.deepEqual(serviceTeamCoverage(changed), serviceTeamCoverage(event));
});
test('cancelled, unnamed and pending rows cannot complete the roster', () => {
  const event = { id: 1, date: '2026-11-01', requiredRoles: [{ role: 'Emp.Mesa', qty: 4 }], assignments: [
    { collaboratorId: 1, status: 'missed_justified' }, { collaboratorId: 2, status: 'cancelled' },
    { status: 'confirmed' }, { status: 'missed_unjustified' }, { collaboratorId: 5, status: 'pending_confirmation' },
  ] };
  const team = serviceTeamCoverage(event);
  assert.equal(team.covered, 1); assert.equal(team.pending, 1); assert.equal(team.missing, 3); assert.equal(team.complete, false);
  assert.equal(buildDashboardCommandCenter({ services: [event] }, { today }).next48Items[0].badge, '1 por confirmar');
  assert.ok(buildPendingActions({ services: [event] }, { today }).some((action) => action.id === 'service-team-1'));
});
test('cancelled event days do not contribute missing or covered slots', () => {
  const event = { ...continuousEvent(), cancelledDays: '["2026-11-02"]' };
  const team = serviceTeamCoverage(event);
  assert.equal(team.required, 1); assert.equal(team.covered, 1); assert.equal(team.missed, 0); assert.equal(team.complete, true);
});
test('single-day missed assignments complete the roster without invented hours or finalization', () => {
  for (const status of ['missed_justified', 'missed_unjustified']) {
    const event = { date: '2026-11-01', status: 'drafting', requiredRoles: [{ role: 'Bar', qty: 1 }], assignments: [{ collaboratorId: 1, role: 'Bar', status }] };
    assert.equal(serviceTeamCoverage(event).complete, true);
    assert.equal(nextAutomaticServiceStatus(event, today), 'team_complete');
    assert.equal(nextTimeValidationServiceStatus({ ...event, status: 'to_validate_staff' }), 'to_validate_staff');
    assert.equal(isFinanceReadyEvent(event), false);
  }
});
test('financial costs, revenue, VAT and hours still exclude missed assignments', () => {
  const confirmed = { collaboratorId: 1, role: 'Emp.Mesa', status: 'confirmed', hourlyRate: 8, checkIn: '10:00', checkOut: '14:00',
    clientCheckIn: '10:00', clientCheckOut: '14:00', validationStatus: 'validated' };
  const event = { date: '2026-10-30', status: 'to_validate_staff', staffVatRateSnapshot: 23,
    requiredRoles: [{ role: 'Emp.Mesa', qty: 3, agreedRate: 12 }], assignments: [confirmed,
      { ...confirmed, collaboratorId: 2, status: 'missed_justified', hourlyRate: 100 },
      { ...confirmed, collaboratorId: 3, status: 'missed_unjustified', hourlyRate: 100 },
    ] };
  assert.equal(serviceTeamCoverage(event).complete, true);
  assert.deepEqual(calculateEventTotals(event), calculateEventTotals(event, [confirmed]));
});
