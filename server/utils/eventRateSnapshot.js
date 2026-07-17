import { decimalValue } from '../../src/utils/serviceFinance.js';

function safeArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function roleKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function roleRateMap(value, rateField = 'agreedRate') {
  return new Map(safeArray(value).map((item) => [
    roleKey(item?.role),
    decimalValue(item?.[rateField] ?? item?.rate ?? item?.agreedRate) || 0,
  ]));
}

export function snapshotEventRoleRates(requiredRoles, clientRoleRates, existingRequiredRoles = [], {
  preserveExisting = true,
} = {}) {
  const clientRates = roleRateMap(clientRoleRates, 'rate');
  const existingRates = roleRateMap(existingRequiredRoles);

  return safeArray(requiredRoles).map((item) => {
    const role = String(item?.role || '').trim();
    const explicitRate = decimalValue(item?.agreedRate);
    const existingRate = preserveExisting ? existingRates.get(roleKey(role)) || 0 : 0;
    const clientRate = clientRates.get(roleKey(role)) || 0;
    return {
      ...item,
      role,
      agreedRate: explicitRate && explicitRate > 0
        ? explicitRate
        : existingRate || clientRate || null,
    };
  });
}

function historyRows(value) {
  return safeArray(value);
}

function rateChanges(previousRoles, nextRoles) {
  const previous = roleRateMap(previousRoles);
  const next = roleRateMap(nextRoles);
  const roleNames = new Map();
  for (const item of [...safeArray(previousRoles), ...safeArray(nextRoles)]) {
    if (item?.role) roleNames.set(roleKey(item.role), String(item.role).trim());
  }

  return [...new Set([...previous.keys(), ...next.keys()])]
    .map((key) => ({
      role: roleNames.get(key) || key,
      from: previous.get(key) || 0,
      to: next.get(key) || 0,
    }))
    .filter((item) => item.from !== item.to);
}

export function initialEventRateHistory(requiredRoles, at = new Date()) {
  const changes = rateChanges([], requiredRoles).filter((item) => item.to > 0);
  if (!changes.length) return null;
  return JSON.stringify([{ type: 'snapshot', at: at.toISOString(), changes }]);
}

export function appendEventRateHistory(history, previousRoles, nextRoles, at = new Date()) {
  const changes = rateChanges(previousRoles, nextRoles);
  if (!changes.length) return history || null;
  return JSON.stringify([
    ...historyRows(history),
    { type: 'manual_update', at: at.toISOString(), changes },
  ]);
}

