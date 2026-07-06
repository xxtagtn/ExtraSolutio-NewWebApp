import { hasAnyPermission, hasPermission } from './accessPermissions.js';

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  MANAGEMENT: 'management',
  FINANCE: 'finance',
  OPERATIONS: 'operations',
});

export const roleLabels = {
  [ROLES.ADMIN]: 'Administrador',
  [ROLES.MANAGEMENT]: 'Gestão',
  [ROLES.FINANCE]: 'Financeiro',
  [ROLES.OPERATIONS]: 'Operacional',
  user: 'Operacional',
};

export const roleOptions = [
  { value: ROLES.ADMIN, label: roleLabels[ROLES.ADMIN] },
  { value: ROLES.MANAGEMENT, label: roleLabels[ROLES.MANAGEMENT] },
  { value: ROLES.FINANCE, label: roleLabels[ROLES.FINANCE] },
  { value: ROLES.OPERATIONS, label: roleLabels[ROLES.OPERATIONS] },
];

export function normalizeRole(role) {
  if (role === 'user') return ROLES.OPERATIONS;
  return Object.values(ROLES).includes(role) ? role : ROLES.OPERATIONS;
}

export function canAccessRole(user, allowedRoles = []) {
  const role = normalizeRole(user?.role);
  if (role === ROLES.ADMIN) return true;
  return allowedRoles.map(normalizeRole).includes(role);
}

export const ROLE_GROUPS = {
  admin: [ROLES.ADMIN],
  management: [ROLES.MANAGEMENT],
  finance: [ROLES.MANAGEMENT, ROLES.FINANCE],
  operations: [ROLES.MANAGEMENT, ROLES.OPERATIONS],
  commercial: [ROLES.MANAGEMENT],
};

export { hasAnyPermission, hasPermission };
