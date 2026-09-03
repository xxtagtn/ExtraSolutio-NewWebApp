import { activeEventAssignments } from './eventCancelledDays.js';
import { isBillableEventAssignment } from './eventFinancialRules.js';
import { requiredStaffTotal } from './serviceRequirements.js';

const euro = new Intl.NumberFormat('pt-PT', {
  style: 'currency',
  currency: 'EUR',
});

function numberValue(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function activeStaffCount(event = {}) {
  const assigned = activeEventAssignments(event, event.assignments || [])
    .filter((assignment) => assignment.collaboratorId && isBillableEventAssignment(assignment))
    .length;
  return Math.max(requiredStaffTotal(event), assigned);
}

export function eventFinancialImpactMessage(previous = {}, current = {}) {
  const previousStaff = activeStaffCount(previous);
  const currentStaff = activeStaffCount(current);
  const previousTotal = numberValue(previous.totalRevenue);
  const currentTotal = numberValue(current.totalRevenue);
  const difference = Number((currentTotal - previousTotal).toFixed(2));
  if (previousStaff === currentStaff && Math.abs(difference) < 0.005) return '';

  return [
    `Impacto financeiro: colaboradores ${previousStaff} -> ${currentStaff}.`,
    `Valor previsto ${euro.format(previousTotal)} -> ${euro.format(currentTotal)}.`,
    `Diferença ${difference > 0 ? '+' : ''}${euro.format(difference)}.`,
  ].join(' ');
}
