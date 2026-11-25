import assert from 'node:assert/strict';
import test from 'node:test';
import { onboardingState } from '../public/onboarding-state.js';

const inputs = [
  { id: 'face', kind: 'photo', source: 'real', setupSlot: 'face', slot: 'natural_light', quality: 'good' },
  { id: 'body', kind: 'photo', source: 'real', setupSlot: 'body', slot: 'body_front', quality: 'good' },
  { id: 'side', kind: 'photo', source: 'real', setupSlot: 'side', slot: 'face_34', quality: 'partial' },
];
const fullBody = { id: 'avatarbody', kind: 'photo', source: 'avatar' };
const setup = (overrides = {}) => ({ photos: [], settings: { onboarding: {} }, ...overrides });

test('a fresh workspace requires three usable photos in distinct shooting slots', () => {
  assert.equal(onboardingState(setup()).stage, 'photos');
  assert.equal(onboardingState(setup({ photos: inputs.slice(0, 2) })).canBuild, false);
  assert.equal(onboardingState(setup({ photos: inputs })).canBuild, true);
  const bad = { ...inputs[1], id: 'new-body', slot: 'face_front' };
  const state = onboardingState(setup({ photos: [...inputs, bad] }));
  assert.equal(state.slots.find((slot) => slot.key === 'body').status, 'replace');
  assert.equal(state.canBuild, false);
});

test('the generated full-body image opens a preview before workspace confirmation', () => {
  assert.equal(onboardingState(setup({ photos: inputs, analysisJob: { status: 'running' } })).stage, 'building');
  assert.equal(onboardingState(setup({ photos: [...inputs, fullBody] })).stage, 'preview');
  assert.equal(onboardingState(setup({ photos: [{ ...fullBody, source: 'real' }] })).stage, 'photos');
  assert.equal(onboardingState(setup({ photos: [...inputs, fullBody], settings: { onboarding: { confirmedAt: 1 } } })).stage, 'ready');
});

test('existing avatars open directly and a failed job leaves the uploaded photos reusable', () => {
  assert.equal(onboardingState({ photos: [fullBody], settings: {} }).stage, 'ready');
  const result = onboardingState(setup({ photos: inputs, analysisJob: { status: 'failed', error: '超时' } }));
  assert.equal(result.stage, 'photos');
  assert.equal(result.error, '超时');
  assert.equal(result.canBuild, true);
  assert.equal(onboardingState(setup({ photos: inputs, sheets: { avatarBody: { status: 'running' } } })).stage, 'building');
});
