import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  automaticStaffTravelSnapshotEntry,
  staffTravelCompensation,
  normalizeStaffTravel,
  travelConfiguration,
} from './staffTravel.js';
import { calculateTravelAmount, normalizeTravelCars } from './travelCalculator.js';
import { staffAssignmentPaymentTotal } from './staffPayment.js';
import { staffWorkedHours, clientChargeHours, staffPaymentHours } from './serviceFinance.js';
import { calculateEventTotals } from '../../server/utils/eventTotals.js';
import { normalizeEvent, normalizeAssignment } from '../../server/routes/crud.js';
import {
  assertStaffTravelConfiguration,
  assertPaidStaffTravelUnchanged,
  persistPaidStaffTravelSnapshot,
} from '../../server/utils/staffTravelProtection.js';
import { setManualEventStatus } from '../../server/services/eventWorkflow.js';

const assignment = {
  id: 1, collaboratorId: 10, role: 'Emp.Mesa', status: 'confirmed', hourlyRate: 10,
  checkIn: '08:30', checkOut: '22:30', clientCheckIn: '08:30', clientCheckOut: '22:30',
  validatedCheckIn: '08:30', validatedCheckOut: '22:30', validationStatus: 'validated',
};
const car = { id: 'car-1', label: 'Carro 1', km: 120, kmRate: 0.4, durationHours: 2, travelPeople: 1, travelStaffHourlyRate: 10 };
const compensation = { kind: 'staff_compensation', assignmentId: 1, collaboratorId: 10, carId: 'car-1', durationHours: 0 };
function event(patch = {}) {
  const result = {
    id: 30, name: 'Salvaterra', date: '2026-09-27', status: 'to_validate_client',
    requiredRoles: [{ role: 'Emp.Mesa', agreedRate: 14 }],
    travelType: 'kilometers', travelExpenseEnabled: true, split5050: false,
    travelCars: travelConfiguration([car], [compensation]), ...patch,
  };
  result.travelExpenseAmount = calculateTravelAmount(result);
  return result;
}

for (const split5050 of [false, true]) {
  test(`Salvaterra: independent service, client travel and staff pay (50/50=${split5050})`, () => {
    const source = event({ split5050 });
    const original = structuredClone(assignment);
    assertStaffTravelConfiguration({}, source, [assignment]);
    assert.deepEqual(staffTravelCompensation(assignment, source), {
      durationHours: 2, payableHours: split5050 ? 1 : 2, amount: split5050 ? 10 : 20,
    });
    const totals = calculateEventTotals(source, [assignment]);
    assert.equal(totals.totalRevenue, split5050 ? 254 : 264);
    assert.equal(totals.totalCost, split5050 ? 150 : 160);
    assert.equal(totals.totalRevenue - totals.totalCost, 104);
    assert.equal(staffAssignmentPaymentTotal(assignment, source), totals.totalCost);
    assert.equal(staffWorkedHours(assignment), 14);
    assert.equal(staffPaymentHours(assignment), 14);
    assert.equal(clientChargeHours(assignment), 14);
    assert.equal(totals.billableHours, 14);
    assert.deepEqual(assignment, original);
  });
}

for (const [travelType, charge] of [['none', 0], ['outside_lisbon', 35], ['outside_plus_staff', 55], ['manual', 87], ['kilometers', 68]]) {
  test(`${travelType}: automatic staff compensation remains independent of client pricing`, () => {
    const source = event({ travelType, travelPeople: 2, travelManualAmount: 87,
      travelCars: travelConfiguration([car], [{ ...compensation, carId: '', durationHours: 2 }]),
    });
    assert.equal(calculateTravelAmount(source), charge);
    assert.equal(staffAssignmentPaymentTotal(assignment, source), 160);
    const noTravelTime = { ...source, travelCars: [{ ...car, durationHours: 0 }] };
    assert.equal(staffAssignmentPaymentTotal(assignment, noTravelTime), 140);
  });
}

test('each collaborator receives their own staff rate, never the commercial travel rate', () => {
  const second = { ...assignment, id: 2, collaboratorId: 20, hourlyRate: 12.5 };
  const source = event({ split5050: true, travelCars: travelConfiguration([{ ...car, travelPeople: 2, travelStaffHourlyRate: 99 }],
    []) });
  const assignments = [assignment, second];
  assertStaffTravelConfiguration({}, source, assignments);
  assert.equal(staffTravelCompensation(assignment, source, assignments).amount, 10);
  assert.equal(staffTravelCompensation(second, source, assignments).amount, 12.5);
  assert.equal(calculateEventTotals(source, [assignment, second]).totalCost, 337.5);
});

test('split shifts receive one compensation, including different service hours', () => {
  const morning = { ...assignment, checkOut: '12:30', clientCheckOut: '12:30', validatedCheckOut: '12:30' };
  const evening = { ...assignment, id: 2, checkIn: '14:30', clientCheckIn: '14:30', validatedCheckIn: '14:30' };
  const source = event({ split5050: true });
  const assignments = [morning, evening];
  assertStaffTravelConfiguration({}, source, assignments);
  assert.equal(staffTravelCompensation(morning, source, assignments).amount, 10);
  assert.equal(staffTravelCompensation(evening, source, assignments).amount, 0);
  assert.equal(calculateEventTotals(source, [morning, evening]).totalCost, 130);
  assert.doesNotThrow(() => assertStaffTravelConfiguration({}, event({ travelCars: [car, compensation, { ...compensation, assignmentId: 2 }] }),
    [morning, evening]));
});

test('continuous events apply the first car once to each assigned day', () => {
  const first = { ...assignment, assignmentDate: '2026-09-27' };
  const second = { ...assignment, id: 2, assignmentDate: '2026-09-28' };
  const source = event({ isContinuous: true, endDate: '2026-09-28', travelCars: [car,
    { ...car, id: 'car-2', durationHours: 3 }, compensation,
    { ...compensation, assignmentId: 2, carId: 'car-2' },
  ] });
  assertStaffTravelConfiguration({}, source, [first, second]);
  assert.equal(staffTravelCompensation(first, source).amount, 20);
  assert.equal(staffTravelCompensation(second, source).amount, 20);
  assert.equal(staffTravelCompensation(second, { ...source, cancelledDays: [{ date: '2026-09-28' }] }).amount, 0);
  assert.equal(staffTravelCompensation(first, { ...source, cancelledDays: [{ date: '2026-09-28' }] }).amount, 20);
});

test('removed, reassigned and absent collaborators accrue no active compensation', () => {
  for (const status of ['cancelled', 'missed_unjustified', 'missed_justified']) {
    assert.equal(staffTravelCompensation({ ...assignment, status }, event()).amount, 0, status);
  }
  assert.equal(staffTravelCompensation(assignment, event(), []).amount, 0);
  assert.equal(calculateEventTotals(event(), []).totalCost, 0);
  assert.equal(staffTravelCompensation(assignment, event({ status: 'cancelled' })).amount, 0);
});

test('moving compensated continuous assignments onto the same day cannot duplicate compensation', () => {
  const first = { ...assignment, assignmentDate: '2026-09-27' };
  const second = { ...assignment, id: 2, assignmentDate: '2026-09-28' };
  const source = event({ travelCars: [car, compensation, { ...compensation, assignmentId: 2 }] });
  assertStaffTravelConfiguration(source, source, [first, second]);
  const moved = { ...second, assignmentDate: first.assignmentDate };
  assert.doesNotThrow(() => assertStaffTravelConfiguration(source, source, [first, moved]));
  assert.equal(staffTravelCompensation(first, source, [first, moved]).amount, 20);
  assert.equal(staffTravelCompensation(moved, source, [first, moved]).amount, 0);
});

test('confirmed assignments receive automatic compensation and no-show rows do not', () => {
  const missed = { ...assignment, status: 'missed_justified' };
  const worked = { ...assignment, id: 2 };
  const source = event();
  const next = event({ travelCars: [car] });
  assert.doesNotThrow(() => assertStaffTravelConfiguration(source, next, [missed, worked]));
  assert.equal(staffTravelCompensation(missed, next).amount, 0);
  assert.equal(staffTravelCompensation(worked, next).amount, 20);
  assert.equal(normalizeStaffTravel(next.travelCars).length, 0);
  assert.equal(staffTravelCompensation({ ...worked, status: 'pending_confirmation' }, next).amount, 0);
});

test('first car automatically applies to every confirmed collaborator, once per person/day', () => {
  const first = { ...assignment, id: 1, collaboratorId: 10, checkIn: '08:30', checkOut: '12:30',
    clientCheckIn: '08:30', clientCheckOut: '12:30', validatedCheckIn: '08:30', validatedCheckOut: '12:30', plannedCheckIn: '08:30' };
  const split = { ...assignment, id: 2, collaboratorId: 10, checkIn: '14:30', plannedCheckIn: '14:30' };
  const other = { ...assignment, id: 3, collaboratorId: 20, hourlyRate: 12.5 };
  const assignments = [first, split, other];
  const source = event({ split5050: true, travelCars: [car, { ...car, id: 'car-2', durationHours: 3 }], assignments });
  assert.equal(staffTravelCompensation(first, source, assignments).amount, 10);
  assert.equal(staffTravelCompensation(split, source, assignments).amount, 0);
  assert.equal(staffTravelCompensation(other, source, assignments).amount, 12.5);
  assert.equal(calculateEventTotals(source, assignments).totalCost, 317.5);
});

test('matches the Finance example and keeps paid compensation as a snapshot', async () => {
  const row = { ...assignment, hourlyRate: 8.5 };
  const source = event({ travelCars: [car], assignments: [row] });
  assert.equal(staffAssignmentPaymentTotal({ ...row, event: source }), 136);
  assert.equal(staffAssignmentPaymentTotal({ ...row, event: { ...source, split5050: true } }), 127.5);

  const paid = { ...row, paymentStatus: 'paid' };
  const snapshot = automaticStaffTravelSnapshotEntry(paid, source, [paid]);
  assert.equal(snapshot.carId, car.id);
  const paidEvent = { ...source, travelCars: travelConfiguration([car], [snapshot]), assignments: [paid] };
  assert.equal(staffTravelCompensation(paid, paidEvent, [paid]).amount, 17);
});

test('records the automatic route when a staff payment is marked paid', async () => {
  const unpaid = { ...assignment, eventId: 30, paymentStatus: 'unpaid' };
  const paid = { ...assignment, eventId: 30, paymentStatus: 'paid' };
  let savedEvent = event({ travelCars: [car], assignments: [unpaid] });
  let updates = 0;
  const prisma = {
    event: {
      findUnique: async () => savedEvent,
      update: async ({ data }) => {
        updates += 1;
        savedEvent = { ...savedEvent, ...data };
        return savedEvent;
      },
    },
  };
  assert.equal(await persistPaidStaffTravelSnapshot(prisma, paid), true);
  assert.equal(staffTravelCompensation(paid, savedEvent, [paid]).amount, 20);
  assert.equal(await persistPaidStaffTravelSnapshot(prisma, paid), false);
  assert.equal(updates, 1);
});

test('a paid daily snapshot prevents a new earlier split shift from duplicating compensation', () => {
  const evening = { ...assignment, id: 1, eventId: 30, checkIn: '14:30', plannedCheckIn: '14:30', paymentStatus: 'paid' };
  const earlier = { ...assignment, id: 2, eventId: 30, checkIn: '08:30', plannedCheckIn: '08:30', paymentStatus: 'unpaid' };
  const source = event({ assignments: [evening, earlier], travelCars: travelConfiguration([car], [compensation]) });
  assert.equal(staffTravelCompensation(evening, source, [evening, earlier]).amount, 20);
  assert.equal(staffTravelCompensation(earlier, source, [evening, earlier]).amount, 0);
});

test('normalization round-trips separate metadata without modifying legacy cars or doubling client charges', () => {
  const source = event();
  const stored = normalizeEvent({ travelCars: source.travelCars });
  assert.deepEqual(normalizeTravelCars(stored.travelCars), [car]);
  assert.deepEqual(normalizeStaffTravel(stored.travelCars), [compensation]);
  assert.equal(calculateTravelAmount({ ...source, ...stored }), 68);
  assert.equal(staffAssignmentPaymentTotal(assignment, { ...source, ...stored }), 160);
  assert.deepEqual(travelConfiguration([car]), [car]);
  assert.equal(normalizeEvent({ description: 'Alteração sem deslocação' }).travelCars, undefined);
});

test('revalidating service hours does not clear or double travel compensation', () => {
  const source = event({ split5050: true });
  const update = normalizeAssignment({ ...assignment, staffPayableHours: 14, hoursWorked: 14, totalPay: 140 });
  const updated = { ...assignment, ...update };
  assert.equal(staffAssignmentPaymentTotal(updated, source), 150);
  assert.equal(staffAssignmentPaymentTotal(updated, source), 150);
  assert.equal(calculateEventTotals(source, [updated]).totalCost, 150);
  assert.equal(updated.checkIn, '08:30');
  assert.equal(updated.checkOut, '22:30');
});

test('keeps existing rounding, client minimum and VAT/adjustment rules', () => {
  const row = { ...assignment, checkIn: '08:34', checkOut: '11:38', clientCheckIn: '08:34', clientCheckOut: '11:38',
    validatedCheckIn: '08:34', validatedCheckOut: '11:38', collaborator: { includeVat: true }, paymentAdjustment: -2 };
  const source = event({ split5050: true, minimumHoursSnapshot: 5 });
  assert.equal(staffWorkedHours(row), 3);
  assert.equal(clientChargeHours(row, '', '', 5), 5);
  assert.equal(staffAssignmentPaymentTotal(row, source), 47.2);
  const totals = calculateEventTotals(source, [row]);
  assert.equal(totals.totalCost, 47.2);
  assert.equal(totals.totalRevenue, 128);
});

test('protects paid compensation against edits, removal, 50/50, rate or status changes', () => {
  const paid = { ...assignment, paymentStatus: 'paid' };
  const source = event();
  assert.doesNotThrow(() => assertStaffTravelConfiguration(source, source, [paid]));
  for (const next of [event({ split5050: true }), event({ travelCars: [car] }),
    event({ travelCars: [{ ...car, durationHours: 3 }, compensation] })]) {
    assert.throws(() => assertStaffTravelConfiguration(source, next, [paid]), /já foi paga/);
  }
  assert.throws(() => assertPaidStaffTravelUnchanged(paid, { ...paid, hourlyRate: 11 }, source), /já foi paga/);
  assert.throws(() => assertPaidStaffTravelUnchanged(paid, null, source), /já foi paga/);
  assert.throws(() => assertPaidStaffTravelUnchanged(paid, { ...paid, status: 'cancelled' }, source), /já foi paga/);
  assert.throws(() => assertStaffTravelConfiguration({ ...source, travelCars: [car] }, source, [paid]), /já foi paga/);
});

test('preserves issued client totals and leaves legacy payments unchanged', () => {
  const source = event({ totalRevenue: 500, taxAmount: 100, realHours: 14, billableHours: 14 });
  assert.equal(calculateEventTotals(source, [assignment], { preserveClientTotals: true }).totalRevenue, 500);
  assert.equal(staffAssignmentPaymentTotal(assignment, { travelCars: null }), 140);
  assert.deepEqual(normalizeStaffTravel('bad json'), []);
});

test('legacy per-assignment compensation metadata does not block automatic event edits', () => {
  assert.doesNotThrow(() => assertStaffTravelConfiguration({}, event(), []));
  const malformedLegacyMetadata = event({ travelCars: [compensation] });
  assert.doesNotThrow(() => assertStaffTravelConfiguration({}, malformedLegacyMetadata, [assignment]));
  assert.equal(staffTravelCompensation(assignment, malformedLegacyMetadata).amount, 0);
  assert.doesNotThrow(() => assertStaffTravelConfiguration(event(), event(), []));
});

test('manual event cancellation protects paid travel and refreshes unpaid travel cost', async () => {
  let source = event({ assignments: [{ ...assignment, paymentStatus: 'paid' }], totalCost: 160, totalRevenue: 264 });
  let updates = 0;
  const prisma = {
    event: {
      findUnique: async () => source,
      update: async ({ data }) => { updates += 1; source = { ...source, ...data }; return source; },
    },
    $transaction: (fn) => fn(prisma),
  };
  await assert.rejects(setManualEventStatus(prisma, 30, 'cancelled'), /já foi paga/);
  assert.equal(updates, 0);
  source = { ...source, assignments: [{ ...assignment, paymentStatus: 'unpaid' }] };
  const saved = await setManualEventStatus(prisma, 30, 'cancelled');
  assert.equal(saved.totalCost, 140);
  assert.equal(saved.totalRevenue, 264);
  assert.equal(saved.assignments[0].checkIn, '08:30');
});
