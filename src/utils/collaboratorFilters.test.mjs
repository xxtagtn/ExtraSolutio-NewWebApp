import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterCollaborators, normalizeCollaboratorSearch } from './collaboratorFilters.js';

test('filters collaborators with own car only when requested', () => {
  const rows = [
    { name: 'Ana Silva', roles: ['Emp.Mesa'], status: 'active', hasOwnCar: true },
    { name: 'Bruno Costa', roles: ['Barman'], status: 'active', hasOwnCar: false },
    { name: 'Carla Sousa', roles: ['Emp.Mesa'], status: 'inactive', hasOwnCar: true },
  ];

  const filtered = filterCollaborators(rows, { ownCarOnly: true });

  assert.deepEqual(filtered.map((row) => row.name), ['Ana Silva', 'Carla Sousa']);
});

const people = [
  { id: 12, name: 'Rita da Silva', shortName: 'Rita Silva', roles: ['Barman', 'Copa Fina'], status: 'active', hasOwnCar: true,
    notes: 'Boa experiência em casamentos e serviço de catering.', residenceArea: 'Sintra', availability: 'Fins de semana', email: 'rita@example.test', phone: '+351 900 000 001', nif: '999000111' },
  { id: 13, name: 'Rita Mendes', roles: ['Emp.Mesa'], status: 'inactive', hasOwnCar: false, residenceArea: 'Lisboa', notes: 'Não pode trabalhar à noite' },
  { id: 14, name: 'João da Costa', roles: ['Ajd.Cozinha', 'Copa Fina'], status: 'active', hasOwnCar: true,
    residenceArea: 'Sintra', notes: 'Tem experiência em casamentos', availability: 'Sábados à noite' },
  { id: 112, name: 'Joao Santos', roles: ['Barman'], status: 'paused', hasOwnCar: false,
    residenceArea: 'Cascais', notes: 'Tem carro emprestado; sem disponibilidade em casamentos' },
];
const search = (text, filters = {}, includeSensitive = true) => filterCollaborators(people,
  { search: text, ...filters }, { includeSensitive }).map(row => row.id);

test('searches full/partial names with accents, case and nonconsecutive terms', () => {
  assert.deepEqual(search('  RÍTA   da SILVA '), [12]);
  assert.deepEqual(search('Joao'), [14, 112]);
  assert.deepEqual(search('Silv'), [12]);
  assert.deepEqual(search('Costa JoÃo'), [14]);
  assert.equal(normalizeCollaboratorSearch(' Ajd.Cozinha '), 'ajd cozinha');
});

test('searches each real role and expands only the existing abbreviated names', () => {
  assert.deepEqual(search('Bar'), [12, 112]);
  assert.deepEqual(search('Copa'), [12, 14]);
  assert.deepEqual(search('Empregado de mesa'), [13]);
  assert.deepEqual(search('Ajudante de cozinha'), [14]);
});

test('finds terms within notes and residence fields without changing stored text', () => {
  const before = structuredClone(people);
  assert.deepEqual(search('experiencia casamentos'), [12, 14]);
  assert.deepEqual(search('nao pode noite'), [13]);
  assert.deepEqual(search('SINTRA'), [12, 14]);
  assert.deepEqual(people, before);
});

test('AND terms restrict the same person across names, functions, zones and notes', () => {
  assert.deepEqual(search('Rita Bar'), [12]);
  assert.deepEqual(search('Copa Sintra'), [12, 14]);
  assert.deepEqual(search('Joao carro'), [14, 112]);
  assert.deepEqual(search('Rita cozinha'), []);
  assert.deepEqual(search('Rita Bar Sintra casamentos'), [12]);
});

test('recognized function words require actual roles rather than a surname or incidental note', () => {
  const rows = [...people,
    { id: 20, name: 'Rita Barros', roles: ['Emp.Mesa'], notes: 'Disponível para bar e copa', residenceArea: 'Sintra' },
    { id: 21, name: 'Rita Chefe', roles: ['Barman'], notes: 'Tem apoio em eventos' },
    { id: 22, name: 'Rita Apoio', roles: ['Barman de Apoio'] },
  ];
  assert.deepEqual(filterCollaborators(rows, { search: 'Rita Bar' }, { includeSensitive: true }).map(row=>row.id), [12,21,22]);
  assert.deepEqual(filterCollaborators(rows, { search: 'Copa Sintra' }, { includeSensitive: true }).map(row=>row.id), [12,14]);
  assert.deepEqual(filterCollaborators(rows, { search: 'Rita Barman de Apoio' }, { includeSensitive: true }).map(row=>row.id), [22]);
  assert.deepEqual(filterCollaborators(rows, { search: 'Rita Chefe' }, { includeSensitive: true }).map(row=>row.id), [21]);
  assert.deepEqual(filterCollaborators(rows, { search: 'apoio' }, { includeSensitive: true }).map(row=>row.id), [21,22]);
});

test('text and independent role, car, status and zone filters combine without duplicates', () => {
  assert.deepEqual(search('experiência', { roleFilter: 'Copa Fina', ownCarFilter: 'true', statusFilter: 'active', zoneFilter: 'síNtr' }), [12, 14]);
  assert.deepEqual(search('', { roleFilter: 'Barman', ownCarFilter: 'false' }), [112]);
  assert.deepEqual(search('', { statusFilter: 'active', zoneFilter: 'Lisboa' }), []);
  assert.deepEqual(search('Copa Copa'), [12, 14]);
});

test('sensitive notes, zones and NIF never influence unauthorized search results', () => {
  assert.deepEqual(search('casamentos', {}, false), []);
  assert.deepEqual(search('Sintra', {}, false), []);
  assert.deepEqual(search('999000111', {}, false), []);
  assert.deepEqual(search('999000111'), [12]);
  assert.deepEqual(search('sabados noite', {}, false), [14]);
  assert.deepEqual(search('Rita Bar', {}, false), [12]);
  assert.deepEqual(search('', { zoneFilter: 'Sintra' }, false), []);
});

test('supports exact IDs, existing contacts and operational availability without indexing finance or documents', () => {
  assert.deepEqual(search('12'), [12]);
  assert.deepEqual(search('rita@example.test'), [12]);
  assert.deepEqual(search('900000001'), [12]);
  assert.deepEqual(search('fins semana', {}, false), [12]);
  assert.deepEqual(search('carro proprio', {}, false), [12,14]);
  assert.deepEqual(search('viatura propria', {}, false), [12,14]);
  assert.deepEqual(filterCollaborators([{ id: 5, name: 'Outra Pessoa', iban: 'bank-secret', allergies: 'medical-secret',
    documentNumber: 'passport-secret', insurancePolicy: 'insurance-secret', hourlyRate: '9999' }],
  { search: 'secret' }, { includeSensitive: true }), []);
});

test('status words do not make inactive staff match active merely by substring', () => {
  assert.deepEqual(search('ativo'), [12, 14]);
  assert.deepEqual(search('inativo'), [13]);
  assert.deepEqual(search('pausado'), [112]);
});

test('empty, null and legacy role data remains safe and ordinary punctuation is not a regex', () => {
  assert.deepEqual(filterCollaborators(null, { search: 'Rita' }), []);
  assert.deepEqual(filterCollaborators([{ id: 5, name: 'Legacy', category: 'Emp.Mesa' }], { search: 'empregado mesa' }).map(row => row.id), [5]);
  assert.deepEqual(search('.*'), []);
  assert.deepEqual(search('[Rita]'), []);
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
