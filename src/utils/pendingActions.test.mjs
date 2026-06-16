import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPendingActions, groupPendingActions } from './pendingActions.js';

const today = new Date('2026-06-06T10:00:00.000Z');

test('detects urgent operational and validation actions from services', () => {
  const actions = buildPendingActions({
    services: [
      {
        id: 10,
        name: 'Casa Oeiras',
        date: '2026-06-07T09:00:00.000Z',
        startTime: '09:00',
        client: { name: 'BLACK' },
        requiredRoles: JSON.stringify([{ role: 'Barman', qty: 2 }]),
        assignments: [{ id: 1, role: 'Barman', status: 'confirmed', validationStatus: 'pending' }],
        billingStatus: 'pending',
        status: 'drafting',
        totalRevenue: 120,
      },
      {
        id: 11,
        name: 'FIC',
        date: '2026-06-05T18:00:00.000Z',
        client: { name: 'FIC' },
        requiredRoles: JSON.stringify([{ role: 'Emp.Mesa', qty: 1 }]),
        assignments: [{ id: 2, role: 'Emp.Mesa', status: 'confirmed', validationStatus: 'pending', paymentStatus: 'unpaid' }],
        billingStatus: 'pending',
        status: 'to_validate_staff',
        totalRevenue: 90,
      },
      {
        id: 12,
        name: 'Evento validado',
        date: '2026-06-05T18:00:00.000Z',
        client: { name: 'FIC' },
        requiredRoles: JSON.stringify([{ role: 'Emp.Mesa', qty: 1 }]),
        assignments: [{ id: 3, role: 'Emp.Mesa', status: 'confirmed', validationStatus: 'validated', paymentStatus: 'unpaid' }],
        billingStatus: 'pending',
        status: 'finalized',
        totalRevenue: 90,
      },
    ],
  }, { today });

  assert.ok(actions.some((action) => action.id === 'service-team-10'));
  assert.ok(actions.some((action) => action.id === 'hours-validation-11'));
  assert.ok(actions.some((action) => action.id === 'service-billing-12'));
  assert.ok(actions.every((action) => action.to));
});

test('does not create team actions for finalized services', () => {
  const actions = buildPendingActions({
    services: [
      {
        id: 12,
        name: 'Evento arquivado',
        date: '2026-06-07T09:00:00.000Z',
        status: 'finalized',
        requiredRoles: JSON.stringify([{ role: 'Barman', qty: 2 }]),
        assignments: [],
      },
    ],
  }, { today });

  assert.equal(actions.some((action) => action.id === 'service-team-12'), false);
});

test('detects collaborator document expiry windows', () => {
  const actions = buildPendingActions({
    collaborators: [
      { id: 4, shortName: 'Ana Silva', documentExpiry: '2026-07-01T00:00:00.000Z', status: 'active' },
      { id: 5, shortName: 'Joao', documentExpiry: '2026-11-01T00:00:00.000Z', status: 'active' },
    ],
  }, { today });

  assert.deepEqual(actions.map((action) => action.id), ['collaborator-document-4']);
  assert.equal(actions[0].tone, 'danger');
  assert.equal(actions[0].category, 'Documentos');
});

test('detects budget follow-ups and overdue invoices', () => {
  const actions = buildPendingActions({
    budgets: [
      {
        id: 20,
        reference: 'ORC-20',
        companyName: 'Hotel X',
        status: 'sent',
        sentAt: '2026-06-01T00:00:00.000Z',
        followUpHistory: JSON.stringify([{ reminderDate: '2026-06-06', text: 'Ligar ao cliente' }]),
      },
    ],
    invoices: [
      {
        id: 30,
        number: 'FT 30',
        status: 'issued',
        dueDate: '2026-05-31T00:00:00.000Z',
        total: 500,
        client: { name: 'BLACK' },
      },
    ],
  }, { today });

  assert.ok(actions.some((action) => action.id === 'budget-followup-20-0'));
  assert.ok(actions.some((action) => action.id === 'invoice-overdue-30'));
});

test('ignores billing actions without a valid service date unless the event is finance ready', () => {
  const actions = buildPendingActions({
    services: [
      {
        id: 40,
        name: 'Evento incompleto',
        billingStatus: 'pending',
        totalRevenue: 200,
        assignments: [],
      },
    ],
  }, { today });

  assert.equal(actions.some((action) => action.id === 'service-billing-40'), false);
});

test('groups pending actions by operational urgency', () => {
  const groups = groupPendingActions([
    { id: 'later', title: 'Mais tarde', priority: 'low', dueDate: '2026-06-20' },
    { id: 'today', title: 'Hoje', priority: 'medium', dueDate: '2026-06-06' },
    { id: 'next', title: 'Amanha', priority: 'medium', dueDate: '2026-06-07' },
    { id: 'critical', title: 'Critico', priority: 'critical', dueDate: '2026-06-12' },
    { id: 'overdue', title: 'Atrasado', priority: 'high', dueDate: '2026-06-01' },
  ], today);

  assert.deepEqual(groups.map((group) => group.id), ['critical', 'today', 'next48h', 'later']);
  assert.deepEqual(groups[0].actions.map((action) => action.id), ['critical', 'overdue']);
  assert.deepEqual(groups[1].actions.map((action) => action.id), ['today']);
  assert.deepEqual(groups[2].actions.map((action) => action.id), ['next']);
  assert.deepEqual(groups[3].actions.map((action) => action.id), ['later']);
});

test('only shows staff payment actions inside the salary processing window', () => {
  const data = {
    services: [
      {
        id: 60,
        name: 'Evento Junho',
        date: '2026-06-21',
        client: { name: 'BLACK' },
        assignments: [{
          id: 600,
          status: 'confirmed',
          validationStatus: 'validated',
          paymentStatus: 'unpaid',
          collaborator: { shortName: 'Ana' },
        }],
        notes: '[EVENT_VALIDATED_HOURS] 2026-06-21',
      },
    ],
  };

  assert.equal(buildPendingActions(data, { today: new Date('2026-07-07') }).some((action) => action.id === 'staff-payment-600'), false);
  assert.equal(buildPendingActions(data, { today: new Date('2026-07-08') }).some((action) => action.id === 'staff-payment-600'), true);
  assert.equal(buildPendingActions(data, { today: new Date('2026-07-14') }).some((action) => action.id === 'staff-payment-600'), true);
  assert.equal(buildPendingActions(data, { today: new Date('2026-07-15') }).some((action) => action.id === 'staff-payment-600'), false);
});

test('waits for the client billing period before showing monthly billing actions', () => {
  const data = {
    services: [
      {
        id: 70,
        name: 'SSH Junho',
        date: '2026-06-10',
        totalRevenue: 600,
        billingStatus: 'pending',
        client: {
          id: 7,
          name: 'SSH - Supreme Sport Hospitality',
          billingMethod: 'monthly',
          paymentTerm: 'days_30',
        },
        assignments: [{
          id: 700,
          status: 'confirmed',
          validationStatus: 'validated',
        }],
      },
    ],
  };

  assert.equal(buildPendingActions(data, { today: new Date('2026-06-20') }).some((action) => action.id === 'service-billing-70'), false);
  const action = buildPendingActions(data, { today: new Date('2026-06-30') }).find((item) => item.id === 'service-billing-70');
  assert.ok(action);
  assert.equal(new Date(action.dueDate).getDate(), 30);
});
