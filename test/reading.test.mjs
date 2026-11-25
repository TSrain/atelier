import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createFeed } from '../feed.mjs';
import { renderHome, story } from '../public/home.js';
import { S } from '../public/state.js';

const item = {
  id: 'post-1',
  source: '时装媒体',
  title: 'Winter layering tips',
  zh: '冬天怎么叠穿',
  summary: '先用轻薄的单品调整内搭。\n外套留出一点余量。',
  excerpt: 'A closer look at winter layering < and materials.',
  url: 'https://example.com/1?ref=feed&from=atelier',
  publishedAt: Date.parse('2026-11-22T01:00:00Z'),
  fav: true,
};

test('reading cards link to an in-app article from the home feed and favorites', () => {
  const card = story(item);
  assert.equal((card.match(/href="#\/home\?article=post-1"/g) || []).length, 2);
  assert.doesNotMatch(card, /target="_blank"/);
  assert.match(story(item, 'favs'), /href="#\/home\?article=post-1&amp;from=favs"/);
});

test('article detail displays saved text, credits the publisher and returns to its origin', (t) => {
  const previous = S.db;
  t.after(() => { S.db = previous; });
  S.db = { feed: { items: [item] } };
  const html = renderHome(new URLSearchParams('article=post-1&from=favs'));
  assert.match(html, /<h1[^>]*>冬天怎么叠穿<\/h1>/);
  assert.match(html, /Winter layering tips/);
  assert.match(html, /先用轻薄的单品调整内搭。\n外套留出一点余量。/);
  assert.match(html, /订阅源节选/);
  assert.match(html, /A closer look at winter layering &lt; and materials/);
  assert.match(html, /href="https:\/\/example.com\/1\?ref=feed&amp;from=atelier"[^>]*>阅读原文/);
  assert.match(html, /href="#\/mine\?v=favs"/);
  assert.match(html, /data-act="favArticle" data-id="post-1" aria-pressed="true"/);

  S.db.feed.items = [{ ...item, summary: '', excerpt: '', url: 'javascript:alert(1)' }];
  const unavailable = renderHome(new URLSearchParams('article=post-1'));
  assert.match(unavailable, /暂无摘要/);
  assert.doesNotMatch(unavailable, /href="javascript:/);
  assert.match(unavailable, /href="#\/home\?journal=1"/);
  assert.match(renderHome(new URLSearchParams('article=expired')), /这篇读物已不在存档中/);
});

const feedOptions = (dataDir) => ({
  dataDir,
  clock: () => Date.parse('2026-11-22T02:00:00Z'),
  sources: [['Test', 'https://example.com/feed']],
  fetcher: async () => new Response(`<rss><channel><item>
    <title>Article</title><link>https://example.com/1</link>
    <pubDate>Sun, 22 Nov 2026 01:00:00 GMT</pubDate>
    <description><![CDATA[<p>Public excerpt.</p><img src="https://example.com/cover.jpg">]]></description>
  </item></channel></rss>`),
  select: async () => [{ index: 1, title: '文章', summary: '中文摘要', tag: '穿搭' }],
});

test('feed persists public RSS excerpts so an article remains readable after restart', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'atelier-reading-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const options = feedOptions(dataDir);
  await createFeed(options).refresh();
  const [entry] = createFeed(options).get().items;
  assert.equal(entry.summary, '中文摘要');
  assert.equal(entry.excerpt, 'Public excerpt.');
});

test('refresh adds available RSS excerpts to older saved articles without replacing them', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'atelier-reading-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const options = feedOptions(dataDir);
  const oldItem = { id: 'older', url: 'https://example.com/1', summary: '原有摘要', fav: true, day: '2026-11-20', image: 'https://example.com/cover.jpg' };
  await writeFile(path.join(dataDir, 'feed.json'), JSON.stringify({ items: [oldItem], seen: {}, refresh: { status: 'done' } }));
  await createFeed(options).refresh();
  assert.deepEqual(createFeed(options).get().items, [{ ...oldItem, excerpt: 'Public excerpt.' }]);
});

test('daily selection keeps all three media types, filters news, and saves unpicked candidates for later', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'atelier-reading-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let now = Date.parse('2026-11-22T02:00:00Z');
  const article = (title, slug, date = '2026-11-20T01:00:00Z') => `<item><title>${title}</title><link>https://example.com/${slug}</link>
    <pubDate>${date}</pubDate><description><![CDATA[<img src="https://images.example.com/1.jpg"><img src="https://images.example.com/2.jpg">]]></description></item>`;
  const video = (id, title) => `<script type="application/ld+json">${JSON.stringify({
    '@type': 'VideoObject', name: title, description: '用衣橱里的基础款示范', url: `https://www.bilibili.com/video/${id}/`,
    uploadDate: '2025-11-22T01:00:00Z', thumbnailUrl: ['https://images.example.com/video.jpg'], duration: 'PT7M35S', author: { name: '国内创作者' },
  })}</script>`;
  const feeds = {
    'https://example.com/text': [article('男生如何叠穿', 'layer'), article('女装新品发布', 'ad'), article('男生通勤配色方法', 'color'), article('男装裤长怎么选', 'length'), article('男装裤长怎么选', 'length?utm_source=feed')],
    'https://example.com/pics': [article('街拍一', 'snap', '2026-10-18T01:00:00Z')],
  };
  const options = {
    dataDir, clock: () => now,
    sources: [
      { source: '中文穿搭', url: 'https://example.com/text', format: 'article', include: /男生|男装/ },
      { source: '东亚街拍', url: 'https://example.com/pics', format: 'gallery' },
      { source: '哔哩哔哩', url: 'https://search.bilibili.com/all?keyword=test', format: 'video' },
    ],
    fetcher: async (url) => new Response(url.startsWith('https://search.bilibili.com')
      ? '<a href="//www.bilibili.com/video/BV1JbrbBHE2p/"><h3 class="bili-video-card__info--tit">男生穿搭叠穿技巧</h3></a>'
      : url.startsWith('https://www.bilibili.com/video') ? video('BV1JbrbBHE2p', '男生穿搭叠穿技巧') : feeds[url].join('')),
    select: async () => { throw new Error('offline'); },
  };
  const feed = createFeed(options);
  await feed.refresh();
  const first = feed.get().items;
  assert.deepEqual(first.map((entry) => entry.format), ['article', 'gallery', 'video', 'article']);
  assert.equal(first[1].images.length, 2);
  assert.equal(first[2].duration, 455);
  assert.equal(first[2].creator, '国内创作者');
  assert.equal(first[2].publishedAt, Date.parse('2025-11-22T01:00:00Z'));
  await feed.refresh();
  assert.deepEqual(feed.get().items, first);
  now += 86_400_000;
  await feed.tick();
  const second = feed.get().items;
  assert.equal(second[0].url, 'https://example.com/length');
  assert.equal(second.length, first.length + 1);
});

test('the editorial filter can reject all candidates while existing favorites remain readable', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'atelier-reading-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const options = feedOptions(dataDir);
  const older = { ...item, day: '2026-11-20' };
  await writeFile(path.join(dataDir, 'feed.json'), JSON.stringify({ items: [older], seen: {}, refresh: { status: 'done' } }));
  const feed = createFeed({ ...options, select: async () => [] });
  await feed.refresh();
  assert.deepEqual(feed.get().items, [older]);
});

test('video and gallery cards open the original video and show all available look photos', (t) => {
  const previous = S.db;
  t.after(() => { S.db = previous; });
  const video = { ...item, format: 'video', creator: '造型作者', duration: 455, url: 'https://www.bilibili.com/video/BV1JbrbBHE2p/' };
  const gallery = { ...item, id: 'snap-1', format: 'gallery', images: ['https://images.example.com/1.jpg', 'https://images.example.com/2.jpg'] };
  S.db = { feed: { items: [video, gallery] } };
  assert.match(story(video), /视频 · 7:35/);
  assert.match(story(video), /造型作者/);
  assert.match(renderHome(new URLSearchParams('article=post-1')), /bilibili\.com\/video\/BV1JbrbBHE2p\/[^>]*>观看原视频/);
  assert.match(story(gallery), /图集/);
  const photos = renderHome(new URLSearchParams('article=snap-1'));
  assert.match(photos, /src="https:\/\/images.example.com\/1.jpg"/);
  assert.match(photos, /src="https:\/\/images.example.com\/2.jpg"/);
});
