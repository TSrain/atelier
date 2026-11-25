import { S, $, A, art, avatar, bodyBase, bodyEditBusy, elapsed, esc, fitOf, garments, hairs, img, inSeason, lookImg, owned, raws, season, tags, tryOnPhotos } from './state.js';
import { canTryLibraryOutfit, historyLibrary, libraryHref, librarySelection } from './library.js';

export const CATS = ['外套', '上装', '下装', '鞋履', '配饰'];
export const hasWear = () => Boolean(S.studio.outfit || S.studio.reference || Object.values(S.studio.items).some(Boolean) || S.studio.extra);
const recCat = (c) => (/鞋|靴/.test(c) ? '鞋履' : /外套|夹克|大衣|风衣/.test(c) ? '外套' : /裤|下装/.test(c) ? '下装' : /配|镜|包|帽|巾|带|表/.test(c) ? '配饰' : '上装');

// 单品组合里每个品类的候选：自己的 > 顾问推荐 > 素材库（按适合度）。
export function itemChoices(cat) {
  const { db, library } = S, a = A();
  const mine = garments().filter((g) => !g.category || g.category === cat).map((g) => ({ ref: `photo:${g.id}`, name: g.label, image: img(g.id, 1), mine: true }));
  const recs = a && db.sheets?.items?.status === 'done' ? a.items.map((it, i) => ({ ref: `rec:${i}`, name: it.name, image: `/media/assets/${db.sheets.items.ver}_items_${i}.jpg?t=${db.sheets.items.finishedAt}`, cat: recCat(it.category) })).filter((it) => it.cat === cat) : [];
  const lib = (library?.items || []).filter((it) => it.category === cat && !db.hidden[it.id] && inSeason(it.season))
    .sort((x, y) => owned(y.id) - owned(x.id) || fitOf(y.id) - fitOf(x.id)).map((it) => ({ ref: it.id, name: it.name, image: it.image, mine: owned(it.id) }));
  return [...mine, ...recs, ...lib];
}
export function itemName(ref) {
  for (const cat of CATS) { const hit = itemChoices(cat).find((c) => c.ref === ref); if (hit) return hit.name; }
  return librarySelection(S.library, ref)?.entry.name || '单品';
}

function outfitChoices() {
  const { db, library, studio } = S, favs = new Set(library?.favorites || []);
  const own = db.outfits.filter((o) => o.status === 'ready' && !o.disliked && inSeason(o.season)).map((o) => ({ kind: 'own', id: o.id, name: o.name, sub: o.occasion, fit: o.fit, fav: o.fav, html: art(o, 'outfit') }));
  const lib = (library?.outfits || []).filter((o) => !db.hidden[o.id] && inSeason(o.season) && canTryLibraryOutfit(o)
    && (!o.archived || favs.has(o.id) || studio.outfit?.id === o.id)).map((o) => ({ kind: 'lib', id: o.id, name: o.name, sub: o.occasion, fit: fitOf(o.id), fav: favs.has(o.id),
    html: o.image ? `<img class="studio-reference-photo" src="${esc(o.image)}" loading="lazy" alt="">`
      : `<span class="quad" data-n="${Math.min(4, o.items.length)}">${o.items.slice(0, 4).map((p) => `<img src="${esc(p.image)}" loading="lazy" alt="">`).join('')}</span>` }));
  const entered = (o) => Number(o.kind === studio.entryOutfit?.kind && o.id === studio.entryOutfit?.id);
  return [...own, ...lib].filter((o) => (studio.tab === 'fav' ? o.fav : !o.fav)).sort((x, y) => entered(y) - entered(x) || y.fit - x.fit);
}

export function renderStudio() {
  const { db, ui, studio } = S, a = A();
  const group = (n, title, body, extra = '') => `<div class="group"><header><h4><span class="num">${n}</span>${title}</h4>${extra}</header>${body}</div>`;
  const clear = (key, on) => `<button data-act="clearStudio" data-key="${key}" ${on ? '' : 'hidden'}>清除</button>`;
  const seg = (k, v, label) => `<button class="${studio[k] === v ? 'on' : ''}" data-act="setStudio" data-k="${k}" data-v="${v}">${label}</button>`;
  const th = (p, label = '') => `<div><button class="thumb ${p.id === studio.baseId ? 'on' : ''}" data-act="base" data-id="${p.id}" title="${esc(p.issue || p.label)}"><img src="${img(p.id, 1)}" alt=""></button>${label ? `<span>${label}</span>` : ''}</div>`;

  const avs = [...new Set([studio.bodyBaseOnce, bodyBase()?.id, 'avatarbody', 'avatarbust'].filter(Boolean))].map(avatar).filter((p) => p?.source === 'avatar');
  const real = tryOnPhotos();
  const others = raws().filter((p) => !real.includes(p));
  const base = `<div class="bases">${avs.map((p) => th(p, p.id === studio.bodyBaseOnce ? '本次试穿' : p.bodyEditId ? '默认全身' : p.id === 'avatarbody' ? '建模全身' : '建模半身')).join('')}${real.map((p) => th(p, '本人照片')).join('')}</div>
    <p class="muted note">${studio.bodyBaseOnce ? '已选调整后的身形，仅用于下一次生成。' : '默认使用全身底图。'}只换发型时，选建模半身细节更清楚。</p>
    <button class="btn ghost sm studio-shape-action" type="button" data-act="editBody">${bodyEditBusy() ? '查看身形预览进度' : '调整身形'}</button>
    <button class="linkish" data-act="toggle" data-k="rawBases">${ui.rawBases ? '收起其他照片' : `其他照片（${others.length}）`}</button>
    ${ui.rawBases ? `<div class="thumbs" style="margin-top:12px">${others.map((p) => `<button class="thumb ${p.id === studio.baseId ? 'on' : ''}" data-act="base" data-id="${p.id}" title="${esc(p.label)}"><img src="${img(p.id, 1)}" alt=""></button>`).join('')}<button class="thumb add" data-act="upload" data-kind="photo">+</button></div>` : ''}`;

  const choices = studio.mode === 'outfit' ? outfitChoices() : [];
  const selectedOutfit = choices.find((o) => o.id === studio.outfit?.id);
  const picked = Object.entries(studio.items).filter(([, ref]) => ref);
  const reference = studio.reference;
  const uploadReference = reference ? `<div class="studio-upload is-selected">
    <img src="${esc(reference.url)}" alt="穿搭参考预览">
    <div class="studio-upload-copy"><b>已选本地穿搭</b><span title="${esc(reference.file.name)}">${esc(reference.file.name)}</span></div>
    <button type="button" data-act="uploadReference" aria-label="替换参考图">替换</button>
    <button type="button" data-act="removeReference" aria-label="移除参考图">移除</button>
  </div>` : `<button type="button" class="studio-upload" data-act="uploadReference">
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13V3m-3.5 3.5L10 3l3.5 3.5M4 12v4a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-4"/></svg>
    <span>上传本地穿搭</span><small>JPG / PNG / WebP</small>
  </button>`;
  const wear = `<div class="seg-row"><div class="seg">${seg('mode', 'outfit', '套装')}${seg('mode', 'items', '单品组合')}</div>
      <div class="seg small" title="按季节筛选和搭配">${['春', '夏', '秋', '冬'].map((s) => `<button class="${season() === s ? 'on' : ''}" data-act="setStudio" data-k="season" data-v="${s}">${s}</button>`).join('')}</div></div>
    ${studio.mode === 'outfit' ? `
      <div class="chips tabs"><button class="chip ${studio.tab === 'rec' ? 'on' : ''}" data-act="setStudio" data-k="tab" data-v="rec">推荐</button><button class="chip ${studio.tab === 'fav' ? 'on' : ''}" data-act="setStudio" data-k="tab" data-v="fav">已收藏</button><span class="muted">${selectedOutfit ? `已选 · ${esc(selectedOutfit.name)}` : studio.tab === 'rec' ? '按适合度排序，不含已收藏' : ''}</span></div>
      ${choices.length ? `<div class="tiles tall" data-scroll="outfits">${choices.map((o) => `<button class="tile ${studio.outfit?.id === o.id ? 'on' : ''}" data-act="pickOutfit" data-kind="${o.kind}" data-id="${esc(o.id)}" title="${esc(o.name)}" aria-pressed="${studio.outfit?.id === o.id}">${o.html}<b>${esc(o.name)}</b><small>${esc(o.sub)} · ${o.fit}</small></button>`).join('')}</div>`
      : `<p class="muted note">${studio.tab === 'fav' ? '还没有收藏的套装。在首页或素材库点 ♡ 就会出现在这里。' : '这个季节暂时没有可选的套装，换个季节看看。'}</p>`}`
    : `
      <div class="chips tabs">${CATS.map((c) => `<button class="chip ${studio.cat === c ? 'on' : ''}" data-act="setStudio" data-k="cat" data-v="${c}">${c}${studio.items[c] ? ' ·' : ''}</button>`).join('')}</div>
      <div class="tiles" data-scroll="items">${itemChoices(studio.cat).map((it) => `<button class="tile ${studio.items[studio.cat] === it.ref ? 'on' : ''}" data-act="pickItem" data-ref="${esc(it.ref)}" title="${esc(it.name)}"><img src="${esc(it.image)}" loading="lazy" alt="">${it.mine ? '<i class="mine">我的</i>' : ''}<b>${esc(it.name)}</b></button>`).join('')}
        <button class="tile add" data-act="upload" data-kind="garment" title="上传商品图或截图"><span>+</span><b>上传单品图</b></button></div>
      ${picked.length ? `<div class="chips picked">${picked.map(([c, ref]) => `<button class="chip on" data-act="dropItem" data-cat="${c}">${esc(itemName(ref))} ×</button>`).join('')}</div>` : '<p class="muted note">每个品类选一件，没选的部位会自动配基础款。带图的单品最多同时参考 4 件。</p>'}`}
    ${studio.mode === 'outfit' ? uploadReference : ''}
    <textarea class="text" data-studio="extra" aria-label="补充要求" maxlength="300" placeholder="补充要求，可留空。例如：衬衫下摆放在外面、裤脚卷一道">${esc(studio.extra)}</textarea>
    <a class="linkish" href="${libraryHref({ tab: studio.mode === 'outfit' ? 'outfits' : 'items' })}">浏览素材库</a>`;

  const list = hairs().sort((x, y) => y.fav - x.fav);
  const hairJob = db.hairJob?.status === 'running';
  const hair = `<div class="hair-rail" data-scroll="hair">
      <button class="tile ${!studio.hairId && !studio.hair ? 'on' : ''}" data-act="pickHair" data-id="">${avatar('avatarbust') ? `<img src="${img('avatarbust', 1)}" alt="" style="object-position:50% 15%">` : '<div class="ph"></div>'}<b>保持现在</b></button>
      ${list.map((h) => `<button class="tile ${studio.hairId === h.id ? 'on' : ''}" data-act="pickHair" data-id="${h.id}" title="${esc(h.tagline)}">${art(h, 'hair')}<b>${esc(h.name)}</b></button>`).join('')}
      <button class="tile add" data-act="moreHairs" ${hairJob || !a ? 'disabled' : ''}><span>${hairJob ? '…' : '+'}</span><b>${hairJob ? '设计中' : '再来 6 款'}</b></button></div>
    ${db.hairJob?.status === 'failed' ? `<p class="error">${esc(db.hairJob.error)}</p>` : ''}
    <textarea class="text" data-studio="hair" placeholder="也可以直接描述想要的发型，例如：清爽侧分纹理短发，两侧渐变推短，顶部留 6cm 向后梳">${esc(studio.hair)}</textarea>`;

  return `
    <div class="studio">
      <div class="controls glass">
        ${group('01', '穿搭', wear, clear('wear', hasWear()))}
        ${group('02', '发型', hair, clear('hair', studio.hairId || studio.hair))}
        ${group('03', '底图', base)}
        <div class="genbar"><button class="btn primary block" data-act="generate" ${studio.submitting ? 'disabled' : ''}>${studio.submitting ? '正在提交…' : '生成造型'}</button><p class="hint">通过本机 Codex 出图，每张约 2–3 分钟，最多同时生成 2 张</p></div>
      </div>
      <div class="stage-wrap" id="stage"></div>
    </div>`;
}

export const compareDescription = (value) => value === 0 ? '完整成片' : value === 100 ? '完整底图' : `底图 ${value}%`;

export function compare(beforeSrc, afterSrc, position = 0) {
  const after = `<img src="${esc(afterSrc)}" alt="试穿成片">`;
  if (!beforeSrc) return `<div class="canvas">${after}</div>`;
  return `<div class="canvas compare" style="--pos:${position}%">
    ${after}<img class="before" src="${esc(beforeSrc)}" alt="试穿底图">
    <span class="split" aria-hidden="true"></span><span class="handle" aria-hidden="true">‹ ›</span>
    <input type="range" min="0" max="100" value="${position}" aria-label="拖动对比底图和成片" aria-valuetext="${compareDescription(position)}" data-compare>
  </div>`;
}

export async function revealComparison(root, onReveal) {
  const canvas = $('.compare', root);
  if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const slider = $('[data-compare]', canvas);
  const listeners = new AbortController();
  let frame;
  const finish = () => {
    listeners.abort();
    cancelAnimationFrame(frame);
    canvas.style.setProperty('--pos', `${slider.value}%`);
  };
  for (const event of ['pointerdown', 'keydown', 'input']) slider.addEventListener(event, () => {
    onReveal?.();
    finish();
  }, { signal: listeners.signal });

  try { await Promise.all([...canvas.querySelectorAll('img')].map((img) => img.decode())); }
  catch { finish(); return; }
  if (listeners.signal.aborted || !canvas.isConnected || canvas.closest('[hidden]')) { finish(); return; }

  onReveal?.();
  const start = performance.now();
  const duration = 360;
  const step = (now) => {
    if (!canvas.isConnected || canvas.closest('[hidden]') || now - start >= duration) { finish(); return; }
    const progress = Math.max(0, now - start) / duration;
    canvas.style.setProperty('--pos', `${50 * (1 - progress ** 2)}%`);
    frame = requestAnimationFrame(step);
  };
  canvas.style.setProperty('--pos', '50%');
  frame = requestAnimationFrame(step);
}

export function renderStage() {
  const el = $('#stage');
  if (!el) return;
  const { db, studio } = S;
  const recent = db.looks.slice(0, 12);
  const look = db.looks.find((l) => l.id === studio.viewId);
  if (studio.compare?.id !== look?.id) studio.compare = look ? { id: look.id, position: 0 } : null;
  const base = db.photos.find((p) => p.id === (look ? look.baseId : studio.baseId));
  const editingBody = bodyEditBusy();
  const key = JSON.stringify([look?.id, look?.status, look?.fav, base?.id, base?.createdAt, editingBody, recent.map((l) => l.id + l.status)]);
  if (el.dataset.key === key) { const t = $('[data-elapsed]', el); if (t && look?.startedAt) t.textContent = elapsed(look.startedAt); return; }
  el.dataset.key = key;
  const baseSrc = base ? img(base.id) : '';
  let canvas, meta = '';
  if (look?.status === 'done') {
    canvas = compare(baseSrc, lookImg(look.id), studio.compare.position);
    const redo = look.spec && (look.outfit || look.garment) ? `<button class="btn ghost sm" data-act="redo" data-change="pose" data-id="${look.id}">↻ 换个姿势</button><button class="btn ghost sm" data-act="redo" data-change="scene" data-id="${look.id}">↻ 换个场景</button>` : '';
    meta = `<div><h3>${esc(look.title)}</h3>${baseSrc ? '<p>拖动圆形滑杆对比底图和成片</p>' : ''}${historyLibrary(look.libraryRef)}</div><div class="acts">${redo}<button class="btn ghost sm" data-act="fav" data-id="${look.id}">${look.fav ? '♥ 已收藏' : '♡ 收藏'}</button><a class="btn ghost sm" href="${lookImg(look.id)}" download="${esc(look.title)}.jpg">下载</a><button class="btn ghost sm" data-act="view" data-id="">返回底图</button></div>`;
  } else if (look?.status === 'failed') {
    canvas = `<div class="canvas"><img src="${baseSrc}" alt=""></div>`;
    meta = `<div><h3>${esc(look.title)}</h3><p class="error">生成失败：${esc(look.error)}</p></div><div class="acts"><button class="btn ghost sm" data-act="delLook" data-id="${look.id}">移除</button></div>`;
  } else if (look) {
    canvas = `<div class="canvas busy shimmer"><img src="${look.prevId ? lookImg(look.prevId) : baseSrc}" alt=""><div class="busy-info glass"><div><b>${look.status === 'queued' ? '排队中' : '正在生成'}</b><small>${esc(look.title)}${look.change ? ` · 换${look.change === 'scene' ? '场景' : '姿势'}` : ''}</small></div><span data-elapsed>${look.startedAt ? elapsed(look.startedAt) : '—'}</span></div></div>`;
    meta = `<div><h3>${esc(look.title)}</h3><p>完成后会自动显示，可以先继续配置下一个造型</p></div>`;
  } else {
    canvas = base ? `<div class="canvas"><img src="${baseSrc}" alt="">
      <div class="stage-base-tools"><span class="stage-base-label">基础形象</span>
        <button class="stage-base-edit" type="button" data-act="editBody" aria-label="${editingBody ? '查看身形预览进度' : '调整基础形象'}">${editingBody ? '查看进度' : '调整'}</button>
      </div></div>` : `<div class="empty"><h3>先添加一张照片</h3></div>`;
  }
  el.innerHTML = `<div class="studio-preview">
    <div class="stage glass"><div class="bg" style="background-image:url('${look?.status === 'done' ? lookImg(look.id, 1) : base ? img(base.id, 1) : ''}')"></div>${canvas}</div>
    ${recent.length ? `<details class="studio-history"${studio.recentOpen ? ' open' : ''}>
      <summary class="glass">
        <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9a7 7 0 1 1 .8 4.3M3 5v4h4m3-3v4l2.5 1.5"/></svg>
        最近试穿
      </summary>
      <ul class="studio-history-list" aria-label="最近试穿">
        ${recent.map((entry) => {
          const ready = entry.status === 'done';
          const status = { queued: '排队中', running: '生成中', failed: '生成失败' }[entry.status];
          return `<li><button type="button" data-act="view" data-id="${entry.id}" ${entry.id === studio.viewId ? 'aria-current="true"' : ''}>
            <img src="${ready ? lookImg(entry.id, 1) : img(entry.baseId, 1)}" loading="lazy" alt="">
            <span>${esc(entry.title)}${status ? `<small>${status}</small>` : ''}</span>
          </button></li>`;
        }).join('')}
      </ul>
    </details>` : ''}
  </div>${meta ? `<div class="stage-meta">${meta}</div>` : ''}`;
  const comparison = studio.compare;
  if (look?.status === 'done' && !comparison.revealed) revealComparison(el, () => { comparison.revealed = true; });
  const history = $('.studio-history', el);
  history?.addEventListener('toggle', () => {
    if (history.isConnected) studio.recentOpen = history.open;
  });
  history?.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !history.open) return;
    history.open = studio.recentOpen = false;
    $('summary', history).focus();
  });
}
