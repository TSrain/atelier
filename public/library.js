import { esc, hex } from './html.js';

const tabs = [['items', '单品'], ['outfits', '穿搭方案'], ['people', '参考人物']];
const seasons = ['四季', '春秋', '春', '夏', '秋', '冬'];
const categories = ['外套', '上装', '下装', '鞋履', '配饰'];
const scenes = ['通勤', '周末', '约会', '出行', '出镜', '正式'];
const dateTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Singapore', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const checkedDate = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Singapore', year: 'numeric', month: 'numeric', day: 'numeric',
});
const formatDate = (format, value) => {
  const date = new Date(value);
  return Number.isFinite(+date) ? format.format(date) : '';
};

export const libraryHref = (query = {}) => {
  const search = new URLSearchParams(query).toString();
  return '#/library' + (search ? '?' + search : '');
};

export const librarySelection = (library, id) => {
  if (!id) return null;
  const item = library?.items.find((entry) => entry.id === id);
  if (item) return { kind: 'item', entry: item };
  const outfit = library?.outfits.find((entry) => entry.id === id);
  if (outfit) return { kind: 'outfit', entry: outfit };
  for (const entry of library?.outfits || []) {
    const piece = entry.items.find((value) => value.libraryId === id);
    if (piece) return { kind: 'item', entry: { ...piece, id }, outfitId: entry.id };
  }
  return null;
};

export const canTryLibraryOutfit = (outfit) => !outfit.personId || Boolean(outfit.image && outfit.source?.fullBody !== false);

function https(value) {
  try { return new URL(value).protocol === 'https:' ? esc(value) : ''; } catch { return ''; }
}

function localImage(value) {
  return typeof value === 'string' && /^\/(?![\/\\])/.test(value) ? esc(value) : '';
}

const kindLabel = (item) => item.kind === 'seasonal' ? '当季' : '经典';
const marks = (...entries) => entries.filter(Boolean).map(esc).join(' · ');
const outfitLocation = (outfit) => libraryHref({ outfit: outfit.id });
const itemLocation = (item) => libraryHref({ item: item.id });
const personLocation = (person) => libraryHref({ person: person.id });
const empty = (title, body = '') => `<div class="library-empty"><h2>${title}</h2>${body ? `<p>${body}</p>` : ''}</div>`;

function image(item, eager = false) {
  const src = localImage(item.image);
  return src
    ? `<img src="${src}" alt="${esc(item.name)}" ${eager ? '' : 'loading="lazy"'} decoding="async">`
    : `<span class="library-image-placeholder" style="--cloth:${hex(item.color)}">${esc(item.name)}</span>`;
}

function collage(outfit, eager = false) {
  const src = localImage(outfit.image);
  if (src) return `<div class="library-collage library-cover">${image(outfit, eager)}</div>`;
  if (outfit.personId) return '<span class="library-image-placeholder">全身原照待补</span>';
  const pieces = outfit.items.slice(0, 4);
  return `<div class="library-collage" data-pieces="${pieces.length}" aria-label="${esc(outfit.name)}的单品搭配">
    ${pieces.map((piece) => image(piece, eager)).join('')}
  </div>`;
}

function heart(library, entry) {
  const saved = library.favorites.includes(entry.id);
  return `<button type="button" class="library-heart" data-act="libraryFavorite" data-id="${esc(entry.id)}" aria-pressed="${saved}" aria-label="${saved ? '取消收藏' : '收藏'} ${esc(entry.name)}">${saved ? '♥' : '♡'}</button>`;
}

const tryButton = (entry, label) => `<button type="button" class="btn primary sm" data-act="tryLibrary" data-id="${esc(entry.id)}">${label}</button>`;

function itemCard(library, item) {
  return `<article class="library-card">
    <a class="library-card-image" href="${itemLocation(item)}" aria-label="查看${esc(item.name)}">${image(item)}</a>
    ${heart(library, item)}
    <div class="library-card-text">
      <p class="library-meta">${marks(item.category, item.season, kindLabel(item))}</p>
      <h3><a href="${itemLocation(item)}">${esc(item.name)}</a></h3>
      <p>${esc(item.shape)}</p>
    </div>
  </article>`;
}

function outfitCard(library, outfit) {
  return `<article class="library-card">
    <a class="library-card-image" href="${outfitLocation(outfit)}" aria-label="查看${esc(outfit.name)}">${collage(outfit)}</a>
    ${heart(library, outfit)}
    <div class="library-card-text">
      <p class="library-meta">${marks(outfit.occasion, outfit.season)}</p>
      <h3><a href="${outfitLocation(outfit)}">${esc(outfit.name)}</a></h3>
    </div>
  </article>`;
}

function sourceLine(source) {
  const href = https(source?.url);
  return href ? `<a class="library-source" href="${href}" target="_blank" rel="noopener noreferrer">${esc(source.title || '查看出处')} ↗</a>` : '';
}

function purchaseLine(purchase) {
  const href = https(purchase?.url);
  if (!href) return '';
  return `<div class="library-purchase">
    <a class="btn ghost sm" href="${href}" target="_blank" rel="noopener noreferrer">查看${purchase.match === 'same' ? '同款' : '商品'} ↗</a>
    ${purchase.checkedAt ? `<small>${formatDate(checkedDate, purchase.checkedAt)}核验</small>` : ''}
  </div>`;
}

function crumbs(entries) {
  return `<nav class="library-crumbs" aria-label="当前位置">${entries.map(([label, href]) => `<a href="${href}">${esc(label)}</a>`).join('<span aria-hidden="true">/</span>')}</nav>`;
}

function itemDetail(library, item) {
  const related = library.outfits.filter((outfit) => outfit.itemIds.includes(item.id));
  return `
    ${crumbs([['素材库', libraryHref()], ['单品', libraryHref({ tab: 'items' })]])}
    <article class="library-detail">
      <figure class="library-detail-visual">
        ${image(item, true)}
        <figcaption>款式示意</figcaption>
      </figure>
      <div class="library-detail-body">
        <p class="library-meta">${marks(item.category, item.season, kindLabel(item))}</p>
        <h1>${esc(item.name)}</h1>
        <p class="library-detail-shape"><i style="background:${hex(item.color)}"></i>${esc(item.shape)}</p>
        <p>${esc(item.why)}</p>
        ${item.wears?.length ? `<div class="library-detail-wears"><h2>搭配建议</h2><ul>${item.wears.map((wear) => `<li>${esc(wear)}</li>`).join('')}</ul></div>` : ''}
        <div class="library-actions">${tryButton(item, '试穿这件')}${heart(library, item)}</div>
        ${purchaseLine(item.purchase)}${sourceLine(item.source)}
      </div>
    </article>
    ${related.length ? `<section class="library-related"><h2>用到这件的穿搭</h2><div class="library-grid looks-grid">${related.map((outfit) => outfitCard(library, outfit)).join('')}</div></section>` : ''}`;
}

function outfitDetail(library, outfit) {
  const person = library.people.find((entry) => entry.id === outfit.personId);
  const canTry = canTryLibraryOutfit(outfit);
  const parents = person
    ? [['参考人物', libraryHref({ tab: 'people' })], [person.name, personLocation(person)]]
    : [['穿搭方案', libraryHref({ tab: 'outfits' })]];
  return `
    ${crumbs([['素材库', libraryHref()], ...parents])}
    <article class="library-detail">
      ${!outfit.personId || outfit.image ? `<figure class="library-detail-visual">
        ${collage(outfit, true)}
        ${outfit.image ? `<figcaption><a href="${localImage(outfit.image)}" target="_blank" rel="noopener">查看${canTry ? '全身' : '穿搭'}原照 ↗</a></figcaption>` : ''}
      </figure>` : ''}
      <div class="library-detail-body">
        <p class="library-meta">${marks(outfit.occasion, outfit.season, outfit.source?.context, outfit.date)}</p>
        <h1>${esc(outfit.name)}</h1>
        <p>${esc(outfit.why)}</p>
        ${outfit.source ? `<div class="library-evidence">${sourceLine(outfit.source)}${outfit.source.locator ? `<p>${esc(outfit.source.locator)}</p>` : ''}</div>` : ''}
        <div class="library-actions">${canTry ? tryButton(outfit, '试穿整套') : ''}${heart(library, outfit)}</div>
      </div>
    </article>
    ${outfit.personId ? '' : `<section class="library-related">
      <h2>单品清单</h2>
      <ul class="library-pieces">
        ${outfit.items.map((piece) => {
          const item = library.items.find((entry) => entry.id === piece.id);
          const content = `<span class="library-piece-image">${image(piece)}</span><span><small class="library-meta">${esc(piece.category)}</small><b>${esc(piece.name)}</b><span>${esc(piece.shape)}</span></span>`;
          return `<li>${item ? `<a href="${itemLocation(item)}">${content}</a>` : content}</li>`;
        }).join('')}
      </ul>
    </section>`}`;
}

function personDetail(library, person) {
  const looks = person.lookIds.map((id) => library.outfits.find((entry) => entry.id === id)).filter(Boolean);
  return `
    ${crumbs([['素材库', libraryHref()], ['参考人物', libraryHref({ tab: 'people' })]])}
    <header class="library-title">
      <div><h1>${esc(person.name)}</h1><p>${esc(person.summary)}</p></div>
      <span class="library-meta">${looks.length} 套日常穿搭 · ${looks.filter(canTryLibraryOutfit).length} 套可试穿</span>
    </header>
    <div class="library-grid looks-grid">${looks.map((outfit) => outfitCard(library, outfit)).join('')}</div>`;
}

function personCard(library, person) {
  const sample = library.outfits.find((outfit) => outfit.id === person.lookIds[0]);
  return `<article class="library-card">
    ${sample ? `<a class="library-card-image" href="${personLocation(person)}" aria-label="查看${esc(person.name)}的穿搭">${collage(sample)}</a>` : ''}
    <div class="library-card-text">
      <p class="library-meta">${person.lookIds.length} 套日常穿搭</p>
      <h3><a href="${personLocation(person)}">${esc(person.name)}</a></h3>
      <p>${esc(person.summary)}</p>
    </div>
  </article>`;
}

function libraryStatus(refresh) {
  let message = '每周一上午 9 点检查';
  if (refresh.lastSuccess) message = `上次成功检查 ${formatDate(dateTime, refresh.lastSuccess)}`;
  const status = refresh.status === 'failed'
    ? `<p class="error">检查失败${refresh.error ? ` · ${esc(refresh.error)}` : ''}</p>`
    : refresh.status === 'running' ? `<p>正在检查新单品和购买链接${refresh.added ? ` · 已新增 ${refresh.added} 件` : ''}</p>`
      : refresh.lastSuccess ? `<p>本次新增 ${refresh.added ?? 0} 件</p>` : '';
  return `<div class="library-update">
    <div role="status"><p>${message}</p>${status}</div>
    <button type="button" class="btn ghost sm" data-act="checkLibrary" ${refresh.status === 'running' ? 'disabled' : ''}>检查上新</button>
  </div>`;
}

function filter(label, key, values, current) {
  return `<label>${label}<select data-library-filter="${key}">
    <option value="">全部</option>${values.map((value) => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(value)}</option>`).join('')}
  </select></label>`;
}

function orderedValues(rows, key, order) {
  const values = [...new Set(rows.map((row) => row[key]).filter(Boolean))];
  return [...order.filter((value) => values.includes(value)), ...values.filter((value) => !order.includes(value))];
}

function catalogIndex(library, query) {
  const favorite = query.get('favorite') === '1';
  const tab = tabs.some(([id]) => query.get('tab') === id) ? query.get('tab') : 'items';
  const items = library.items.filter((item) => !favorite || library.favorites.includes(item.id));
  const outfits = library.outfits.filter((outfit) => favorite ? library.favorites.includes(outfit.id) : !outfit.personId);
  const rowKind = tab === 'outfits' ? 'outfit' : 'item';
  const rows = rowKind === 'outfit' ? outfits : items;
  const valueKey = rowKind === 'outfit' ? 'occasion' : 'category';
  const value = query.get(valueKey) || '';
  const season = query.get('season') || '';
  const results = rows.filter((row) => (!value || row[valueKey] === value) && (!season || row.season === '四季' || row.season === season));
  let content;
  if (favorite) {
    content = items.length || outfits.length ? `
      ${items.length ? `<section class="library-related"><h2>收藏的单品</h2><div class="library-grid">${items.map((item) => itemCard(library, item)).join('')}</div></section>` : ''}
      ${outfits.length ? `<section class="library-related"><h2>收藏的穿搭</h2><div class="library-grid looks-grid">${outfits.map((outfit) => outfitCard(library, outfit)).join('')}</div></section>` : ''}`
      : empty('还没有收藏', '点单品或穿搭上的爱心，就能在这里找到。');
  } else if (tab === 'people') {
    content = library.people.length
      ? `<div class="library-grid looks-grid">${library.people.map((person) => personCard(library, person)).join('')}</div>`
      : empty('参考穿搭正在整理', '每位人物收录至少 20 套可查原照的日常穿搭。');
  } else {
    const grid = rowKind === 'outfit'
      ? results.sort((a, b) => Number(Boolean(b.image)) - Number(Boolean(a.image))).map((outfit) => outfitCard(library, outfit)).join('')
      : results.map((item) => itemCard(library, item)).join('');
    content = `
      <div class="library-filters">
        ${filter(valueKey === 'occasion' ? '场合' : '品类', valueKey, orderedValues(rows, valueKey, valueKey === 'occasion' ? scenes : categories), value)}
        ${filter('季节', 'season', orderedValues(rows, 'season', seasons), season)}
        <span class="library-meta">${results.length} ${rowKind === 'outfit' ? '套' : '件'}</span>
      </div>
      ${results.length ? `<div class="library-grid ${rowKind === 'outfit' ? 'looks-grid' : ''}">${grid}</div>` : empty('没有符合筛选的素材', '试试其他品类、场合或季节。')}`;
  }
  return `
    <header class="library-title"><div><h1>素材库</h1><p>挑一件单品，或把喜欢的一套带进试衣间。</p></div>${libraryStatus(library.refresh)}</header>
    <nav class="library-tabs" aria-label="素材类别">
      ${tabs.map(([id, label]) => `<a href="${libraryHref({ tab: id })}" ${!favorite && tab === id ? 'aria-current="page"' : ''}>${label}</a>`).join('')}
      <a class="library-saved" href="${libraryHref({ favorite: '1' })}" ${favorite ? 'aria-current="page"' : ''}>收藏${library.favorites.length ? ` <span>${library.favorites.length}</span>` : ''}</a>
    </nav>
    ${content}`;
}

export function renderLibrary(library, query, error) {
  if (!library) {
    const loadingOrError = error
      ? `${empty('素材库暂时无法载入', esc(error))}<button type="button" class="btn ghost sm" data-act="reloadLibrary">重新载入</button>`
      : `<p class="muted" role="status">正在载入素材库</p>`;
    return `<section class="library"><header class="library-title"><h1>素材库</h1></header>${loadingOrError}</section>`;
  }
  const item = query.has('item') && library.items.find((entry) => entry.id === query.get('item'));
  const outfit = query.has('outfit') && library.outfits.find((entry) => entry.id === query.get('outfit'));
  const person = query.has('person') && library.people.find((entry) => entry.id === query.get('person'));
  const detailRequested = ['item', 'outfit', 'person'].some((key) => query.has(key));
  const content = item ? itemDetail(library, item)
    : outfit ? outfitDetail(library, outfit)
      : person ? personDetail(library, person)
        : detailRequested ? `${crumbs([['素材库', libraryHref()]])}${empty('这条素材暂时无法查看')}` : catalogIndex(library, query);
  return `<section class="library">${content}</section>`;
}

export function profileLibrary(library) {
  const byOccasion = new Map();
  for (const entry of library?.outfits || []) {
    if (!entry.personId && !byOccasion.has(entry.occasion)) byOccasion.set(entry.occasion, entry);
  }
  const picks = [...byOccasion.values()].slice(0, 3);
  if (!picks.length) return '';
  return `<section class="library library-profile">
    <header class="library-subtitle"><h2>素材库精选</h2><a class="btn ghost sm" href="${libraryHref()}">逛素材库</a></header>
    <div class="library-grid looks-grid">${picks.map((outfit) => outfitCard(library, outfit)).join('')}</div>
  </section>`;
}

export function studioLibrary(library, selection) {
  const picked = selection?.entry;
  const item = selection?.kind === 'item';
  const opts = (rows) => rows.map((entry) => `<option value="${esc(entry.id)}" ${picked?.id === entry.id ? 'selected' : ''}>${esc(entry.name)}</option>`).join('');
  const options = library ? `<label>素材库<select data-library-studio>
    <option value="">选择单品或穿搭</option>
    ${selection?.outfitId ? `<option value="${esc(picked.id)}" selected>${esc(picked.name)}</option>` : ''}
    <optgroup label="单品">${opts(library.items)}</optgroup>
    <optgroup label="穿搭方案">${opts(library.outfits.filter((outfit) => !outfit.personId))}</optgroup>
    ${library.people.map((person) => `<optgroup label="${esc(person.name)}">${opts(library.outfits.filter((outfit) => outfit.personId === person.id))}</optgroup>`).join('')}
  </select></label>` : '';
  return `<div class="library-studio">
    <div>${options}<a class="linkish" href="${libraryHref()}">浏览素材库</a></div>
    ${picked ? `<p class="library-studio-picked">${item ? '已选单品' : '已带入搭配'} <a href="${selection.outfitId ? libraryHref({ outfit: selection.outfitId }) : item ? itemLocation(picked) : outfitLocation(picked)}">${esc(picked.name)}</a></p>` : ''}
  </div>`;
}

export function historyLibrary(ref) {
  if (!ref) return '';
  const href = ref.outfitId ? libraryHref({ outfit: ref.outfitId }) : libraryHref({ [ref.kind]: ref.id });
  return `<a class="library-source" href="${href}">素材来源 · ${esc(ref.name)}</a>`;
}
