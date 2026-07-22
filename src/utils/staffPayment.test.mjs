import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assignmentWorkDateValue,
  defaultStaffPaymentMonth,
  staffPaymentRequiresAttention,
  staffPaymentTiming,
  staffPaymentTotal,
  validatedClientScheduleLabel,
} from './staffPayment.js';

test('adds a positive decimal adjustment to the staff payment', () => {
  assert.equal(staffPaymentTotal(80, false, '+2,50€'), 82.5);
});

test('subtracts a negative decimal adjustment from the staff payment', () => {
  assert.equal(staffPaymentTotal(80, false, '-2,43€'), 77.57);
});

test('applies the adjustment after collaborator VAT', () => {
  assert.equal(staffPaymentTotal(100, true, '-2,43'), 120.57);
});

test('does not allow an adjustment to produce a negative payment', () => {
  assert.equal(staffPaymentTotal(10, false, '-20,00'), 0);
});

test('uses the month after the service as the default staff payment month', () => {
  assert.equal(defaultStaffPaymentMonth('2026-06-21'), '2026-07');
  assert.equal(defaultStaffPaymentMonth('2026-12-21'), '2027-01');
});

test('uses assignment date before the general event date for staff payments', () => {
  const assignment = {
    assignmentDate: '2026-06-18',
    event: { date: '2026-06-16' },
  };

  assert.equal(assignmentWorkDateValue(assignment), '2026-06-18');
  assert.equal(staffPaymentTiming(assignment, new Date('2026-07-08')).paymentMonth, '2026-07');
});

test('marks staff payment as open only between day 8 and day 14', () => {
  const assignment = { event: { date: '2026-06-21' } };

  assert.equal(staffPaymentTiming(assignment, new Date('2026-07-07')).status, 'not_open');
  assert.equal(staffPaymentTiming(assignment, new Date('2026-07-08')).status, 'open');
  assert.equal(staffPaymentTiming(assignment, new Date('2026-07-14')).status, 'open');
  assert.equal(staffPaymentTiming(assignment, new Date('2026-07-15')).status, 'overdue');
});

test('allows a staff payment to be deferred to a later month', () => {
  const assignment = {
    event: { date: '2026-06-21' },
    paymentDeferredMonth: '2026-08',
  };

  const timing = staffPaymentTiming(assignment, new Date('2026-07-10'));

  assert.equal(timing.paymentMonth, '2026-08');
  assert.equal(timing.status, 'not_open');
  assert.equal(timing.deferred, true);
});

test('shows the validated client schedule and supports legacy client hours', () => {
  assert.equal(validatedClientScheduleLabel({
    validatedCheckIn: '11:30:00',
    validatedCheckOut: '16:05:00',
    clientCheckIn: '11:00',
    clientCheckOut: '16:00',
  }), '11:30 - 16:05');
  assert.equal(validatedClientScheduleLabel({ clientCheckIn: '18:00', clientCheckOut: '23:30' }), '18:00 - 23:30');
  assert.equal(validatedClientScheduleLabel({ clientCheckIn: '18:00' }), '-');
});

test('highlights unpaid staff payments from day 8 until they are paid', () => {
  const assignment = { event: { date: '2026-06-21' }, paymentStatus: 'unpaid' };

  assert.equal(staffPaymentRequiresAttention(assignment, new Date('2026-07-07')), false);
  assert.equal(staffPaymentRequiresAttention(assignment, new Date('2026-07-08')), true);
  assert.equal(staffPaymentRequiresAttention(assignment, new Date('2026-07-14')), true);
  assert.equal(staffPaymentRequiresAttention(assignment, new Date('2026-07-15')), true);
  assert.equal(staffPaymentRequiresAttention({ ...assignment, paymentStatus: 'paid' }, new Date('2026-07-15')), false);
});
