import { PERMISSIONS, hasPermission } from '../../src/utils/accessPermissions.js';

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  MANAGEMENT: 'management',
  FINANCE: 'finance',
  OPERATIONS: 'operations',
});

export const roleOptions = [
  { value: ROLES.ADMIN, label: 'Administrador' },
  { value: ROLES.MANAGEMENT, label: 'Gestão' },
  { value: ROLES.FINANCE, label: 'Financeiro' },
  { value: ROLES.OPERATIONS, label: 'Operacional' },
];

const ROLE_ALIASES = new Map([
  ['user', ROLES.OPERATIONS],
  ['gestao', ROLES.MANAGEMENT],
  ['gestão', ROLES.MANAGEMENT],
  ['financeiro', ROLES.FINANCE],
  ['operacional', ROLES.OPERATIONS],
]);

const validRoles = new Set(Object.values(ROLES));

export function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (validRoles.has(value)) return value;
  return ROLE_ALIASES.get(value) || ROLES.OPERATIONS;
}

export function canAccessRole(user, allowedRoles = []) {
  const role = normalizeRole(user?.role);
  if (role === ROLES.ADMIN) return true;
  return allowedRoles.map(normalizeRole).includes(role);
}

export function canViewSensitiveCollaboratorData(user) {
  return hasPermission(user, PERMISSIONS.COLLABORATORS_VIEW_SENSITIVE)
    || hasPermission(user, PERMISSIONS.CLIENTS_VIEW_SENSITIVE)
    || canAccessRole(user, [ROLES.MANAGEMENT, ROLES.FINANCE]);
}

export function canViewFinancialData(user) {
  return hasPermission(user, PERMISSIONS.FINANCE_VIEW_VALUES)
    || canAccessRole(user, [ROLES.MANAGEMENT, ROLES.FINANCE]);
}

export function publicRole(role) {
  return normalizeRole(role);
}
