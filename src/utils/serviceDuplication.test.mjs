import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServiceDuplicateForm, emptyAssignmentForRole, shiftDuplicatedServiceStart } from './serviceDuplication.js';
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
