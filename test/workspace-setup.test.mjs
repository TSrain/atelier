import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const fake = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const cwd = process.cwd();
const [, , ...args] = process.argv;
const output = args.indexOf('-o');
if (output >= 0) {
  let data;
  if (cwd.includes('classify_')) {
    const db = JSON.parse(fs.readFileSync(path.resolve(cwd, '../../db.json')));
    const keys = {face:'face_front', body:'body_front', side:'side_left'};
    const inputs = args.flatMap((arg, index) => arg === '-i' ? [args[index+1]] : []);
    data = { photos: inputs.map((file, index) => {
      const photo = db.photos.find(({id}) => id === path.basename(file, '.jpg'));
      return { slot: keys[photo.setupSlot], index: index+1, quality:'good' };
    }) };
  } else data = { summary:'示例', diagnosis:[], hairstyles:[], outfits:[], items:[], celebrities:[], style:{} };
  fs.writeFileSync(args[output + 1], JSON.stringify(data));
} else if (cwd.includes('sheet_')) fs.copyFileSync('ref1.jpg','out.png');
else if (fs.existsSync('person.jpg')) fs.copyFileSync('person.jpg','out.png');
`;

const slowFullBodyProbe = `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const args = process.argv.slice(2);
if (args.at(-1)?.endsWith('/photos/avatarbody.jpg')) await delay(1250);
const result = spawnSync('ffprobe', args, {
  env: {...process.env, PATH:process.env.ATELIER_TEST_PATH}, stdio:'inherit',
});
process.exit(result.status ?? 1);
`;

async function launch(dir, executable) {
  const processHandle = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, PORT: '0', CODEX_BIN: executable,
      PATH: path.dirname(executable) + path.delimiter + process.env.PATH, ATELIER_TEST_PATH: process.env.PATH, ATELIER_DATA_DIR: dir, ATELIER_AUTO: '0', ATELIER_LIBRARY_AUTO: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const closed = once(processHandle, 'close');
  const [line] = await Promise.race([once(processHandle.stdout, 'data'), closed.then(() => { throw new Error('启动测试服务失败'); })]);
  const root = line.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  return {
    call: (route, options) => fetch(root + '/api' + route, options),
    async stop() { if (processHandle.exitCode === null) processHandle.kill(); await closed; },
  };
}

test('first setup unlocks only after confirming a modeled photo and copies to a new data directory', { timeout: 30000 }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atelier-setup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const executable = path.join(dir, 'codex.mjs');
  await writeFile(executable, fake, { mode: 0o755 });
  await writeFile(path.join(dir, 'ffprobe'), slowFullBodyProbe, { mode: 0o755 });
  const first = await launch(path.join(dir, 'original'), executable);
  t.after(() => first.stop());
  assert.equal((await first.call('/library')).status, 409);
  assert.equal((await first.call('/setup/confirm', { method: 'POST' })).status, 400);
  assert.equal((await first.call('/state', { headers: { origin: 'https://example.com' } })).status, 403);
  assert.equal((await first.call('/setup/build', { method: 'POST' })).status, 400);
  for (const key of ['face', 'body', 'side']) {
    const body = await readFile(new URL('../public/setup-' + key + '.jpg', import.meta.url));
    const upload = await first.call('/photos?setupSlot=' + key, { method: 'POST', body });
    assert.equal(upload.status, 200);
  }

  const awaitState = async (predicate) => {
    for (let index = 0; index < 250; index++) {
      const state = await (await first.call('/state')).json();
      if (predicate(state)) return state;
      await delay(30);
    }
    assert.fail('任务未完成');
  };
  const approved = await awaitState((db) => db.photos.filter(({ slot }) => slot).length === 3);
  assert.equal((await first.call('/setup/build', { method: 'POST' })).status, 200);
  const modeled = await awaitState((db) => db.sheets?.avatarBody?.status === 'done' && db.sheets?.avatarBust?.status === 'done');
  assert.ok(modeled.photos.some(({ id }) => id === 'avatarbody'), 'concurrent portrait generation must retain the full-body entry');
  assert.ok(modeled.photos.some(({ id }) => id === 'avatarbust'));
  const jobs = path.join(dir, 'original', 'jobs');
  const avatarJob = (await readdir(jobs)).find((name) => name.startsWith('sheet_avatarBody_'));
  for (const [index, key] of ['face', 'body', 'side'].entries()) {
    const { id } = approved.photos.find(({ setupSlot }) => setupSlot === key);
    const uploaded = await readFile(path.join(dir, 'original', 'photos', id + '.jpg'));
    const given = await readFile(path.join(jobs, avatarJob, 'ref' + (index + 1) + '.jpg'));
    assert.deepEqual(uploaded, given);
  }
  assert.equal((await first.call('/library')).status, 409);
  const confirmation = await first.call('/setup/confirm', { method: 'POST' });
  assert.equal(confirmation.status, 200, await confirmation.text());
  const library = await (await first.call('/library')).json();
  const tryOn = await first.call('/looks', { method: 'POST', body: JSON.stringify({
    baseId: 'avatarbody', outfit: { kind: 'lib', id: library.outfits[0].id }, scene: 'keep',
  }) });
  const look = await tryOn.json();
  assert.equal(tryOn.status, 200, look.error);
  await awaitState((db) => db.looks.find(({ id }) => id === look.id)?.status === 'done');
  const favorite = await first.call('/looks?id=' + look.id, { method: 'PATCH', body: JSON.stringify({ fav: true }) });
  assert.equal(favorite.status, 200);

  await first.stop();
  await cp(path.join(dir, 'original'), path.join(dir, 'restored'), { recursive: true });
  const restored = await launch(path.join(dir, 'restored'), executable);
  t.after(() => restored.stop());
  const state = await (await restored.call('/state')).json();
  assert.ok(state.settings.onboarding.confirmedAt);
  assert.equal(state.settings.automatic, false);
  assert.ok(state.photos.some(({ id }) => id === 'avatarbody'));
  assert.ok(state.looks.some(({ id, fav }) => id === look.id && fav));
  assert.equal((await restored.call('/library')).status, 200);
});
