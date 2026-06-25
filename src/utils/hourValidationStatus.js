export function hoursValidationState(assignment = {}) {
  const staffComplete = Boolean(assignment.checkIn && assignment.checkOut);
  const clientComplete = Boolean(assignment.clientCheckIn && assignment.clientCheckOut);
  const isValidated = assignment.validationStatus === 'validated' && staffComplete && clientComplete;
  const waitingForClient = staffComplete && !clientComplete;
  return {
    isValidated,
    tone: isValidated ? 'success' : 'info',
    label: isValidated ? 'Horas validadas' : waitingForClient ? 'Aguardar Cliente' : 'Por validar',
  };
}

export function validationPersistenceFields(assignment = {}, mode = 'auto', automaticStatus = 'pending') {
  const staffComplete = Boolean(assignment.checkIn && assignment.checkOut);
  const clientComplete = Boolean(assignment.clientCheckIn && assignment.clientCheckOut);

  if (mode === 'validated' && staffComplete && clientComplete) {
    return {
      validatedCheckIn: assignment.clientCheckIn,
      validatedCheckOut: assignment.clientCheckOut,
      validationStatus: 'validated',
    };
  }

  const acceptedValuesStillMatch = clientComplete
    && assignment.validationStatus === 'validated'
    && assignment.validatedCheckIn === assignment.clientCheckIn
    && assignment.validatedCheckOut === assignment.clientCheckOut;

  if (mode === 'pending' || !staffComplete || !clientComplete || !acceptedValuesStillMatch) {
    return {
      validatedCheckIn: null,
      validatedCheckOut: null,
      validationStatus: mode === 'pending' || !staffComplete || !clientComplete
        ? 'pending'
        : automaticStatus,
    };
  }

  return {
    validatedCheckIn: assignment.validatedCheckIn,
    validatedCheckOut: assignment.validatedCheckOut,
    validationStatus: 'validated',
  };
}
