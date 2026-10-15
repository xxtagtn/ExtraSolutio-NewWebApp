import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedStaffHourCachePatch, assignmentDerivedHours, assignmentHoursSourceChanged } from './assignmentDerivedHours.js';
import { clientRealHours, clientChargeHours, staffPaymentHours } from './serviceFinance.js';

const event = { startTime: '18:00', endTime: '00:00', minimumHoursSnapshot: 4.5 };
const row = { checkIn: '18:00', checkOut: '02:20', hourlyRate: 8, validationStatus: 'staff_accepted',
  clientRealHours: 14, clientBillableHours: 6, hoursWorked: 14, staffPayableHours: 14, totalPay: 112 };

test('accepted Staff clocks replace obsolete numeric Client caches without Client validation', () => {
  assert.equal(clientRealHours(row), 8.5);
  assert.equal(staffPaymentHours(row), 8.5);
  assert.deepEqual(acceptedStaffHourCachePatch(row, event), {
    hoursWorked: 8.5, staffPayableHours: 8.5, clientRealHours: 8.5, clientBillableHours: 8.5, totalPay: 68,
  });
  assert.deepEqual(acceptedStaffHourCachePatch({ ...row, ...assignmentDerivedHours(row, event) }, event), {});
});

test('Client and validated clocks keep their existing priority over Staff clocks', () => {
  const client = { ...row, clientCheckIn: '18:00', clientCheckOut: '01:30' };
  const validated = { ...client, validatedCheckIn: '18:00', validatedCheckOut: '02:00' };
  assert.equal(clientRealHours(client), 7.5); assert.equal(clientChargeHours(client), 7.5);
  assert.equal(clientRealHours(validated), 8); assert.equal(clientChargeHours(validated), 8);
  assert.deepEqual(acceptedStaffHourCachePatch(client, event), {});
  assert.deepEqual(acceptedStaffHourCachePatch(validated, event), {});
  assert.equal(assignmentDerivedHours(validated, event).clientRealHours, 8);
});

test('legacy explicit Client duration and minimum billing do not become Staff worked hours', () => {
  assert.equal(clientRealHours({ checkIn: '09:00', checkOut: '15:00', clientRealHours: 4.5 }), 4.5);
  assert.equal(clientRealHours({ validationStatus: 'staff_accepted', clientRealHours: 4.5 }), 4.5);
  const result = assignmentDerivedHours({ ...row, checkOut: '20:00' }, event);
  assert.equal(result.hoursWorked, 2); assert.equal(result.clientRealHours, 2);
  assert.equal(result.clientBillableHours, 4.5); assert.equal(result.totalPay, 16);
});

test('incomplete punches do not persist planned durations as executed numeric caches', () => {
  const result = assignmentDerivedHours({ ...row, checkOut: null, plannedCheckIn: '18:00', plannedCheckOut: '00:00' }, event);
  assert.equal(result.hoursWorked, 0); assert.equal(result.staffPayableHours, 0);
  assert.equal(result.clientRealHours, 0); assert.equal(result.clientBillableHours, 0);
  const planned = { ...result, plannedCheckIn: '18:00', plannedCheckOut: '01:00' };
  assert.equal(clientChargeHours(planned, event.startTime, event.endTime, 4.5), 7);
});

test('source detection ignores unrelated edits and accepts cleared or zero duration clocks', () => {
  assert.equal(assignmentHoursSourceChanged({ checkOut: '01:00' }, row), true);
  assert.equal(assignmentHoursSourceChanged({ checkOut: null }, row), true);
  assert.equal(assignmentHoursSourceChanged({ hourlyRate: 9 }, row), false);
  assert.equal(assignmentHoursSourceChanged({ checkOut: row.checkOut }, row), false);
  const zero = assignmentDerivedHours({ ...row, checkOut: '18:00' }, { minimumHoursSnapshot: 0 });
  assert.equal(zero.hoursWorked, 0); assert.equal(zero.clientRealHours, 0); assert.equal(zero.clientBillableHours, 0);
  assert.deepEqual(acceptedStaffHourCachePatch({ ...row, checkOut: null }, event), {});
});
