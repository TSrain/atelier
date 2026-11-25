import { S, $, A, analyzing, api, avatar, bodyBase, day, esc, img, inSeason, lookImg, photos, tags, toast } from './state.js';
import { canTryLibraryOutfit, historyLibrary, libraryHref, librarySelection, renderLibrary } from './library.js';
import { alignDailyCaret, renderHome, selectDailyOutfit } from './home.js';
import { CATS, compare, compareDescription, hasWear, itemChoices, renderStage, renderStudio, revealComparison } from './studio.js';
import { renderMine } from './mine.js';
import { STYLE_QUIZ_VERSION, styleQuizIds } from './style-questions.js';
import { styleQuizBack } from './style-quiz.js';
import { createTaskStatus } from './task-status.js';
import { createBodyEditor } from './body-editor.js';
import { isModeledBody } from './body-shape.js';
import { onboardingState } from './onboarding-state.js';
import { renderOnboarding } from './onboarding.js';

const app = $('#app');
const reanalyzeDialog = $('#reanalyzeDialog');
const navStatus = $('#navStatus'), navProgress = $('.nav-progress', navStatus), navCompletion = $('a', navStatus);
const taskToast = $('#taskToast');
const taskStatus = createTaskStatus();
const { ui, studio } = S;
const bodyEditor = createBodyEditor($('#bodyEditor'), {
  applyOnce: (id) => {
    studio.bodyBaseOnce = studio.baseId = id;
    studio.picked = true;
    studio.viewId = null;
    render();
    toast('已换为调整后的身形，选好的穿搭可以直接继续试穿');
  },
  saveDefault: (id) => updateBodyDefault({ id }, '已设为默认形象'),
  restoreDefault: () => updateBodyDefault({ restore: true }, '已切回上一版形象'),
});
let displayedCompletion, taskToastTimer;
let lastJson = '';
let libraryToken = Symbol();
let libraryRequest = 0;
let libraryRetryAt = 0;
let upload = { kind: 'photo', label: '', owned: false };
let referenceRequest = 0;
let visitedAt = 0;
let locateTried = false;
const setupClient = { check: null, checking: false, busy: false, error: '', slot: '' };
const setupOpen = () => S.db && onboardingState(S.db).stage !== 'ready';

async function checkSetup(force = false) {
  if (setupClient.checking) return;
  setupClient.checking = true;
  setupClient.error = '';
  render();
  try {
    setupClient.check = await api('GET', '/api/setup/check' + (force ? '?refresh' : ''));
  } catch (error) {
    setupClient.error = error.message;
  } finally {
    setupClient.checking = false;
    render();
  }
}

async function submitSetup(request, complete) {
  if (setupClient.busy) return;
  setupClient.busy = true;
  setupClient.error = '';
  render();
  try {
    await request();
    complete?.();
    await refresh(true);
  } catch (error) {
    setupClient.error = error.message;
  } finally {
    setupClient.busy = false;
    render();
  }
}

const act = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };
const editing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable || document.activeElement?.closest('.style-quiz');

const ROUTES = ['home', 'studio', 'mine', 'library'];
const route = () => {
  const r = (location.hash.replace('#/', '') || 'home').split('?')[0];
  return r === 'profile' ? 'mine' : ROUTES.includes(r) ? r : 'home';
};
const libraryQuery = () => new URLSearchParams(location.hash.split('?')[1] || '');
const inStyleQuiz = () => route() === 'mine' && libraryQuery().get('v') === 'style';
const dailyRail = () => $('.rail.daily', app);
const go = (r) => { if (route() === r) render(); else location.hash = `#/${r}`; };

async function updateBodyDefault(change, message) {
  await api('PUT', '/api/body-base', change);
  studio.bodyBaseOnce = null;
  studio.picked = false;
  studio.viewId = null;
  await refresh(true);
  toast(message);
}

async function syncLibrary(token, force) {
  if (!force && token === libraryToken && (!S.libraryError || Date.now() < libraryRetryAt)) return;
  const request = ++libraryRequest;
  libraryToken = token;
  libraryRetryAt = Date.now() + 30000;
  try {
    const next = await api('GET', '/api/library');
    if (request !== libraryRequest) return;
    S.library = next;
    S.libraryError = '';
  } catch (error) {
    if (request !== libraryRequest) return;
    S.libraryError = error.message;
  }
  if (S.db && !editing()) render();
}

async function refresh(force, reloadLibrary = false) {
  const next = await api('GET', '/api/state');
  const firstLoad = !S.db;
  const json = JSON.stringify(next);
  const changed = json !== lastJson;
  S.db = next; lastJson = json;
  if (setupOpen()) {
    if (force || changed) render();
    if (firstLoad) void checkSetup();
    return;
  }
  if (!studio.picked || !next.photos.some((p) => p.id === studio.baseId)) {
    studio.bodyBaseOnce = null;
    studio.baseId = (bodyBase() || avatar('avatarbust') || photos().find((p) => !p.bodyEditId))?.id || null;
  }
  if (firstLoad) selectLookFromUrl();
  renderStatus();
  bodyEditor.sync();
  if (force || (changed && !editing())) render();
  else if (route() === 'studio') renderStage();
  if (firstLoad) openBodyFromUrl();
  await syncLibrary(next.libraryRevision, reloadLibrary);
  visit();
}

// 进首页才算「看过」今天的方案；服务端据此决定明早要不要出新的。
function visit() {
  const { db } = S;
  if (setupOpen() || db.settings.automatic === false || route() !== 'home' || libraryQuery().has('article') || !A() || document.hidden || Date.now() - visitedAt < 20000) return;
  if (db.daily?.seenAt && db.daily.date === db.today && db.weather?.date === db.today) return;
  visitedAt = Date.now();
  api('POST', '/api/home/visit').then(() => refresh()).catch(() => {});
  if (!db.settings.located && !locateTried) locate(true);
}
function locate(silent) {
  locateTried = true;
  if (!navigator.geolocation) { if (!silent) toast('这个浏览器不支持定位，请直接输入城市'); return; }
  navigator.geolocation.getCurrentPosition(act(async (pos) => {
    const { city } = await api('PUT', '/api/settings/city', { lat: pos.coords.latitude, lon: pos.coords.longitude });
    ui.cityOpen = false;
    await refresh(true);
    if (!silent) toast(`已定位到${city.name}`);
  }), () => { if (!silent) toast('没有拿到定位权限，请直接输入城市'); }, { timeout: 8000, maximumAge: 3600_000 });
}

function renderStatus() {
  const { progress, completion, newCompletion } = taskStatus.update(S.db);
  const progressLabel = $('span', navProgress);
  if (progressLabel.textContent !== progress) progressLabel.textContent = progress;
  navProgress.hidden = !progress;
  if (completion !== displayedCompletion) {
    displayedCompletion = completion;
    if (completion) {
      for (const link of [navCompletion, taskToast]) {
        $('.task-result-label', link).textContent = completion.text;
        link.setAttribute('href', completion.href);
      }
    }
    taskToast.hidden = !newCompletion;
    scheduleTaskToastHide();
  }
  navCompletion.hidden = !completion;
  navStatus.hidden = !progress && !completion;
}

function scheduleTaskToastHide() {
  clearTimeout(taskToastTimer);
  if (taskToast.hidden || document.hidden) return;
  taskToastTimer = setTimeout(() => {
    if (!taskToast.matches(':hover, :focus-within')) taskToast.hidden = true;
  }, 8000);
}

function selectLookFromUrl() {
  if (route() !== 'studio') return;
  const id = libraryQuery().get('look');
  if (id && S.db.looks.some((look) => look.id === id && look.status === 'done')) studio.viewId = id;
}

function openBodyFromUrl() {
  const id = libraryQuery().get('shape');
  if (id && S.db.bodyEdits?.some((edit) => edit.id === id && edit.status === 'done')) {
    bodyEditor.open(route(), bodyBase(), $('[data-act="editBody"]'), id);
  }
}

const views = { home: () => renderHome(libraryQuery()), studio: renderStudio, mine: renderMine, library: () => renderLibrary(S.library, libraryQuery(), S.libraryError) };
function render() {
  const setup = onboardingState(S.db);
  document.body.classList.toggle('setup-open', setup.stage !== 'ready');
  if (setup.stage !== 'ready') {
    app.innerHTML = renderOnboarding(setup, setupClient, S.db.classifyJob);
    return;
  }
  const r = route();
  if (!inStyleQuiz()) ui.styleQuiz = null;
  else if (!ui.styleQuiz) {
    const choices = styleQuizIds(S.db.prefs.notes);
    ui.styleQuiz = { choices, hadChoices: choices.length > 0, saving: false };
  }
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#/${r === 'library' ? 'mine' : r}`));
  const y = window.scrollY, same = render.last === r;
  const keep = same && Object.fromEntries([...app.querySelectorAll('[data-scroll]')].map((el) => [el.dataset.scroll, [el.scrollTop, el.scrollLeft]]));
  app.innerHTML = `<div class="view ${same ? '' : 'enter'}">${views[r]()}</div>`;
  if (same) { window.scrollTo(0, y); app.querySelectorAll('[data-scroll]').forEach((el) => { const p = keep[el.dataset.scroll] || [0, 0]; el.scrollTop = p[0]; el.scrollLeft = p[1]; }); }
  const rail = dailyRail();
  if (rail) {
    alignDailyCaret(rail);
    rail.addEventListener('scroll', () => alignDailyCaret(rail), { passive: true });
  }
  render.last = r;
  if (r === 'studio') renderStage();
  if (r === 'mine') { drawWires(); setTimeout(drawWires, 400); }
}

function openLook(id) {
  const l = S.db.looks.find((x) => x.id === id);
  if (!l) return;
  const row = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '');
  const box = $('#lightbox');
  const sameLook = !box.hidden && box.dataset.id === id;
  const position = sameLook ? $('[data-compare]', box)?.valueAsNumber ?? 0 : 0;
  box.innerHTML = `<button class="close glass" data-act="close">×</button>
    ${compare(S.db.photos.some((photo) => photo.id === l.baseId) ? img(l.baseId) : '', lookImg(l.id), position)}
    <aside class="glass"><div><span class="eyebrow">${tags(l).join(' · ')} — ${day(l.createdAt)}</span><h3 style="margin-top:12px">${esc(l.title)}</h3></div>
      <dl class="dl">${row('发型', l.hair)}${row(l.garment ? '搭配' : '穿搭', l.outfit)}${row('姿势', l.pose)}${row('场景', l.scene)}</dl>
      ${historyLibrary(l.libraryRef)}
      ${l.garment ? `<div><span class="eyebrow">试穿单品</span><img src="/media/${l.garment}" alt="" style="max-width:100%;height:110px;border-radius:12px;margin-top:10px" onerror="this.parentElement.remove()"></div>` : ''}
      <div class="acts"><button class="btn primary sm" data-act="fav" data-id="${l.id}">${l.fav ? '♥ 已收藏' : '♡ 收藏'}</button><a class="btn ghost sm" href="${lookImg(l.id)}" download="${esc(l.title)}.jpg">下载原图</a><button class="btn ghost sm" data-act="delLook" data-id="${l.id}">删除</button></div></aside>`;
  box.hidden = false; box.dataset.id = id;
  if (!sameLook) revealComparison(box);
}
const closeLook = () => { $('#lightbox').hidden = true; };

async function uploadFiles(files, kind) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  if (!list.length) return;
  toast(`正在导入 ${list.length} 张图片…`);
  const label = kind === 'garment' ? (upload.owned ? '衣橱单品' : '试穿单品') : upload.label || '未标注';
  let last;
  for (const f of list) last = await api('POST', `/api/photos?kind=${kind}&label=${encodeURIComponent(label)}${kind === 'garment' && upload.owned ? '&owned=1' : ''}`, f);
  if (kind === 'garment' && !upload.owned && route() === 'studio') { studio.mode = 'items'; studio.items[studio.cat] = `photo:${last.id}`; }
  else if (kind === 'photo' && route() === 'studio') { studio.picked = true; ui.rawBases = true; studio.bodyBaseOnce = null; studio.baseId = last.id; studio.viewId = null; }
  upload = { kind: 'photo', label: '', owned: false };
  await refresh(true);
  toast(kind === 'photo' ? '已上传，正在识别照片类型，稍后清单会自动更新' : '已导入，正在识别名称和品类');
}

function clearLocalOutfit() {
  referenceRequest++;
  if (studio.reference) URL.revokeObjectURL(studio.reference.url);
  studio.reference = null;
}

async function chooseLocalOutfit(file) {
  if (!file) return;
  const request = ++referenceRequest;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片');
  if (file.size > 20 * 1024 * 1024) throw new Error('参考图不能超过 20 MB，请压缩后重试');
  const url = URL.createObjectURL(file);
  const preview = new Image();
  preview.src = url;
  try { await preview.decode(); }
  catch { URL.revokeObjectURL(url); throw new Error('无法读取这张图片，请换一张'); }
  if (request !== referenceRequest || route() !== 'studio' || studio.mode !== 'outfit') { URL.revokeObjectURL(url); return; }
  clearLocalOutfit();
  studio.reference = { file, url };
  studio.outfit = studio.entryOutfit = null;
  studio.viewId = null;
  render();
  $('[data-act="uploadReference"]')?.focus({ preventScroll: true });
}

function wearItem(ref) {
  const selection = librarySelection(S.library, ref);
  const cat = selection?.entry.category || CATS.find((c) => itemChoices(c).some((it) => it.ref === ref)) || '上装';
  clearLocalOutfit();
  studio.mode = 'items'; studio.outfit = null; studio.cat = cat; studio.items = { [cat]: ref }; studio.viewId = null;
  closeLook(); go('studio');
}
function chooseLibrary(id) {
  const selection = librarySelection(S.library, id);
  if (!selection) throw new Error('这条素材暂时无法试穿');
  if (selection.kind === 'item') return wearItem(id);
  if (!canTryLibraryOutfit(selection.entry)) throw new Error('这套穿搭暂缺全身原照');
  openStudioOutfit('lib', selection.entry, S.library.favorites.includes(id));
}

function openStudioOutfit(kind, { id, season }, favorite) {
  clearLocalOutfit();
  studio.mode = 'outfit'; studio.outfit = studio.entryOutfit = { kind, id }; studio.items = {}; studio.extra = ''; studio.viewId = null;
  studio.tab = favorite ? 'fav' : 'rec';
  if (!inSeason(season)) studio.season = season === '春秋' ? '秋' : season;
  closeLook(); go('studio');
  const cards = $('[data-scroll="outfits"]');
  if (cards) cards.scrollTop = 0;
  window.scrollTo(0, 0);
}

const DISLIKE = {
  outfit: [(id, reason) => api('PATCH', `/api/outfits?id=${id}`, { disliked: true, reason }), '记下了，正在原位补一套新的'],
  item: [(id, reason) => api('PUT', '/api/hidden', { id, hidden: true, reason }), '记下了，换一件给你'],
  hair: [(id, reason) => api('PATCH', `/api/hairs?id=${id}`, { disliked: true, reason }), '记下了，这款不会再出现'],
  article: [(id, reason) => api('PATCH', `/api/feed?id=${id}`, { disliked: true, reason }), '记下了，以后少推这类内容'],
};

async function appendDailyOutfits(direction) {
  const slots = await api('POST', '/api/outfits/more', direction === undefined ? {} : { direction });
  if (direction !== undefined) { ui.dirOpen = false; ui.direction = ''; }
  await refresh(true);
  const rail = dailyRail();
  if (!rail || !slots.length) return;
  const first = $(`[data-id="${CSS.escape(slots[0].id)}"]`, rail);
  if (!first) return;
  rail.scrollTo({
    left: first.offsetLeft - rail.firstElementChild.offsetLeft,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}

async function finishStyleQuiz(choices) {
  const quiz = ui.styleQuiz;
  if (quiz.saving) return;
  const back = styleQuizBack(libraryQuery());
  quiz.saving = true;
  render();
  try {
    S.db.prefs = await api('PUT', '/api/prefs/style-quiz', { choices });
    S.db.settings.styleQuizDone = STYLE_QUIZ_VERSION;
  } catch (error) {
    quiz.saving = false;
    if (ui.styleQuiz === quiz) render();
    throw error;
  }
  if (inStyleQuiz() && ui.styleQuiz === quiz) location.hash = back;
  toast(choices.length ? '风格偏好已保存' : '将按形象档案为你推荐');
  await refresh(true);
}

const actions = {
  setupCheck: () => checkSetup(true),
  setupPick: (el) => {
    setupClient.slot = el.dataset.slot;
    $('#setupPhoto').click();
  },
  setupClassify: () => submitSetup(() => api('POST', '/api/setup/classify')),
  setupBuild: () => submitSetup(() => api('POST', '/api/setup/build')),
  setupConfirm: () => submitSetup(() => api('POST', '/api/setup/confirm'), () => {
    studio.picked = false;
    history.replaceState(null, '', '#/studio');
    window.scrollTo(0, 0);
  }),
  automatic: async (el) => {
    await api('PUT', '/api/settings/automatic', { enabled: el.dataset.enabled === 'true' });
    await refresh(true);
  },
  editBody: (el) => {
    const from = route();
    const chosen = from === 'studio' && avatar(studio.baseId);
    bodyEditor.open(from, isModeledBody(chosen) ? chosen : bodyBase(), el);
  },
  styleQuizChoose: (el) => {
    const quiz = ui.styleQuiz;
    const id = el.dataset.id;
    if (quiz.choices.includes(id)) quiz.choices = quiz.choices.filter((choice) => choice !== id);
    else quiz.choices.push(id);
    render();
    $(`[data-act="styleQuizChoose"][data-id="${id}"]`)?.focus({ preventScroll: true });
  },
  styleQuizSave: () => finishStyleQuiz(ui.styleQuiz.choices),
  styleQuizSkip: () => finishStyleQuiz([]),
  analyze: async () => {
    await api('POST', '/api/analyze');
    await refresh(true); toast('已开始分析，约 5–8 分钟，完成后页面会自动更新');
  },
  reanalyze: () => {
    if (reanalyzeDialog.open || analyzing()) return;
    $('form', reanalyzeDialog).reset();
    $('.archive-dialog-error', reanalyzeDialog).hidden = true;
    reanalyzeDialog.showModal();
  },
  cancelReanalysis: () => reanalyzeDialog.close(),
  lock: async (el) => { const key = el.dataset.key; await api('PUT', '/api/locks', { key, locked: !S.db.locks[key] }); await refresh(true); },
  dismissDrift: async () => { await api('POST', '/api/drift/dismiss'); await refresh(true); },
  buildAvatar: async () => { await api('POST', '/api/avatar'); await refresh(true); toast('开始生成建模形象，完成后会自动更新'); },
  retrySheet: async (el) => { await api('POST', `/api/sheets?key=${el.dataset.key}`); await refresh(true); },
  retryArt: async (el) => { await api('POST', '/api/art/retry', { kind: el.dataset.kind, id: el.dataset.id }); await refresh(true); toast('已重新排队'); },
  upload: (el) => { upload = { kind: el.dataset.kind, label: el.dataset.label || '', owned: el.dataset.owned === '1' }; $('#file').click(); },
  uploadReference: () => $('#studioReference').click(),
  removeReference: () => { clearLocalOutfit(); render(); $('[data-act="uploadReference"]')?.focus({ preventScroll: true }); },
  delPhoto: async (el) => { if (!confirm('删除这张照片？')) return; await api('DELETE', `/api/photos?id=${el.dataset.id}`); await refresh(true); },
  copy: async (el) => { await navigator.clipboard.writeText(el.dataset.text); toast(el.dataset.done || '已复制'); },
  set: (el) => { ui[el.dataset.k] = el.dataset.v; ui.disliking = null; render(); },
  toggle: (el) => { ui[el.dataset.k] = !ui[el.dataset.k]; render(); if (el.dataset.k === 'cityOpen' && ui.cityOpen) $('[data-form="city"] input')?.focus(); },

  selOutfit: selectDailyOutfit,
  moreOutfits: async () => { await appendDailyOutfits(); toast('正在追加 2 套，文字方案约半分钟，图约 2 分钟'); },
  fillDirection: (el) => { ui.dirOpen = true; ui.direction = el.dataset.text; render(); const input = $('[data-form="direction"] input'); input?.focus(); input?.setSelectionRange(input.value.length, input.value.length); },
  closeDirection: () => { ui.dirOpen = false; render(); },
  tryOutfit: (el) => {
    const outfit = S.db.outfits.find((o) => o.id === el.dataset.id);
    if (!outfit) throw new Error('这套穿搭暂时无法试穿');
    openStudioOutfit('own', outfit, outfit.fav);
  },
  favOutfit: async (el) => { const o = S.db.outfits.find((x) => x.id === el.dataset.id); await api('PATCH', `/api/outfits?id=${o.id}`, { fav: !o.fav }); await refresh(true); toast(o.fav ? '已取消收藏' : '已收藏，可以在「我的 · 收藏」和试衣间里找到'); },
  askDislike: (el) => { ui.disliking = { kind: el.dataset.kind, id: el.dataset.id }; render(); },
  cancelDislike: () => { ui.disliking = null; render(); },
  dislike: async (el) => { const [send, message] = DISLIKE[el.dataset.kind]; await send(el.dataset.id, el.dataset.reason); ui.disliking = null; await refresh(true, el.dataset.kind === 'item'); toast(message); },
  own: async (el) => { await api('PUT', '/api/wardrobe', { libraryId: el.dataset.id, owned: true }); await refresh(true); toast('已加入衣橱，之后的穿搭会优先用它'); },
  dropWardrobe: async (el) => { await api('DELETE', `/api/wardrobe?id=${el.dataset.id}`); await refresh(true); },
  favArticle: async (el) => { const item = S.db.feed.items.find((x) => x.id === el.dataset.id); await api('PATCH', `/api/feed?id=${item.id}`, { fav: !item.fav }); await refresh(true); },
  refreshFeed: async () => { await api('POST', '/api/feed/refresh'); await refresh(true); toast('正在挑选今天的穿搭读物'); },
  locate: () => locate(false),
  dropNote: async (el) => { await api('PUT', '/api/prefs', { remove: el.dataset.id }); await refresh(true); },

  tryHair: (el) => { studio.hairId = el.dataset.id; studio.hair = ''; studio.viewId = null; go('studio'); },
  tryItem: (el) => wearItem(el.dataset.id),
  tryCeleb: (el) => { const c = S.db.analysis.celebrities[el.dataset.i]; clearLocalOutfit(); studio.mode = 'outfit'; studio.outfit = null; studio.items = {}; studio.extra = c.outfit_prompt; studio.viewId = null; go('studio'); },
  tryLibrary: (el) => chooseLibrary(el.dataset.id),
  reloadLibrary: () => syncLibrary(S.db.libraryRevision, true),
  checkLibrary: async (el) => {
    el.disabled = true;
    try { await api('POST', '/api/library/refresh', {}); await refresh(true, true); } finally { el.disabled = false; }
  },
  libraryFavorite: async (el) => {
    const id = el.dataset.id, favorite = !S.library.favorites.includes(id);
    el.disabled = true;
    try {
      await api('PUT', '/api/library/favorites', { id, favorite });
      await refresh(true, true);
      toast(favorite ? '已收藏' : '已取消收藏');
      Array.from(document.querySelectorAll('[data-act="libraryFavorite"]')).find((button) => button.dataset.id === id)?.focus({ preventScroll: true });
    } finally { el.disabled = false; }
  },

  setStudio: (el) => { studio[el.dataset.k] = el.dataset.v; render(); },
  pickOutfit: (el) => { clearLocalOutfit(); studio.outfit = studio.outfit?.id === el.dataset.id ? null : { kind: el.dataset.kind, id: el.dataset.id }; studio.viewId = null; render(); },
  pickItem: (el) => { studio.items[studio.cat] = studio.items[studio.cat] === el.dataset.ref ? null : el.dataset.ref; studio.viewId = null; render(); },
  dropItem: (el) => { studio.items[el.dataset.cat] = null; render(); },
  pickHair: (el) => { studio.hairId = el.dataset.id || null; studio.hair = ''; studio.viewId = null; render(); },
  moreHairs: async () => { await api('POST', '/api/hairs/more'); await refresh(true); toast('正在设计 6 款新发型，约 3 分钟后出预览'); },
  clearStudio: (el) => { if (el.dataset.key === 'hair') { studio.hairId = null; studio.hair = ''; } else { clearLocalOutfit(); studio.outfit = studio.entryOutfit = null; studio.items = {}; studio.extra = ''; } render(); },
  base: (el) => {
    studio.picked = true;
    if (studio.bodyBaseOnce !== el.dataset.id) studio.bodyBaseOnce = null;
    studio.baseId = el.dataset.id;
    studio.viewId = null;
    render();
  },
  view: (el) => {
    const fromHistory = el.closest('.studio-history');
    if (fromHistory) studio.recentOpen = false;
    studio.viewId = el.dataset.id || null;
    render();
    if (fromHistory) $('.studio-history summary')?.focus({ preventScroll: true });
  },
  generate: async (el) => {
    if (studio.submitting) return;
    const outfitMode = studio.mode === 'outfit';
    const spec = { baseId: studio.baseId, hairId: studio.hairId, hair: studio.hairId ? '' : studio.hair, outfit: outfitMode ? studio.outfit : null,
      items: outfitMode ? [] : Object.values(studio.items).filter(Boolean), extra: studio.extra, season: studio.season || S.db.seasonName[0] };
    let body = spec;
    if (outfitMode && studio.reference) {
      body = new FormData();
      body.set('spec', JSON.stringify(spec));
      body.set('reference', studio.reference.file);
    }
    studio.submitting = el.disabled = true;
    el.textContent = '正在提交…';
    let look;
    try { look = await api('POST', '/api/looks', body); }
    finally {
      studio.submitting = false;
      const button = $('[data-act="generate"]');
      if (button) { button.disabled = false; button.textContent = '生成造型'; }
    }
    if (spec.baseId && studio.bodyBaseOnce === spec.baseId) {
      studio.bodyBaseOnce = null;
      studio.picked = false;
    }
    studio.viewId = look.id;
    await refresh(true);
    if (window.innerWidth <= 1080) $('#stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('已加入生成队列');
  },
  redo: async (el) => {
    const look = await api('POST', '/api/looks', { from: el.dataset.id, change: el.dataset.change });
    studio.viewId = look.id;
    await refresh(true);
    toast(el.dataset.change === 'scene' ? '正在换一个场景，衣服保持不变' : '正在换一个姿势，衣服保持不变');
  },
  fav: async (el) => { const l = S.db.looks.find((x) => x.id === el.dataset.id); await api('PATCH', `/api/looks?id=${l.id}`, { fav: !l.fav }); await refresh(true); if (!$('#lightbox').hidden) openLook(l.id); },
  delLook: async (el) => { if (!confirm('删除这张试穿图？删除后无法恢复。')) return; await api('DELETE', `/api/looks?id=${el.dataset.id}`); if (studio.viewId === el.dataset.id) studio.viewId = null; closeLook(); await refresh(true); },
  open: (el) => openLook(el.dataset.id),
  close: closeLook,
};

const forms = {
  reanalyze: async (data) => {
    const submit = $('[type="submit"]', reanalyzeDialog);
    const cancel = $('[data-act="cancelReanalysis"]', reanalyzeDialog);
    const error = $('.archive-dialog-error', reanalyzeDialog);
    if (submit.disabled) return;
    submit.disabled = cancel.disabled = true;
    error.hidden = true;
    try {
      await api('POST', '/api/analyze', { feedback: data.get('feedback').trim() });
      reanalyzeDialog.close();
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
      return;
    } finally {
      submit.disabled = cancel.disabled = false;
    }
    await refresh(true);
    toast('已开始重新分析，完成后页面会自动更新');
  },
  city: async (data) => { const { city } = await api('PUT', '/api/settings/city', { name: data.get('city') }); ui.cityOpen = false; await refresh(true); toast(`已切换到${city.name}`); },
  direction: async (data) => {
    const direction = String(data.get('direction') || '').trim();
    await appendDailyOutfits(direction);
    toast(direction ? `正在按「${direction}」出 2 套，约 2 分钟` : '正在追加 2 套，约 2 分钟');
  },
  note: async (data) => { if (!String(data.get('note') || '').trim()) return; await api('PUT', '/api/prefs', { add: data.get('note') }); await refresh(true); toast('已添加，之后的推荐会遵守'); },
};

function focusPoint(target) {
  const el = target.closest?.('[data-pt]');
  const block = (el || target).closest?.('[data-diag]');
  document.querySelectorAll('[data-diag]').forEach((b) => {
    const on = b === block && el;
    b.classList.toggle('focus', !!on);
    b.querySelectorAll('[data-pt]').forEach((x) => x.classList.toggle('active', !!on && x.dataset.pt === el.dataset.pt));
  });
}
function drawWires() {
  document.querySelectorAll('[data-diag]').forEach((b) => {
    const svg = $('.wires', b), box = b.getBoundingClientRect(), fig = $('.figure', b).getBoundingClientRect();
    const stacked = $('.notes', b).getBoundingClientRect().left < fig.right;
    svg.innerHTML = stacked ? '' : [...b.querySelectorAll('.mark')].map((m) => {
      const r = m.getBoundingClientRect(), dot = $(`li[data-pt="${m.dataset.pt}"] > i`, b).getBoundingClientRect();
      const x1 = r.left + r.width / 2 - box.left, y1 = r.top + r.height / 2 - box.top, x2 = dot.left - box.left - 5, y2 = dot.top + dot.height / 2 - box.top;
      const edge = fig.right - box.left, bend = edge + (x2 - edge) * 0.45;
      const d = `M${x1 + r.width / 2 - 1} ${y1} L${edge} ${y1} C${bend} ${y1} ${bend} ${y2} ${x2} ${y2}`;
      return `<g data-pt="${m.dataset.pt}" class="${m.classList.contains('locked') ? 'locked' : ''}"><path class="halo" d="${d}"/><path d="${d}"/><circle cx="${x2}" cy="${y2}" r="2.2"/></g>`;
    }).join('');
  });
}
window.addEventListener('resize', drawWires);
window.addEventListener('resize', () => alignDailyCaret(dailyRail()));
document.addEventListener('mouseover', (e) => { if (route() === 'mine' && e.target.closest) focusPoint(e.target); });

app.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const card = e.target.closest('#today [data-act="selOutfit"]:enabled');
  if (card && !card.contains(e.relatedTarget)) selectDailyOutfit(card);
});

document.addEventListener('click', (e) => {
  const history = $('.studio-history[open]');
  if (history && !history.contains(e.target)) history.open = studio.recentOpen = false;
  const el = e.target.closest('[data-act]');
  if (el) { if (el.closest('button[disabled]')) return; if (el.tagName !== 'A') e.preventDefault(); return act(actions[el.dataset.act])(el); }
  if (e.target.id === 'lightbox') closeLook();
  document.querySelectorAll('details.menu[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; });
});
function openTaskResult(e) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const href = e.currentTarget.getAttribute('href');
  e.preventDefault();
  if (location.hash === href) {
    selectLookFromUrl();
    render();
    openBodyFromUrl();
    window.scrollTo(0, 0);
  } else location.hash = href;
  taskStatus.dismiss();
  renderStatus();
}
navCompletion.addEventListener('click', openTaskResult);
taskToast.addEventListener('click', openTaskResult);
taskToast.addEventListener('pointerleave', scheduleTaskToastHide);
taskToast.addEventListener('focusout', scheduleTaskToastHide);
document.addEventListener('visibilitychange', scheduleTaskToastHide);
document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  act(forms[form.dataset.form])(new FormData(form));
});
reanalyzeDialog.addEventListener('cancel', (e) => {
  if ($('[type="submit"]', reanalyzeDialog).disabled) e.preventDefault();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLook();
  if (['Enter', ' '].includes(e.key) && e.target.matches('[role="button"][data-act="retryArt"]')) {
    e.preventDefault();
    e.target.click();
  }
  if (e.key === 'Enter' && e.target.matches('[data-label], .field input')) { e.preventDefault(); e.target.blur(); }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.matches('[data-compare]')) {
    const position = t.valueAsNumber;
    t.parentElement.style.setProperty('--pos', `${position}%`);
    t.setAttribute('aria-valuetext', compareDescription(position));
    if (t.closest('#stage') && studio.compare) studio.compare.position = position;
  }
  if (t.matches('[data-ui]')) ui[t.dataset.ui] = t.value;
  if (t.matches('[data-studio]')) {
    studio[t.dataset.studio] = t.value;
    if (t.dataset.studio === 'hair' && t.value) studio.hairId = null;
    if (t.dataset.studio === 'extra') $('[data-act="clearStudio"][data-key="wear"]').hidden = !hasWear();
  }
});
document.addEventListener('change', act(async (e) => {
  const t = e.target;
  if (t.matches('[data-library-filter]')) {
    const query = libraryQuery();
    if (t.value) query.set(t.dataset.libraryFilter, t.value);
    else query.delete(t.dataset.libraryFilter);
    location.hash = libraryHref(query);
  }
  if (t.id === 'setupPhoto') {
    const file = t.files[0], slot = setupClient.slot;
    t.value = '';
    if (file && slot && setupOpen()) await submitSetup(() => api('POST', '/api/photos?setupSlot=' + slot, file));
    return;
  }
  if (t.id === 'file') { const files = t.files; await uploadFiles(files, upload.kind); t.value = ''; }
  if (t.id === 'studioReference') {
    const file = t.files[0];
    t.value = '';
    await chooseLocalOutfit(file);
  }
  if (t.matches('[data-field]')) { await api('PUT', '/api/profile', { [t.dataset.field]: t.value.trim() }); toast('已保存'); refresh(); }
  if (t.matches('[data-studio="hair"]')) render();
}));
document.addEventListener('focusout', act(async (e) => {
  const t = e.target;
  if (!t.matches?.('[data-label]')) return;
  const label = t.textContent.trim();
  const p = S.db.photos.find((x) => x.id === t.dataset.label);
  if (label && p && label !== p.label) { await api('PATCH', `/api/photos?id=${p.id}`, { label }); refresh(); } else if (p) t.textContent = p.label;
}));
document.addEventListener('dragover', (e) => { e.preventDefault(); $('.drop')?.classList.add('over'); });
document.addEventListener('dragleave', () => $('.drop')?.classList.remove('over'));
document.addEventListener('drop', act(async (e) => { e.preventDefault(); if (setupOpen()) return; $('.drop')?.classList.remove('over'); await uploadFiles(e.dataTransfer.files, e.target.closest('[data-kind="garment"]') ? 'garment' : 'photo'); }));
window.addEventListener('hashchange', () => {
  if (!S.db) return;
  if (setupOpen()) { render(); return; }
  bodyEditor.close();
  closeLook(); ui.disliking = null; selectLookFromUrl(); render();
  openBodyFromUrl();
  const journal = route() === 'home' && libraryQuery().has('journal') && $('#journal');
  if (journal) journal.scrollIntoView(); else window.scrollTo(0, 0);
  if (route() === 'home' && libraryQuery().has('article')) $('#articleTitle')?.focus({ preventScroll: true });
  visit();
});

await refresh(true).catch((e) => { app.innerHTML = `<div class="empty glass"><h3>无法连接本地服务</h3><p>${esc(e.message)}</p></div>`; });
setInterval(() => refresh().catch(() => {}), 3000);
setInterval(() => { if (analyzing() && document.activeElement === document.body && route() === 'mine') render(); }, 15000);
