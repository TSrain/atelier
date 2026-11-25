import assert from 'node:assert/strict';
import test from 'node:test';
import { bodyPhotoBounds, bodyRowTransform, emptyBodyShape, isModeledBody } from '../public/body-shape.js';

test('the cutout uses a full-body modeled image rather than uploaded photos', () => {
  assert.ok(isModeledBody({ kind: 'photo', source: 'avatar', id: 'avatarbody' }));
  assert.ok(isModeledBody({ kind: 'photo', source: 'avatar', id: 'v2', bodyEditId: 'edit' }));
  assert.equal(isModeledBody({ kind: 'photo', source: 'real', slot: 'body_front', quality: 'good' }), false);
  assert.equal(isModeledBody({ kind: 'photo', source: 'avatar', id: 'avatarbust' }), false);
});

test('neutral body sliders preserve the original cutout geometry exactly', () => {
  for (const row of [0, 1, 75, 130, 301, 459]) {
    assert.deepEqual(bodyRowTransform(row, 460, emptyBodyShape()), { widthScale: 1, top: row, bottom: row + 1 });
  }
});

test('warping keeps the face width and bottom alignment while scaling the waist', () => {
  const shape = { ...emptyBodyShape(), waist: 4, height: 3 };
  const head = bodyRowTransform(25, 460, shape);
  const waist = bodyRowTransform(193, 460, shape);
  assert.equal(head.widthScale, 1);
  assert.ok(waist.widthScale > 1);
  assert.ok(head.top < 25);
  assert.equal(Math.abs(head.bottom - head.top - 1) < 1e-8, true);
  assert.equal(bodyRowTransform(459, 460, shape).bottom, 460);
});

test('a mask touching a photo edge is marked cropped and bounds come from alpha', () => {
  const pixels = new Uint8ClampedArray(8 * 10 * 4);
  for (let y = 2; y < 10; y++) for (let x = 2; x <= 5; x++) pixels[(y * 8 + x) * 4 + 3] = 255;
  pixels[3] = 255;
  pixels[(8 * 4 - 1)] = 255;
  assert.deepEqual(bodyPhotoBounds(pixels, 8, 10), { x: 2, y: 2, width: 4, height: 8, cropped: true });
});
