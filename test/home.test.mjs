import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('independent review checks completeness, styling fit and distinct outfits before publication', async () => {
  const { outfitReviewPrompt } = await import('../prompts.mjs');
  const prompt = outfitReviewPrompt({ brief: '偏好休闲', weather: '体感 5℃', outfits: [
    { name: '针织与直筒', occasion: '通勤', items: ['针织衫', '直筒裤', '乐福鞋'], palette: ['#223344'], image_prompt: '全身搭配' },
  ] });
  assert.match(prompt, /偏好休闲/);
  assert.match(prompt, /体感 5℃/);
  assert.match(prompt, /鞋履/);
  assert.match(prompt, /仅换色/);
  assert.match(prompt, /69/);
});
import { mismatch, nearestCity, summarize } from '../weather.mjs';
import { createFeed, parseFeed } from '../feed.mjs';
import { analysisPrompt, generationPrompt, matchScene, outfitsPrompt, panelPrompt } from '../prompts.mjs';

const day = (over = {}) => summarize({ date: '2026-11-22', city: '北京', tmax: 6, tmin: -2, feelMax: 2, feelMin: -6, rainProb: 0, rain: 0, snow: 0, code: 3, wind: 9, pm25: 20, aqi: 40, ...over });

test('reanalysis considers feedback about the previous conclusions alongside current photos', () => {
  const photos = [{ label: '最新的自然光正脸' }];
  const feedback = '上次的定位太成熟了\n想要更随性一些';
  const previous = { summary: '原来的分析总结', style: { archetype: '都市自然轻熟' } };
  const prompt = analysisPrompt({}, photos, { feedback, previous });
  assert.match(prompt, /最新的自然光正脸/);
  assert.ok(prompt.includes(JSON.stringify(feedback)));
  assert.match(prompt, /原来的分析总结/);
  assert.match(prompt, /都市自然轻熟/);
  assert.doesNotMatch(analysisPrompt({}, photos, { previous }), /原来的分析总结/);
});

test('style advice ties each recommendation or pitfall to an observed feature and a visible result', () => {
  const prompt = analysisPrompt({}, [{ label: '正脸' }]);
  const style = prompt.split('四、style：')[1].split('五、hairstyles：')[0];
  assert.match(style, /dos 与 donts 各 4 条/);
  assert.match(style, /每条都写清[\s\S]*具体选法[\s\S]*本人特征[\s\S]*可见效果/);
  assert.match(style, /locked 为 true 的诊断点不能作为依据/);
});

test('weather is reduced to the facts outfits depend on', () => {
  assert.equal(day().season, '冬');
  assert.deepEqual(day().flags, { rain: false, snow: false, haze: false, wind: false });
  assert.equal(day({ rainProb: 80, rain: 4, code: 63 }).flags.rain, true);
  assert.equal(day({ aqi: 180 }).flags.haze, true);
  assert.equal(day({ feelMax: 30, feelMin: 24 }).season, '夏');
});

test('a stale batch is replaced only for a real change in weather', () => {
  assert.equal(mismatch(day(), day({ feelMax: 4, feelMin: -3 })), '');
  assert.match(mismatch(day(), day({ feelMax: 14, feelMin: 6 })), /高了/);
  assert.match(mismatch(day(), day({ rainProb: 90, rain: 6, code: 63 })), /下雨/);
  assert.equal(mismatch(day({ aqi: 180 }), day({ aqi: 190 })), '');
  assert.equal(mismatch(null, day()), '');
});

test('located coordinates map to a Chinese city or are refused', () => {
  assert.equal(nearestCity(30.3, 120.2).name, '杭州');
  assert.equal(nearestCity(1.35, 103.8), null);
});

test('rain and haze put an umbrella and a mask into the brief and the picture', () => {
  const prompt = outfitsPrompt({ brief: '-', count: 5, weather: day({ rainProb: 90, rain: 6, code: 63, aqi: 180 }), seasonLabel: '秋季' });
  assert.match(prompt, /雨伞/);
  assert.match(prompt, /口罩/);
  assert.doesNotMatch(outfitsPrompt({ brief: '-', count: 5, weather: day(), seasonLabel: '冬季' }), /雨伞/);
  assert.match(panelPrompt('outfits', [{ image_prompt: '手撑一把打开的深色长柄雨伞' }, { image_prompt: '针织衫' }]), /2 个竖向面板[\s\S]*撑着打开的雨伞/);
});

test('changing pose or scene keeps the finished outfit as a reference', () => {
  const prompt = generationPrompt({ outfit: '藏青夹克', pose: '行走', scene: '咖啡馆', season: '冬', prevId: 'abc', change: 'pose' });
  assert.match(prompt, /prev\.jpg[\s\S]*只按下面列出的内容改变姿势/);
  const changedScene = generationPrompt({ outfit: '藏青夹克', pose: '行走', scene: '咖啡馆', season: '冬', prevId: 'abc', change: 'scene' });
  assert.match(changedScene, /冬季/);
  assert.doesNotMatch(changedScene, /姿势：改为/);
  assert.notEqual(matchScene('日常通勤', [matchScene('日常通勤')]), undefined);
});

const rss = (items) => `<?xml version="1.0"?><rss><channel>${items.map(([title, link, date]) => `<item><title><![CDATA[${title}]]></title><link>${link}</link><pubDate>${new Date(date).toUTCString()}</pubDate><description><![CDATA[<p>About <b>${title}</b></p><img src="https://img.example.com/a.jpg">]]></description></item>`).join('')}</channel></rss>`;

test('feed entries keep the original title and link and drop unusable ones', () => {
  const [entry, ...rest] = parseFeed(rss([['Wool &amp; Denim', 'https://example.com/a', '2026-11-22'], ['No link', 'javascript:alert(1)', '2026-11-22']]));
  assert.equal(rest.length, 0);
  assert.deepEqual([entry.title, entry.url, entry.image, entry.excerpt], ['Wool & Denim', 'https://example.com/a', 'https://img.example.com/a.jpg', 'About Wool & Denim']);
});

test('the daily feed is new each day, archived for 7 days, and survives a failed selection', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'atelier-feed-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let now = Date.parse('2026-11-22T02:00:00Z'), items = [['First', 'https://example.com/1', now - 3600_000], ['Second', 'https://example.com/2', now - 7200_000]], fail = false;
  const feed = createFeed({ dataDir, clock: () => now, sources: [['Test', 'https://example.com/feed']],
    fetcher: async () => new Response(rss(items)),
    select: async () => { if (fail) throw new Error('offline'); return [{ index: 2, title: '第二篇', summary: '摘要', tag: '穿搭' }]; } });
  await feed.refresh();
  assert.deepEqual(feed.get().items.map((item) => [item.zh, item.url, item.day]), [['第二篇', 'https://example.com/2', '2026-11-22']]);
  assert.equal(feed.tick(), undefined);
  feed.mark(feed.get().items[0].id, { fav: true });

  now += 86_400_000; fail = true;
  items = [...items, ['Third', 'https://example.com/3', now - 3600_000]];
  await feed.tick();
  assert.deepEqual(feed.get().items.map((item) => item.title), ['Third', 'First', 'Second']);
  feed.mark(feed.get().items[0].id, { disliked: true });
  assert.equal(feed.get().items.length, 2);

  now += 8 * 86_400_000; items = [];
  await feed.refresh();
  assert.deepEqual(feed.get().items.map((item) => item.title), ['Second']);
});
