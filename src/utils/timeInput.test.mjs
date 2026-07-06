import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isCompleteTimeInput,
  normalizeTimeInput,
  sanitizeTimeInput,
} from './timeInput.js';

test('completes hour-only values with zero minutes', () => {
  assert.equal(normalizeTimeInput('14'), '14:00');
  assert.equal(normalizeTimeInput('9'), '09:00');
  assert.equal(normalizeTimeInput('18'), '18:00');
});

test('keeps complete valid times unchanged and normalizes compact values', () => {
  assert.equal(normalizeTimeInput('18:35'), '18:35');
  assert.equal(normalizeTimeInput('1430'), '14:30');
  assert.equal(normalizeTimeInput('1019'), '10:19');
  assert.equal(normalizeTimeInput('830'), '08:30');
  assert.equal(normalizeTimeInput('930'), '09:30');
  assert.equal(normalizeTimeInput('8:5'), '08:50');
});

test('validates the final HH:MM format and clock range', () => {
  assert.equal(isCompleteTimeInput('14:00'), true);
  assert.equal(isCompleteTimeInput('9:00'), false);
  assert.equal(isCompleteTimeInput('24:00'), false);
  assert.equal(isCompleteTimeInput('14:75'), false);
});

test('sanitizes time drafts while the user is typing', () => {
  assert.equal(sanitizeTimeInput('14h30'), '1430');
  assert.equal(sanitizeTimeInput('09:05 extra'), '09:05');
});
