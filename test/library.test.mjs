import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function library(t, options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'atelier-catalog-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const { createLibrary } = await import('../library.mjs');
  const optionsWithDefaults = {
    dataDir,
    seed: { items: [], outfits: [], people: [] },
    clock: () => Date.parse('2026-11-23T02:00:00Z'),
    ...options,
  };
  return { dataDir, instance: await createLibrary(optionsWithDefaults), options: optionsWithDefaults };
}

const seedItem = {
  id: 'ivory-tee', name: '米白圆领T恤', category: '上装', season: '四季', color: '#ece4d6',
  shape: '微宽松棉质短袖', why: '用中性色给深外套留出层次',
  wears: ['配靛蓝牛仔裤', '配藏青短夹克'], kind: 'classic',
};

test('seed items and outfits use stable IDs; saved favorites survive reopening', async (t) => {
  const { instance, options } = await library(t, {
    seed: { items: [seedItem], outfits: [{ id: 'wear-tee', name: '牛仔叠穿', occasion: '通勤', season: '春秋', why: '短款叠穿', itemIds: [seedItem.id] }], people: [] },
  });
  assert.equal(instance.get().outfits[0].items[0].id, seedItem.id);
  assert.equal(instance.find('wear-tee').kind, 'outfit');
  await instance.favorite(seedItem.id, true);
  const { createLibrary } = await import('../library.mjs');
  assert.deepEqual((await createLibrary(options)).get().favorites, [seedItem.id]);
});

test('only complete people are published and duplicate evidence cannot fill the quota', async (t) => {
  const pieces = ['上装', '下装'].map((category) => ({ name: category, category, color: '#565656', shape: '直筒' }));
  const looks = Array.from({ length: 20 }, (_, i) => ({
    id: 'person-' + i, name: '穿搭 ' + i, occasion: '出行', season: '春秋', date: '2025-10-10', tip: '同色搭配', pieces,
    source: { url: 'https://example.com/original', title: '街拍', locator: '图 ' + i, context: '出行', imageFile: `person-${i}.jpg` },
  }));
  const archived = { ...looks[0], id: 'former-look', archived: true, source: { ...looks[0].source, locator: '旧图' } };
  const missing = { ...looks[0], id: 'missing-look', source: { ...looks[0].source, locator: '未找到的图', imageFile: 'missing-look.jpg' } };
  const { instance } = await library(t, {
    seed: { items: [], outfits: [], people: [
      { id: 'valid', name: '完整', summary: '完整', looks: [...looks, archived] },
      { id: 'short', name: '待整理', summary: '待整理', looks: [...looks.slice(0, 19), missing] },
      { id: 'duplicate', name: '重复', summary: '重复', looks: looks.map((look) => ({ ...look, source: { ...look.source, locator: '同一张' } })) },
    ] },
    photoFor: ({ imageFile }) => imageFile === 'missing-look.jpg' ? null : `/media/library/${imageFile}`,
  });
  assert.deepEqual(instance.get().people.map((person) => person.id), ['valid']);
  assert.equal(instance.get().people[0].lookIds.length, 20);
  assert.ok(!instance.get().people[0].lookIds.includes(archived.id));
  assert.equal(instance.find(archived.id).entry.archived, true);
  assert.equal(instance.get().outfits[0].source.locator, '图 0');
});

test('Monday 09:00 Singapore time is the weekly cutoff', async () => {
  const { refreshWeek } = await import('../library.mjs');
  assert.equal(refreshWeek(Date.parse('2026-11-23T00:59:59Z')), '2026-11-16');
  assert.equal(refreshWeek(Date.parse('2026-11-23T01:00:00Z')), '2026-11-23');
});

test('refresh coalesces starts, counts zero as success, and retains published data on failure', async (t) => {
  let release;
  let calls = 0;
  const { instance } = await library(t, {
    seed: { items: [seedItem], outfits: [], people: [] },
    discover: async () => {
      calls++;
      if (calls > 1) throw new Error('离线');
      await new Promise((resolve) => { release = resolve; });
      return [];
    },
  });
  const first = instance.refresh();
  const second = instance.refresh();
  assert.equal(instance.get().refresh.status, 'running');
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(instance.get().refresh.added, 0);
  assert.equal(instance.get().refresh.status, 'done');
  await instance.tick();
  assert.equal(calls, 1);
  await instance.refresh();
  assert.equal(instance.get().refresh.status, 'failed');
  assert.equal(instance.get().items[0].id, seedItem.id);
  assert.ok(instance.get().refresh.lastSuccess);
});

test('qualified updates cap weekly additions, retain unlinked styles, and hide unavailable links', async (t) => {
  const batch = Array.from({ length: 15 }, (_, i) => ({
    ...seedItem, id: 'new-' + i, name: '单品 ' + i, shape: '独立款 ' + i, kind: 'seasonal',
    source: { url: 'https://example.com/catalog', title: '官方型录' }, purchase: { url: 'https://example.com/p/' + i, match: 'product' },
  }));
  let down = false;
  const { instance, dataDir } = await library(t, {
    discover: async () => batch,
    makeImage: async (item) => item.id + '.jpg',
    checkPurchase: async ({ purchase }) => down || purchase.url.endsWith('/0') ? 'unavailable' : 'verified',
  });
  await instance.refresh();
  assert.equal(instance.get().refresh.added, 12);
  assert.equal(instance.get().items.length, 12);
  assert.equal(instance.get().items.find((item) => item.id === 'new-0').purchase, null);
  down = true;
  await instance.refresh();
  assert.equal(instance.get().items.length, 12);
  assert.equal(instance.get().refresh.added, 0);
  assert.equal(instance.get().items.find((item) => item.id === 'new-1').purchase, null);
  assert.equal(JSON.parse(await readFile(path.join(dataDir, 'library.json'), 'utf8')).items.length, 12);
});

test('a reference outfit displays a verified local photo and keeps the original source', async (t) => {
  const pieces = ['上装', '下装'].map((category) => ({ name: category, category, color: '#565656', shape: '直筒' }));
  const looks = Array.from({ length: 21 }, (_, i) => ({
    id: 'look-' + i, name: '穿搭 ' + i, occasion: '出行', season: '春秋', date: '2025-10-10', tip: '同色搭配', pieces,
    source: { url: 'https://example.com/looks', title: '本人的街拍', locator: '图 ' + i, context: '出行', imageFile: `look-${i}.jpg`, ...(i === 2 && { fullBody: false }) },
  }));
  const { instance } = await library(t, {
    seed: { items: [], outfits: [], people: [{ id: 'person', name: '参考人物', summary: '简介', looks }] },
    photoFor: ({ imageFile }) => imageFile === 'look-1.jpg' ? null : `/media/library/${imageFile}`,
  });
  const verified = instance.find('look-0').entry;
  assert.equal(verified.image, '/media/library/look-0.jpg');
  assert.equal(verified.source.url, 'https://example.com/looks');
  assert.equal(instance.find('look-1').entry.image, undefined);
  const { renderLibrary } = await import('../public/library.js');
  const view = renderLibrary(instance.get(), new URLSearchParams('outfit=look-0'));
  assert.match(view, /全身原照/);
  assert.match(view, /试穿整套/);
  assert.doesNotMatch(view, /单品清单|已核对的单品|试穿这件|\/api\/library\/illustration/);
  const noPhoto = renderLibrary(instance.get(), new URLSearchParams('outfit=look-1'));
  assert.match(noPhoto, /本人的街拍/);
  assert.doesNotMatch(noPhoto, /试穿|试搭|\/api\/library\/illustration/);
  const partial = renderLibrary(instance.get(), new URLSearchParams('outfit=look-2'));
  assert.match(partial, /查看穿搭原照/);
  assert.doesNotMatch(partial, /全身原照|试穿整套/);
});

test('local lookbook photos appear as browsable standalone outfits and can be favorited', async (t) => {
  const { dataDir, options } = await library(t);
  const outfit = {
    id: 'lookbook-01', name: '米色夹克配牛仔', occasion: '周末', season: '春秋', tip: '用深色鞋接住牛仔裤',
    source: { url: 'https://example.com/looks', title: '官方型录', locator: 'Look 1', imageUrl: 'https://example.com/look-1.jpg' },
    pieces: ['上装', '下装'].map((category) => ({ name: category, category, color: '#565656', shape: '直筒' })),
  };
  await writeFile(path.join(dataDir, 'outfit-lookbook.json'), JSON.stringify([outfit, outfit, { ...outfit, id: 'missing-photo' }]));
  const { createLibrary } = await import('../library.mjs');
  const instance = await createLibrary({ ...options, photoFor: ({ imageFile }) => imageFile === 'lookbook-01.jpg' ? `/media/library/${imageFile}` : null });
  assert.equal(instance.get().outfits.length, 1);
  const published = instance.find(outfit.id).entry;
  assert.equal(published.image, '/media/library/lookbook-01.jpg');
  assert.equal(published.source.imageFile, 'lookbook-01.jpg');
  assert.equal(published.source.url, outfit.source.url);
  assert.deepEqual(await instance.favorite(outfit.id, true), [outfit.id]);
  const { renderLibrary } = await import('../public/library.js');
  assert.match(renderLibrary(instance.get(), new URLSearchParams('tab=outfits')), /米色夹克配牛仔/);
  const detail = renderLibrary(instance.get(), new URLSearchParams('outfit=lookbook-01'));
  assert.match(detail, /查看全身原照/);
  assert.match(detail, /试穿整套/);
});

test('the outfit brought into the studio appears first and remains visibly selected', async () => {
  const { renderStudio } = await import('../public/studio.js');
  const { S } = await import('../public/state.js');
  const original = { ...S, studio: { ...S.studio } };
  try {
    S.db = { photos: [], outfits: [], hairs: [], hidden: {}, looks: [], seasonName: '秋季', fit: { scores: { first: 98, target: 60 } } };
    S.library = { favorites: [], outfits: [
      { id: 'first', name: '高分精选', items: [], season: '四季' },
      { id: 'target', name: '从详情来', items: [], season: '春秋', personId: 'person', image: '/media/library/target.jpg' },
    ] };
    S.studio = { ...S.studio, entryOutfit: { kind: 'lib', id: 'target' }, outfit: { kind: 'lib', id: 'target' } };
    const view = renderStudio();
    assert.ok(view.indexOf('data-id="target"') < view.indexOf('data-id="first"'));
    assert.match(view, /data-id="target"[^>]*aria-pressed="true"/);
  } finally { Object.assign(S, original); }
});

test('weekly screening prioritizes strong matches and holds low, missing and previously uncertain results', async () => {
  const { rankNewItems } = await import('../library-research.mjs');
  const items = [{ id: 'acceptable' }, { id: 'best' }, { id: 'poor' }, { id: 'unscored' }, { id: 'uncertain', uncertain: '来源有疑问' }];
  const ranked = rankNewItems(items, [{ index: 1, score: 75 }, { index: 2, score: 91 }, { index: 3, score: 74 }, { index: 5, score: 97 }]);
  assert.deepEqual(ranked.filter((item) => !item.uncertain).map((item) => item.id), ['best', 'acceptable']);
  assert.equal(ranked.find((item) => item.id === 'uncertain').uncertain, '来源有疑问');
});

test('qualified photos appear during refresh while other images are still queued', async (t) => {
  const batch = [1, 2].map((i) => ({ ...seedItem, id: `new-${i}`, name: `新款 ${i}`, source: { url: 'https://example.com/catalog', title: '型录' } }));
  let release, waiting;
  const secondStarted = new Promise((resolve) => { waiting = resolve; });
  const { instance } = await library(t, { discover: async () => batch, async makeImage(item) {
    if (item.id === 'new-2') await new Promise((resolve) => { release = resolve; waiting(); });
    return `${item.id}.jpg`;
  } });
  const ongoing = instance.refresh();
  await secondStarted;
  try {
    assert.ok(instance.find('new-1'));
    assert.equal(instance.get().refresh.added, 1);
    await instance.favorite('new-1', true);
  } finally { release(); await ongoing; }
  assert.equal(instance.get().refresh.added, 2);
  assert.deepEqual(instance.get().favorites, ['new-1']);
});

test('photo-based try-on dresses the selected body using only the extracted outfit details', async () => {
  const { generationPrompt } = await import('../prompts.mjs');
  const base = { outfit: '素材库简写', libraryOutfitImage: 'look-0.jpg', referencePieces: ['蓝色细格短夹克，胸前两只贴袋', '黑色直筒裤'], referenceNotes: '袖口卷一折' };
  const first = generationPrompt(base);
  for (const detail of [...base.referencePieces, base.referenceNotes]) assert.ok(first.includes(detail));
  assert.match(first, /person\.jpg[^\n]*肩宽/);
  assert.doesNotMatch(first, /outfit-reference\.jpg|素材库简写/);
  const refinement = generationPrompt({ ...base, prevId: 'first', change: 'pose' });
  assert.match(refinement, /prev\.jpg/);
  assert.doesNotMatch(refinement, /outfit-reference\.jpg/);
});

test('the shipped catalog includes 40 illustrated items and 24 curated looks', async (t) => {
  const { items, outfits } = await import('../catalog/starter.mjs');
  const { instance } = await library(t, { seed: { items, outfits, people: [] } });
  const catalog = instance.get();
  assert.equal(catalog.items.length, 40);
  assert.deepEqual(Object.values(Object.groupBy(catalog.outfits, (look) => look.occasion)).map((group) => group.length), [4, 4, 4, 4, 4, 4]);
  const photos = await Promise.all(catalog.items.map(({ id }) => readFile(new URL('../catalog/images/' + id + '.jpg', import.meta.url))));
  assert.ok(photos.every((image) => image[0] === 0xff && image[1] === 0xd8));
});

test('an independent product withdrawal is processed when discovery fails', async (t) => {
  const purchase = { url: 'https://example.com/p/old', match: 'product' };
  const item = { ...seedItem, purchase, initialPurchase: { ...purchase, status: 'verified', checkedAt: 1 } };
  const { instance } = await library(t, {
    seed: { items: [item], outfits: [], people: [] },
    discover: async () => { throw new Error('资料搜索离线'); },
    checkPurchase: async () => 'unavailable',
  });
  assert.equal(instance.get().items[0].purchase.status, 'verified');
  await instance.refresh();
  assert.equal(instance.get().refresh.status, 'failed');
  assert.equal(instance.get().items[0].purchase, null);
});

test('a retailer HTTP 200 page with a different product ID invalidates the old link', async () => {
  const { verifyPurchase } = await import('../library-research.mjs');
  const purchase = { url: 'https://www.uniqlo.cn/product-detail.html?productCode=123456',
    name: '羊毛针织衫', color: '黑色', shape: '长袖', sku: '123456' };
  const htmlResponse = (text) => new Response('<html>' + text + '</html>', { headers: { 'content-type': 'text/html' } });
  assert.equal(await verifyPurchase({ purchase }, async () => htmlResponse('衬衫商品编号 456789')), 'unavailable');
  assert.equal(await verifyPurchase({ purchase }, async () => htmlResponse('商品编号 123456 羊毛针织衫 长袖 <img alt="黑色">')), 'verified');
  assert.equal(await verifyPurchase({ purchase }, async () => htmlResponse('<title>产品详情</title><script>load()</script>')), 'unknown');
});

test('weekly items cannot shadow a curated outfit ID', async (t) => {
  const { instance } = await library(t, {
    seed: { items: [seedItem], outfits: [{ id: 'wear-tee', name: '牛仔叠穿', occasion: '通勤', season: '春秋', why: '短款叠穿', itemIds: [seedItem.id] }], people: [] },
    discover: async () => [{ ...seedItem, id: 'wear-tee', name: '另一件', source: { url: 'https://example.com/catalog', title: '官方型录' } }],
    makeImage: async () => 'wear-tee.jpg',
  });
  await instance.refresh();
  assert.equal(instance.get().refresh.added, 0);
  assert.equal(instance.find('wear-tee').kind, 'outfit');
});
