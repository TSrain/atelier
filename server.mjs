import http from 'node:http';
import { spawn } from 'node:child_process';
import { promises as fs, existsSync, createReadStream, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ANALYSIS_SCHEMA, ANNOTATE_SCHEMA, CLASSIFY_SCHEMA, FEED_SCHEMA, FIT_SCHEMA, GARMENT_SCHEMA, HAIRS_SCHEMA, OUTFITS_SCHEMA, PREFS_SCHEMA, REFERENCE_OUTFIT_SCHEMA, SHEETS, SLOTS,
  analysisPrompt, annotatePrompt, classifyPrompt, feedPrompt, fitPrompt, garmentPrompt, generationPrompt, hairsPrompt, matchScene, outfitReviewPrompt, outfitsPrompt, panelPrompt, prefsPrompt, randomPose, referenceOutfitPrompt, sheetPrompt } from './prompts.mjs';
import { DEFAULT_CITY, fetchWeather, findCity, localDate, localHour, mismatch, nearestCity, seasonName } from './weather.mjs';
import { createFeed } from './feed.mjs';
import { createLibrary } from './library.mjs';
import { apparelIllustration } from './library-art.mjs';
import { pictureSchema, rankNewItems, researchPrompt, researchSchema, verifyCandidates, verifyPurchase } from './library-research.mjs';
import { items as starterItems, outfits as starterOutfits } from './catalog/starter.mjs';
import { STYLE_QUIZ_VERSION, styleQuizIds, styleQuizNotes, styleQuizText } from './public/style-questions.js';
import { BODY_CONTROLS, isBodyBase, isModeledBody, usableBodySide } from './public/body-shape.js';
import { onboardingState, SETUP_SLOTS } from './public/onboarding-state.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.ATELIER_DATA_DIR ? path.resolve(process.env.ATELIER_DATA_DIR) : path.join(ROOT, 'data');
const CATALOG = process.env.ATELIER_CATALOG_DIR ? path.resolve(process.env.ATELIER_CATALOG_DIR) : path.join(ROOT, 'catalog');
const LIBRARY = path.join(DATA, 'library');
const LIBRARY_IMAGES = path.join(LIBRARY, 'images');
const CATALOG_IMAGES = path.join(CATALOG, 'images');
const DIRS = { photos: path.join(DATA, 'photos'), looks: path.join(DATA, 'looks'), jobs: path.join(DATA, 'jobs'), assets: path.join(DATA, 'assets') };
const DB_FILE = path.join(DATA, 'db.json');
const PORT = Number(process.env.PORT || 5178);
const CODEX = process.env.CODEX_BIN || 'codex';
const MAX_PARALLEL = 2;
const DAILY_COUNT = 5;
const MORE_COUNT = 2;
const BG_DAILY_CAP = 12;
const SETUP_JOB_TIMEOUT = 6 * 60 * 1000;
const KEEP_OUTFIT_DAYS = 21;

for (const d of [DATA, ...Object.values(DIRS)]) await fs.mkdir(d, { recursive: true });

const db = existsSync(DB_FILE)
  ? JSON.parse(readFileSync(DB_FILE, 'utf8'))
  : { profile: { name: '', age: '', height: '', weight: '', shoulder: '', chest: '', waist: '', topSize: '', bottomSize: '', shoe: '', notes: '' }, photos: [], analysis: null, analysisJob: null, looks: [] };
if (db.classifyJob?.status === 'running') db.classifyJob = { status: 'failed', error: '服务重启，任务中断' };
if (db.analysisJob?.status === 'running') db.analysisJob = { status: 'failed', error: '服务重启，任务中断' };
for (const sh of Object.values(db.sheets || {})) if (sh.status === 'running' || sh.status === 'queued') Object.assign(sh, { status: 'failed', error: '服务重启，任务中断' });
for (const l of db.looks) if (l.status === 'running' || l.status === 'queued') Object.assign(l, { status: 'failed', error: '服务重启，任务中断' });
db.bodyEdits ||= [];
db.bodyBaseHistory ||= [];
for (const edit of db.bodyEdits) if (['queued', 'running'].includes(edit.status)) Object.assign(edit, { status: 'failed', error: '服务重启，任务中断，可重新生成' });
const save = () => {
  const temporary = DB_FILE + '.tmp';
  writeFileSync(temporary, JSON.stringify(db, null, 2), { mode: 0o600 });
  renameSync(temporary, DB_FILE);
};
const uid = () => crypto.randomBytes(5).toString('hex');

// 穿搭与发型原先按下标存在 analysis 里，重新分析就会整体覆盖；这里拆成有独立 id 的集合。
if (!db.outfits) {
  const a = db.analysis?.diagnosis ? db.analysis : null;
  const legacy = (rel) => (existsSync(path.join(DATA, rel)) ? { art: 'done', image: rel, imageAt: a.analyzedAt } : { art: 'failed' });
  db.outfits = (a?.outfits || []).map((o, i) => ({ id: uid(), status: 'ready', source: 'analysis', batch: '', createdAt: a.analyzedAt, ...o,
    season: '四季', fit: 85, weather_note: '', indoor: false, fav: false, ...legacy(`assets/${a.ver}_outfits${i < 3 ? 'A' : 'B'}_${i % 3}.jpg`) }));
  db.hairs = (a?.hairstyles || []).map((h, i) => ({ id: uid(), source: 'analysis', createdAt: a.analyzedAt, ...h, fav: false, ...legacy(`assets/${a.ver}_hair_${i}.jpg`) }));
  for (const h of db.hairs) h.group = db.hairs.map((x) => x.id);
  for (const k of ['outfitsA', 'outfitsB', 'hair']) delete db.sheets?.[k];
}
db.hairs ||= [];
db.jobs ||= [];
db.settings ||= {};
if (onboardingState(db).stage !== 'ready') {
  db.settings.onboarding ||= {};
  db.settings.automatic ??= false;
}
const workspaceReady = () => onboardingState(db).stage === 'ready';
const automatic = () => workspaceReady() && db.settings.automatic !== false && process.env.ATELIER_AUTO !== '0';
db.settings.city ||= { ...DEFAULT_CITY };
db.prefs ||= { notes: [], directions: [] };
db.feedback ||= [];
db.hidden ||= {};
db.wardrobe ||= [];
db.locks ||= {};
for (const j of db.jobs) if (j.status === 'running') Object.assign(j, (j.tries || 0) < 2 ? { status: 'queued' } : { status: 'failed', error: '服务重启，任务中断' });
db.jobs = db.jobs.filter((j) => j.status === 'queued');
const drafting = new Set(db.outfits.filter((o) => o.status === 'drafting').map((o) => o.id));
db.outfits = db.outfits.filter((o) => !drafting.has(o.id));
if (db.daily) db.daily.outfitIds = db.daily.outfitIds.filter((id) => !drafting.has(id));
for (const e of [...db.outfits, ...db.hairs]) if (e.art === 'pending' && !db.jobs.some((j) => j.ids.includes(e.id))) e.art = 'failed';
save();

const run = (cmd, args, { input, cwd, timeout } = {}) => new Promise((resolve) => {
  const p = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (err += d));
  let timedOut = false, killTimer;
  const timer = timeout && setTimeout(() => {
    timedOut = true;
    p.kill('SIGTERM');
    killTimer = setTimeout(() => p.kill('SIGKILL'), 5000);
  }, timeout);
  const finish = (code, error = err) => {
    clearTimeout(timer);
    clearTimeout(killTimer);
    resolve({ code: timedOut ? -1 : code, out, err: timedOut ? '调用超时，请重试' : error });
  };
  p.on('error', (e) => finish(-1, String(e)));
  p.on('close', (code) => finish(code));
  p.stdin.on('error', () => {});
  p.stdin.end(input ?? '');
});
async function normalize(src, dest, max) {
  const vf = `scale='if(gt(iw,ih),min(${max},iw),-2)':'if(gt(iw,ih),-2,min(${max},ih))'`;
  const r = await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', vf, '-frames:v', '1', '-q:v', '3', dest]);
  if (r.code !== 0) throw new Error('图片处理失败：' + r.err.slice(-200));
}

async function dims(file) {
  const r = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const [w, h] = r.out.trim().split(',').map(Number);
  return { w: w || 3, h: h || 4 };
}

export async function addPhoto(srcPath, { label = '未标注', kind = 'photo', source = 'real', bodyEdit, setupSlot } = {}) {
  const id = uid();
  await normalize(srcPath, path.join(DIRS.photos, `${id}.jpg`), 1600);
  await normalize(srcPath, path.join(DIRS.photos, `${id}_t.jpg`), 520);
  const photo = { id, label, kind, source, createdAt: Date.now(), ...(await dims(photoPath(id))) };
  if (setupSlot) photo.setupSlot = setupSlot;
  if (bodyEdit) {
    photo.bodyEditId = bodyEdit.id;
    bodyEdit.photoId = id;
  }
  db.photos.push(photo);
  save();
  return photo;
}
function photoPath(id) { return path.join(DIRS.photos, `${id}.jpg`); }
const cutoutScript = path.join(ROOT, 'scripts/body-cutout.swift');
const cutoutVersion = crypto.createHash('sha256').update(readFileSync(cutoutScript)).digest('hex').slice(0, 12);
const cutoutDir = path.join(DIRS.photos, 'cutouts');
const pendingCutouts = new Map();
let cutoutCompiler;

function getCutoutTool() {
  const toolDir = path.join(DATA, 'tools');
  const binary = path.join(toolDir, `body-cutout-${cutoutVersion}`);
  if (existsSync(binary)) return Promise.resolve(binary);
  cutoutCompiler ||= (async () => {
    await fs.mkdir(toolDir, { recursive: true });
    const temporary = `${binary}.${uid()}`;
    try {
      const result = await run('/usr/bin/swiftc', ['-module-cache-path', path.join(toolDir, 'swift-cache'), '-o', temporary, cutoutScript], { timeout: 90000 });
      if (result.code !== 0) {
        console.error('Body cutout compiler:', result.err.slice(-600));
        throw new Error('本机暂时无法启动抠图');
      }
      await fs.rename(temporary, binary);
      return binary;
    } finally { await fs.rm(temporary, { force: true }); }
  })().finally(() => { cutoutCompiler = null; });
  return cutoutCompiler;
}

async function getBodyCutout(photo) {
  const version = Number(photo.createdAt || 0);
  const key = `${photo.id}-${version}-${cutoutVersion}`;
  const png = path.join(cutoutDir, `${key}.png`);
  const metadata = path.join(cutoutDir, `${key}.json`);
  const image = `/media/photos/cutouts/${key}.png`;
  if (existsSync(metadata) && existsSync(png)) return { image, landmarks: JSON.parse(await fs.readFile(metadata, 'utf8')) };
  if (!pendingCutouts.has(key)) {
    pendingCutouts.set(key, (async () => {
      await fs.mkdir(cutoutDir, { recursive: true });
      const temporary = path.join(cutoutDir, `${key}.${uid()}.png`);
      try {
        const result = await run(await getCutoutTool(), [photoPath(photo.id), temporary], { timeout: 30000 });
        if (result.code !== 0) {
          console.error('Body cutout:', result.err.slice(-400));
          throw new Error('这张照片暂时无法抠图，可以重试或换一张');
        }
        const landmarks = JSON.parse(result.out);
        if (!db.photos.includes(photo)) throw new Error('照片已删除');
        await fs.rename(temporary, png);
        if (!db.photos.includes(photo)) {
          await fs.rm(png, { force: true });
          throw new Error('照片已删除');
        }
        writeFileSync(metadata, JSON.stringify(landmarks));
        return { image, landmarks };
      } finally { await fs.rm(temporary, { force: true }); }
    })().finally(() => pendingCutouts.delete(key)));
  }
  return pendingCutouts.get(key);
}
for (const p of db.photos) if (!p.w) Object.assign(p, await dims(photoPath(p.id)));
save();

async function codexExec({ cwd, images, prompt, sandbox, schemaFile, outFile, effort, search, timeout }) {
  const args = [...(search ? ['--search'] : []), 'exec', '--skip-git-repo-check', '-s', sandbox, '-C', cwd, '--json', '-c', `model_reasoning_effort="${effort}"`];
  if (schemaFile) args.push('--output-schema', schemaFile);
  if (outFile) args.push('-o', outFile);
  for (const img of images) args.push('-i', img);
  args.push('-');
  const r = await run(CODEX, args, { input: prompt, cwd, timeout });
  await fs.writeFile(path.join(cwd, 'events.jsonl'), r.out).catch(() => {});
  if (r.code !== 0) throw new Error(`Codex 退出码 ${r.code}：${(r.err || r.out).trim().split('\n').slice(-3).join(' ').slice(-400)}`);
  return r.out;
}

async function generateImage(jobId, refs, prompt, timeout) {
  const cwd = path.join(DIRS.jobs, jobId);
  await fs.mkdir(cwd, { recursive: true });
  const images = [];
  for (const [name, src] of refs) { await fs.copyFile(src, path.join(cwd, name)); images.push(path.join(cwd, name)); }
  const out = await codexExec({ cwd, images, prompt, sandbox: 'workspace-write', effort: 'low', timeout });
  const local = path.join(cwd, 'out.png');
  if (existsSync(local)) return local;
  const thread = out.match(/"thread_id":"([^"]+)"/)?.[1];
  const dir = thread && path.join(os.homedir(), '.codex', 'generated_images', thread);
  const files = dir && existsSync(dir) ? (await fs.readdir(dir)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)) : [];
  if (!files.length) throw new Error('Codex 没有返回图片，可能是出图额度用尽或请求被拒绝');
  const stats = await Promise.all(files.map(async (f) => ({ f, t: (await fs.stat(path.join(dir, f))).mtimeMs })));
  return path.join(dir, stats.sort((x, y) => y.t - x.t)[0].f);
}

const libraryImageJobs = [];
const libraryGenerationTimeout = 5 * 60 * 1000;
const libraryFilename = /^[a-z0-9]+(?:-[a-z0-9]+)*\.jpg$/;
function libraryImagePath(file) {
  if (!libraryFilename.test(file)) return null;
  const dynamic = path.join(LIBRARY_IMAGES, file);
  if (existsSync(dynamic)) return dynamic;
  const builtIn = path.join(CATALOG_IMAGES, file);
  return existsSync(builtIn) ? builtIn : null;
}

async function libraryQuery(job, schema, prompt, images = [], search = false, effort = 'low') {
  const cwd = path.join(DIRS.jobs, `library_${job}_${uid()}`);
  await fs.mkdir(cwd, { recursive: true });
  const schemaFile = path.join(cwd, 'schema.json');
  const outFile = path.join(cwd, 'result.json');
  await fs.writeFile(schemaFile, JSON.stringify(schema));
  await codexExec({ cwd, images, prompt, schemaFile, outFile, sandbox: 'read-only', effort, search,
    timeout: libraryGenerationTimeout });
  return JSON.parse(await fs.readFile(outFile, 'utf8'));
}

async function createLibraryPhoto(item) {
  const prompt = `用内置 imagegen 生成一张真实男装单品摄影。单品：${item.name}，版型与材质：${item.shape}，主色：${item.color}。平铺，暖灰纯色底，柔光，单品轮廓完整居中，正方形构图。画面只放这一种衣物、鞋或配饰，鞋子成对，没有人、衣架、字、标签、商标、水印，忠实按版型和颜色呈现。将唯一的成品保存为 out.png。`;
  const result = await generateImage(`library_item_${uid()}`, [], prompt, libraryGenerationTimeout);
  const check = await libraryQuery('photo-check', pictureSchema,
    `检查这一张单品图是否只展示了 ${item.name}（${item.shape}，${item.color}），服装完整、颜色和轮廓一致且看得清楚，无人、外露商标或文字。所有条件满足才 approved=true。`,
    [result]);
  if (!check.approved) return null;
  await fs.mkdir(LIBRARY_IMAGES, { recursive: true });
  const file = item.id + '.jpg';
  const final = path.join(LIBRARY_IMAGES, file);
  const temporary = path.join(LIBRARY_IMAGES, item.id + '-temp-' + uid() + '.jpg');
  try {
    await normalize(result, temporary, 960);
    await fs.rename(temporary, final);
    return file;
  } finally { await fs.rm(temporary, { force: true }); }
}

const people = (await Promise.all(['cn', 'jp', 'kr'].map(async (region) => {
  try { return JSON.parse(await fs.readFile(path.join(CATALOG, `people-${region}.json`), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}))).flat();
const library = await createLibrary({
  dataDir: LIBRARY,
  seed: { items: starterItems, outfits: starterOutfits, people },
  async discover(items) {
    const choices = styleQuizText(db.prefs.notes);
    const owned = db.wardrobe.map((w) => w.name).filter((name) => name && name !== '识别中');
    const profile = [A() ? brief() : generalPrefs().join('、'), choices.length && `想尝试：${choices.join('、')}`,
      owned.length && `已有单品：${owned.join('、')}。优先选能与衣橱搭配、且用户尚未拥有的款式。`].filter(Boolean).join('\n');
    if (!profile) return [];
    const result = await libraryQuery('weekly', researchSchema, researchPrompt(items, Date.now(), profile), [], true, 'medium')
      .catch((e) => { console.error('library research', e.message); throw new Error('暂时无法完成公开资料搜索'); });
    const verified = await verifyCandidates(result);
    const eligible = verified.filter((candidate) => !candidate.uncertain);
    if (!eligible.length) return verified;
    const entries = eligible.map((item) => `${item.name}（${item.category}，${item.season}，主色 ${item.color}）：${item.shape}`);
    const review = await libraryQuery('weekly-fit', FIT_SCHEMA, fitPrompt({ brief: profile, entries, styleChoices: choices }), [], false, 'medium');
    return [...rankNewItems(eligible, review.scores), ...verified.filter((candidate) => candidate.uncertain)];
  },
  makeImage(item) {
    return new Promise((resolve, reject) => {
      libraryImageJobs.push(() => createLibraryPhoto(item).then(resolve, reject));
      pump();
    });
  },
  checkPurchase: verifyPurchase,
  photoFor(item) {
    const file = item.imageFile || item.id + '.jpg';
    return libraryImagePath(file) ? `/media/library/${file}` : null;
  },
});

const ask = (job, schema, prompt, { images = [], effort = 'low' } = {}) => libraryQuery(job, schema, prompt, images, false, effort);
const A = () => (db.analysis?.diagnosis ? db.analysis : null);
const feed = createFeed({
  dataDir: DATA,
  async select(candidates, count, slots) {
    const style = A() && `形象档案建议「${A().style.archetype}」、关键词为${A().style.keywords.join('、')}的男性`;
    const city = db.settings.city.name;
    const weather = db.weather?.city === city && db.weather.date === localDate() ? db.weather.text : '';
    return (await ask('feed', FEED_SCHEMA, feedPrompt({ candidates, count, slots, style, notes: generalPrefs(), city, weather, season: seasonName() }))).picks;
  },
});

const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number(n) || 0));
async function runAnalysis(feedback) {
  const photos = workspaceReady()
    ? db.photos.filter((p) => p.kind === 'photo' && p.source === 'real').slice(-12)
    : onboardingState(db).slots.map(({ photo }) => photo).filter(Boolean);
  if (!photos.length) throw new Error('请先上传至少一张本人真实照片');
  const referencePeople = library.get().people;
  const prompt = analysisPrompt(db.profile, photos, { feedback, previous: A(), styleChoices: styleQuizText(db.prefs.notes), referencePeople });
  const cwd = path.join(DIRS.jobs, `analysis_${uid()}`);
  await fs.mkdir(cwd, { recursive: true });
  const schemaFile = path.join(cwd, 'schema.json');
  const outFile = path.join(cwd, 'result.json');
  await fs.writeFile(schemaFile, JSON.stringify(ANALYSIS_SCHEMA));
  await codexExec({ cwd, images: photos.map((p) => photoPath(p.id)), prompt, sandbox: 'read-only', schemaFile, outFile, effort: 'medium', timeout: SETUP_JOB_TIMEOUT });
  const raw = await fs.readFile(outFile, 'utf8');
  const a = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  if (referencePeople.length) {
    const allowed = new Set(referencePeople.map((person) => person.name));
    a.celebrities = a.celebrities.filter(({ name }) => allowed.delete(name)).slice(0, 5);
  }
  for (const d of a.diagnosis) {
    d.photoId = (photos[d.photo - 1] || photos[0]).id;
    const c = d.crop;
    c.x = clamp(c.x, 0, 0.9); c.y = clamp(c.y, 0, 0.9);
    c.w = clamp(c.w, 0.1, 1 - c.x); c.h = clamp(c.h, 0.1, 1 - c.y);
    for (const p of d.points) { p.x = clamp(p.x, c.x + c.w * 0.04, c.x + c.w * 0.96); p.y = clamp(p.y, c.y + c.h * 0.04, c.y + c.h * 0.96); }
  }
  return { ...a, analyzedAt: Date.now(), ver: uid(), photoIds: photos.map((p) => p.id) };
}

const SECTIONS = { diagnosis: ['summary', 'diagnosis'], style: ['color', 'style'], hairstyles: ['hairstyles'], outfits: ['outfits', 'items'], celebrities: ['celebrities'] };
// 重新分析时只覆盖选中的板块；用户确认过并锁定的板块保持原样。
function applyAnalysis(a, sections) {
  const first = !A();
  const picked = first ? Object.keys(SECTIONS) : Object.keys(SECTIONS).filter((k) => sections.includes(k) && !db.locks[k]);
  const merged = first ? a : { ...db.analysis, analyzedAt: a.analyzedAt, ver: a.ver, photoIds: a.photoIds };
  if (!first) for (const k of picked) for (const field of SECTIONS[k]) merged[field] = a[field];
  db.analysis = merged;
  db.analysisJob = { status: 'done', sections: picked };
  db.drift = null;
  db.sheets ||= {};
  for (const [key, id] of Object.entries(AVATARS)) {
    const setupPhotoIds = workspaceReady() ? null : a.photoIds;
    const current = db.sheets[key];
    if (current?.status !== 'done' || !db.photos.some((p) => p.id === id) || setupPhotoIds) {
      if (current?.status === 'running') continue;
      db.sheets[key] = { status: 'queued', ver: a.ver, ...(setupPhotoIds && { setupPhotoIds }) };
    }
  }
  if (picked.includes('outfits')) {
    db.sheets.items = { status: 'queued', ver: a.ver };
    retire(db.outfits, 'outfit');
    const added = a.outfits.map((o) => ({ id: uid(), status: 'ready', source: 'analysis', batch: localDate(), createdAt: Date.now(), ...cleanOutfit({ ...o, season: '四季', fit: 85 }), art: 'pending', fav: false }));
    db.outfits.unshift(...added);
    queueArt('outfits', added.map((o) => o.id), 'bg');
  }
  if (picked.includes('hairstyles')) {
    retire(db.hairs, 'hair');
    addHairs(a.hairstyles, 'analysis', 'bg');
  }
  if (picked.includes('celebrities')) {
    db.celebs = [];
    if (automatic() && library.get().people.length) fetchCelebs(merged).catch((e) => console.error('celebs', e.message));
  }
  save(); pump();
  if (automatic()) { annotate(); scoreFit(); }
}

function startAnalysis(sections = Object.keys(SECTIONS), feedback = '') {
  if (db.analysisJob?.status === 'running') return;
  db.analysisJob = { status: 'running', startedAt: Date.now() };
  save();
  runAnalysis(feedback)
    .then((a) => applyAnalysis(a, sections))
    .catch((e) => { db.analysisJob = { status: 'failed', error: e.message }; save(); });
}

const UA = { 'user-agent': 'AtelierPersonalStylist/0.1 (local personal tool)' };
async function fetchCelebs(a) {
  for (const [i, c] of a.celebrities.entries()) {
    const images = [];
    for (const [lang, title] of [['zh', c.wiki_zh], ['en', c.wiki_en]]) {
      if (!title || images.length) continue;
      const res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(title.replace(/ /g, '_'))}`, { headers: UA, signal: AbortSignal.timeout(15000) }).catch(() => null);
      if (!res?.ok) continue;
      const items = ((await res.json()).items || []).filter((it) => it.type === 'image' && it.srcset?.length && !/\.svg|logo|icon|flag|signature/i.test(it.title));
      for (const it of items.slice(0, 4)) {
        const src = it.srcset.at(-1).src;
        const img = await fetch(src.startsWith('//') ? `https:${src}` : src, { headers: UA, signal: AbortSignal.timeout(20000) }).catch(() => null);
        if (!img?.ok) continue;
        const tmp = path.join(os.tmpdir(), `atelier_${uid()}`);
        await fs.writeFile(tmp, Buffer.from(await img.arrayBuffer()));
        const rel = `assets/${a.ver}_celeb_${i}_${images.length}.jpg`;
        await normalize(tmp, path.join(DATA, rel), 900).then(() => images.push({ file: rel, credit: it.title.replace(/^File:/, '') })).catch(() => {});
        await fs.rm(tmp, { force: true });
      }
    }
    if (db.analysis?.ver !== a.ver) return;
    db.celebs[i] = { images };
    save();
  }
}

const RANK = { good: 3, partial: 2, poor: 1 };
function bestPhoto(slot) {
  return db.photos.filter((p) => p.source === 'real' && p.slot === slot).sort((x, y) => (RANK[y.quality] || 0) - (RANK[x.quality] || 0) || y.createdAt - x.createdAt)[0];
}
const AVATARS = { avatarBody: 'avatarbody', avatarBust: 'avatarbust', avatarSide: 'avatarside' };
const AVATAR_LABELS = { avatarBody: '建模形象 · 全身', avatarBust: '建模形象 · 半身', avatarSide: '建模形象 · 侧面' };
function refsFor(keys, preferAvatar) {
  const diag = (k) => db.analysis?.diagnosis.find((d) => d.key === k)?.photoId;
  const fallback = { face_front: diag('face'), body_front: diag('body'), face_34: diag('head'), side_left: diag('head'), face: diag('face'), body: diag('body'), head: diag('head') };
  const avatar = { face: 'avatarbust', body: 'avatarbody' };
  const ids = keys.map((k) => (preferAvatar && avatar[k] && db.photos.some((p) => p.id === avatar[k]) ? avatar[k] : bestPhoto(k)?.id || (k === 'side_left' && bestPhoto('side_right')?.id) || fallback[k]));
  return [...new Set(ids.filter((id) => id && existsSync(photoPath(id))))].map((id, i) => [`ref${i + 1}.jpg`, photoPath(id)]);
}
function sheetRefs(key) {
  const setupIds = db.sheets[key]?.setupPhotoIds;
  if (!setupIds) return refsFor(SHEETS[key].refs, !AVATARS[key]);
  const [face, fullBody, side] = setupIds;
  const ids = key === 'avatarSide' ? [side, face, fullBody] : [face, fullBody, side];
  return ids.map((id, index) => [`ref${index + 1}.jpg`, photoPath(id)]);
}
async function cropGrid(sheet, cols, rows, index, dest) {
  const c = index % cols, r = Math.floor(index / cols);
  const vf = `crop=iw/${cols}*0.95:ih/${rows}*0.95:iw/${cols}*${c + 0.025}:ih/${rows}*${r + 0.025}`;
  const out = await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', sheet, '-vf', vf, '-frames:v', '1', '-q:v', '3', dest]);
  if (out.code !== 0) throw new Error('切图失败：' + out.err.slice(-200));
}

async function runSheet(key) {
  const a = db.analysis, { cols, rows } = SHEETS[key];
  const result = await generateImage(`sheet_${key}_${uid()}`, sheetRefs(key), sheetPrompt(key, a, db.profile),
    AVATARS[key] ? SETUP_JOB_TIMEOUT : undefined);
  if (AVATARS[key]) {
    const id = AVATARS[key];
    await normalize(result, photoPath(id), 1600);
    await normalize(result, path.join(DIRS.photos, `${id}_t.jpg`), 520);
    db.photos = db.photos.filter((p) => p.id !== id);
    db.photos.unshift({ id, label: AVATAR_LABELS[key], kind: 'photo', source: 'avatar', createdAt: Date.now(), ...(await dims(photoPath(id))) });
    return;
  }
  const base = path.join(DIRS.assets, `${db.sheets[key].ver || a.ver}_${key}`);
  await normalize(result, `${base}.jpg`, 1800);
  for (let i = 0; i < cols * rows; i++) await cropGrid(`${base}.jpg`, cols, rows, i, `${base}_${i}.jpg`);
}

const DIAG_AVATAR = { face: 'avatarbust', head: 'avatarside' };
let annotating = false;
async function annotate() {
  const a = db.analysis;
  if (annotating || !a?.diagnosis || Object.keys(AVATARS).some((k) => ['queued', 'running'].includes(db.sheets?.[k]?.status))) return;
  const todo = a.diagnosis.map((d) => ({ d, ph: db.photos.find((p) => p.id === DIAG_AVATAR[d.key]) })).filter(({ d, ph }) => ph && d.avatar?.ver !== ph.createdAt);
  if (!todo.length) return;
  annotating = true;
  try {
    const cwd = path.join(DIRS.jobs, `annotate_${uid()}`);
    await fs.mkdir(cwd, { recursive: true });
    const schemaFile = path.join(cwd, 'schema.json'), outFile = path.join(cwd, 'result.json');
    await fs.writeFile(schemaFile, JSON.stringify(ANNOTATE_SCHEMA));
    await codexExec({ cwd, images: todo.map(({ ph }) => photoPath(ph.id)), prompt: annotatePrompt(todo.map(({ d }) => d)), sandbox: 'read-only', schemaFile, outFile, effort: 'medium' });
    const raw = await fs.readFile(outFile, 'utf8');
    const groups = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).groups;
    for (const { d, ph } of todo) {
      const g = groups.find((x) => x.key === d.key);
      if (!g || db.analysis !== a) continue;
      const c = { x: clamp(g.crop.x, 0, 0.9), y: clamp(g.crop.y, 0, 0.9) };
      c.w = clamp(g.crop.w, 0.1, 1 - c.x); c.h = clamp(g.crop.h, 0.1, 1 - c.y);
      const points = d.points.map((_, i) => {
        const pt = g.points.find((x) => x.index === i + 1);
        return pt ? { x: clamp(pt.x, c.x + c.w * 0.04, c.x + c.w * 0.96), y: clamp(pt.y, c.y + c.h * 0.04, c.y + c.h * 0.96) } : null;
      });
      if (points.every(Boolean)) d.avatar = { photoId: ph.id, ver: ph.createdAt, crop: c, points };
    }
    save();
  } catch (e) {
    console.error('annotate', e.message);
  }
  annotating = false;
}

let classifying = false;
async function classify() {
  if (classifying) return;
  const batch = db.photos.filter((p) => p.kind === 'photo' && p.source === 'real' && !p.slot).slice(0, 12);
  if (!batch.length) return;
  classifying = true;
  db.classifyJob = { status: 'running', startedAt: Date.now(), count: batch.length };
  save();
  try {
    const cwd = path.join(DIRS.jobs, `classify_${uid()}`);
    await fs.mkdir(cwd, { recursive: true });
    const schemaFile = path.join(cwd, 'schema.json'), outFile = path.join(cwd, 'result.json');
    await fs.writeFile(schemaFile, JSON.stringify(CLASSIFY_SCHEMA));
    const a = A();
    const refs = a ? ['avatarbody', 'avatarbust'].filter((id) => db.photos.some((p) => p.id === id)).map(photoPath) : [];
    const archive = refs.length ? { refs: refs.length, note: `${a.diagnosis.map((d) => `${d.title}：${d.headline}`).join('；')}；现有发型与眼镜以标准形象照为准` } : null;
    await codexExec({ cwd, images: [...batch.map((p) => photoPath(p.id)), ...refs], prompt: classifyPrompt(batch.length, archive), sandbox: 'read-only', schemaFile, outFile, effort: 'low', timeout: SETUP_JOB_TIMEOUT });
    const raw = await fs.readFile(outFile, 'utf8');
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const res = parsed.photos;
    if (archive && parsed.drift?.level === 'major') db.drift = { level: 'major', note: String(parsed.drift.note || '').slice(0, 60), at: Date.now(), photoIds: batch.map((p) => p.id) };
    batch.forEach((p, i) => {
      const r = res.find((x) => x.index === i + 1) || {};
      const live = db.photos.find((x) => x.id === p.id);
      if (!live) return;
      live.slot = SLOTS[r.slot] ? r.slot : 'other';
      live.quality = RANK[r.quality] ? r.quality : 'good';
      live.issue = live.quality === 'good' ? '' : String(r.issue || '').slice(0, 40);
      if (r.label && (live.label === '未标注' || live.autoLabel)) { live.label = String(r.label).slice(0, 12); live.autoLabel = true; }
    });
    db.classifyJob = { status: 'done' };
  } catch (e) {
    db.classifyJob = { status: 'failed', error: e.message };
  }
  classifying = false;
  save();
  if (db.classifyJob.status === 'done') classify();
}
let classifyTimer;
const classifySoon = () => { clearTimeout(classifyTimer); classifyTimer = setTimeout(classify, 1500); };

async function collage(files, dest) {
  const args = ['-y', '-loglevel', 'error'];
  for (const f of files) args.push('-i', f);
  const cells = files.map((_, i) => `[${i}:v]scale=640:640:force_original_aspect_ratio=decrease,pad=640:640:(ow-iw)/2:(oh-ih)/2:color=0xE9E0D5[c${i}]`).join(';');
  const filter = files.length > 1 ? `${cells};${files.map((_, i) => `[c${i}]`).join('')}hstack=inputs=${files.length}[out]` : cells.replace('[c0]', '[out]');
  const r = await run('ffmpeg', [...args, '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', '-q:v', '3', dest]);
  if (r.code !== 0) throw new Error('单品拼图失败：' + r.err.slice(-200));
}

async function runLook(look) {
  const refs = [['person.jpg', photoPath(look.baseId)]];
  if (look.garment) {
    const garment = look.garment.startsWith('library/') ? libraryImagePath(look.garment.slice('library/'.length)) : path.join(DATA, look.garment);
    if (!garment || !existsSync(garment)) throw new Error('试穿单品图暂不可用');
    refs.push(['garment.jpg', garment]);
  }
  const prev = look.prevId && path.join(DIRS.looks, `${look.prevId}.jpg`);
  let usePrevious = prev && existsSync(prev);
  if (!look.referencePieces?.length && (look.localOutfitImage || look.libraryOutfitImage)) {
    // 旧成片可能已经继承了参考人物的体型，继续试穿时也只提取它的服装。
    const source = usePrevious ? prev : look.localOutfitImage
      ? path.join(DATA, look.localOutfitImage) : libraryImagePath(look.libraryOutfitImage);
    if (!source || !existsSync(source)) throw new Error('穿搭参考图暂不可用');
    const { pieces } = await ask('outfit-details', REFERENCE_OUTFIT_SCHEMA, referenceOutfitPrompt, { images: [source] });
    look.referencePieces = (pieces || []).filter((piece) => typeof piece === 'string' && piece.trim());
    if (!look.referencePieces.length) throw new Error('参考图中没有辨认出衣物，请换一张清晰的穿搭图');
    usePrevious = false;
  }
  const base = db.photos.find((photo) => photo.id === look.baseId);
  if (look.referencePieces?.length && !isBodyBase(base) && !usableBodySide(base)) {
    const guide = [look.bodyGuideId, db.settings.bodyBaseId, 'avatarbody', bestPhoto('body_front')?.id]
      .map((id) => id && db.photos.find((photo) => photo.id === id))
      .find((photo) => isBodyBase(photo) && existsSync(photoPath(photo.id)));
    look.bodyGuideId = guide?.id;
    if (guide) refs.push(['body-guide.jpg', photoPath(guide.id)]);
  }
  if (usePrevious) refs.push(['prev.jpg', prev]);
  const result = await generateImage(look.id, refs, generationPrompt({ ...look, prevId: usePrevious ? look.prevId : null }));
  await normalize(result, path.join(DIRS.looks, `${look.id}.jpg`), 2048);
  await normalize(result, path.join(DIRS.looks, `${look.id}_t.jpg`), 640);
}

async function runBodyEdit(edit) {
  const base = db.photos.find((photo) => photo.id === edit.baseId);
  if (!base || base.createdAt !== edit.baseCreatedAt) throw new Error('原底图已更新，请重新打开编辑器');
  const jobId = `body_${edit.id}`;
  const diagram = path.join(DIRS.jobs, jobId, 'target.png');
  const refs = [['person.jpg', photoPath(base.id)], ['contour.png', diagram]];
  const face = bestPhoto('face_front') || db.photos.find((photo) => photo.id === 'avatarbust');
  if (face && existsSync(photoPath(face.id))) refs.push(['face.jpg', photoPath(face.id)]);

  const changes = BODY_CONTROLS.filter(({ key }) => edit.values[key]).map(({ key, label, ends }) => {
    const value = edit.values[key];
    return key === 'height' && edit.height ? `身高由 ${edit.height} cm 调为 ${edit.height + value} cm` :
      `${label}${ends[value > 0 ? 1 : 0]} ${Math.abs(value)} 档`;
  });
  const prompt = `使用你内置的图片生成能力（imagegen）编辑 person.jpg，生成同一个人的全身基础形象照。
只调整这些项：${changes.join('、')}。contour.png 的剪影由 person.jpg 抠出并按指定幅度调整，是同一姿势下的目标比例参考。对齐对应部位，不要把剪影、线条或文字画进成片。${refs.some(([name]) => name === 'face.jpg') ? 'face.jpg 只作身份与五官参考。' : ''}
成片保持与 person.jpg 相同人物、五官、头型、发型、肤色、眼镜、姿势、衣服、机位、光线、背景和脚底位置。体型变化应影响衣服的贴合与垂坠。身高调整体现在身体比例与人物占画面的高度，不要拉伸脸或整体缩放画面。所有未指定部位尽量忠于原照。头顶到鞋底完整可见，真实摄影效果。
只生成这一张图，将图片复制到当前目录命名为 out.png。只回复 out.png。`;
  const result = await generateImage(jobId, refs, prompt, 5 * 60 * 1000);
  await addPhoto(result, { label: '调整后的全身形象', source: 'avatar', bodyEdit: edit });
}

/* ---------- 造型师：档案摘要、偏好、方案库 ---------- */
const KIND = { outfit: '穿搭', item: '单品', hair: '发型', article: '读物' };
const feedbackLine = (f) => (f.kind === 'direction' ? `主动要求「${f.name}」` : `不喜欢${KIND[f.kind] || ''}「${f.name}」${f.detail ? `（${f.detail}）` : ''}${f.reason ? `，原因：${f.reason}` : ''}`);
const generalPrefs = () => db.prefs.notes.filter((n) => n.source !== 'style-quiz').map((n) => n.text);
function brief() {
  const a = db.analysis, p = db.profile;
  const facts = [['age', '年龄', ' 岁'], ['height', '身高', 'cm'], ['weight', '体重', 'kg'], ['shoulder', '肩宽', 'cm'], ['chest', '胸围', 'cm'], ['waist', '腰围', 'cm']].filter(([k]) => p[k]).map(([k, label, unit]) => `${label} ${p[k]}${unit}`).join('、');
  const notes = generalPrefs();
  const raw = db.feedback.filter((f) => !f.summarized).slice(-8).map(feedbackLine);
  const favs = db.outfits.filter((o) => o.fav).slice(0, 6).map((o) => o.name);
  return [
    `总评：${a.summary}`,
    `风格定位：${a.style.archetype}（${a.style.keywords.join('、')}）。${a.style.direction}`,
    `身形：${a.diagnosis.find((d) => d.key === 'body')?.headline || '见参考图'}${facts ? `；${facts}` : ''}${p.notes ? `；本人补充：${p.notes}` : ''}`,
    `适合的颜色：${a.color.best.map((c) => c.name).join('、')}；应回避：${a.color.avoid.map((c) => c.name).join('、')}`,
    `坚持：${a.style.dos.join('；')}`,
    `避开：${a.style.donts.join('；')}`,
    notes.length && `他明确的偏好（必须遵守）：${notes.join('；')}`,
    raw.length && `最近的反馈：${raw.join('；')}`,
    favs.length && `他收藏过的方案：${favs.join('、')}`,
  ].filter(Boolean).map((line) => `- ${line}`).join('\n');
}

function addFeedback(entry) {
  db.feedback.push({ ...entry, at: Date.now() });
  db.feedback = db.feedback.slice(-80);
  summarizePrefs();
}
let summarizing = false;
async function summarizePrefs() {
  const fresh = db.feedback.filter((f) => !f.summarized);
  if (summarizing || fresh.length < 3) return;
  summarizing = true;
  try {
    const res = await ask('prefs', PREFS_SCHEMA, prefsPrompt({ feedback: db.feedback.slice(-30).map(feedbackLine), notes: db.prefs.notes.filter((n) => n.auto).map((n) => n.text) }));
    db.prefs.notes = [...db.prefs.notes.filter((n) => !n.auto), ...res.notes.slice(0, 6).map((text) => ({ id: uid(), text: String(text).slice(0, 40), auto: true }))];
    for (const f of fresh) f.summarized = true;
  } catch (e) { console.error('prefs', e.message); }
  summarizing = false;
  save();
}

const text = (value, max) => String(value ?? '').trim().slice(0, max);
function cleanOutfit(o) {
  return { name: text(o.name, 14), occasion: text(o.occasion, 8), items: (o.items || []).map((x) => text(x, 24)).filter(Boolean).slice(0, 6),
    palette: (o.palette || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 4), why: text(o.why, 90), image_prompt: text(o.image_prompt, 400),
    weather_note: text(o.weather_note, 50), season: ['四季', '春秋', '夏', '冬'].includes(o.season) ? o.season : '四季', indoor: Boolean(o.indoor),
    fit: Math.round(clamp(o.fit, 0, 100)) };
}
const artFile = (kind, id) => `assets/${kind}_${id}.jpg`;
async function dropEntries(kind, ids) {
  const key = kind === 'hair' ? 'hairs' : 'outfits';
  db[key] = db[key].filter((e) => !ids.includes(e.id));
  for (const j of db.jobs) if (j.status === 'queued') j.ids = j.ids.filter((id) => !ids.includes(id));
  db.jobs = db.jobs.filter((j) => j.ids.length);
  if (kind === 'outfit' && db.daily) db.daily.outfitIds = db.daily.outfitIds.filter((id) => !ids.includes(id));
  for (const id of ids) await fs.rm(path.join(DATA, artFile(kind, id)), { force: true });
}
// 新一轮分析的方案替换旧的；收藏过的留下，转成「已保存」。
function retire(list, kind) {
  for (const e of list) if (e.source === 'analysis' && e.fav) e.source = 'saved';
  dropEntries(kind, list.filter((e) => e.source === 'analysis').map((e) => e.id));
}
function queueArt(type, ids, priority) {
  const parts = type === 'hairs' ? [ids] : ids.length === 4 ? [ids.slice(0, 2), ids.slice(2)] : Array.from({ length: Math.ceil(ids.length / 3) }, (_, i) => ids.slice(i * 3, i * 3 + 3));
  for (const part of parts) db.jobs.push({ id: uid(), type, ids: part, priority, status: 'queued', createdAt: Date.now() });
}
function addHairs(list, source, priority) {
  const added = list.slice(0, 6).map((h) => ({ id: uid(), source, createdAt: Date.now(), name: text(h.name, 12), tagline: text(h.tagline, 20), why: text(h.why, 90),
    barber_brief: text(h.barber_brief, 300), maintenance: text(h.maintenance, 300), image_prompt: text(h.image_prompt, 400), art: 'pending', fav: false }));
  for (const h of added) h.group = added.map((x) => x.id);
  db.hairs.unshift(...added);
  if (added.length === 6) queueArt('hairs', added.map((h) => h.id), priority);
  else for (const h of added) h.art = 'failed';
  return added;
}

async function runArt(job) {
  const hairs = job.type === 'hairs';
  const entries = job.ids.map((id) => (hairs ? db.hairs : db.outfits).find((e) => e.id === id)).filter((e) => e?.image_prompt);
  if (!entries.length) return;
  if (hairs && entries.length !== 6) throw new Error('发型预览需要 6 款一组生成');
  const cols = hairs ? 3 : entries.length, rows = hairs ? 2 : 1;
  const result = await generateImage(`art_${job.id}`, refsFor(hairs ? ['face', 'head'] : ['face', 'body'], true), panelPrompt(job.type, entries, db.profile));
  const sheet = path.join(DIRS.assets, `art_${job.id}.jpg`);
  await normalize(result, sheet, 1800);
  for (const [i, e] of entries.entries()) {
    const rel = artFile(hairs ? 'hair' : 'outfit', e.id);
    if (cols * rows === 1) await fs.copyFile(sheet, path.join(DATA, rel)); else await cropGrid(sheet, cols, rows, i, path.join(DATA, rel));
    Object.assign(e, { image: rel, art: 'done', imageAt: Date.now() });
  }
  await fs.rm(sheet, { force: true });
}

let weatherJob;
function ensureWeather(force) {
  const city = db.settings.city, w = db.weather;
  if (!force && w && w.date === localDate() && w.city === city.name && Date.now() - w.fetchedAt < 3 * 3600_000) return Promise.resolve(w);
  return (weatherJob ||= fetchWeather(city)
    .then((next) => { db.weather = next; save(); return next; })
    .catch((e) => { console.error('weather', e.message); return w?.city === city.name && w.date === localDate() ? w : null; })
    .finally(() => { weatherJob = null; }));
}

// 先占位、后填充：卡片立刻出现，文字方案回来后再排队出图。
function draft({ count, source, priority, direction = '', replace = null }) {
  const slots = Array.from({ length: count }, () => ({ id: uid(), status: 'drafting', source, batch: localDate(), createdAt: Date.now(), art: 'pending', fav: false, ...(direction && { direction }) }));
  db.outfits.unshift(...slots);
  save();
  const done = (async () => {
    const weather = await ensureWeather();
    const recent = db.outfits.filter((o) => o.status === 'ready').slice(0, 30).map((o) => o.name);
    const images = ['avatarbody', 'avatarbust'].filter((id) => db.photos.some((p) => p.id === id)).map(photoPath);
    const trends = feed.get().items.filter((item) => item.zh && ['穿搭', '单品'].includes(item.tag)).slice(0, 8).map((item) => item.zh);
    const archive = brief(), styleChoices = styleQuizText(db.prefs.notes);
    const request = outfitsPrompt({ brief: archive, count, weather, seasonLabel: seasonName(), recent, direction, replace, photos: images.length, trends,
      styleChoices, wardrobe: db.wardrobe.map((w) => w.name).filter((name) => name && name !== '识别中').slice(0, 40) });
    let approved = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const retry = attempt ? '\n上一轮未达到复审标准。请重做整批，仔细核对全身完整性、色彩、版型、天气、场合和方案间的区分度。' : '';
      const res = await ask('outfits', OUTFITS_SCHEMA, request + retry, { effort: 'medium', images });
      const candidates = res.outfits.slice(0, count).map(cleanOutfit).filter((o) => o.name && o.occasion && o.image_prompt && new Set(o.items).size >= 4 && o.palette.length >= 3);
      if (candidates.length < count) continue;
      const review = await ask('outfit-review', FIT_SCHEMA, outfitReviewPrompt({ brief: archive, weather: weather?.text || seasonName(),
        outfits: candidates, direction, styleChoices }));
      const scores = new Map(review.scores.map(({ index, score }) => [index, score]));
      approved = candidates.filter((o, index) => {
        o.fit = Math.round(clamp(scores.get(index + 1), 0, 100));
        return o.fit >= 70;
      });
      if (approved.length === count) break;
    }
    if (approved.length < count) throw new Error('本批穿搭未通过复审');
    const live = slots.filter((slot) => db.outfits.includes(slot));
    live.forEach((slot, i) => Object.assign(slot, approved[slots.indexOf(slot)], { status: 'ready', weather: weather?.text || '' }));
    queueArt('outfits', live.map((slot) => slot.id), priority);
    save(); pump();
    return weather;
  })();
  return { slots, done };
}

async function startDaily(reason) {
  const prev = db.daily;
  const { slots, done } = draft({ count: DAILY_COUNT, source: 'daily', priority: 'bg' });
  db.daily = { date: localDate(), seenAt: null, outfitIds: slots.map((s) => s.id), reason, startedAt: Date.now(), weather: db.weather || null };
  save();
  try {
    const weather = await done;
    if (weather) db.daily.weather = weather;
    const cutoff = Date.now() - KEEP_OUTFIT_DAYS * 86_400_000;
    await dropEntries('outfit', db.outfits.filter((o) => ['daily', 'more', 'replace'].includes(o.source) && !o.fav && o.createdAt < cutoff && !db.daily.outfitIds.includes(o.id)).map((o) => o.id));
  } catch (e) {
    console.error('daily', e.message);
    await dropEntries('outfit', slots.map((s) => s.id));
    db.daily = { ...(prev || { date: '', outfitIds: [], seenAt: null }), error: `今日穿搭生成失败：${e.message}`.slice(0, 160), retryAt: Date.now() + 30 * 60_000 };
  }
  save();
}
const dailyDrafting = () => db.outfits.some((o) => o.status === 'drafting' && o.source === 'daily');

// 看过才换新：昨天的方案被看过，今天早上出新的；没看过就留着，除非进来时天气已经严重不符。
async function dailyTick(visit) {
  if (!automatic() || !A() || dailyDrafting()) return;
  const d = db.daily, today = localDate();
  if (d?.retryAt && Date.now() < d.retryAt) return;
  if (!d || !d.date) return startDaily('first');
  if (d.date === today) return;
  if (d.seenAt) { if (localHour() >= 6) return startDaily('newday'); return; }
  if (!visit) return;
  const why = mismatch(d.weather, await ensureWeather());
  if (why) return startDaily(`weather:${why}`);
}

let fitting = false;
const styleQuizKey = () => styleQuizIds(db.prefs.notes).join(',');
async function scoreFit() {
  const a = A();
  if (!automatic() || !a || fitting) return;
  const styleKey = styleQuizKey();
  if (db.fit?.ver !== a.ver || (db.fit.styleKey || '') !== styleKey) db.fit = { ver: a.ver, styleKey, scores: {} };
  const fit = db.fit;
  if (fit.retryAt > Date.now()) return;
  const snap = library.get();
  const entries = [
    ...snap.outfits.filter((o) => !o.archived && o.source?.fullBody !== false).map((o) => ({ id: o.id, text: `穿搭「${o.name}」（${o.occasion}，${o.season}）：${o.items.map((p) => p.name).join('、')}` })),
    ...snap.items.map((i) => ({ id: i.id, text: `单品「${i.name}」（${i.category}，${i.season}，主色 ${i.color}）：${i.shape}` })),
  ].filter((e) => fit.scores[e.id] == null).slice(0, 60);
  if (!entries.length) return;
  fitting = true;
  try {
    const res = await ask('fit', FIT_SCHEMA, fitPrompt({ brief: brief(), entries: entries.map((e) => e.text), styleChoices: styleQuizText(db.prefs.notes) }));
    if (A()?.ver === a.ver && styleQuizKey() === styleKey) {
      for (const s of res.scores || []) { const e = entries[s.index - 1]; if (e) fit.scores[e.id] = Math.round(clamp(s.score, 0, 100)); }
      for (const e of entries) fit.scores[e.id] ??= 60;
    }
  } catch (e) { console.error('fit', e.message); fit.retryAt = Date.now() + 30 * 60_000; }
  fitting = false;
  save();
  scoreFit();
}

let describing = false;
async function describeGarments() {
  const batch = db.photos.filter((p) => p.kind === 'garment' && !p.described).slice(0, 8);
  if (describing || !batch.length) return;
  describing = true;
  try {
    const res = await ask('garments', GARMENT_SCHEMA, garmentPrompt(batch.length), { images: batch.map((p) => photoPath(p.id)) });
    batch.forEach((p, i) => {
      const live = db.photos.find((x) => x.id === p.id), g = (res.garments || []).find((x) => x.index === i + 1);
      if (!live) return;
      live.described = true;
      if (!g) return;
      if (['试穿单品', '衣橱单品', '未标注'].includes(live.label)) live.label = text(g.name, 14);
      live.category = g.category;
      const owned = db.wardrobe.find((w) => w.photoId === p.id);
      if (owned) Object.assign(owned, { name: live.label, category: g.category });
    });
  } catch (e) { console.error('garments', e.message); for (const p of batch) p.described = true; }
  describing = false;
  save();
  describeGarments();
}
let describeTimer;
const describeSoon = () => { clearTimeout(describeTimer); describeTimer = setTimeout(describeGarments, 1500); };

/* ---------- 出图队列：手动试穿 > 建模形象 > 手动追加 > 后台 ---------- */
let active = 0, activeBg = 0;
function nextTask() {
  const look = db.looks.find((l) => l.status === 'queued');
  if (look) return { job: look, start: () => runLook(look) };
  const bodyEdit = db.bodyEdits.find((edit) => edit.status === 'queued');
  if (bodyEdit) return { job: bodyEdit, start: () => runBodyEdit(bodyEdit) };
  const avatarKey = Object.keys(AVATARS).find((k) => db.sheets?.[k]?.status === 'queued');
  if (avatarKey) return { job: db.sheets[avatarKey], start: () => runSheet(avatarKey), after: () => { if (automatic()) annotate(); } };
  if (Object.keys(AVATARS).some((k) => db.sheets?.[k]?.status === 'running')) return null;
  const art = (job) => ({ job, start: () => runArt(job), art: true });
  const mine = db.jobs.find((j) => j.status === 'queued' && j.priority === 'user');
  if (mine) return art(mine);
  // 后台任务最多占一个并发，给手动操作留一个；每天的后台出图次数有上限。
  if (!workspaceReady() || activeBg >= 1) return null;
  if (db.budget?.date !== localDate()) db.budget = { date: localDate(), bg: 0 };
  if (db.budget.bg >= BG_DAILY_CAP) return null;
  const sheetKey = Object.keys(db.sheets || {}).find((k) => SHEETS[k] && db.sheets[k].status === 'queued' && (automatic() || db.sheets[k].manual));
  if (sheetKey) return { job: db.sheets[sheetKey], start: () => runSheet(sheetKey), bg: true };
  const later = automatic() && db.jobs.find((j) => j.status === 'queued');
  if (later) return { ...art(later), bg: true };
  const background = libraryImageJobs.shift();
  return background ? { start: background, bg: true } : null;
}
function pump() {
  while (active < MAX_PARALLEL) {
    const task = nextTask();
    if (!task) return;
    const { job } = task;
    active++;
    if (task.bg) { activeBg++; db.budget.bg++; }
    if (job) Object.assign(job, { status: 'running', startedAt: Date.now(), error: undefined, ...(task.art && { tries: (job.tries || 0) + 1 }) });
    save();
    task.start()
      .then(() => job && Object.assign(job, { status: 'done', finishedAt: Date.now() }))
      .catch((e) => {
        if (!job) return;
        Object.assign(job, { status: 'failed', error: e.message, finishedAt: Date.now() });
        if (task.art) for (const e2 of [...db.outfits, ...db.hairs]) if (job.ids.includes(e2.id) && e2.art === 'pending') Object.assign(e2, { art: 'failed', artError: e.message.slice(0, 160) });
      })
      .finally(() => {
        active--;
        if (task.bg) activeBg--;
        if (task.art) db.jobs = db.jobs.filter((j) => j !== job);
        save(); pump(); task.after?.();
      });
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
const readBody = (req, limit = 40 * 1024 * 1024) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0;
  req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('文件过大')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

async function readLookRequest(req) {
  const body = await readBody(req);
  const contentType = req.headers['content-type'] || '';
  if (!contentType.startsWith('multipart/form-data;')) return { spec: JSON.parse(body) };
  const form = await new Response(body, { headers: { 'content-type': contentType } }).formData();
  const reference = form.get('reference');
  if (!(reference instanceof File) || !reference.size) throw new Error('请选择一张穿搭参考图');
  if (reference.size > 20 * 1024 * 1024) throw new Error('参考图不能超过 20 MB，请压缩后重试');
  return { spec: JSON.parse(form.get('spec')), reference };
}

async function saveLookReference(file, dest) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const isJpeg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) throw new Error('请选择 JPG、PNG 或 WebP 图片');
  const temp = path.join(os.tmpdir(), `atelier_reference_${uid()}`);
  try {
    await fs.writeFile(temp, bytes);
    await normalize(temp, dest, 1600);
  } catch (error) {
    await fs.rm(dest, { force: true });
    console.error('look reference', error.message);
    throw new Error('无法处理这张参考图，请换一张');
  } finally {
    await fs.rm(temp, { force: true });
  }
}

function sendFile(res, base, rel, cache) {
  const file = path.join(base, path.normalize(rel));
  if (!file.startsWith(base + path.sep) || !existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': cache });
  createReadStream(file).pipe(res);
}

let setupCheck;
let checkStartedAt = 0;
function checkSetup(force) {
  if (force || !setupCheck || Date.now() - checkStartedAt > 30000) {
    checkStartedAt = Date.now();
    const options = { timeout: 5000 };
    setupCheck = Promise.all([
      run('ffmpeg', ['-version'], options),
      run('ffprobe', ['-version'], options),
      run(CODEX, ['--version'], options),
      run(CODEX, ['login', 'status'], options),
    ]).then(([ffmpeg, ffprobe, codex, login]) => ({
      node: Number(process.versions.node.split('.')[0]) >= 24,
      ffmpeg: ffmpeg.code === 0 && ffprobe.code === 0,
      codex: codex.code === 0,
      login: login.code === 0,
    }));
  }
  return setupCheck;
}

const setupRoutes = new Set([
  'GET /api/state', 'GET /api/setup/check', 'POST /api/photos',
  'POST /api/setup/classify', 'POST /api/setup/build', 'POST /api/setup/confirm',
]);

const routes = {
  'GET /api/state': async () => ({ ...db, libraryRevision: library.get().revision, feed: feed.get(), today: localDate(), seasonName: seasonName() }),
  'GET /api/setup/check': async (_req, url) => checkSetup(url.searchParams.has('refresh')),
  'POST /api/setup/classify': async () => {
    classifySoon();
    return { ok: true };
  },
  'POST /api/setup/build': async () => {
    const setup = onboardingState(db);
    if (setup.stage === 'ready' || setup.stage === 'building') return { stage: setup.stage };
    if (!setup.canBuild) throw new Error('请先上传并检查三张照片');
    const inputIds = setup.slots.map(({ photo }) => photo.id);
    if (A()?.photoIds?.join(',') === inputIds.join(',')) {
      db.sheets ||= {};
      db.sheets.avatarBody = { status: 'queued', ver: db.analysis.ver, setupPhotoIds: inputIds };
      save(); pump();
    } else {
      if (db.sheets?.avatarBody?.status === 'failed') delete db.sheets.avatarBody;
      startAnalysis();
    }
    return { stage: 'building' };
  },
  'POST /api/setup/confirm': async () => {
    const setup = onboardingState(db);
    if (setup.stage === 'ready') return { ok: true };
    if (setup.stage !== 'preview' || !existsSync(photoPath('avatarbody'))) throw new Error('全身建模形象还未生成');
    db.settings.onboarding.confirmedAt = Date.now();
    save(); pump();
    return { ok: true };
  },
  'GET /api/body-cutout': async (_req, url) => {
    const id = url.searchParams.get('id');
    const photo = /^[a-z0-9]+$/.test(id || '') && db.photos.find((entry) => entry.id === id);
    if (!isModeledBody(photo) || !existsSync(photoPath(id))) throw new Error('需要一张建模全身照');
    return getBodyCutout(photo);
  },
  'GET /api/library': async () => library.get(),
  'PUT /api/library/favorites': async (req) => {
    const { id, favorite } = JSON.parse(await readBody(req));
    return { favorites: await library.favorite(id, favorite) };
  },
  'POST /api/library/refresh': async () => {
    library.refresh().catch((e) => console.error('library refresh', e.message));
    return library.get().refresh;
  },
  'PUT /api/profile': async (req) => { Object.assign(db.profile, JSON.parse(await readBody(req))); save(); return db.profile; },
  'POST /api/photos': async (req, url) => {
    const setupSlot = url.searchParams.get('setupSlot');
    if (setupSlot && !SETUP_SLOTS.some(({ key }) => key === setupSlot)) throw new Error('拍摄角度无效');
    if (!workspaceReady() && (!setupSlot || onboardingState(db).stage !== 'photos' || url.searchParams.get('kind') === 'garment')) {
      throw new Error('请在建模向导中上传本人照片');
    }
    const tmp = path.join(os.tmpdir(), `atelier_${uid()}`);
    await fs.writeFile(tmp, await readBody(req));
    try {
      const photo = await addPhoto(tmp, { label: url.searchParams.get('label') || '未标注', kind: url.searchParams.get('kind') === 'garment' ? 'garment' : 'photo', source: 'real', setupSlot });
      if (photo.kind === 'photo') classifySoon();
      else {
        if (url.searchParams.get('owned') === '1') { photo.owned = true; db.wardrobe.unshift({ id: uid(), photoId: photo.id, name: '识别中', category: '', addedAt: Date.now() }); save(); }
        describeSoon();
      }
      return photo;
    } finally { await fs.rm(tmp, { force: true }); }
  },
  'PATCH /api/photos': async (req, url) => {
    const p = db.photos.find((x) => x.id === url.searchParams.get('id'));
    if (!p) throw new Error('照片不存在');
    const { label, source } = JSON.parse(await readBody(req));
    if (label) { p.label = label; p.autoLabel = false; }
    if (source) p.source = source;
    save(); return p;
  },
  'DELETE /api/photos': async (req, url) => {
    const id = url.searchParams.get('id');
    if (!/^[0-9a-z]+$/.test(id || '')) throw new Error('参数错误');
    db.photos = db.photos.filter((p) => p.id !== id);
    db.wardrobe = db.wardrobe.filter((w) => w.photoId !== id);
    await fs.rm(photoPath(id), { force: true });
    await fs.rm(path.join(DIRS.photos, `${id}_t.jpg`), { force: true });
    const cutouts = await fs.readdir(cutoutDir).catch(() => []);
    await Promise.all(cutouts.filter((file) => file.startsWith(`${id}-`)).map((file) => fs.rm(path.join(cutoutDir, file), { force: true })));
    save(); return { ok: true };
  },
  'PUT /api/settings/automatic': async (req) => {
    const { enabled } = JSON.parse((await readBody(req)).toString());
    if (typeof enabled !== 'boolean') throw new Error('请选择自动更新设置');
    db.settings.automatic = enabled;
    save(); pump();
    if (automatic()) { housekeeping(); annotate(); }
    return { enabled };
  },
  'POST /api/analyze': async (req) => {
    const { sections, feedback } = JSON.parse((await readBody(req)).toString() || '{}');
    startAnalysis(Array.isArray(sections) && sections.length ? sections : undefined, typeof feedback === 'string' ? text(feedback, 500) : '');
    return db.analysisJob;
  },
  'POST /api/avatar': async () => {
    if (!A()) throw new Error('请先完成一次风格分析');
    db.sheets ||= {};
    for (const k of Object.keys(AVATARS)) if (db.sheets[k]?.status !== 'running') db.sheets[k] = { ...db.sheets[k], status: 'queued', ver: db.analysis.ver };
    const hairs = db.hairs.filter((h) => h.source === 'analysis');
    if (automatic() && hairs.length === 6 && !db.jobs.some((j) => j.ids.includes(hairs[0].id))) { for (const h of hairs) h.art = 'pending'; queueArt('hairs', hairs.map((h) => h.id), 'bg'); }
    save(); pump();
    return db.sheets;
  },
  'POST /api/body-edits': async (req) => {
    const { baseId, baseCreatedAt, entry, values, contour } = JSON.parse(await readBody(req, 500_000));
    const base = db.photos.find((photo) => photo.id === baseId);
    if (!isModeledBody(base) || !existsSync(photoPath(baseId))) throw new Error('请先选一张建模全身照');
    if (base.createdAt !== baseCreatedAt) throw new Error('原底图已更新，请重新打开编辑器');
    if (baseId === AVATARS.avatarBody && ['running', 'queued'].includes(db.sheets?.avatarBody?.status)) throw new Error('标准形象正在重新生成，请完成后再调整');
    if (db.bodyEdits.some((edit) => ['queued', 'running'].includes(edit.status))) throw new Error('已有一张身形预览正在生成');
    const changes = Object.fromEntries(BODY_CONTROLS.map(({ key, limit }) => {
      const value = values?.[key];
      if (!Number.isInteger(value) || Math.abs(value) > limit) throw new Error('身形调整数值无效');
      return [key, value];
    }));
    if (!Object.values(changes).some(Boolean)) throw new Error('先调整任意一项，再生成预览');
    if (typeof contour !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(contour)) throw new Error('缺少有效的轮廓预览');
    const diagram = Buffer.from(contour, 'base64');
    if (diagram.length < 33 || diagram.toString('hex', 0, 8) !== '89504e470d0a1a0a' ||
        diagram.readUInt32BE(16) !== 480 || diagram.readUInt32BE(20) !== 540) throw new Error('轮廓预览尺寸无效');
    const prior = db.bodyEdits.find((edit) => edit.id === base.bodyEditId);
    const height = prior?.height ? prior.height + prior.values.height : Number(db.profile.height);
    const edit = { id: uid(), status: 'queued', baseId, baseCreatedAt: base.createdAt, entry: entry === 'studio' ? 'studio' : 'mine', values: changes, createdAt: Date.now(),
      height: height >= 100 && height <= 250 ? height : null };
    const dir = path.join(DIRS.jobs, `body_${edit.id}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'target.png'), diagram);
    db.bodyEdits.unshift(edit);
    save(); pump();
    return edit;
  },
  'PUT /api/body-base': async (req) => {
    const { id, restore } = JSON.parse(await readBody(req));
    if (restore === true) {
      if (!db.bodyBaseHistory.length) throw new Error('没有可恢复的上一版形象');
      db.settings.bodyBaseId = db.bodyBaseHistory.pop();
    } else {
      const edit = db.bodyEdits.find((entry) => entry.id === id && entry.status === 'done');
      if (!edit || !db.photos.some((photo) => photo.id === edit.photoId)) throw new Error('真人预览尚未生成');
      if (db.settings.bodyBaseId === edit.photoId) return { bodyBaseId: edit.photoId };
      db.bodyBaseHistory.push(db.settings.bodyBaseId || null);
      db.settings.bodyBaseId = edit.photoId;
      edit.adoptedAt = Date.now();
    }
    save();
    return { bodyBaseId: db.settings.bodyBaseId };
  },
  'POST /api/sheets': async (req, url) => {
    const key = url.searchParams.get('key');
    if (!SHEETS[key] || !db.analysis?.diagnosis) throw new Error('无法重新生成');
    const sh = ((db.sheets ||= {})[key] ||= { ver: db.analysis.ver });
    if (sh.status === 'running') throw new Error('正在生成中');
    sh.status = 'queued'; sh.manual = true; save(); pump();
    return sh;
  },
  'POST /api/looks': async (req) => {
    const { spec: b, reference } = await readLookRequest(req);
    const prev = b.from ? db.looks.find((l) => l.id === b.from && l.status === 'done') : null;
    if (b.from && !prev?.spec) throw new Error('这个造型不支持继续调整');
    const spec = prev ? prev.spec : b;
    if (!db.photos.some((p) => p.id === spec.baseId)) throw new Error('请选择一张底图');
    const hairEntry = spec.hairId ? db.hairs.find((h) => h.id === spec.hairId) : null;
    const hair = hairEntry?.image_prompt || text(spec.hair, 600);
    const eyewear = (piece) => piece.category === '配饰' && /眼镜|墨镜|光学镜|镜框|镜片/.test(piece.name + (piece.shape || ''));
    let outfit = '', outfitName = '', occasion = '', libraryRef, libraryOutfitImage, libraryEyewear = false;
    const pictures = [];
    const usesLocalReference = Boolean(reference || prev?.localOutfitImage);
    if (usesLocalReference) {
      outfit = '按本地参考图试穿';
      outfitName = '本地穿搭';
    } else if (spec.outfit?.kind === 'own') {
      const o = db.outfits.find((x) => x.id === spec.outfit.id && x.status === 'ready');
      if (!o) throw new Error('这套穿搭暂不可用，请重新选择');
      outfit = o.image_prompt; outfitName = o.name; occasion = o.occasion;
    } else if (spec.outfit?.kind === 'lib') {
      const selection = library.find(spec.outfit.id);
      if (selection?.kind !== 'outfit') throw new Error('素材暂不可用，请重新选择');
      const { entry } = selection;
      libraryOutfitImage = prev?.libraryOutfitImage || (entry.image && entry.source?.fullBody !== false ? entry.source?.imageFile : undefined);
      if (entry.personId && !libraryOutfitImage && !prev) throw new Error('这套穿搭暂缺全身原照');
      outfit = libraryOutfitImage ? '按全身原照试穿整套' : entry.items.map((piece) => `${piece.name}（${piece.shape}）`).join('、');
      outfitName = entry.name; occasion = entry.occasion;
      libraryRef = { id: entry.id, name: entry.name, kind: 'outfit' };
      libraryEyewear = entry.items.some(eyewear);
    } else if (Array.isArray(spec.items) && spec.items.length) {
      const parts = [];
      for (const ref of spec.items.slice(0, 6).map(String)) {
        if (ref.startsWith('photo:')) {
          const p = db.photos.find((x) => x.id === ref.slice(6) && x.kind === 'garment');
          if (p) parts.push({ name: p.label, file: photoPath(p.id) });
        } else if (ref.startsWith('rec:')) {
          const i = Number(ref.slice(4)), it = db.analysis?.items?.[i];
          if (it) parts.push({ name: it.name, desc: it.image_prompt, file: path.join(DIRS.assets, `${db.sheets?.items?.ver}_items_${i}.jpg`) });
        } else {
          const selection = library.find(ref);
          if (selection?.kind !== 'item') continue;
          const { entry } = selection;
          parts.push({ name: entry.name, desc: entry.shape, file: entry.hasPhoto ? libraryImagePath(entry.image.slice('/media/library/'.length)) : null });
          libraryEyewear ||= eyewear(entry);
          if (spec.items.length === 1) libraryRef = { id: entry.id, name: entry.name, kind: 'item', ...(entry.outfitId && { outfitId: entry.outfitId }) };
        }
      }
      if (!parts.length) throw new Error('所选单品暂不可用，请重新选择');
      pictures.push(...parts.filter((part) => part.file && existsSync(part.file)).slice(0, 4));
      outfit = parts.length === 1 && pictures.length === 1 ? '' : `同时穿戴：${parts.map((part) => (part.desc ? `${part.name}（${part.desc}）` : part.name)).join('、')}。没有提到的部位搭配协调的基础款`;
      outfitName = parts.length === 1 ? `试穿 ${parts[0].name}` : `${parts[0].name}等 ${parts.length} 件`;
    }
    const season = ['春', '夏', '秋', '冬'].includes(spec.season) ? spec.season : '';
    const extra = text(spec.extra, 300);
    const usesOutfitPhoto = usesLocalReference || libraryOutfitImage;
    if (extra && !usesOutfitPhoto) outfit = outfit ? `${outfit}。补充要求：${extra}` : extra;
    const dressed = Boolean(outfit || pictures.length);
    if (dressed && season && spec.outfit?.kind !== 'own' && !usesOutfitPhoto) outfit += `${outfit ? '。' : ''}厚薄与层次按${season}季来穿`;
    const sceneMode = text(spec.scene, 300) || 'auto';
    let scene = '', pose = '';
    if (prev) {
      scene = prev.scene; pose = prev.pose;
      if (b.change === 'scene') scene = matchScene(occasion, db.looks.filter((l) => l.spec === prev.spec || l.id === prev.id).map((l) => l.scene));
      else pose = randomPose(prev.pose);
    } else if (sceneMode !== 'keep') {
      scene = sceneMode === 'auto' ? (dressed ? matchScene(occasion) : '') : sceneMode;
      if (dressed) pose = randomPose();
    }
    if (!hair && !dressed && !scene) throw new Error('至少选择发型或穿搭中的一项');
    const id = uid();
    let garment = null;
    if (pictures.length) { garment = `looks/${id}_g.jpg`; await collage(pictures.map((part) => part.file), path.join(DATA, garment)); }
    const localOutfitImage = usesLocalReference ? `looks/${id}_ref.jpg` : null;
    if (localOutfitImage) {
      const dest = path.join(DATA, localOutfitImage);
      if (reference) await saveLookReference(reference, dest);
      else await fs.copyFile(path.join(DATA, prev.localOutfitImage), dest);
    }
    const title = [hairEntry?.name || (hair && '自定义发型'), outfitName || (dressed && '自定义穿搭')].filter(Boolean).join(' · ') || '换个场景';
    const look = { id, status: 'queued', createdAt: Date.now(), baseId: spec.baseId, garment, garmentNames: pictures.map((part) => part.name),
      hair, outfit, scene, pose, season, title: text(title, 40), fav: false,
      spec: prev ? prev.spec : { baseId: spec.baseId, hairId: hairEntry?.id || null, hair: hairEntry ? '' : hair, outfit: !usesLocalReference && spec.outfit?.kind ? { kind: spec.outfit.kind, id: spec.outfit.id } : null,
        items: !usesLocalReference && Array.isArray(spec.items) ? spec.items.slice(0, 6).map(String) : [], extra, season, scene: sceneMode },
      ...(prev && { prevId: prev.id, change: b.change === 'scene' ? 'scene' : 'pose' }),
      ...(prev?.referencePieces?.length && { referencePieces: prev.referencePieces }),
      ...(prev?.bodyGuideId && { bodyGuideId: prev.bodyGuideId }),
      ...(libraryRef && { libraryRef }), ...(libraryOutfitImage && { libraryOutfitImage }), ...(localOutfitImage && { localOutfitImage }),
      ...(usesOutfitPhoto && { referenceNotes: extra }), ...(libraryEyewear && { libraryEyewear }) };
    db.looks.unshift(look);
    save(); pump();
    return look;
  },
  'PATCH /api/looks': async (req, url) => {
    const l = db.looks.find((x) => x.id === url.searchParams.get('id'));
    if (!l) throw new Error('造型不存在');
    const { fav, title } = JSON.parse(await readBody(req));
    if (typeof fav === 'boolean') l.fav = fav;
    if (title) l.title = String(title).slice(0, 40);
    save(); return l;
  },
  'DELETE /api/looks': async (req, url) => {
    const id = url.searchParams.get('id');
    if (!/^[0-9a-f]+$/.test(id || '')) throw new Error('参数错误');
    if (db.looks.find((l) => l.id === id)?.status === 'running') throw new Error('生成中的造型暂时不能删除');
    db.looks = db.looks.filter((l) => l.id !== id);
    await fs.rm(path.join(DIRS.looks, `${id}.jpg`), { force: true });
    await fs.rm(path.join(DIRS.looks, `${id}_t.jpg`), { force: true });
    await fs.rm(path.join(DIRS.looks, `${id}_g.jpg`), { force: true });
    await fs.rm(path.join(DIRS.looks, `${id}_ref.jpg`), { force: true });
    save(); return { ok: true };
  },
  'PUT /api/settings/city': async (req) => {
    const b = JSON.parse(await readBody(req));
    let city;
    if (b.name) city = await findCity(b.name);
    else {
      city = nearestCity(Number(b.lat), Number(b.lon));
      if (!city) throw new Error('定位结果不在中国范围内，已保持当前城市');
    }
    const changed = city.name !== db.settings.city.name;
    db.settings.city = { ...city, auto: !b.name };
    db.settings.located = true;
    save();
    const weather = await ensureWeather(changed);
    if (automatic() && changed && weather && db.daily?.date && !dailyDrafting() && mismatch(db.daily.weather, weather)) startDaily('city').catch((e) => console.error('daily', e.message));
    return { city: db.settings.city, weather };
  },
  'POST /api/home/visit': async () => {
    if (automatic()) await ensureWeather();
    await dailyTick(true);
    const d = db.daily;
    if (d?.outfitIds.length && !d.seenAt && !d.outfitIds.some((id) => db.outfits.find((o) => o.id === id)?.status === 'drafting')) { d.seenAt = Date.now(); save(); }
    return { ok: true };
  },
  'POST /api/outfits/more': async (req) => {
    if (!A()) throw new Error('请先完成一次风格分析');
    if (db.outfits.some((o) => o.status === 'drafting' && o.source === 'more')) throw new Error('上一批还在构思中，稍等一下');
    const direction = text(JSON.parse((await readBody(req)).toString() || '{}').direction, 80);
    if (direction) {
      db.prefs.directions = [direction, ...db.prefs.directions.filter((d) => d !== direction)].slice(0, 8);
      addFeedback({ kind: 'direction', name: direction });
    }
    const { slots, done } = draft({ count: MORE_COUNT, source: 'more', priority: 'user', direction });
    db.daily ||= { date: localDate(), seenAt: Date.now(), outfitIds: [], weather: db.weather || null };
    db.daily.outfitIds.push(...slots.map((s) => s.id));
    delete db.daily.error;
    save();
    done.catch(async (e) => { await dropEntries('outfit', slots.map((s) => s.id)); db.daily.error = `追加失败：${e.message}`.slice(0, 160); save(); });
    return slots;
  },
  'PATCH /api/outfits': async (req, url) => {
    const o = db.outfits.find((x) => x.id === url.searchParams.get('id'));
    if (!o) throw new Error('这套穿搭已经不在了');
    const { fav, disliked, reason } = JSON.parse(await readBody(req));
    if (typeof fav === 'boolean') o.fav = fav;
    if (disliked === true && !o.disliked) {
      Object.assign(o, { disliked: true, fav: false });
      const why = text(reason, 40);
      addFeedback({ kind: 'outfit', name: o.name, detail: o.items.join('、'), reason: why });
      const at = db.daily?.outfitIds.indexOf(o.id) ?? -1;
      if (at >= 0) {
        // 今日方案里被否掉的那一格，原位补一套新的。
        const { slots, done } = draft({ count: 1, source: 'replace', priority: 'user', replace: { name: o.name, items: o.items.join('、'), reason: why, occasion: o.occasion } });
        db.daily.outfitIds.splice(at, 1, slots[0].id);
        done.catch(async (e) => { await dropEntries('outfit', [slots[0].id]); db.daily.error = `补位失败：${e.message}`.slice(0, 160); save(); });
      }
    }
    save(); return o;
  },
  'POST /api/art/retry': async (req) => {
    const { kind, id } = JSON.parse(await readBody(req));
    const hairs = kind === 'hair';
    const e = (hairs ? db.hairs : db.outfits).find((x) => x.id === id);
    if (!e) throw new Error('无法生成预览');
    const deferred = e.art === 'pending' && db.jobs.find((job) =>
      job.status === 'queued' && job.priority !== 'user' && job.ids.includes(e.id));
    if (deferred) {
      deferred.priority = 'user';
      save(); pump();
      return { ok: true };
    }
    if (e.art !== 'failed') throw new Error('无法重新生成');
    const ids = hairs ? (e.group || []).filter((gid) => db.hairs.some((h) => h.id === gid)) : [e.id];
    if (hairs && ids.length !== 6) throw new Error('这组发型已经不完整，无法重画预览');
    for (const x of hairs ? db.hairs : db.outfits) if (ids.includes(x.id)) x.art = 'pending';
    queueArt(hairs ? 'hairs' : 'outfits', ids, 'user');
    save(); pump();
    return { ok: true };
  },
  'POST /api/hairs/more': async () => {
    if (!A()) throw new Error('请先完成一次风格分析');
    if (db.hairJob?.status === 'running') throw new Error('正在设计新发型，稍等一下');
    db.hairJob = { status: 'running', startedAt: Date.now() };
    save();
    ask('hairs', HAIRS_SCHEMA, hairsPrompt({ brief: brief(), existing: db.hairs.map((h) => h.name) }), { effort: 'medium' })
      .then((res) => { if ((res.hairstyles || []).length < 6) throw new Error('这次没有给够 6 款'); addHairs(res.hairstyles, 'library', 'user'); db.hairJob = { status: 'done' }; })
      .catch((e) => { db.hairJob = { status: 'failed', error: e.message.slice(0, 160) }; })
      .finally(() => { save(); pump(); });
    return db.hairJob;
  },
  'PATCH /api/hairs': async (req, url) => {
    const h = db.hairs.find((x) => x.id === url.searchParams.get('id'));
    if (!h) throw new Error('这款发型已经不在了');
    const { fav, disliked, reason } = JSON.parse(await readBody(req));
    if (typeof fav === 'boolean') h.fav = fav;
    if (disliked === true && !h.disliked) { Object.assign(h, { disliked: true, fav: false }); addFeedback({ kind: 'hair', name: h.name, detail: h.tagline, reason: text(reason, 40) }); }
    save(); return h;
  },
  'PATCH /api/feed': async (req, url) => {
    const { fav, disliked, reason } = JSON.parse(await readBody(req));
    const item = feed.mark(url.searchParams.get('id'), { fav, disliked });
    if (disliked === true) { addFeedback({ kind: 'article', name: item.zh || item.title, detail: [item.source, item.tag].filter(Boolean).join(' · '), reason: text(reason, 40) }); save(); }
    return item;
  },
  'POST /api/feed/refresh': async () => { feed.refresh().catch((e) => console.error('feed', e.message)); return { ok: true }; },
  'PUT /api/hidden': async (req) => {
    const { id, hidden, reason } = JSON.parse(await readBody(req));
    const selection = library.find(id);
    if (!selection) throw new Error('素材暂不可用');
    if (hidden) {
      db.hidden[id] = Date.now();
      if (library.get().favorites.includes(id)) await library.favorite(id, false);
      addFeedback({ kind: selection.kind, name: selection.entry.name, detail: selection.kind === 'item' ? selection.entry.shape : selection.entry.items.map((p) => p.name).join('、'), reason: text(reason, 40) });
    } else delete db.hidden[id];
    save(); return { hidden: db.hidden };
  },
  'PUT /api/wardrobe': async (req) => {
    const { libraryId, owned } = JSON.parse(await readBody(req));
    const selection = library.find(libraryId);
    if (selection?.kind !== 'item') throw new Error('单品暂不可用');
    db.wardrobe = db.wardrobe.filter((w) => w.libraryId !== libraryId);
    if (owned) db.wardrobe.unshift({ id: uid(), libraryId, name: selection.entry.name, category: selection.entry.category, addedAt: Date.now() });
    save(); return db.wardrobe;
  },
  'DELETE /api/wardrobe': async (req, url) => {
    const entry = db.wardrobe.find((w) => w.id === url.searchParams.get('id'));
    db.wardrobe = db.wardrobe.filter((w) => w !== entry);
    if (entry?.photoId) { const p = db.photos.find((x) => x.id === entry.photoId); if (p) p.owned = false; }
    save(); return db.wardrobe;
  },
  'PUT /api/prefs': async (req) => {
    const { add, remove } = JSON.parse(await readBody(req));
    const before = styleQuizKey();
    if (remove) db.prefs.notes = db.prefs.notes.filter((n) => n.id !== remove);
    if (text(add, 40)) db.prefs.notes.unshift({ id: uid(), text: text(add, 40), auto: false });
    save();
    if (before !== styleQuizKey() && process.env.ATELIER_AUTO !== '0') scoreFit();
    return db.prefs;
  },
  'PUT /api/prefs/style-quiz': async (req) => {
    const { choices } = JSON.parse(await readBody(req));
    const before = styleQuizKey();
    db.prefs.notes = styleQuizNotes(choices, db.prefs.notes);
    db.settings.styleQuizDone = STYLE_QUIZ_VERSION;
    save();
    if (before !== styleQuizKey() && process.env.ATELIER_AUTO !== '0') scoreFit();
    return db.prefs;
  },
  'PUT /api/locks': async (req) => {
    const { key, locked } = JSON.parse(await readBody(req));
    if (!SECTIONS[key]) throw new Error('参数错误');
    db.locks[key] = Boolean(locked);
    save(); return db.locks;
  },
  'POST /api/drift/dismiss': async () => { db.drift = null; save(); return { ok: true }; },
};

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host;
    const port = server.address().port;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)
        || (req.headers.origin && req.headers.origin !== 'http://' + host)) {
      return json(res, 403, { error: '请从本机地址打开 Atelier' });
    }
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);
    if (req.method === 'GET' && p === '/api/library/illustration') {
      const svg = apparelIllustration(Object.fromEntries(url.searchParams));
      if (!svg) return json(res, 400, { error: '单品图参数无效' });
      res.writeHead(200, { 'content-type': MIME['.svg'], 'cache-control': 'private, max-age=86400' });
      return res.end(svg);
    }
    const handler = routes[`${req.method} ${p}`];
    if (handler) {
      if (!workspaceReady() && !setupRoutes.has(`${req.method} ${p}`)) return json(res, 409, { error: '请先完成建模向导' });
      return json(res, 200, await handler(req, url));
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: '接口不存在' });
    if (p.startsWith('/media/library/')) {
      const file = libraryImagePath(p.slice('/media/library/'.length));
      if (!file) { res.writeHead(404); return res.end('Not found'); }
      return sendFile(res, path.dirname(file), path.basename(file), 'private, max-age=86400');
    }
    const media = p.match(/^\/media\/(photos|looks|assets)\/(.+)$/);
    if (media) return sendFile(res, DIRS[media[1]], media[2], 'private, no-store');
    return sendFile(res, PUBLIC, p === '/' ? 'index.html' : p.slice(1), 'no-cache');
  } catch (e) {
    json(res, 400, { error: e.message });
  }
});

function housekeeping() {
  if (!automatic()) return;
  dailyTick(false).catch((e) => console.error('daily', e.message));
  Promise.resolve(feed.tick()).catch((e) => console.error('feed', e.message));
  scoreFit();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '127.0.0.1', () => console.log(`Atelier 已启动： http://127.0.0.1:${server.address().port}`));
  pump();
  classify();
  if (automatic()) annotate();
  describeGarments();
  if (process.env.ATELIER_AUTO !== '0') {
    housekeeping();
    setInterval(housekeeping, 60 * 1000).unref();
  }
  if (process.env.ATELIER_LIBRARY_AUTO !== '0') {
    const checkLibrary = () => { pump(); if (automatic()) library.tick().catch((e) => console.error('library refresh', e.message)); };
    checkLibrary();
    setInterval(checkLibrary, 60 * 1000).unref();
  }
}
