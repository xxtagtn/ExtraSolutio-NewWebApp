import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  birthdayNotification,
  birthdaysByDayForMonth,
  birthdaysOnDate,
} from './birthdays.js';

const collaborators = [
  { id: 1, shortName: 'João Silva', name: 'João Miguel Silva', birthDate: '1990-06-19' },
  { id: 2, shortName: 'Maria Santos', name: 'Maria Santos', birthDate: '1988-06-19T00:00:00.000Z' },
  { id: 3, shortName: 'Pedro Costa', name: 'Pedro Costa', birthDate: '1995-06-22' },
  { id: 4, shortName: 'Sem Data', name: 'Sem Data', birthDate: null },
];

test('finds annual birthdays and calculates the age completed', () => {
  assert.deepEqual(birthdaysOnDate(collaborators, new Date(2026, 5, 19)), [
    { collaboratorId: 1, name: 'João Silva', age: 36 },
    { collaboratorId: 2, name: 'Maria Santos', age: 38 },
  ]);
});

test('groups birthdays by calendar day for the selected month', () => {
  const result = birthdaysByDayForMonth(collaborators, 2026, 5);

  assert.equal(result.get(19).length, 2);
  assert.deepEqual(result.get(22), [
    { collaboratorId: 3, name: 'Pedro Costa', age: 31 },
  ]);
});

test('creates one daily birthday notification with a yearly key', () => {
  assert.deepEqual(birthdayNotification(collaborators, new Date(2026, 5, 19)), {
    id: 'birthdays-2026-06-19',
    kind: 'birthday',
    title: '🎂 Hoje fazem anos',
    subtitle: 'João Silva e Maria Santos',
    dueDate: new Date(2026, 5, 19),
  });
});

test('does not create a birthday notification when nobody has a birthday', () => {
  assert.equal(birthdayNotification(collaborators, new Date(2026, 5, 20)), null);
});

test('shows a leap-day birthday on the last day of February in non-leap years', () => {
  const leapDayCollaborator = [
    { id: 5, shortName: 'Ana', birthDate: '2000-02-29' },
  ];

  assert.deepEqual(birthdaysOnDate(leapDayCollaborator, new Date(2026, 1, 28)), [
    { collaboratorId: 5, name: 'Ana', age: 26 },
  ]);
});
