import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessTimeTolerance, resolvePlannedTimes } from './timeTolerance.js';

test('marks equal staff and client times inside tolerance', () => {
  assert.deepEqual(assessTimeTolerance({
    checkIn: '17:34',
    checkOut: '21:33',
    clientCheckIn: '17:34',
    clientCheckOut: '21:33',
  }), {
    tone: 'success',
    label: 'Dentro da tolerância',
    diffMinutes: 0,
    entryDiffMinutes: 0,
    exitDiffMinutes: 0,
    detail: 'Entrada: 0 min · Saída: 0 min',
    isDifference: false,
    needsAttention: false,
  });
});

test('shows the real entry and exit differences between staff and client', () => {
  const result = assessTimeTolerance({
    checkIn: '17:34',
    checkOut: '21:33',
    clientCheckIn: '17:40',
    clientCheckOut: '21:20',
  });

  assert.equal(result.tone, 'success');
  assert.equal(result.entryDiffMinutes, 6);
  assert.equal(result.exitDiffMinutes, 13);
  assert.equal(result.diffMinutes, 13);
  assert.equal(result.detail, 'Entrada: 6 min · Saída: 13 min');
  assert.equal(result.isDifference, false);
});

test('ignores planned times when staff and client times are equal', () => {
  const result = assessTimeTolerance({
    plannedCheckIn: '11:30',
    plannedCheckOut: '17:34',
    checkIn: '21:33',
    checkOut: '23:00',
    clientCheckIn: '21:33',
    clientCheckOut: '23:00',
  });

  assert.equal(result.tone, 'success');
  assert.equal(result.entryDiffMinutes, 0);
  assert.equal(result.exitDiffMinutes, 0);
  assert.equal(result.diffMinutes, 0);
});

test('identifies a difference only at entry', () => {
  const result = assessTimeTolerance({
    checkIn: '11:30',
    checkOut: '16:00',
    clientCheckIn: '12:00',
    clientCheckOut: '16:00',
  });

  assert.equal(result.tone, 'warning');
  assert.equal(result.detail, 'Entrada: 30 min');
});

test('identifies a difference only at exit', () => {
  const result = assessTimeTolerance({
    checkIn: '11:30',
    checkOut: '16:00',
    clientCheckIn: '11:30',
    clientCheckOut: '17:10',
  });

  assert.equal(result.tone, 'danger');
  assert.equal(result.detail, 'Saída: 70 min');
});

test('uses the shortest clock difference around midnight', () => {
  const result = assessTimeTolerance({
    checkIn: '23:55',
    checkOut: '02:00',
    clientCheckIn: '00:05',
    clientCheckOut: '02:00',
  });

  assert.equal(result.entryDiffMinutes, 10);
  assert.equal(result.tone, 'success');
});

test('waits for validation when staff or client times are incomplete', () => {
  assert.deepEqual(assessTimeTolerance({
    checkIn: '11:35',
    checkOut: '16:00',
    clientCheckIn: '11:30',
    clientCheckOut: '',
  }), {
    tone: 'info',
    label: 'Aguardar validação',
    diffMinutes: null,
    entryDiffMinutes: null,
    exitDiffMinutes: null,
    detail: '',
    isDifference: false,
    needsAttention: true,
  });
});

test('uses collaborator planned times before the general event schedule', () => {
  assert.deepEqual(resolvePlannedTimes({
    plannedCheckIn: '19:00',
    plannedCheckOut: '23:00',
  }, {
    startTime: '11:30',
    endTime: '16:00',
  }), {
    plannedCheckIn: '19:00',
    plannedCheckOut: '23:00',
  });

  assert.deepEqual(resolvePlannedTimes({}, {
    startTime: '11:30',
    endTime: '16:00',
  }), {
    plannedCheckIn: '11:30',
    plannedCheckOut: '16:00',
  });
});
