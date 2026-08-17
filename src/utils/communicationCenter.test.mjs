import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCommunicationCenter,
  communicationSummary,
  normalizePhoneForWaLink,
} from './communicationCenter.js';

const today = new Date('2026-07-02T10:00:00');

test('normalizes Portuguese mobile numbers for WhatsApp manual links', () => {
  assert.equal(normalizePhoneForWaLink('963 680 415'), '351963680415');
  assert.equal(normalizePhoneForWaLink('+351 963 680 415'), '351963680415');
  assert.equal(normalizePhoneForWaLink('00351 963 680 415'), '351963680415');
});

test('builds confirmation tasks for assigned staff with a prepared message', () => {
  const tasks = buildCommunicationCenter({
    services: [
      {
        id: 10,
        name: 'Restaurante Luz Chakall',
        date: '2026-07-03',
        startTime: '11:30',
        endTime: '16:00',
        uniform: 'Camisa Preta',
        location: 'Lisboa',
        client: { name: 'SSH' },
        assignments: [
          {
            id: 101,
            collaboratorId: 7,
            role: 'Emp.Mesa',
            status: 'pending_confirmation',
            plannedCheckIn: '11:30',
            plannedCheckOut: '16:00',
            collaborator: {
              id: 7,
              shortName: 'Ana Silva',
              name: 'Ana Carolina Silva',
              phone: '963 680 415',
            },
          },
        ],
      },
    ],
    communicationLogs: [],
  }, { today });

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].kind, 'confirmation');
  assert.equal(tasks[0].state, 'pending_contact');
  assert.equal(tasks[0].collaboratorName, 'Ana Silva');
  assert.equal(tasks[0].phone, '351963680415');
  assert.match(tasks[0].message, /Olá Ana Silva/);
  assert.match(tasks[0].message, /Restaurante Luz Chakall/);
  assert.match(tasks[0].message, /Uniforme: Camisa Preta/);
  assert.match(tasks[0].whatsappUrl, /^https:\/\/wa\.me\/351963680415\?text=/);
});

test('uses the latest communication log as the visible state', () => {
  const tasks = buildCommunicationCenter({
    services: [
      {
        id: 10,
        name: 'Restaurante Luz Chakall',
        date: '2026-07-03',
        assignments: [
          {
            id: 101,
            collaboratorId: 7,
            role: 'Barman',
            status: 'pending_confirmation',
            collaborator: { id: 7, shortName: 'Ana Silva', name: 'Ana Carolina Silva', phone: '963680415' },
          },
        ],
      },
    ],
    communicationLogs: [
      { id: 1, assignmentId: 101, type: 'confirmation', status: 'sent', createdAt: '2026-07-02T09:00:00' },
      { id: 2, assignmentId: 101, type: 'confirmation', status: 'responded', createdAt: '2026-07-02T10:00:00' },
    ],
  }, { today });

  assert.equal(tasks[0].state, 'responded');
  assert.equal(tasks[0].latestLog.id, 2);
});

test('creates reminder tasks for confirmed shifts in the next 24 hours', () => {
  const tasks = buildCommunicationCenter({
    services: [
      {
        id: 20,
        name: 'Embaixada',
        date: '2026-07-03',
        startTime: '09:00',
        endTime: '13:00',
        client: { name: 'Embaixada' },
        assignments: [
          {
            id: 201,
            collaboratorId: 8,
            role: 'Barman',
            status: 'confirmed',
            collaborator: { id: 8, shortName: 'João Costa', name: 'João Costa', phone: '912345678' },
          },
        ],
      },
    ],
    communicationLogs: [],
  }, { today });

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].kind, 'reminder_24h');
  assert.equal(tasks[0].state, 'ready');
  assert.match(tasks[0].message, /lembramos que tens serviço/);
  assert.match(tasks[0].message, /Informa a equipa ExtraSolutio, caso não consigas\./);
});

test('summarizes communication workload by state', () => {
  const tasks = [
    { state: 'pending_contact' },
    { state: 'sent' },
    { state: 'sent' },
    { state: 'responded' },
    { state: 'confirmed' },
  ];

  assert.deepEqual(communicationSummary(tasks), {
    total: 5,
    pendingContact: 1,
    sent: 2,
    responded: 1,
    confirmed: 1,
    unavailable: 0,
  });
});
