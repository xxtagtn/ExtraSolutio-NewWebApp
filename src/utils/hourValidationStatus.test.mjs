import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hoursValidationState } from './hourValidationStatus.js';

test('shows a validated state only when the persisted validation status is validated', () => {
  assert.deepEqual(hoursValidationState({ validationStatus: 'validated' }), {
    isValidated: true,
    tone: 'success',
    label: 'Horas validadas',
  });
});

test('shows a pending state for reopened validations', () => {
  assert.deepEqual(hoursValidationState({ validationStatus: 'reopened' }), {
    isValidated: false,
    tone: 'info',
    label: 'Por validar',
  });
});

test('shows a pending state when no validation status exists', () => {
  assert.deepEqual(hoursValidationState({}), {
    isValidated: false,
    tone: 'info',
    label: 'Por validar',
  });
});
