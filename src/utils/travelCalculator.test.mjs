import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateTravelAmount } from './travelCalculator.js';

test('does not charge travel when no travel mode is selected', () => {
  assert.equal(calculateTravelAmount({ travelType: 'none' }), 0);
});

test('charges the fixed outside Lisbon amount', () => {
  assert.equal(calculateTravelAmount({ travelType: 'outside_lisbon' }), 35);
});

test('charges the fixed outside Lisbon amount plus the selected staff', () => {
  assert.equal(calculateTravelAmount({ travelType: 'outside_plus_staff', travelPeople: 3 }), 65);
});

test('calculates kilometers and travel time', () => {
  assert.equal(calculateTravelAmount({
    travelType: 'kilometers',
    travelPeople: 3,
    km: 100,
    kmRate: 0.4,
    durationHours: 2,
    travelStaffHourlyRate: 10,
  }), 100);
});

test('does not add an automatic staff travel amount when no manual staff value exists', () => {
  assert.equal(calculateTravelAmount({
    travelType: 'kilometers',
    travelPeople: 3,
    km: 100,
    kmRate: 0.4,
    durationHours: 2,
  }), 40);
});

test('sums several kilometer cars with independent manual staff travel values', () => {
  assert.equal(calculateTravelAmount({
    travelType: 'kilometers',
    travelCars: [
      { km: 100, kmRate: 0.4, durationHours: 2, travelPeople: 3, travelStaffHourlyRate: 15 },
      { km: 60, kmRate: 0.4, durationHours: 1.5, travelPeople: 2, travelStaffHourlyRate: '10,00€' },
    ],
  }), 184);
});

test('applies 50/50 only to the travel time amount', () => {
  assert.equal(calculateTravelAmount({
    travelType: 'kilometers',
    travelPeople: 3,
    km: 100,
    kmRate: 0.4,
    durationHours: 2,
    split5050: true,
    travelStaffHourlyRate: 10,
  }), 70);
});

test('uses the manually entered staff travel hourly rate', () => {
  assert.equal(calculateTravelAmount({
    travelType: 'kilometers',
    travelPeople: 3,
    km: 100,
    kmRate: 0.4,
    durationHours: 2,
    travelStaffHourlyRate: 15,
  }), 130);
});

test('does not add an automatic staff amount when the manual rate is zero', () => {
  assert.equal(calculateTravelAmount({
    travelType: 'kilometers',
    travelPeople: 3,
    km: 100,
    kmRate: 0.4,
    durationHours: 2,
    travelStaffHourlyRate: 0,
  }), 40);
});

test('applies 50/50 to the manually calculated staff travel amount', () => {
  assert.equal(calculateTravelAmount({
    travelType: 'kilometers',
    travelPeople: 3,
    km: 100,
    kmRate: 0.4,
    durationHours: 2,
    travelStaffHourlyRate: 15,
    split5050: true,
  }), 85);
});

test('uses a direct custom amount in manual mode', () => {
  assert.equal(calculateTravelAmount({ travelType: 'manual', travelManualAmount: '87,50€' }), 87.5);
});

test('does not preserve the removed automatic mode', () => {
  assert.equal(calculateTravelAmount({ travelType: 'automatic', locationScope: 'outside_lisbon' }), 0);
});
