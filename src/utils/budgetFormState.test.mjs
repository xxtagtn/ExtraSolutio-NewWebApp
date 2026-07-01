import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeBudgetFormState } from './budgetFormState.js';

test('normalizes null budget form values before they reach controlled inputs', () => {
  const form = normalizeBudgetFormState({
    reference: null,
    leadName: null,
    companyName: null,
    phone: null,
    email: null,
    nif: null,
    eventType: null,
    description: null,
    lostReason: null,
    notes: null,
    discountRate: null,
    travelManualAmount: null,
    categories: [
      { role: null, qty: null, rate: null, date: null, start: null, end: null, uniform: null },
    ],
    eventDays: [
      { date: null, location: null, guestsCount: null, startTime: null, endTime: null },
    ],
    externalCosts: [
      { type: null, supplier: null, description: null, costAmount: null, marginPercent: null },
    ],
    travelCars: [
      { label: null, km: null, kmRate: null, durationHours: null, travelPeople: null, travelStaffHourlyRate: null },
    ],
  });

  assert.equal(form.reference, '');
  assert.equal(form.leadName, '');
  assert.equal(form.companyName, '');
  assert.equal(form.phone, '');
  assert.equal(form.email, '');
  assert.equal(form.nif, '');
  assert.equal(form.eventType, '');
  assert.equal(form.description, '');
  assert.equal(form.lostReason, '');
  assert.equal(form.notes, '');
  assert.equal(form.discountRate, '');
  assert.equal(form.travelManualAmount, '');
  assert.deepEqual(form.categories[0], {
    role: '',
    qty: '',
    rate: '',
    date: '',
    start: '',
    end: '',
    uniform: '',
  });
  assert.deepEqual(form.eventDays[0], {
    date: '',
    location: '',
    guestsCount: '',
    startTime: '',
    endTime: '',
  });
  assert.deepEqual(form.externalCosts[0], {
    type: '',
    supplier: '',
    description: '',
    costAmount: '',
    marginPercent: '',
  });
  assert.deepEqual(form.travelCars[0], {
    label: '',
    km: '',
    kmRate: '',
    durationHours: '',
    travelPeople: '',
    travelStaffHourlyRate: '',
  });
});
