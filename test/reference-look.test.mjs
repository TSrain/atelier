import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const pieces = ['蓝色细格短夹克，胸前两只贴袋', '黑色直筒裤'];
const spec = { baseId: 'avatarbody', outfit: { kind: 'lib', id: 'fixture-full-body' } };
const photoName = spec.outfit.id + '.jpg';
const fakeCodex = `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
const images = args.flatMap((arg, i) => arg === '-i' ? [args[i + 1]] : []);
const prompt = fs.readFileSync(0, 'utf8');
const extract = args.includes('--output-schema');
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify({ images, prompt, extract }) + '\\n');
if (extract) fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({ pieces: ${JSON.stringify(pieces)} }));
else fs.copyFileSync('person.jpg', 'out.png');
`;

test('photo-based try-on separates clothing extraction from image generation', { timeout: 30000 }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atelier-reference-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'photos'));
  await mkdir(path.join(dir, 'looks'));
  function fixture(relative, color) {
    const dest = path.join(dir, relative);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=' + color + ':s=64x96', '-frames:v', '1', dest]);
    return dest;
  }
  const base = fixture('photos/avatarbody.jpg', 'red');
  const bust = fixture('photos/avatarbust.jpg', 'green');
  const adjusted = fixture('photos/adjusted.jpg', 'yellow');
  const catalog = path.join(dir, 'catalog');
  await mkdir(path.join(catalog, 'images'), { recursive: true });
  const reference = fixture('catalog/images/' + photoName, 'purple');
  fixture('catalog/images/fixture-partial.jpg', 'white');
  const fixturePieces = ['上装', '下装'].map((category) => ({ name: category, category, color: '#565656', shape: '直筒' }));
  const looks = [spec.outfit.id, 'fixture-partial'].map((id, index) => ({
    id, name: '合成测试搭配', occasion: '周末', season: '春秋', date: '2026-11-24', tip: '深浅叠穿', pieces: fixturePieces,
    source: { url: 'https://example.com/looks', title: '测试资料', locator: id, context: '日常', imageFile: id + '.jpg', fullBody: index === 0 },
  }));
  await writeFile(path.join(catalog, 'people-cn.json'), JSON.stringify([{ id: 'fixture-person', name: '测试人物', summary: '合成测试', looks }]));
  const legacy = { id: 'abcd', baseId: 'avatarbody', status: 'done', libraryOutfitImage: photoName, spec };
  const oldResult = fixture('looks/' + legacy.id + '.jpg', 'blue');
  const photo = { kind: 'photo', source: 'avatar', w: 64, h: 96 };
  await writeFile(path.join(dir, 'db.json'), JSON.stringify({
    profile: {}, photos: [{ ...photo, id: 'avatarbody' }, { ...photo, id: 'avatarbust' }, { ...photo, id: 'adjusted', bodyEditId: 'edit' }],
    settings: { bodyBaseId: 'adjusted' }, looks: [legacy],
  }));
  const executable = path.join(dir, 'codex.mjs');
  const log = path.join(dir, 'calls.jsonl');
  await writeFile(executable, fakeCodex, { mode: 0o755 });
  await writeFile(log, '');

  const server = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, PORT: '0', CODEX_BIN: executable, ATELIER_DATA_DIR: dir, ATELIER_CATALOG_DIR: catalog,
      CALL_LOG: log, ATELIER_AUTO: '0', ATELIER_LIBRARY_AUTO: '0' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  const closed = once(server, 'close');
  t.after(async () => { server.kill(); await closed; });
  const [ready] = await Promise.race([once(server.stdout, 'data'), closed.then(() => { throw new Error('测试服务未能启动'); })]);
  const api = ready.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0] + '/api';
  async function tryOn(request) {
    await writeFile(log, '');
    const response = await fetch(api + '/looks', { method: 'POST', body: request instanceof FormData ? request : JSON.stringify(request) });
    const queued = await response.json();
    assert.equal(response.status, 200, queued.error);
    for (let i = 0; i < 200; i++) {
      const state = await (await fetch(api + '/state')).json();
      const look = state.looks.find(({ id }) => id === queued.id);
      assert.notEqual(look.status, 'failed', look.error);
      if (look.status === 'done') {
        const calls = (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
        return { look, calls };
      }
      await delay(30);
    }
    assert.fail('试穿任务未完成');
  }
  async function checkExtraction({ look, calls }, original, inputs = { 'person.jpg': base }) {
    assert.deepEqual(calls.map((call) => call.extract), [true, false]);
    const [inspect, render] = calls;
    assert.equal(inspect.images.length, 1);
    assert.deepEqual(await readFile(inspect.images[0]), await readFile(original));
    assert.deepEqual(render.images.map((file) => path.basename(file)), Object.keys(inputs));
    for (const file of render.images) assert.deepEqual(await readFile(file), await readFile(inputs[path.basename(file)]));
    for (const piece of pieces) assert.ok(render.prompt.includes(piece), piece);
    assert.deepEqual(look.referencePieces, pieces);
  }

  await t.test('library photo and previous photo-based results', async () => {
    const first = await tryOn(spec);
    await checkExtraction(first, reference);
    assert.equal(first.look.spec.scene, 'auto');
    assert.ok(first.look.scene);
    assert.ok(first.look.pose);
    assert.ok(first.calls[1].prompt.includes(first.look.scene));
    assert.match(first.calls[1].prompt, /person\.jpg[\s\S]*仅用于确认身份和身形/);
    assert.match(first.calls[1].prompt, /眼镜的反光/);
    assert.match(first.calls[1].prompt, /鞋底与地面的接触阴影/);
    assert.doesNotMatch(first.calls[1].prompt, /保留 person\.jpg 的背景和光线/);

    const { look, calls } = await tryOn({ from: first.look.id, change: 'scene' });
    assert.ok(look.scene);
    assert.notEqual(look.scene, first.look.scene);
    assert.equal(look.pose, first.look.pose);
    assert.deepEqual(calls.map((call) => call.extract), [false]);
    assert.deepEqual(calls[0].images.map((file) => path.basename(file)), ['person.jpg', 'prev.jpg']);
    assert.match(calls[0].prompt, /鞋底与地面的接触阴影/);
    assert.match(calls[0].prompt, /保留 prev\.jpg 的姿势/);

    const changedPose = await tryOn({ from: look.id, change: 'pose' });
    assert.equal(changedPose.look.scene, look.scene);
    assert.ok(changedPose.look.pose);
    assert.match(changedPose.calls[0].prompt, /保留 prev\.jpg 的背景和光线/);
    assert.doesNotMatch(changedPose.calls[0].prompt, /把背景换成/);
  });

  await t.test('an explicit keep request preserves the original photo environment', async () => {
    const { look, calls } = await tryOn({ ...spec, scene: 'keep' });
    assert.equal(look.scene, '');
    assert.match(calls[1].prompt, /保留 person\.jpg 的背景和光线/);
  });

  await t.test('a partial reference remains available to browse and cannot start a try-on', async () => {
    const library = await (await fetch(api + '/library')).json();
    const partial = library.outfits.find((outfit) => outfit.image && outfit.source?.fullBody === false);
    assert.ok(partial);
    const response = await fetch(api + '/looks', {
      method: 'POST', body: JSON.stringify({ ...spec, outfit: { kind: 'lib', id: partial.id } }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /暂缺全身原照/);
  });
  await t.test('local reference upload', async () => {
    const form = new FormData();
    form.set('spec', JSON.stringify({ baseId: spec.baseId }));
    form.set('reference', new Blob([await readFile(reference)], { type: 'image/jpeg' }), 'outfit.jpg');
    const first = await tryOn(form);
    await checkExtraction(first, path.join(dir, first.look.localOutfitImage));
  });
  await t.test('legacy result with no saved clothing description', async () => {
    await checkExtraction(await tryOn({ from: legacy.id, change: 'pose' }), oldResult);
  });
  await t.test('a bust base uses the selected full-body edit as its body guide', async () => {
    const result = await tryOn({ ...spec, baseId: 'avatarbust' });
    await checkExtraction(result, reference, { 'person.jpg': bust, 'body-guide.jpg': adjusted });
    const { prompt } = result.calls[1];
    assert.match(prompt, /(?:面容|身份)[^，。\n]*person\.jpg|person\.jpg[^，。\n]*(脸|五官|身份)/);
    assert.match(prompt, /(?:身形|体型|比例)[^，。\n]*body-guide\.jpg|body-guide\.jpg[^，。\n]*(身形|体型|比例)/);
  });
});
