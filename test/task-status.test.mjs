import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaskStatus } from '../public/task-status.js';

const state = (extra = {}) => ({ photos: [], looks: [], outfits: [], hairs: [], jobs: [], sheets: {}, ...extra });

test('idle hides the count and ignores results from before the page opened', () => {
  const status = createTaskStatus();
  const db = state({ looks: [{ id: 'old', status: 'done' }] });
  assert.deepEqual(status.update(db), { progress: '', completion: undefined, newCompletion: undefined });
  assert.deepEqual(status.update(db), { progress: '', completion: undefined, newCompletion: undefined });
});

test('a finished try-on remains clickable while another is queued, then clears when opened', () => {
  const status = createTaskStatus();
  const queued = { id: 'next', status: 'queued' };
  assert.equal(status.update(state({ looks: [queued, { id: 'one', status: 'running' }] })).progress, '2 张试穿生成中');
  const db = state({ looks: [queued, { id: 'one', status: 'done' }] });
  const { progress, completion } = status.update(db);
  assert.equal(progress, '1 张试穿生成中');
  assert.equal(completion.href, '#/studio?look=one');
  assert.equal(status.update(db).completion, completion);
  status.dismiss();
  assert.equal(status.update(db).completion, undefined);
  assert.deepEqual(status.update(state({ looks: [{ ...queued, status: 'failed' }] })), { progress: '', completion: undefined, newCompletion: undefined });
});

test('results are detected even if success lands between polls, with links to their pages', () => {
  const scenarios = [
    [{ photos: [{ id: 'real', slot: 'face', source: 'real', kind: 'photo' }] }, '#/mine?v=materials'],
    [{ analysis: { ver: 'new' }, analysisJob: { status: 'done' } }, '#/mine?v=profile'],
    [{ sheets: { avatarBody: { status: 'done', finishedAt: 123 } } }, '#/mine?v=materials'],
    [{ sheets: { items: { status: 'done', finishedAt: 123 } } }, '#/mine?v=profile'],
    [{ hairs: [{ id: 'hair', art: 'done', imageAt: 123 }] }, '#/studio'],
    [{ outfits: [{ id: 'outfit', art: 'done', imageAt: 123 }], daily: { outfitIds: ['outfit'] } }, '#/home'],
    [{ outfits: [{ id: 'outfit', art: 'done', imageAt: 123 }] }, '#/studio'],
  ];
  for (const [extra, href] of scenarios) {
    const status = createTaskStatus();
    status.update(state());
    assert.equal(status.update(state(extra)).completion.href, href);
  }
});

test('completion notices are retained, coalesced by preview type, and dropped with deleted results', () => {
  const status = createTaskStatus();
  status.update(state());
  const db = state({ looks: [{ id: 'one', status: 'done' }], hairs: [{ id: 'one', art: 'done' }, { id: 'two', art: 'done' }] });
  assert.equal(status.update(db).completion.href, '#/studio?look=one');
  db.looks = [];
  assert.equal(status.update(db).completion.text, '发型预览已更新');
  status.dismiss();
  assert.equal(status.update(db).completion, undefined);
});

test('a new result takes the front of the queue and announces only on the poll that finds it', () => {
  const status = createTaskStatus();
  status.update(state());
  const hairs = [{ id: 'hair', art: 'done' }];
  const first = status.update(state({ hairs }));
  assert.equal(first.newCompletion, first.completion);
  assert.equal(first.completion.text, '发型预览已更新');

  const db = state({ hairs, looks: [{ id: 'one', status: 'done' }] });
  const second = status.update(db);
  assert.equal(second.newCompletion, second.completion);
  assert.equal(second.completion.href, '#/studio?look=one');
  assert.equal(status.update(db).newCompletion, undefined);

  status.dismiss();
  const remaining = status.update(db);
  assert.equal(remaining.completion, first.completion);
  assert.equal(remaining.newCompletion, undefined);
});
