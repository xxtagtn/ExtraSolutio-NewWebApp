import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PERMISSIONS } from './accessPermissions.js';
import { visibleProfileMenuItems, visibleSidebarItems } from './appNavigation.js';

test('administração não aparece na barra lateral', () => {
  const items = visibleSidebarItems({ role: 'admin' });

  assert.equal(items.some((item) => item.to === '/admin'), false);
});

test('administração aparece no menu de perfil apenas com permissão', () => {
  const adminItems = visibleProfileMenuItems({ role: 'admin' });
  const viewerItems = visibleProfileMenuItems({ role: 'viewer', permissions: [PERMISSIONS.DASHBOARD_VIEW] });

  assert.equal(adminItems.some((item) => item.to === '/admin'), true);
  assert.equal(viewerItems.some((item) => item.to === '/admin'), false);
});
