import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampWidth } from '../../public/js/panel/resize.js';

test('below min: clamps up to min', () => {
  assert.equal(clampWidth(100, 1200), 320);
  assert.equal(clampWidth(0, 1200, { min: 320, maxRatio: 0.7 }), 320);
});

test('above maxRatio: clamps down to viewportWidth * maxRatio', () => {
  assert.equal(clampWidth(2000, 1200), 840); // 1200 * 0.7
  assert.equal(clampWidth(900, 1000, { min: 320, maxRatio: 0.5 }), 500);
});

test('tiny viewport where maxRatio*vw < min: min wins over the ratio cap', () => {
  assert.equal(clampWidth(500, 400, { min: 320, maxRatio: 0.7 }), 320); // 400*0.7=280 < 320
  assert.equal(clampWidth(100, 400, { min: 320, maxRatio: 0.7 }), 320);
});

test('normal value: passes through unchanged', () => {
  assert.equal(clampWidth(500, 1200), 500);
  assert.equal(clampWidth(380, 1200, { min: 320, maxRatio: 0.7 }), 380);
});
