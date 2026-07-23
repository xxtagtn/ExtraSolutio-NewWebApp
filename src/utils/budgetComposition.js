import { normalizeExternalCosts } from './externalCosts.js';

export const BUDGET_COMPOSITION_ERROR = 'Adiciona pelo menos uma função de Staff ou um custo externo com valor.';

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function hasBudgetStaff(categories = []) {
  return parseList(categories).some((item) => (
    String(item?.role || '').trim()
    && Number(item?.qty || 0) > 0
  ));
}

export function hasBudgetExternalCosts(externalCosts = []) {
  return normalizeExternalCosts(externalCosts).some((item) => item.costAmount > 0);
}

export function isBudgetCompositionValid({ categories = [], externalCosts = [] } = {}) {
  return hasBudgetStaff(categories) || hasBudgetExternalCosts(externalCosts);
}
