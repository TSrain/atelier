import assert from 'node:assert/strict';
import test from 'node:test';
import { styleQuizIds, styleQuizNotes, styleQuizText } from '../public/style-questions.js';
import { renderStyleQuiz } from '../public/style-quiz.js';
import { analysisPrompt, fitPrompt, outfitsPrompt } from '../prompts.mjs';

test('style cold start displays nine visual choices together in one optional question', () => {
  const page = renderStyleQuiz({ choices: [], hadChoices: false, saving: false }, '#/home');
  assert.equal((page.match(/data-act="styleQuizChoose"/g) || []).length, 9);
  assert.ok(['老钱风', '科技风', '户外风'].every((name) => page.includes(name)));
  assert.match(page, /跳过/);
  assert.doesNotMatch(page, /下一题|上一题/);
});

test('only selected answers become preferences, and retaking updates those answers', () => {
  const personal = { id: 'manual', text: '不要皮鞋', auto: false };
  const learned = { id: 'learned', text: '少推西装', auto: true };
  const original = [personal, learned];
  assert.deepEqual(styleQuizNotes([], original), original);
  const selected = styleQuizNotes(['style-techwear', 'style-old-money', 'style-techwear'], original);
  assert.deepEqual(styleQuizIds(selected), ['style-old-money', 'style-techwear']);
  assert.deepEqual(styleQuizText(selected), ['想尝试：老钱风', '想尝试：科技风']);
  assert.ok(selected.slice(0, 2).every((note) => !('scene' in note)));
  assert.deepEqual(styleQuizNotes(['style-old-money', 'style-techwear'], selected), selected);
  const edited = styleQuizNotes(['style-outdoor'], selected);
  assert.deepEqual(styleQuizIds(edited), ['style-outdoor']);
  assert.deepEqual(styleQuizNotes([], edited), original);
  const threeFromTheFormerClassicGroup = ['style-old-money', 'style-preppy', 'style-minimal'];
  assert.deepEqual(styleQuizIds(styleQuizNotes(threeFromTheFormerClassicGroup, original)), threeFromTheFormerClassicGroup);
  assert.throws(() => styleQuizNotes(['invented'], original), /无效/);
});

test('previous quizzes do not imply which named styles the user likes', () => {
  const old = [
    { id: 'straight', text: '日常偏好自然直身', source: 'style-quiz' },
    { id: 'weekend-outdoor', text: '周末休闲：喜欢功能外套', scene: 'weekend', source: 'style-quiz' },
  ];
  assert.deepEqual(styleQuizIds(old), []);
  assert.deepEqual(styleQuizText(old), []);
  assert.deepEqual(styleQuizNotes([], old), []);
});

test('analysis and recommendations use named styles in ways that suit the occasion', () => {
  const photos = [{ label: '全身照' }];
  const choice = '想尝试：老钱风';
  assert.match(analysisPrompt({}, photos, { styleChoices: [choice] }), new RegExp(choice));
  assert.doesNotMatch(analysisPrompt({}, photos), /看图选择/);
  const outfit = { brief: '档案', count: 5, seasonLabel: '秋季' };
  const scored = { brief: '档案', entries: ['短夹克'] };
  for (const [fn, args] of [[outfitsPrompt, outfit], [fitPrompt, scored]]) {
    const prompt = fn({ ...args, styleChoices: [choice] });
    assert.match(prompt, /场合/);
    assert.match(prompt, /配色、版型/);
    assert.ok(prompt.includes(choice));
    assert.ok(!fn(args).includes(choice));
  }
});
