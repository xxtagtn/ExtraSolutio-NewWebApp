import test from 'node:test';
import assert from 'node:assert/strict';
import { searchServices } from './serviceSearch.js';

const event = (id, name, date = '2026-07-12', patch = {}) => ({ id, name, date, ...patch });
const ids = (rows, query) => searchServices(rows, query).map((row) => row.id);
const rows = [event(1, 'Casamento da Rita'), event(2, 'Rita - Festa', '2025-07-12'),
  event(3, 'Rita - Outubro', '2026-10-12'), event(4, 'Jo\u00e3o - Evento Corporativo'),
  event(5, 'Outro casamento', '2026-07-13')];

test('service search ignores case, accents and extra whitespace without mutating data', () => {
  const before = structuredClone(rows);
  assert.deepEqual(ids(rows, 'Rita'), [1, 2, 3]); assert.deepEqual(ids(rows, 'rita'), [1, 2, 3]);
  assert.deepEqual(ids(rows, ' JOAO '), [4]); assert.deepEqual(ids(rows, 'CASAMENTO   rita'), [1]);
  assert.deepEqual(rows, before); assert.equal(searchServices(rows, ' \t '), rows);
});

test('Portuguese dates recognize slash/hyphen and optional year, never US month/day order', () => {
  for (const query of ['12/07', '12-07', '12/7']) assert.deepEqual(ids(rows, query), [1, 2, 4]);
  for (const query of ['12/07/2026', '12-07-2026', '2026-07-12']) assert.deepEqual(ids(rows, query), [1, 4]);
  assert.deepEqual(ids(rows, '07/12'), []); assert.deepEqual(ids(rows, '12/07/2025'), [2]);
});

test('all name/date criteria restrict the same event rather than producing a union', () => {
  assert.deepEqual(ids(rows, 'Rita 12/07'), [1, 2]);
  assert.deepEqual(ids(rows, 'Casamento 12/07/2026'), [1]);
  assert.deepEqual(ids(rows, 'Rita 12/07/2026'), [1]);
  assert.deepEqual(ids(rows, 'Rita Corporativo'), []);
});

test('continuous services match start, intermediate and final days with or without a year', () => {
  const list = [event(1, 'Rita', '2026-07-11', { isContinuous: true, endDate: '2026-07-13' }),
    event(2, 'Rita', '2026-07-11', { isContinuous: false, endDate: '2026-07-13' })];
  for (const query of ['11/07', '12/07', '13/07', 'Rita 12-07-2026']) assert.ok(ids(list, query).includes(1));
  assert.deepEqual(ids(list, '12/07'), [1]); assert.deepEqual(ids(list, '14/07'), []);
  assert.deepEqual(ids(list, '12/07/2025'), []);
});

test('month/year crossings and leap days use calendar dates independent of local timezone', () => {
  const list = [event(1, 'Viragem', '2025-12-30T00:00:00.000Z', { isContinuous: true, endDate: '2026-01-03T00:00:00.000Z' }),
    event(2, 'Bissexto', new Date('2024-02-28T00:00:00Z'), { isContinuous: true, endDate: new Date('2024-03-01T00:00:00Z') }),
    event(3, 'Comum', '2026-02-28', { isContinuous: true, endDate: '2026-03-01' })];
  assert.deepEqual(ids(list, '01/01'), [1]); assert.deepEqual(ids(list, '31/12/2025'), [1]);
  assert.deepEqual(ids(list, '01/01/2025'), []); assert.deepEqual(ids(list, '29/02'), [2]);
  assert.deepEqual(ids(list, '29/02/2026'), []);
});

test('invalid dates do not roll into a different day or accidentally match the event name', () => {
  const list = [event(1, 'Rita 31/02', '2026-03-03'), event(2, 'Invalido', '2026-02-31'),
    event(3, 'Sem data', null), event(4, 'Intervalo invalido', '2026-07-12', { isContinuous: true, endDate: '2026-07-01' })];
  for (const query of ['31/02', '31/04/2026', '00/07', '12/13', '2026-02-31']) assert.deepEqual(ids(list, query), []);
  assert.deepEqual(ids(list, '12/07'), [4]); assert.deepEqual(ids(list, '11/07'), []);
});

test('numeric queries use exact IDs and whole numeric segments, never partial IDs/dates/amounts', () => {
  const list = [event(112, 'Rita'), event(2, 'Rita 12'), event(12, 'Rita'), event(3, 'Rita 112'),
    event(4, 'Rita', '2026-07-12', { totalRevenue: 12, guestsCount: 12 }),
    event(5, 'Rita', undefined, { serviceReference: 'EVT-12' }),
    event(6, 'Rita', undefined, { serviceReference: 'EVT-112' })];
  assert.deepEqual(ids(list, 'Rita 12'), [12, 2, 5]); assert.deepEqual(ids(list, '112'), [112, 3, 6]);
  assert.deepEqual(ids(list, '2026'), []);
});

test('existing internal references are searchable, with exact references ranked before partial text', () => {
  const list = [event(1, 'Referencia EV-12 extra'), event(2, 'Rita', undefined, { serviceReference: 'EV-12' }),
    event(3, 'Rita', undefined, { serviceReference: 'EV-123' })];
  assert.deepEqual(ids(list, 'ev-12'), [2, 1]); assert.deepEqual(ids(list, 'Rita EV-12'), [2]);
  assert.deepEqual(ids(list, 'EV-12 12/07/2026'), [2, 1]);
});

test('an exact ID never overrides the other query terms or a prefiltered list', () => {
  const list = [event(12, 'Outro', '2026-07-13'), event(13, 'Rita 12')];
  assert.deepEqual(ids(list, 'Rita 12 12/07'), [13]);
  assert.deepEqual(ids(list.filter((row) => row.id !== 12), '12'), [13]);
});

test('punctuation is literal rather than a regular expression and multiple dates can match one range', () => {
  const list = [event(1, 'Rita (VIP) +', '2026-07-11', { isContinuous: true, endDate: '2026-07-13' }), event(2, 'Rita VIP')];
  assert.deepEqual(ids(list, '(VIP) +'), [1]); assert.deepEqual(ids(list, '.*'), []);
  assert.deepEqual(ids(list, '[VIP]'), []); assert.deepEqual(ids(list, 'Rita 11/07 13/07'), [1]);
});

test('empty data and null optional fields are safe, and nonmatching searches return an empty list', () => {
  assert.deepEqual(searchServices([], 'Rita'), []);
  assert.deepEqual(searchServices([{ id: 9, name: null, serviceReference: null }], 'Rita'), []);
  assert.deepEqual(ids(rows, 'inexistente'), []);
  assert.deepEqual(ids(rows, 'cliente-interno'), []);
});
