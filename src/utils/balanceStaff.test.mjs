import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStaffBalance, staffAnalysisYears } from './balanceStaff.js';
import { staffAssignmentPaymentTotal, staffAssignmentCostTotal, staffAssignmentOutstandingPay } from './staffPayment.js';
import { normalizeStaffAdvances, staffCarAdvancesTotal, staffPaymentRemaining } from './staffAdvances.js';

const row = (id, collaboratorId, date, status = 'unpaid', extra = {}) => ({
  id, collaboratorId, collaborator: { id: collaboratorId, name: collaboratorId === 1 ? 'Miriam Peçanha' : 'Ana Rosa', nif: `30000000${collaboratorId}` },
  assignmentDate: date, status: 'confirmed', paymentStatus: status, hourlyRate: 10,
  validatedCheckIn: '08:00', validatedCheckOut: '13:00', ...extra,
});
const event = (assignments, extra = {}) => ({ id: 1, status: 'finalized', date: '2026-09-01', clientId: 1, assignments, ...extra });
const period = { year: '2026', month: '9', clientId: 'all', status: 'all' };

test('empty data returns zero totals and all twelve months', () => {
  const result = buildStaffBalance({ period });
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.totals, { services: 0, hours: 0, cost: 0, paid: 0, unpaid: 0 });
  assert.equal(result.monthlySeries.length, 12);
  assert.deepEqual(result.annualTotals, result.totals);
});

test('groups multiple shifts per collaborator and keeps each service exactly once', () => {
  const result = buildStaffBalance({ services: [event([row(1, 1, '2026-09-01'), row(2, 1, '2026-09-01', 'paid'), row(3, 2, '2026-09-01')])], period });
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.totals, { services: 3, hours: 15, cost: 150, paid: 50, unpaid: 100 });
  assert.equal(result.rows[0].services, 2);
});

test('service date selects the month, ignoring payment date, deferred month and general event date', () => {
  const services = [event([
    row(1, 1, '2026-10-01', 'paid', { paymentDate: '2027-01-08', paymentDeferredMonth: '2027-01' }),
    row(2, 1, '2026-09-30'), row(3, 1, '2025-12-31'),
  ])];
  const result = buildStaffBalance({ services, period });
  assert.equal(result.totals.cost, 50);
  assert.equal(result.annualTotals.cost, 100);
  assert.equal(result.monthlySeries[9].paid, 50);
  assert.equal(result.monthlySeries[8].unpaid, 50);
  assert.equal(buildStaffBalance({ services, period: { ...period, month: '' } }).totals.cost, 100);
});

test('includes only existing finance-ready and billable collaborator records', () => {
  const services = [event([
    row(1, 1, '2026-09-01'),
    ...['cancelled', 'missed_justified', 'missed_unjustified'].map((status, index) => row(index + 2, 1, '2026-09-01', 'unpaid', { status })),
    row(5, null, '2026-09-01'), row(6, 1, 'bad-date'),
  ]), event([row(7, 1, '2026-09-01')], { status: 'to_validate_client' }), event([row(8, 1, '2026-09-01')], { status: 'cancelled' })];
  assert.equal(buildStaffBalance({ services, period }).totals.services, 1);
});

test('preserves legacy event validation marker and complete validated client hours', () => {
  const services = [event([row(1, 1, '2026-09-01', 'unpaid', { validationStatus: 'validated' })], { status: 'to_validate_client', notes: '[EVENT_VALIDATED_HOURS]' })];
  assert.equal(buildStaffBalance({ services, period }).totals.cost, 50);
});

test('only Paid counts as paid; Penhorado, Ganho, Validado ES and RV remain outstanding', () => {
  const states = ['unpaid', 'validated_es', 'awaiting_data', 'penhorado', 'ganho', 'paid'];
  const services = [event(states.map((state, i) => row(i, 1, '2026-09-01', state)))];
  assert.equal(buildStaffBalance({ services, period }).totals.paid, 50);
  assert.equal(buildStaffBalance({ services, period }).totals.unpaid, 250);
  services[0].assignments[0].paymentStatus = 'paid';
  const after = buildStaffBalance({ services, period });
  assert.equal(after.totals.paid, 100);
  assert.equal(after.totals.unpaid, 200);
  assert.equal(after.totals.cost, 300);
});

test('existing payment formulas remain identical for VAT, advances, cars, adjustments, travel and legacy totals', () => {
  for (const includeVat of [true, false]) {
    for (const paymentStatus of ['paid', 'unpaid']) {
      for (const advancePayments of [null, '[{"amount":20},{"amount":40,"car":true}]', [{ amount: 1000 }, { amount: 40, car: true }]]) {
        const assignment = row(1, 1, '2026-09-01', paymentStatus, {
          collaborator: { includeVat }, paymentAdjustment: '-2,50', advancePayments,
          event: { assignments: [], travelCars: [{ id: 'car-qa', durationHours: 2 }] },
        });
        const gross = staffAssignmentPaymentTotal(assignment);
        const advances = normalizeStaffAdvances(advancePayments);
        assert.equal(staffAssignmentCostTotal(assignment), Number((gross + staffCarAdvancesTotal(advances)).toFixed(2)));
        assert.equal(staffAssignmentOutstandingPay(assignment), staffPaymentRemaining(gross, advances));
      }
    }
  }
  const legacy = row(1, 1, '2026-09-01', 'paid', { validatedCheckIn: null, validatedCheckOut: null, totalPay: 42.75 });
  assert.equal(staffAssignmentCostTotal(legacy), 42.75);
});

test('client, status, collaborator, year, month and accent-independent name/NIF filters stay consistent', () => {
  const services = [event([row(1, 1, '2026-09-01'), row(2, 2, '2026-10-01')]), event([row(3, 1, '2026-09-01')], { clientId: 2, status: 'completed' })];
  assert.equal(buildStaffBalance({ services, period: { ...period, clientId: '1', status: 'finalized' } }).totals.cost, 50);
  assert.equal(buildStaffBalance({ services, period, collaboratorId: '2' }).totals.cost, 0);
  assert.equal(buildStaffBalance({ services, period: { ...period, month: '' }, collaboratorId: '2' }).annualTotals.cost, 50);
  assert.equal(buildStaffBalance({ services, period, search: 'pecanha' }).totals.cost, 100);
  assert.equal(buildStaffBalance({ services, period, search: '300000002' }).annualTotals.cost, 50);
  assert.equal(buildStaffBalance({ services, period: { ...period, status: 'confirmed' } }).totals.cost, 0);
  assert.equal(buildStaffBalance({ services, period: { ...period, year: '2027' } }).totals.cost, 0);
});

test('date fallbacks and assignment years include multiday events crossing the year', () => {
  const services = [event([row(1, 1, null), row(2, 1, null, 'unpaid', { eventDate: '2027-01-01' }), row(3, 1, '2027-02-01')])];
  assert.deepEqual(staffAnalysisYears(services).sort(), ['2026', '2027']);
  assert.equal(buildStaffBalance({ services, period: { year: '2027' } }).totals.services, 2);
});

test('annual monthly totals equal the annual summary with exact currency aggregation', () => {
  const services = [event(Array.from({ length: 1001 }, (_, i) => row(i, i % 2 + 1, `2026-${String(i % 12 + 1).padStart(2, '0')}-01`, 'unpaid', { hourlyRate: 0.02 })))];
  const result = buildStaffBalance({ services, period: { year: '2026' } });
  assert.equal(result.annualTotals.cost, 100.1);
  assert.equal(result.rows.reduce((sum, item) => sum + Math.round(item.cost * 100), 0), 10010);
  assert.equal(result.monthlySeries.reduce((sum, item) => sum + Math.round(item.cost * 100), 0), 10010);
  assert.equal(result.annualTotals.services, 1001);
});

test('analysis does not mutate events, assignments or persisted payment data', () => {
  const services = [event([row(1, 1, '2026-09-01', 'unpaid', { advancePayments: '[{"amount":20}]' })])];
  const before = structuredClone(services);
  buildStaffBalance({ services, period });
  assert.deepEqual(services, before);
});

test('daily and weekly evolution reuse exact selected collaborator payment values', () => {
  const services = [event([
    row(1, 1, '2026-09-01'), row(2, 1, '2026-09-02', 'paid'), row(3, 1, '2026-09-07', 'ganho'),
    row(4, 2, '2026-09-01'), row(5, 1, '2026-10-01'),
  ])];
  const result = buildStaffBalance({ services, period, collaboratorId: '1' });
  assert.equal(result.evolution.dailySeries.length, 30);
  assert.deepEqual(result.evolution.monthTotals, result.totals);
  assert.deepEqual(result.evolution.weekTotals, { services: 2, hours: 10, cost: 100, paid: 50, unpaid: 50 });
  assert.equal(result.evolution.weeklySeries.length, 6);
  assert.equal(result.evolution.weeks[0].label, '01/09 – 06/09');
  const next = buildStaffBalance({ services, period, collaboratorId: '1', evolutionWeek: 7 });
  assert.equal(next.evolution.weekTotals.cost, 50);
  assert.equal(next.evolution.weekTotals.paid, 0);
  assert.equal(next.evolution.weekTotals.unpaid, 50);
  assert.deepEqual(next.totals, result.totals);
  assert.deepEqual(next.annualTotals, result.annualTotals);
});

test('week boundaries cover selected month once, including leap years and empty days', () => {
  for (const [year, month, days] of [['2024', '2', 29], ['2026', '2', 28], ['2026', '3', 31], ['2026', '12', 31]]) {
    const result = buildStaffBalance({ period: { ...period, year, month } });
    assert.equal(result.evolution.dailySeries.length, days);
    assert.equal(result.evolution.weeks.flatMap(({ start, end }) => Array.from({ length: end - start + 1 }, (_, index) => start + index)).join(','), Array.from({ length: days }, (_, index) => index + 1).join(','));
    assert.deepEqual(result.evolution.weekTotals, result.totals);
    assert.ok(result.evolution.weeks.every((week) => week.start >= 1 && week.end <= days));
  }
});

test('all-month filter supports evolution month selection without changing annual data', () => {
  const services = [event([row(1, 1, '2026-09-01'), row(2, 1, '2026-10-01', 'paid')])];
  const result = buildStaffBalance({ services, period: { ...period, month: '' }, evolutionMonth: 10, evolutionWeek: 999 });
  assert.equal(result.evolution.month, 10);
  assert.equal(result.evolution.monthTotals.cost, 50);
  assert.equal(result.evolution.monthTotals.paid, 50);
  assert.equal(result.evolution.activeWeek.start, 1);
  assert.equal(result.totals.cost, 100);
  assert.equal(result.annualTotals.cost, 100);
  assert.equal(buildStaffBalance({ services, period, evolutionMonth: 10 }).evolution.month, 9);
});

test('weekly amounts respect all analysis filters, states, adjustments and advances', () => {
  const services = [event([
    row(1, 1, '2026-09-01', 'paid', { paymentAdjustment: -2.5, advancePayments: '[{"amount":20},{"amount":40,"car":true}]' }),
    row(2, 2, '2026-09-01', 'penhorado'), row(3, 1, '2026-09-02', 'ganho'),
  ]), event([row(4, 1, '2026-09-03')], { clientId: 2 })];
  const result = buildStaffBalance({ services, period: { ...period, clientId: '1', status: 'finalized' }, search: 'pecanha' });
  assert.deepEqual(result.evolution.weekTotals, result.totals);
  assert.deepEqual(result.evolution.monthTotals, result.totals);
  const before = result.evolution.weekTotals;
  services[0].assignments[2].paymentStatus = 'paid';
  const after = buildStaffBalance({ services, period: { ...period, clientId: '1', status: 'finalized' }, search: 'pecanha' }).evolution.weekTotals;
  assert.equal(after.cost, before.cost);
  assert.equal(after.paid - before.paid, 50);
  assert.equal(before.unpaid - after.unpaid, 50);
});

test('monthly comparison crosses the year without changing the annual summary or collaborators', () => {
  const services = [event([
    row(1, 1, '2025-12-10'), row(2, 1, '2025-12-20', 'paid'), row(3, 1, '2026-01-01'), row(4, 2, '2025-12-10'),
  ])];
  const result = buildStaffBalance({ services, period: { ...period, month: '1' }, collaboratorId: '1' });
  assert.equal(result.annualTotals.cost, 50);
  assert.equal(result.evolution.monthTotals.cost, 50);
  assert.equal(result.evolution.previousMonth.totals.cost, 100);
  assert.equal(result.evolution.previousMonth.totals.services, 2);
  assert.equal(result.evolution.previousMonth.totals.paid, 50);
  assert.equal(result.evolution.previousMonth.label, '01/12/2025 – 31/12/2025');
  assert.equal(result.collaborators.length, 1);
});

test('partial week compares matching weekdays without leaking adjacent days into current totals', () => {
  const services = [event([
    row(1, 1, '2026-08-24'), row(2, 1, '2026-08-25'), row(3, 1, '2026-08-30'),
    row(4, 1, '2026-08-31'), row(5, 1, '2026-09-01'), row(6, 1, '2026-09-06'),
  ])];
  const result = buildStaffBalance({ services, period, collaboratorId: '1' });
  assert.equal(result.evolution.previousWeek.label, '25/08/2026 – 30/08/2026');
  assert.equal(result.evolution.previousWeek.totals.cost, 100);
  assert.equal(result.evolution.weekTotals.cost, 100);
  assert.equal(result.totals.cost, 100);
  const next = buildStaffBalance({ services, period, collaboratorId: '1', evolutionWeek: 7 });
  assert.equal(next.evolution.previousWeek.label, '31/08/2026 – 06/09/2026');
  assert.equal(next.evolution.previousWeek.totals.cost, 150);
  assert.equal(next.evolution.weekTotals.cost, 0);
});

test('comparison excludes other collaborators, clients and non-billable services', () => {
  const services = [event([row(1, 1, '2026-08-25'), row(2, 2, '2026-08-25'), row(3, 1, '2026-09-01')]),
    event([row(4, 1, '2026-08-25')], { clientId: 2 }), event([row(5, 1, '2026-08-25')], { status: 'confirmed' })];
  const result = buildStaffBalance({ services, period: { ...period, clientId: '1' }, search: 'pecanha' });
  assert.equal(result.evolution.previousMonth.totals.cost, 50);
  assert.equal(result.evolution.previousWeek.totals.cost, 50);
});
