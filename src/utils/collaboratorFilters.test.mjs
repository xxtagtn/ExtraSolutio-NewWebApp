import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterCollaborators } from './collaboratorFilters.js';

test('filters collaborators with own car only when requested', () => {
  const rows = [
    { name: 'Ana Silva', roles: ['Emp.Mesa'], status: 'active', hasOwnCar: true },
    { name: 'Bruno Costa', roles: ['Barman'], status: 'active', hasOwnCar: false },
    { name: 'Carla Sousa', roles: ['Emp.Mesa'], status: 'inactive', hasOwnCar: true },
  ];

  const filtered = filterCollaborators(rows, { ownCarOnly: true });

  assert.deepEqual(filtered.map((row) => row.name), ['Ana Silva', 'Carla Sousa']);
});

test('combines own car filter with role and status filters', () => {
  const rows = [
    { name: 'Ana Silva', roles: ['Emp.Mesa'], status: 'active', hasOwnCar: true },
    { name: 'Carla Sousa', roles: ['Emp.Mesa'], status: 'inactive', hasOwnCar: true },
    { name: 'Diana Lima', roles: ['Barman'], status: 'active', hasOwnCar: true },
  ];

  const filtered = filterCollaborators(rows, {
    roleFilter: 'Emp.Mesa',
    statusFilter: 'active',
    ownCarOnly: true,
  });

  assert.deepEqual(filtered.map((row) => row.name), ['Ana Silva']);
});
