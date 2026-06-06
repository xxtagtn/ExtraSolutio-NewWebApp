export function hoursValidationState(assignment = {}) {
  const isValidated = assignment.validationStatus === 'validated';
  return {
    isValidated,
    tone: isValidated ? 'success' : 'info',
    label: isValidated ? 'Horas validadas' : 'Por validar',
  };
}
