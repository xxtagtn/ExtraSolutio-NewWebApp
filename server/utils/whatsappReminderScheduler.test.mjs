import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReminderTemplateMessage,
  evaluateReminderCandidate,
  eventStartInstant,
  processWhatsAppReminders,
  reminderDedupeKey,
} from './whatsappReminderScheduler.js';

function assignment(overrides = {}) {
  return {
    id: 501,
    eventId: 50,
    collaboratorId: 5,
    assignmentDate: new Date('2026-08-20T00:00:00.000Z'),
    plannedCheckIn: '18:00',
    plannedCheckOut: '23:00',
    status: 'confirmed',
    whatsappEnabled: true,
    role: 'Emp.Mesa',
    collaborator: { id: 5, name: 'Ana Silva', phone: '963680415' },
    event: {
      id: 50,
      name: 'Jantar Institucional',
      date: new Date('2026-08-20T00:00:00.000Z'),
      status: 'confirmed',
      location: 'Lisboa',
      cancelledDays: '[]',
      client: { name: 'Cliente' },
    },
    ...overrides,
  };
}

test('converts an event wall-clock time in Lisbon to the correct instant', () => {
  assert.equal(
    eventStartInstant('2026-08-20', '18:00', 'Europe/Lisbon').toISOString(),
    '2026-08-20T17:00:00.000Z',
  );
});

test('accepts only confirmed opted-in assignments inside the next 24 hours', () => {
  const now = new Date('2026-08-19T17:00:00.000Z');
  assert.equal(evaluateReminderCandidate(assignment(), { now }).eligible, true);
  assert.equal(evaluateReminderCandidate(assignment({ whatsappEnabled: false }), { now }).reason, 'disabled');
  assert.equal(evaluateReminderCandidate(assignment({ status: 'pending_confirmation' }), { now }).reason, 'not_confirmed');
  assert.equal(evaluateReminderCandidate(assignment({
    event: { ...assignment().event, cancelledDays: '["2026-08-20"]' },
  }), { now }).reason, 'day_cancelled');
});

test('uses one dedupe key per collaborator and service day', () => {
  assert.equal(reminderDedupeKey(assignment()), 'whatsapp_reminder_24h:collaborator:5:2026-08-20');
});

test('builds approved template variables in the configured order', () => {
  const message = buildReminderTemplateMessage(assignment(), {
    WHATSAPP_REMINDER_TEMPLATE_NAME: 'lembrete_servico_24h',
    WHATSAPP_REMINDER_LANGUAGE_CODE: 'pt_PT',
    WHATSAPP_REMINDER_TEMPLATE_FIELDS: 'collaborator,event,date,start,end,location,role',
  });
  assert.equal(message.to, '963680415');
  assert.equal(message.templateName, 'lembrete_servico_24h');
  assert.deepEqual(
    message.components[0].parameters.map((parameter) => parameter.text),
    ['Ana Silva', 'Jantar Institucional', '20/08/2026', '18:00', '23:00', 'Lisboa', 'Emp.Mesa'],
  );
});

test('uses all approved template variables by default', () => {
  const message = buildReminderTemplateMessage(assignment(), {});
  assert.deepEqual(
    message.components[0].parameters.map((parameter) => parameter.text),
    ['Ana Silva', 'Jantar Institucional', '20/08/2026', '18:00', '23:00', 'Lisboa', 'Emp.Mesa'],
  );
});

test('sends once and records the provider message id', async () => {
  const candidate = assignment();
  const createdLogs = [];
  const updatedLogs = [];
  const db = {
    eventAssignment: { findMany: async () => [candidate] },
    communicationLog: {
      findFirst: async () => null,
      create: async ({ data }) => {
        createdLogs.push(data);
        return { id: 900, ...data };
      },
      update: async ({ data }) => {
        updatedLogs.push(data);
        return data;
      },
    },
  };
  const sentMessages = [];
  const result = await processWhatsAppReminders({
    db,
    now: new Date('2026-08-19T17:00:00.000Z'),
    env: {},
    sendMessage: async ({ message }) => {
      sentMessages.push(message);
      return { messages: [{ id: 'wamid.test' }], contacts: [{ wa_id: '351963680415' }] };
    },
  });

  assert.deepEqual(result, { checked: 1, sent: 1, skipped: 0, failed: 0 });
  assert.equal(createdLogs[0].dedupeKey, 'whatsapp_reminder_24h:collaborator:5:2026-08-20');
  assert.equal(sentMessages.length, 1);
  assert.equal(updatedLogs[0].status, 'accepted');
  assert.match(updatedLogs[0].response, /wamid\.test/);
});

test('sends one automatic reminder containing all confirmed shifts for a collaborator on that day', async () => {
  const first = assignment();
  const second = assignment({
    id: 502,
    plannedCheckIn: '20:00',
    plannedCheckOut: '22:00',
  });
  const createdLogs = [];
  const sentMessages = [];
  const result = await processWhatsAppReminders({
    db: {
      eventAssignment: { findMany: async () => [first, second] },
      communicationLog: {
        findFirst: async () => null,
        create: async ({ data }) => { createdLogs.push(data); return { id: 901, ...data }; },
        update: async () => {},
      },
    },
    now: new Date('2026-08-19T17:00:00.000Z'),
    env: { WHATSAPP_REMINDER_TEMPLATE_FIELDS: 'event,date,start,end' },
    sendMessage: async ({ message }) => {
      sentMessages.push(message);
      return { messages: [{ id: 'wamid.daily' }] };
    },
  });

  assert.deepEqual(result, { checked: 2, sent: 1, skipped: 1, failed: 0 });
  assert.equal(createdLogs.length, 1);
  assert.equal(createdLogs[0].dedupeKey, 'whatsapp_reminder_24h:collaborator:5:2026-08-20');
  assert.match(createdLogs[0].message, /18:00 → 23:00/);
  assert.match(createdLogs[0].message, /20:00 → 22:00/);
  assert.equal(sentMessages.length, 1);
  assert.deepEqual(sentMessages[0].components[0].parameters.map((item) => item.text), [
    'Jantar Institucional', '20/08/2026', '18:00', '23:00; 20:00 → 22:00',
  ]);
});

test('does not send a second daily reminder when an earlier same-day shift already has an automatic log', async () => {
  let sends = 0;
  const result = await processWhatsAppReminders({
    db: {
      eventAssignment: {
        findMany: async () => [
          assignment({ plannedCheckIn: '09:00', plannedCheckOut: '13:00' }),
          assignment({ id: 502, plannedCheckIn: '17:00', plannedCheckOut: '22:00' }),
        ],
      },
      communicationLog: {
        findFirst: async () => ({ id: 800 }),
        create: async ({ data }) => ({ id: 901, ...data }),
        update: async () => {},
      },
    },
    now: new Date('2026-08-20T09:00:00.000Z'),
    sendMessage: async () => { sends += 1; return {}; },
  });

  assert.deepEqual(result, { checked: 2, sent: 0, skipped: 2, failed: 0 });
  assert.equal(sends, 0);
});

test('skips an already reserved reminder without sending again', async () => {
  const duplicate = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
  let sends = 0;
  const result = await processWhatsAppReminders({
    db: {
      eventAssignment: { findMany: async () => [assignment()] },
      communicationLog: {
      findFirst: async () => null,
        create: async () => { throw duplicate; },
        update: async () => {},
      },
    },
    now: new Date('2026-08-19T17:00:00.000Z'),
    sendMessage: async () => { sends += 1; },
  });

  assert.equal(result.skipped, 1);
  assert.equal(sends, 0);
});
