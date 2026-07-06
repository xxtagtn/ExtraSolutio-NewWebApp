import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PERMISSIONS,
  allPermissionKeys,
  effectivePermissionsForUser,
  hasPermission,
  normalizePermissionList,
  parsePermissionOverrides,
  permissionsForRole,
} from './accessPermissions.js';

test('administrador tem todas as permissões disponíveis', () => {
  const permissions = effectivePermissionsForUser({ role: 'admin' });
  assert.equal(permissions.length, allPermissionKeys.length);
  assert.equal(hasPermission({ role: 'admin' }, PERMISSIONS.ADMIN_MANAGE_PERMISSIONS), true);
});

test('perfil financeiro vê valores financeiros mas não gere permissões', () => {
  const permissions = permissionsForRole('finance');
  assert.equal(permissions.includes(PERMISSIONS.FINANCE_VIEW_VALUES), true);
  assert.equal(permissions.includes(PERMISSIONS.ADMIN_MANAGE_PERMISSIONS), false);
});

test('permissões efetivas aplicam perfil e exceções do utilizador', () => {
  const user = {
    role: 'operations',
    accessProfile: {
      permissions: JSON.stringify([PERMISSIONS.SERVICES_VIEW, PERMISSIONS.TIME_VALIDATION_VIEW]),
    },
    permissionOverrides: JSON.stringify({
      allow: [PERMISSIONS.CLIENTS_VIEW],
      deny: [PERMISSIONS.TIME_VALIDATION_VIEW],
    }),
  };

  const permissions = effectivePermissionsForUser(user);
  assert.deepEqual(permissions.sort(), [PERMISSIONS.CLIENTS_VIEW, PERMISSIONS.SERVICES_VIEW].sort());
});

test('normalização ignora permissões desconhecidas e remove duplicados', () => {
  assert.deepEqual(
    normalizePermissionList([PERMISSIONS.CLIENTS_VIEW, 'invalid.permission', PERMISSIONS.CLIENTS_VIEW]),
    [PERMISSIONS.CLIENTS_VIEW],
  );
});

test('parsePermissionOverrides aceita JSON inválido sem rebentar', () => {
  assert.deepEqual(parsePermissionOverrides('{bad json'), { allow: [], deny: [] });
});

test('admin ignores stale permissions stored in the auth token', () => {
  const staleAdmin = {
    role: 'admin',
    permissions: [PERMISSIONS.COMMUNICATION_VIEW],
  };

  assert.equal(hasPermission(staleAdmin, PERMISSIONS.COMMUNICATION_MANAGE_QR_CODES), true);
});
