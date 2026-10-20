import test from 'node:test';
import assert from 'node:assert/strict';
import { googleMapsDirectionsUrl } from './googleMapsDirections.js';

test('directions use the event address without guessing origin or transport', () => {
  const address = 'Avenida Bombeiros, n.º 1, 1400-036 Lisboa';
  const url = new URL(googleMapsDirectionsUrl(address));
  assert.equal(url.origin, 'https://www.google.com');
  assert.equal(url.pathname, '/maps/dir/');
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.get('destination'), address);
  assert.deepEqual([...url.searchParams.keys()], ['api', 'destination']);
});

test('venue names, accents and URL-reserved characters are encoded as destination text', () => {
  for (const destination of ['Estádio da Luz', 'Salão A & B #2, Rua João XXI / Porto', 'javascript:alert(1)', 'https://example.test/?a=1&b=2']) {
    const url = new URL(googleMapsDirectionsUrl(`  ${destination}  `));
    assert.equal(url.origin, 'https://www.google.com');
    assert.equal(url.searchParams.get('destination'), destination);
    assert.equal(url.searchParams.size, 2);
    assert.equal(url.hash, '');
  }
});

test('absent locations never produce empty directions links', () => {
  for (const location of ['', '  ', null, undefined, {}, 123]) assert.equal(googleMapsDirectionsUrl(location), null);
});

test('unusable oversized destinations stay plain text instead of being truncated', () => {
  assert.equal(googleMapsDirectionsUrl('a'.repeat(2048)), null);
});
