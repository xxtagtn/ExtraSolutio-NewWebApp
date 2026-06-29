import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildBudgetConversionDraft,
  buildEventPayloadFromBudgetConversion,
} from './budgetConversion.js';

test('builds an editable event draft from a budget without forcing optional fields', () => {
  const draft = buildBudgetConversionDraft({
    reference: 'ORC-0101',
    clientId: 7,
    companyName: 'BLACK',
    eventType: 'Corporate',
    eventDate: '2026-07-12T00:00:00.000Z',
    categories: '[]',
    totalAmount: 284,
    travelType: 'none',
  });

  assert.equal(draft.clientId, '7');
  assert.equal(draft.clientLabel, 'BLACK');
  assert.equal(draft.name, 'Corporate - BLACK');
  assert.equal(draft.date, '2026-07-12');
  assert.equal(draft.endDate, '');
  assert.equal(draft.location, '');
  assert.equal(draft.startTime, '');
  assert.equal(draft.endTime, '');
  assert.equal(draft.status, 'drafting');
  assert.deepEqual(draft.requiredRoles, []);

  const payload = buildEventPayloadFromBudgetConversion(draft, 7);

  assert.equal(payload.clientId, 7);
  assert.equal(payload.status, 'drafting');
  assert.equal(payload.billingStatus, 'pending');
  assert.equal(payload.notes, '[BUDGET_REF:ORC-0101]');
  assert.equal(payload.totalRevenue, 284);
  assert.equal(payload.travelExpenseEnabled, false);
  assert.deepEqual(payload.requiredRoles, []);
});

test('passes adjudicated budget total with cents to the converted event payload', () => {
  const draft = buildBudgetConversionDraft({
    reference: 'ORC-0102',
    companyName: 'BLACK',
    eventDate: '2026-07-12',
    totalAmount: '284,50€',
  });

  const payload = buildEventPayloadFromBudgetConversion(draft, 7);

  assert.equal(draft.totalRevenue, 284.5);
  assert.equal(payload.totalRevenue, 284.5);
});

test('does not invent an automatic staff travel rate when converting a kilometer budget', () => {
  const draft = buildBudgetConversionDraft({
    reference: 'ORC-0103',
    companyName: 'BLACK',
    eventDate: '2026-07-12',
    travelType: 'kilometers',
    travelPeople: 3,
    km: 100,
    kmRate: 0.4,
    durationHours: 2,
  });

  const payload = buildEventPayloadFromBudgetConversion(draft, 7);

  assert.equal(draft.travelStaffHourlyRate, 0);
  assert.equal(payload.travelStaffHourlyRate, 0);
  assert.equal(payload.travelExpenseAmount, 40);
});

test('preserves multiple budget travel cars when converting into an event', () => {
  const draft = buildBudgetConversionDraft({
    reference: 'ORC-0104',
    companyName: 'BLACK',
    eventDate: '2026-07-12',
    travelType: 'kilometers',
    travelCars: JSON.stringify([
      { label: 'Carro 1', km: 100, kmRate: 0.4, durationHours: 2, travelPeople: 3, travelStaffHourlyRate: 15 },
      { label: 'Carro 2', km: 60, kmRate: 0.4, durationHours: 1.5, travelPeople: 2, travelStaffHourlyRate: 10 },
    ]),
  });

  const payload = buildEventPayloadFromBudgetConversion(draft, 7);

  assert.equal(draft.travelCars.length, 2);
  assert.equal(payload.travelExpenseAmount, 184);
  assert.equal(payload.travelCars.length, 2);
});

test('preserves multi-day budget dates, role quantities and client rates for conversion', () => {
  const draft = buildBudgetConversionDraft({
    reference: 'ORC-0202',
    companyName: 'Casa Oeiras',
    eventType: 'Casamento',
    paymentPlan: JSON.stringify([
      { date: '2026-09-04', startTime: '18:00', endTime: '23:00', guestsCount: 80, location: 'Palacio' },
      { date: '2026-09-01', startTime: '09:00', endTime: '13:00', guestsCount: 30, location: 'Quinta' },
    ]),
    categories: JSON.stringify([
      { role: 'Barman', qty: 2, date: '2026-09-04', start: '18:00', end: '23:00', uniform: 'Camisa Preta', rate: '10,50' },
      { role: 'Emp.Mesa', qty: 4, date: '2026-09-01', start: '09:00', end: '13:00', uniform: 'Camisa Preta', rate: 12 },
    ]),
    travelType: 'manual',
    travelAmount: '35,00',
  });

  assert.equal(draft.isContinuous, true);
  assert.equal(draft.date, '2026-09-01');
  assert.equal(draft.endDate, '2026-09-04');
  assert.equal(draft.location, 'Quinta');
  assert.equal(draft.guestsCount, 30);
  assert.equal(draft.startTime, '09:00');
  assert.equal(draft.endTime, '13:00');
  assert.equal(draft.uniform, 'Camisa Preta');
  assert.equal(draft.travelType, 'manual');
  assert.equal(draft.travelManualAmount, 35);

  const payload = buildEventPayloadFromBudgetConversion(draft, 11);

  assert.equal(payload.isContinuous, true);
  assert.equal(payload.date, '2026-09-01');
  assert.equal(payload.endDate, '2026-09-04');
  assert.equal(payload.travelExpenseEnabled, true);
  assert.equal(payload.travelExpenseAmount, 35);
  assert.equal(payload.requiredRoles.length, 2);
  assert.deepEqual(payload.requiredRoles[0], {
    role: 'Barman',
    qty: 2,
    agreedRate: 10.5,
    day: '2026-09-04',
    start: '18:00',
    end: '23:00',
  });
});

test('preserves external partner costs when converting a budget into an event', () => {
  const draft = buildBudgetConversionDraft({
    reference: 'ORC-0301',
    companyName: 'BLACK',
    eventDate: '2026-07-12',
    totalAmount: 225,
    externalCosts: JSON.stringify([
      {
        type: 'Catering',
        supplier: 'Parceiro A',
        description: 'Menu volante',
        costAmount: '100,00',
        marginPercent: '20',
      },
    ]),
  });

  assert.equal(draft.externalCosts.length, 1);
  assert.equal(draft.externalCosts[0].chargeAmount, 120);
  assert.equal(draft.externalCosts[0].marginAmount, 20);

  const payload = buildEventPayloadFromBudgetConversion(draft, 7);

  assert.equal(payload.externalCosts.length, 1);
  assert.equal(payload.externalCosts[0].supplier, 'Parceiro A');
  assert.equal(payload.externalCosts[0].chargeAmount, 120);
});
