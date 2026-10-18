import assert from 'node:assert/strict';
import test from 'node:test';
import { collaboratorPickerPlacement } from './collaboratorPickerPlacement.js';

const anchor = { left: 35, top: 600, bottom: 640, width: 280 };

test('mobile picker fits 320/390/430/760px and does not inherit the narrow trigger width', () => {
  for (const width of [320, 390, 430, 760]) {
    const placement = collaboratorPickerPlacement(anchor, { width, height: 844 });
    assert.equal(placement.width, width - 20);
    assert.equal(placement.left, 10);
    assert.equal(placement.bottom, 10);
    assert.equal(placement.maxHeight, 520);
  }
});

test('mobile keyboard resize lifts the entire menu above the visual viewport bottom', () => {
  const placement = collaboratorPickerPlacement(anchor, { width: 390, height: 330, layoutHeight: 844 });
  assert.equal(placement.bottom, 524);
  assert.equal(placement.maxHeight, 310);
  assert.equal(844 - placement.bottom, 320);
});

test('visual viewport panning and keyboard dismissal keep the menu within the visible area', () => {
  const placement = collaboratorPickerPlacement(anchor, { width: 360, layoutWidth: 390, height: 300, layoutHeight: 844, offsetTop: 140, offsetLeft: 15 });
  assert.equal(placement.bottom, 414);
  assert.equal(placement.left, 25);
  assert.equal(844 - placement.bottom - placement.maxHeight, 150);
  assert.equal(collaboratorPickerPlacement(anchor, { width: 390, height: 844 }).bottom, 10);
});

test('compact mobile landscape shrinks the results area without exceeding the viewport', () => {
  const placement = collaboratorPickerPlacement(anchor, { width: 740, height: 210 });
  assert.equal(placement.maxHeight, 190);
  assert.equal(placement.width, 720);
});

test('tablet above the existing 760px CSS breakpoint keeps its anchored menu', () => {
  assert.equal(collaboratorPickerPlacement(anchor, { width: 768, height: 1000 }).width, anchor.width);
});

test('desktop retains anchored dropdown positioning and clamps its right edge', () => {
  const placement = collaboratorPickerPlacement({ left: 1300, top: 100, bottom: 140, width: 280 }, { width: 1440, height: 900 });
  assert.equal(placement.top, 146);
  assert.equal(placement.width, 280);
  assert.equal(placement.left, 1144);
  assert.equal(placement.maxHeight, 320);
});

test('desktop near the bottom opens upwards without imposing an overflowing minimum height', () => {
  const placement = collaboratorPickerPlacement(anchor, { width: 1440, height: 700 });
  assert.equal(placement.top, undefined);
  assert.equal(placement.bottom, 106);
  assert.ok(placement.maxHeight <= 320);
});
