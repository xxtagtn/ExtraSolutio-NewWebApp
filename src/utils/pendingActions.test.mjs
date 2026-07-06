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
      { id: 4, shortName: 'Ana Silva', documentType: 'passport', documentExpiry: '2026-07-01T00:00:00.000Z', status: 'active' },
      { id: 5, shortName: 'Joao', documentExpiry: '2026-11-01T00:00:00.000Z', status: 'active' },
    ],
  }, { today });

  assert.deepEqual(actions.map((action) => action.id), ['collaborator-document-4']);
  assert.equal(actions[0].tone, 'danger');
  assert.equal(actions[0].category, 'Documentos');
  assert.equal(actions[0].origin, 'Ana Silva');
  assert.equal(actions[0].to, '/collaborators?collaboratorId=4&section=documents');
  assert.deepEqual(actions[0].details, [
    { label: 'Colaborador', value: 'Ana Silva' },
    { label: 'Documento', value: 'Passaporte' },
    { label: 'Validade', value: '01/07/2026 (faltam 25 dias)' },
  ]);
});

test('labels residence title documents in pending actions', () => {
  const actions = buildPendingActions({
    collaborators: [
      { id: 6, shortName: 'Vidal Silva', documentType: 'residence_title', documentExpiry: '2026-06-20T00:00:00.000Z', status: 'active' },
    ],
  }, { today });

  assert.equal(actions[0].details.find((item) => item.label === 'Documento').value, 'Título de Residência');
});

test('adds client and service context to billing actions', () => {
  const actions = buildPendingActions({
    services: [
      {
        id: 90,
        name: 'Restaurante Luz Chakall',
        status: 'finalized',
        date: '2026-06-04',
        totalRevenue: 2592.9,
        billingStatus: 'invoiced',
        client: { name: 'SSH - Supreme Sport Hospitality', paymentTerm: 'immediate' },
        assignments: [{ id: 901, status: 'confirmed', validationStatus: 'validated' }],
      },
      {
        id: 91,
        name: 'Casa Oeiras',
        status: 'finalized',
        date: '2026-06-05',
        totalRevenue: 565.25,
        billingStatus: 'pending',
        client: { name: 'BLACK' },
        assignments: [{ id: 902, status: 'confirmed', validationStatus: 'validated' }],
      },
    ],
  }, { today });

  const payment = actions.find((action) => action.id === 'service-billing-90');
  assert.equal(payment.title, 'Pagamento de cliente pendente');
  assert.equal(payment.origin, 'SSH - Supreme Sport Hospitality');
  assert.equal(payment.to, '/finance?area=clients&eventId=90');
  assert.deepEqual(payment.details, [
    { label: 'Cliente', value: 'SSH - Supreme Sport Hospitality' },
    { label: 'Evento', value: 'Restaurante Luz Chakall' },
    { label: 'Valor', value: '2.592,90 €' },
    { label: 'Vencimento', value: 'Ontem (05/06/2026)' },
  ]);

  const billing = actions.find((action) => action.id === 'service-billing-91');
  assert.equal(billing.title, 'Serviço pronto para faturar');
  assert.equal(billing.origin, 'BLACK');
  assert.equal(billing.to, '/services/91');
  assert.deepEqual(billing.details, [
    { label: 'Cliente', value: 'BLACK' },
    { label: 'Evento', value: 'Casa Oeiras' },
    { label: 'Valor a faturar', value: '565,25 €' },
  ]);
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
        status: 'finalized',
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
        status: 'finalized',
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
  const action = buildPendingActions(data, { today: new Date('2026-06-30') }).find((item) => item.id === 'service-billing-group-7-monthly-2026-06-30');
  assert.ok(action);
  assert.equal(new Date(action.dueDate).getDate(), 30);
});

test('groups monthly ready-to-bill services into one client period action', () => {
  const actions = buildPendingActions({
    services: [
      {
        id: 71,
        name: 'SSH 10 Junho',
        status: 'finalized',
        date: '2026-06-10',
        totalRevenue: 600,
        billingStatus: 'pending',
        client: { id: 7, name: 'SSH - Supreme Sport Hospitality', billingMethod: 'monthly', paymentTerm: 'days_30' },
        assignments: [{ id: 710, status: 'confirmed', validationStatus: 'validated' }],
      },
      {
        id: 72,
        name: 'SSH 20 Junho',
        status: 'finalized',
        date: '2026-06-20',
        totalRevenue: 400,
        billingStatus: 'pending',
        client: { id: 7, name: 'SSH - Supreme Sport Hospitality', billingMethod: 'monthly', paymentTerm: 'days_30' },
        assignments: [{ id: 720, status: 'confirmed', validationStatus: 'validated' }],
      },
    ],
  }, { today: new Date('2026-06-30') });

  const grouped = actions.find((action) => action.id === 'service-billing-group-7-monthly-2026-06-30');
  assert.ok(grouped);
  assert.equal(grouped.to, '/finance?area=clients&clientId=7&eventId=71&eventIds=71,72');
  assert.equal(actions.some((action) => action.id === 'service-billing-71'), false);
  assert.equal(actions.some((action) => action.id === 'service-billing-72'), false);
  assert.equal(grouped.title, 'Período pronto para faturar');
  assert.deepEqual(grouped.details, [
    { label: 'Cliente', value: 'SSH - Supreme Sport Hospitality' },
    { label: 'Período', value: 'junho de 2026' },
    { label: 'Eventos', value: '2 serviço(s)' },
    { label: 'Valor a faturar', value: '1.000,00 €' },
  ]);
});

test('uses the client prepayment rule when remaining payment date is missing', () => {
  const actions = buildPendingActions({
    services: [
      {
        id: 73,
        name: 'Casa Particular',
        status: 'team_complete',
        date: '2026-06-20',
        totalRevenue: 700,
        billingStatus: 'partial70',
        client: {
          name: 'Cliente Particular',
          billingMethod: 'prepaid',
          prepaymentRemainingDaysBefore: 7,
        },
      },
    ],
  }, { today: new Date('2026-06-13') });

  const action = actions.find((item) => item.id === 'service-remaining-payment-73');
  assert.ok(action);
  assert.equal(new Date(action.dueDate).toISOString().slice(0, 10), '2026-06-13');
  assert.deepEqual(action.details, [
    { label: 'Cliente', value: 'Cliente Particular' },
    { label: 'Evento', value: 'Casa Particular' },
    { label: 'Valor', value: '700,00 €' },
    { label: 'Vencimento', value: 'Hoje (13/06/2026)' },
  ]);
});

test('creates staff reminder actions for confirmed shifts starting in the next 24 hours', () => {
  const actions = buildPendingActions({
    services: [
      {
        id: 80,
        name: 'Jantar Corporate',
        status: 'team_complete',
        date: '2026-06-07',
        startTime: '09:00',
        client: { name: 'Hotel X' },
        assignments: [
          {
            id: 800,
            assignmentDate: '2026-06-07',
            plannedStartTime: '09:00',
            status: 'confirmed',
            collaborator: { shortName: 'Ana' },
          },
          {
            id: 801,
            assignmentDate: '2026-06-07',
            plannedStartTime: '09:00',
            status: 'awaiting_confirmation',
            collaborator: { shortName: 'Marta' },
          },
        ],
      },
    ],
  }, { today: new Date('2026-06-06T12:00:00.000Z') });

  const reminder = actions.find((action) => action.id === 'staff-reminder-80-2026-06-07-09:00');
  assert.ok(reminder);
  assert.equal(reminder.title, 'Enviar lembrete 24h ao staff');
  assert.equal(reminder.buttonLabel, 'Preparar');
  assert.equal(reminder.to, '/services/80?tab=collaborators');
  assert.deepEqual(reminder.details, [
    { label: 'Cliente', value: 'Hotel X' },
    { label: 'Evento', value: 'Jantar Corporate' },
    { label: 'Turno', value: '07/06/2026 09:00' },
    { label: 'Colaboradores', value: '1 confirmado(s)' },
  ]);
});

test('does not create staff reminder actions outside the next 24 hours', () => {
  const actions = buildPendingActions({
    services: [
      {
        id: 81,
        name: 'Evento distante',
        status: 'team_complete',
        date: '2026-06-08',
        startTime: '18:00',
        client: { name: 'BLACK' },
        assignments: [
          { id: 810, assignmentDate: '2026-06-08', plannedStartTime: '18:00', status: 'confirmed' },
        ],
      },
    ],
  }, { today: new Date('2026-06-06T12:00:00.000Z') });

  assert.equal(actions.some((action) => action.id.startsWith('staff-reminder-81')), false);
});
