import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServiceDuplicateForm, createDuplicatePeriodDraft, emptyAssignmentForRole, shiftDuplicatedServiceStart, synchronizeDuplicatedServiceDays, updateDuplicatePeriodDraft } from './serviceDuplication.js';
import { nextAutomaticServiceStatus } from './serviceStatus.js';

const defaults = () => ({
  serviceReference: '', status: 'drafting', billingStatus: 'pending',
  signaledAmount: '', paidAmount: '', signaledAt: '', remainingPaymentDate: '',
  totalRevenue: '', realHours: 0, billableHours: 0, taxAmount: 0,
  minimumHoursSnapshot: 0, rateHistory: null, staffTravel: [], externalCosts: [],
});

const source = {
  id: 12, name: 'Evento original', serviceReference: 'REF-12',
  eventType: 'Catering', clientId: '3', clientName: '', date: '2026-10-01',
  endDate: '2026-10-03', isContinuous: true, startTime: '18:00', endTime: '04:00',
  location: 'Local original', useDefaultLocation: false, guestsCount: 100,
  uniform: 'Outros', uniformOther: 'Avental', meetingPoint: 'Entrada',
  onsiteContactName: 'Contacto', onsiteContactPhone: '900000000',
  description: 'Notas operacionais [BUDGET_REF:ORC-123] [EVENT_VALIDATED_HOURS]',
  status: 'finalized', statusMode: 'manual', billingStatus: 'paid',
  paidAmount: 500, signaledAmount: 400, totalRevenue: 500, taxAmount: 100,
  rateHistory: { private: 'old history' }, minimumHoursSnapshot: 8,
  externalCosts: [{ id: 99, amount: 40 }],
  staffTravel: [{ assignmentId: 10, collaboratorId: 6 }],
  invoices: [{ id: 10 }], qrToken: 'private-token', cancelledDays: ['2026-10-02'],
  workLocationsEnabled: true, workLocations: [{ id: 20, eventId: 12, name: 'Sala', sortOrder: 0 }],
  travelCars: [{ id: 'old-car', label: 'Carro', km: 30, kmRate: 0.4, durationHours: 1, travelPeople: 2 }],
  requiredRoles: [{ role: 'Emp. Mesa', qty: 1, agreedRate: '14,00', day: '2026-10-01', start: '18:00', end: '04:00', order: 0, id: 15 }],
  assignments: [{
    id: 10, eventId: 12, collaboratorId: '6', role: 'Emp. Mesa', status: 'confirmed',
    assignmentDate: '2026-10-01', plannedCheckIn: '18:00', plannedCheckOut: '04:00',
    checkIn: '17:59', checkOut: '04:01', clientCheckIn: '18:00', clientCheckOut: '04:00',
    validatedCheckIn: '18:00', validatedCheckOut: '04:00', validationStatus: 'validated',
    clientSynced: true, validationNotes: 'private history', hoursWorked: 10, staffPayableHours: 10,
    clientBillableHours: 10, hourlyRate: '9,00', paymentStatus: 'paid', paymentAdjustment: 4,
    paymentDate: '2026-10-05', advancePayments: [{ id: 1, amount: 20 }], workLocationId: '20',
    qrToken: 'private-assignment-token', isDriver: true,
  }],
};

test('duplicates planning without creating identities, billing or workflow history', () => {
  const form = buildServiceDuplicateForm(source, defaults());
  assert.equal(form.name, 'Cópia de Evento original');
  for (const field of ['clientId', 'location', 'date', 'endDate', 'startTime', 'endTime', 'uniform', 'uniformOther']) {
    assert.equal(form[field], source[field]);
  }
  assert.equal(form.description, 'Notas operacionais');
  assert.equal(form.status, 'drafting');
  assert.equal(form.billingStatus, 'pending');
  assert.equal(form.serviceReference, '');
  assert.equal(form.paidAmount, '');
  assert.equal(form.taxAmount, 0);
  assert.equal(form.rateHistory, null);
  assert.deepEqual(form.staffTravel, []);
  assert.deepEqual(form.externalCosts, []);
  assert.deepEqual(form.workLocations, ['Sala']);
  assert.equal(form.travelCars[0].id, 'car-1');
  for (const field of ['id', 'invoices', 'qrToken', 'cancelledDays', 'statusMode']) assert.equal(field in form, false);
  assert.equal('id' in form.requiredRoles[0], false);
  assert.equal(form.assignments[0].collaboratorId, '');
  assert.equal(form.assignments[0].plannedCheckOut, '04:00');
});

test('optional team is awaiting confirmation, without punches, advances or payment data', () => {
  const assignment = buildServiceDuplicateForm(source, defaults(), { includeTeam: true }).assignments[0];
  assert.equal(assignment.collaboratorId, '6');
  assert.equal(assignment.status, 'pending_confirmation');
  assert.equal(assignment.validationStatus, 'pending');
  assert.equal(assignment.clientSynced, false);
  assert.deepEqual(assignment.advancePayments, []);
  assert.equal(assignment.hourlyRate, '');
  assert.equal(assignment.workLocationId, '');
  for (const field of ['checkIn', 'checkOut', 'clientCheckIn', 'clientCheckOut', 'validatedCheckIn', 'validatedCheckOut', 'validationNotes']) {
    assert.equal(assignment[field], '');
  }
  for (const field of ['id', 'eventId', 'qrToken', 'paymentStatus', 'paymentDate', 'paymentAdjustment']) assert.equal(field in assignment, false);
  assert.equal(assignment.staffPayableHours, 0);
  assert.equal(assignment.clientBillableHours, 0);
});

test('cancelled and absent historical rows do not create extra copied slots', () => {
  for (const status of ['cancelled', 'missed_justified', 'missed_unjustified']) {
    const form = buildServiceDuplicateForm({ ...source, assignments: [{ ...source.assignments[0], status }] }, defaults(), { includeTeam: true });
    assert.deepEqual(form.assignments, []);
  }
});

test('retains pending collaborators and empty planned shifts without old draft IDs', () => {
  const pending = { ...source.assignments[0], status: 'pending_confirmation' };
  const draft = { ...emptyAssignmentForRole('Bar', '2026-10-03'), draftId: 'old-draft', plannedCheckIn: '09:00' };
  const form = buildServiceDuplicateForm({ ...source, assignments: [pending, draft] }, defaults(), { includeTeam: true });
  assert.equal(form.assignments[0].collaboratorId, '6');
  assert.equal(form.assignments[1].collaboratorId, '');
  assert.equal(form.assignments[1].plannedCheckIn, '09:00');
  assert.equal('draftId' in form.assignments[1], false);
});

test('all nested planning structures are independent from the original', () => {
  const original = structuredClone(source);
  const form = buildServiceDuplicateForm(original, defaults(), { includeTeam: true });
  form.requiredRoles[0].qty = 8;
  form.travelCars[0].km = 900;
  form.assignments[0].plannedCheckIn = '10:00';
  form.workLocations[0] = 'Novo local';
  assert.deepEqual(original, source);
});

test('new copied team does not automatically complete or finalize a future event', () => {
  const form = buildServiceDuplicateForm(source, defaults(), { includeTeam: true });
  assert.equal(nextAutomaticServiceStatus(form, new Date('2026-09-01T12:00:00Z')), 'drafting');
});

test('shifts the whole multi-day planning across month, year and DST boundaries', () => {
  const form = buildServiceDuplicateForm(source, defaults(), { includeTeam: true });
  for (const date of ['2026-10-31', '2026-12-31', '2026-03-28']) {
    const shifted = shiftDuplicatedServiceStart(form, date);
    const end = new Date(`${date}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 2);
    assert.equal(shifted.endDate, end.toISOString().slice(0, 10));
    assert.equal(shifted.requiredRoles[0].day, date);
    assert.equal(shifted.assignments[0].assignmentDate, date);
    assert.equal(shifted.assignments[0].plannedCheckOut, '04:00');
    assert.equal(form.date, source.date);
  }
});

test('single-day copies, empty data and invalid intermediate date inputs remain safe', () => {
  const form = buildServiceDuplicateForm({ name: 'Simples', date: '2026-10-10' }, { ...defaults(), isContinuous: false });
  assert.equal(shiftDuplicatedServiceStart(form, '2026-10-11').date, '2026-10-11');
  assert.deepEqual(form.assignments, []);
  assert.deepEqual(form.requiredRoles, []);
  assert.deepEqual(shiftDuplicatedServiceStart(form, '').assignments, []);
});

function multiDaySource() {
  const days = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'];
  return {
    ...structuredClone(source), date: days[0], endDate: days.at(-1), cancelledDays: [],
    requiredRoles: days.map((day) => ({ role: 'Emp. Mesa', qty: 3, agreedRate: '14,00', day })),
    assignments: days.flatMap((day, dayIndex) => Array.from({ length: 3 }, (_, index) => ({
      ...structuredClone(source.assignments[0]), id: dayIndex * 10 + index,
      collaboratorId: `${dayIndex * 10 + index + 1}`, assignmentDate: day,
      plannedCheckIn: `${10 + dayIndex}:00`,
    }))),
  };
}

test('copies every day without deleting or reassigning its distinct team', () => {
  const original = multiDaySource();
  const snapshot = structuredClone(original);
  const duplicate = buildServiceDuplicateForm(original, defaults(), { includeTeam: true });
  assert.equal(duplicate.assignments.length, 12);
  assert.deepEqual(duplicate.assignments.map((row) => [row.assignmentDate, row.collaboratorId, row.plannedCheckIn]),
    original.assignments.map((row) => [row.assignmentDate, row.collaboratorId, row.plannedCheckIn]));
  assert.strictEqual(synchronizeDuplicatedServiceDays(duplicate), duplicate, 'no-op synchronization must not trigger a render loop');
  assert.deepEqual(original, snapshot);
});

test('shortening the continuous period removes assignments, empty slots and requirements for the last day', () => {
  const original = multiDaySource();
  for (const includeTeam of [true, false]) {
    const duplicate = buildServiceDuplicateForm(original, defaults(), { includeTeam });
    const resized = synchronizeDuplicatedServiceDays({ ...duplicate, endDate: '2026-10-12' });
    assert.equal(resized.assignments.length, 9);
    assert.equal(resized.requiredRoles.length, 3);
    assert.ok(resized.assignments.every((row) => row.assignmentDate <= resized.endDate));
    assert.equal(duplicate.assignments.length, 12, 'source draft must not be mutated');
  }
});

test('removing interleaved days keeps exact date associations, not positions in the day list', () => {
  const original = multiDaySource();
  const snapshot = structuredClone(original);
  const duplicate = buildServiceDuplicateForm(original, defaults(), { includeTeam: true });
  const resized = synchronizeDuplicatedServiceDays({ ...duplicate, cancelledDays: ['2026-10-11', { date: '2026-10-13' }] });
  assert.deepEqual(resized.requiredRoles.map((row) => row.day), ['2026-10-10', '2026-10-12']);
  assert.deepEqual(resized.assignments.map((row) => [row.assignmentDate, row.collaboratorId]),
    original.assignments.filter((row) => ['2026-10-10', '2026-10-12'].includes(row.assignmentDate))
      .map((row) => [row.assignmentDate, row.collaboratorId]));
  assert.deepEqual(original, snapshot);
});

test('advancing the first date inside the copied period trims days without moving their teams', () => {
  const original = multiDaySource();
  const duplicate = buildServiceDuplicateForm(original, defaults(), { includeTeam: true });
  const changed = updateDuplicatePeriodDraft({ ...duplicate, date: '2026-10-12' }, createDuplicatePeriodDraft(duplicate), { relocate: true });
  assert.equal(changed.form.endDate, '2026-10-13');
  assert.equal(changed.retained.startDate, original.date);
  assert.equal(changed.form.assignments.length, 6);
  assert.deepEqual(changed.form.assignments.map((row) => row.collaboratorId), ['21', '22', '23', '31', '32', '33']);
  assert.deepEqual(changed.form.requiredRoles.map((row) => row.day), ['2026-10-12', '2026-10-13']);
});

test('recopying the team respects the edited period and never appends duplicates or deleted days', () => {
  const original = multiDaySource();
  const duplicate = buildServiceDuplicateForm(original, defaults());
  let current = updateDuplicatePeriodDraft({ ...duplicate, date: '2026-10-12' }, createDuplicatePeriodDraft(duplicate)).form;
  current = synchronizeDuplicatedServiceDays({ ...current, endDate: '2026-10-12' });
  for (const includeTeam of [true, false, true, false, true]) {
    const copied = buildServiceDuplicateForm(original, defaults(), { includeTeam });
    current = synchronizeDuplicatedServiceDays({ ...current, assignments: copied.assignments });
    assert.equal(current.assignments.length, 3);
    assert.ok(current.assignments.every((row) => row.assignmentDate === '2026-10-12'));
    assert.deepEqual(current.assignments.map((row) => row.collaboratorId), includeTeam ? ['21', '22', '23'] : ['', '', '']);
  }
});

test('moving a trimmed event to another month preserves its remaining teams and recopy date mapping', () => {
  const original = multiDaySource();
  const duplicate = buildServiceDuplicateForm(original, defaults(), { includeTeam: true });
  const trimmed = updateDuplicatePeriodDraft({ ...duplicate, date: '2026-10-12' }, createDuplicatePeriodDraft(duplicate));
  const incomplete = updateDuplicatePeriodDraft({ ...trimmed.form, date: '2026-11-01' }, trimmed.retained, { relocate: true });
  assert.equal(incomplete.form.endDate, '2026-10-13', 'start must not automatically change the end');
  assert.strictEqual(incomplete.retained, trimmed.retained, 'invalid intermediate period must not lose data');
  const moved = updateDuplicatePeriodDraft({ ...incomplete.form, endDate: '2026-11-02' }, incomplete.retained, { relocate: true });
  assert.equal(moved.form.endDate, '2026-11-02');
  assert.equal(moved.retained.startDate, '2026-10-30');
  const copied = shiftDuplicatedServiceStart(buildServiceDuplicateForm(original, defaults(), { includeTeam: true }), moved.retained.startDate);
  const recopied = synchronizeDuplicatedServiceDays({ ...moved.form, assignments: copied.assignments });
  assert.deepEqual(recopied.assignments.map((row) => [row.assignmentDate, row.collaboratorId]),
    moved.form.assignments.map((row) => [row.assignmentDate, row.collaboratorId]));
});

test('cancelled source days never copy their team or explicit requirements, even with stale confirmed statuses', () => {
  const original = { ...multiDaySource(), cancelledDays: [{ date: '2026-10-11', assignmentStates: [{ id: 10, status: 'confirmed' }] }] };
  const snapshot = structuredClone(original);
  const duplicate = buildServiceDuplicateForm(original, defaults(), { includeTeam: true });
  assert.equal(duplicate.assignments.length, 9);
  assert.equal(duplicate.requiredRoles.length, 3);
  assert.ok(duplicate.assignments.every((row) => row.assignmentDate !== '2026-10-11'));
  assert.equal('cancelledDays' in duplicate, false, 'original cancellation history is not transferred');
  assert.deepEqual(original, snapshot);
});

test('converting a multi-day duplicate to a single day keeps only that day and its planned times', () => {
  const duplicate = buildServiceDuplicateForm(multiDaySource(), defaults(), { includeTeam: true });
  const single = synchronizeDuplicatedServiceDays({ ...duplicate, isContinuous: false, endDate: '' });
  assert.equal(single.assignments.length, 3);
  assert.equal(single.requiredRoles.length, 1);
  assert.ok(single.assignments.every((row) => row.assignmentDate === single.date && row.plannedCheckIn === '10:00'));
});

test('invalid intermediate dates keep the draft intact until existing date validation runs', () => {
  const duplicate = buildServiceDuplicateForm(multiDaySource(), defaults(), { includeTeam: true });
  for (const patch of [{ date: '' }, { endDate: '' }, { endDate: '2026-10-09' }]) {
    const incomplete = { ...duplicate, ...patch };
    assert.strictEqual(synchronizeDuplicatedServiceDays(incomplete), incomplete);
  }
});

test('a missing continuous assignment date is not guessed or replaced: existing save validation still applies', () => {
  const original = multiDaySource();
  original.assignments[0].assignmentDate = '';
  const duplicate = buildServiceDuplicateForm(original, defaults(), { includeTeam: true });
  assert.equal(duplicate.assignments[0].assignmentDate, '');
  assert.equal(duplicate.assignments[0].collaboratorId, original.assignments[0].collaboratorId);
});

test('restoring the first date after trimming does not shift the remaining days or attach another day team', () => {
  const original = multiDaySource();
  const duplicate = buildServiceDuplicateForm(original, defaults(), { includeTeam: true });
  const trimmed = updateDuplicatePeriodDraft({ ...duplicate, date: '2026-10-12' }, createDuplicatePeriodDraft(duplicate));
  const restored = updateDuplicatePeriodDraft({ ...trimmed.form, date: '2026-10-10' }, trimmed.retained);
  assert.equal(restored.form.endDate, '2026-10-13');
  assert.equal(restored.retained.startDate, '2026-10-10');
  assert.deepEqual(restored.form.assignments.map((row) => [row.assignmentDate, row.collaboratorId]),
    original.assignments.map((row) => [row.assignmentDate, row.collaboratorId]));
});

test('shortening then expanding restores edited teams, roles, rates and status without recreating rows', () => {
  const duplicate = buildServiceDuplicateForm(multiDaySource(), defaults(), { includeTeam: true });
  const edited = duplicate.assignments.find((row) => row.assignmentDate === '2026-10-12');
  Object.assign(edited, { plannedCheckIn: '14:30', hourlyRate: '11,25', status: 'confirmed', isDriver: true, validationNotes: 'Nota do novo evento' });
  duplicate.requiredRoles[2].agreedRate = '20,50';
  let working = { form: duplicate, retained: createDuplicatePeriodDraft(duplicate) };
  for (let repeat = 0; repeat < 5; repeat += 1) {
    working = updateDuplicatePeriodDraft({ ...working.form, endDate: '2026-10-10' }, working.retained);
    assert.equal(working.form.assignments.length, 3);
    assert.equal(working.retained.assignments.length, 9);
    working = updateDuplicatePeriodDraft({ ...working.form, endDate: '2026-10-13' }, working.retained);
    assert.equal(working.form.assignments.length, 12);
    assert.equal(working.retained.assignments.length, 0);
    assert.strictEqual(working.form.assignments.find((row) => row === edited), edited);
    assert.equal(working.form.requiredRoles[2].agreedRate, '20,50');
  }
  assert.equal(edited.plannedCheckIn, '14:30');
  assert.equal(edited.hourlyRate, '11,25');
  assert.equal(edited.status, 'confirmed');
});

test('clearing and retyping dates and a reversed period do not delete any cached data', () => {
  const duplicate = buildServiceDuplicateForm(multiDaySource(), defaults(), { includeTeam: true });
  const trimmed = updateDuplicatePeriodDraft({ ...duplicate, endDate: '2026-10-11' }, createDuplicatePeriodDraft(duplicate));
  for (const patch of [{ date: '' }, { endDate: '' }, { date: '2026-10-15' }]) {
    const next = { ...trimmed.form, ...patch };
    const incomplete = updateDuplicatePeriodDraft(next, trimmed.retained, { relocate: true });
    assert.strictEqual(incomplete.form, next);
    assert.strictEqual(incomplete.retained, trimmed.retained);
  }
  const restored = updateDuplicatePeriodDraft({ ...trimmed.form, endDate: '2026-10-25' }, trimmed.retained);
  assert.equal(restored.form.assignments.length, 12);
  assert.equal(restored.form.endDate, '2026-10-25');
});

test('manually deleted active rows are not resurrected by resizing; no-op updates are idempotent', () => {
  const duplicate = buildServiceDuplicateForm(multiDaySource(), defaults(), { includeTeam: true });
  const removed = duplicate.assignments[3];
  duplicate.assignments = duplicate.assignments.filter((row) => row !== removed);
  const trimmed = updateDuplicatePeriodDraft({ ...duplicate, endDate: '2026-10-10' }, createDuplicatePeriodDraft(duplicate));
  const expanded = updateDuplicatePeriodDraft({ ...trimmed.form, endDate: '2026-10-13' }, trimmed.retained);
  assert.equal(expanded.form.assignments.length, 11);
  assert.ok(!expanded.form.assignments.includes(removed));
  assert.strictEqual(updateDuplicatePeriodDraft(expanded.form, expanded.retained).form, expanded.form);
});

test('restored rows are excluded from submission when their days are still outside the final interval', () => {
  const duplicate = buildServiceDuplicateForm(multiDaySource(), defaults(), { includeTeam: true });
  const trimmed = updateDuplicatePeriodDraft({ ...duplicate, endDate: '2026-10-10' }, createDuplicatePeriodDraft(duplicate));
  assert.equal(trimmed.retained.assignments.length, 9);
  assert.equal(synchronizeDuplicatedServiceDays(trimmed.form).assignments.length, 3);
  assert.equal('retained' in trimmed.form, false);
  assert.equal('anchorDate' in trimmed.form, false);
});
