import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  STAFF_ACCEPTED_VALIDATION_STATUS,
  hoursValidationState,
  validationStatusAfterClientImport,
  validationPersistenceFields,
} from './hourValidationStatus.js';

test('shows a validated state when status, staff and client times are complete', () => {
  assert.deepEqual(hoursValidationState({
    validationStatus: 'validated',
    checkIn: '09:00',
    checkOut: '17:00',
    clientCheckIn: '09:00',
    clientCheckOut: '17:00',
  }), {
    isValidated: true,
    tone: 'success',
    label: 'Horas validadas',
  });
});

test('does not trust a legacy validated status while client times are missing', () => {
  assert.deepEqual(hoursValidationState({
    validationStatus: 'validated',
    checkIn: '09:00',
    checkOut: '17:00',
  }), {
    isValidated: false,
    tone: 'info',
    label: 'Por validar',
  });
});

test('shows waiting for client only after staff validation is accepted', () => {
  assert.deepEqual(hoursValidationState({
    validationStatus: STAFF_ACCEPTED_VALIDATION_STATUS,
    checkIn: '09:00',
    checkOut: '17:00',
  }), {
    isValidated: false,
    tone: 'info',
    label: 'Aguardar Cliente',
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

test('clears accepted validation when client times are removed', () => {
  assert.deepEqual(validationPersistenceFields({
    checkIn: '09:00',
    checkOut: '17:00',
    clientCheckIn: '',
    clientCheckOut: '',
    validatedCheckIn: '09:00',
    validatedCheckOut: '17:00',
    validationStatus: 'validated',
  }, 'auto', 'matched'), {
    validatedCheckIn: null,
    validatedCheckOut: null,
    validationStatus: 'pending',
  });
});

test('keeps a staff accepted row waiting for client when client times are cleared', () => {
  assert.deepEqual(validationPersistenceFields({
    checkIn: '09:00',
    checkOut: '17:00',
    clientCheckIn: '',
    clientCheckOut: '',
    validationStatus: STAFF_ACCEPTED_VALIDATION_STATUS,
  }, 'auto', 'pending'), {
    validatedCheckIn: null,
    validatedCheckOut: null,
    validationStatus: STAFF_ACCEPTED_VALIDATION_STATUS,
  });
});

test('clears accepted validation when corrected client times no longer match it', () => {
  assert.deepEqual(validationPersistenceFields({
    checkIn: '09:00',
    checkOut: '17:00',
    clientCheckIn: '09:15',
    clientCheckOut: '17:00',
    validatedCheckIn: '09:00',
    validatedCheckOut: '17:00',
    validationStatus: 'validated',
  }, 'auto', 'pending'), {
    validatedCheckIn: null,
    validatedCheckOut: null,
    validationStatus: 'pending',
  });
});

test('accepts complete client times as the validated values', () => {
  assert.deepEqual(validationPersistenceFields({
    checkIn: '09:00',
    checkOut: '17:00',
    clientCheckIn: '09:15',
    clientCheckOut: '17:00',
  }, 'validated', 'pending'), {
    validatedCheckIn: '09:15',
    validatedCheckOut: '17:00',
    validationStatus: 'validated',
  });
});

test('accepts staff times without validating client times', () => {
  assert.deepEqual(validationPersistenceFields({
    checkIn: '09:00',
    checkOut: '17:00',
  }, STAFF_ACCEPTED_VALIDATION_STATUS, 'pending'), {
    validatedCheckIn: null,
    validatedCheckOut: null,
    validationStatus: STAFF_ACCEPTED_VALIDATION_STATUS,
  });
});

test('client Excel import preserves Staff acceptance but reopens Client validation', () => {
  assert.equal(
    validationStatusAfterClientImport(STAFF_ACCEPTED_VALIDATION_STATUS),
    STAFF_ACCEPTED_VALIDATION_STATUS,
  );
  assert.equal(validationStatusAfterClientImport('validated'), STAFF_ACCEPTED_VALIDATION_STATUS);
  assert.equal(validationStatusAfterClientImport('pending'), 'pending');
  assert.equal(validationStatusAfterClientImport('reopened'), 'reopened');
});
