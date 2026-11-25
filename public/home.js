import { S, A, analyzing, art, day, elapsed, esc, fitOf, head, hex, inSeason, outfitOf, owned, photos, reasonBar } from './state.js';
import { libraryHref } from './library.js';
import { STYLE_QUIZ_HREF } from './style-quiz.js';
import { STYLE_QUIZ_VERSION } from './style-questions.js';

const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const DIRECTIONS = ['更年轻一点', '更休闲一点', '更正式一点', '换个色系', '更显瘦', '更保暖', '颜色再深一些'];
const dateOf = (iso) => new Date(`${iso}T12:00:00+08:00`);
const localDaysAgo = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
const short = (iso) => { const d = dateOf(iso); return `${d.getMonth() + 1}月${d.getDate()}日`; };
const ago = (t) => { const h = Math.floor((Date.now() - t) / 3600_000); return h < 1 ? '刚刚' : h < 24 ? `${h} 小时前` : `${Math.floor(h / 24)} 天前`; };
const https = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? esc(url.href) : '';
  } catch { return ''; }
};

// 天气只是推荐的依据，不是重点：一行小字交代「今天是按什么搭的」。
function context() {
  const { db, ui } = S, now = dateOf(db.today), w = db.weather?.city === db.settings.city.name ? db.weather : null;
  const tips = w ? [w.flags.rain && '带伞', w.flags.snow && '防滑', w.flags.haze && '戴口罩', w.flags.wind && '挡风'].filter(Boolean) : [];
  const facts = w ? `${esc(w.city)} ${esc(w.sky)} ${Math.round(w.tmin)}–${Math.round(w.tmax)}℃，体感 ${Math.round(w.feelMin)}–${Math.round(w.feelMax)}℃${w.air ? `，空气${esc(w.air)}` : ''}${tips.length ? `，建议${tips.join('、')}` : ''}` : `${esc(db.settings.city.name)}，暂时拿不到天气，先按季节来搭`;
  return `<div class="context"><span>${now.getMonth() + 1}月${now.getDate()}日 ${WEEK_CN[now.getDay()]}</span><span>按今天的情况搭配：${facts}</span><button class="linkish" data-act="toggle" data-k="cityOpen">${ui.cityOpen ? '收起' : '换城市'}</button>
    ${ui.cityOpen ? `<form class="city" data-form="city"><input name="city" placeholder="输入中国的城市，如 杭州" autocomplete="off" aria-label="城市"><button class="btn primary sm">确定</button><button type="button" class="btn ghost sm" data-act="locate">自动定位</button></form>` : ''}</div>`;
}

function dailyDetail(sel) {
  if (!sel) return '';
  return `<div class="detail glass linked">
      <div class="thumb">${art(sel, 'outfit')}</div>
      <div><span class="eyebrow">已选 · ${esc(sel.occasion)}${sel.indoor ? ' · 室内' : ''} · 适合度 ${sel.fit}</span><h4>${esc(sel.name)}</h4><div class="dots">${sel.palette.map((c) => `<i style="background:${hex(c)}"></i>`).join('')}</div><p>${esc(sel.why)}</p>${sel.weather_note ? `<p class="wx">${esc(sel.weather_note)}</p>` : ''}${sel.direction ? `<p class="wx">按你的方向：${esc(sel.direction)}</p>` : ''}</div>
      <div class="items-col"><ul>${sel.items.map((it) => `<li>${esc(it)}</li>`).join('')}</ul>
      <div class="acts"><button class="btn primary sm" data-act="tryOutfit" data-id="${sel.id}">上身试穿</button>
        <button class="btn ghost sm" data-act="favOutfit" data-id="${sel.id}">${sel.fav ? '♥ 已收藏' : '♡ 收藏'}</button>
        <button class="btn ghost sm" data-act="askDislike" data-kind="outfit" data-id="${sel.id}">不喜欢，换一套</button>
        <details class="menu"><summary>更多</summary><div class="glass"><button data-act="copy" data-text="${esc(`${sel.name}：${sel.items.join('、')}`)}" data-done="已复制单品清单">复制单品清单</button>${sel.image ? `<a href="/media/${esc(sel.image)}" download="${esc(sel.name)}.jpg">下载预览图</a>` : ''}</div></details></div></div>
    </div>${S.ui.disliking?.kind === 'outfit' && S.ui.disliking.id === sel.id ? reasonBar('outfit', sel.id) : ''}`;
}

export function alignDailyCaret(rail) {
  const detail = rail?.closest('#today')?.querySelector('#dailyDetail .detail');
  if (!detail) return;
  const card = rail.querySelector('.pick.on')?.getBoundingClientRect();
  const frame = rail.getBoundingClientRect();
  const center = card && card.left + card.width / 2;
  const visible = !!card && center >= frame.left + 8 && center <= frame.right - 8;
  detail.classList.toggle('caret', visible);
  if (visible) detail.style.setProperty('--caret-x', `${center - detail.getBoundingClientRect().left - detail.clientLeft}px`);
}

export function selectDailyOutfit(card) {
  if (card.disabled || card.classList.contains('on')) return;
  const outfit = outfitOf(card.dataset.id);
  if (outfit?.status !== 'ready' || outfit.disliked) return;

  const section = card.closest('#today');
  const rail = card.parentElement;
  S.ui.outfit = outfit.id;
  if (S.ui.disliking?.kind === 'outfit') S.ui.disliking = null;
  rail.querySelectorAll('[data-act="selOutfit"]').forEach((button) => {
    button.classList.toggle('on', button === card);
    button.setAttribute('aria-pressed', String(button === card));
  });
  section.querySelector('#dailyDetail').innerHTML = dailyDetail(outfit);
  alignDailyCaret(rail);
}

function dailySection() {
  const { db, ui } = S, d = db.daily;
  const list = (d?.outfitIds || []).map(outfitOf).filter((o) => o && !o.disliked);
  const sel = list.find((o) => o.id === ui.outfit && o.status === 'ready') || list.find((o) => o.status === 'ready');
  const drafting = list.some((o) => o.status === 'drafting');
  const adding = db.outfits.some((o) => o.status === 'drafting' && o.source === 'more');
  const stale = d?.date && d.date !== db.today;
  const note = db.settings?.automatic === false ? '自动更新已暂停，可以手动生成穿搭' : !d?.date ? '正在为你准备第一批方案' : drafting && d.reason?.startsWith('weather') ? `${esc(d.reason.slice(8))}，正在按今天的天气重新搭配`
    : stale ? `这是 ${short(d.date)} 准备的方案 · 看过之后，明早会换一批新的` : '每天早上更新';
  const card = (o) => `<button class="pick ${sel?.id === o.id ? 'on' : ''}" data-act="selOutfit" data-id="${o.id}" aria-pressed="${sel?.id === o.id}" aria-controls="dailyDetail" ${o.status === 'ready' ? '' : 'disabled'}>
    ${art(o, 'outfit')}${o.fav ? '<span class="heart">♥</span>' : ''}
    <span class="eyebrow">${esc(o.occasion || (o.source === 'replace' ? '补位中' : '构思中'))}</span><b>${esc(o.name || '造型师正在搭配')}</b></button>`;
  const dirs = [...new Set([...(db.prefs.directions || []), ...DIRECTIONS])].slice(0, 8);
  return `<section class="section" id="today">
    ${head('01', '今日穿搭', note)}
    ${context()}
    ${db.drift ? `<p class="context"><span>新照片和档案有些出入：${esc(db.drift.note)}</span><a class="linkish" href="#/mine?v=profile">去看看</a></p>` : ''}
    ${d?.error ? `<p class="error" style="margin:0 0 20px">${esc(d.error)}</p>` : ''}
    <div class="rail six tall daily" data-scroll="daily-${esc(d?.startedAt || d?.date || '')}" tabindex="0" role="region" aria-label="横向浏览今日穿搭">${list.map(card).join('')}
      <div class="pick plus">
        <div class="plus-card">
          <button class="plus-main" data-act="moreOutfits" ${adding ? 'disabled' : ''}><i>${adding ? '…' : '+'}</i><b>${adding ? '正在追加' : '再来 2 套'}</b><small>${adding ? '文字先出，图稍后' : '约 2 分钟'}</small></button>
          <div class="plus-dirs">${DIRECTIONS.slice(0, 3).map((t) => `<button data-act="fillDirection" data-text="${t}">${t}</button>`).join('')}<button data-act="fillDirection" data-text="">自己写…</button></div>
        </div>
        <span class="eyebrow">不够看</span><b>追加，或换个方向</b>
      </div>
    </div>
    ${ui.dirOpen ? `<form class="direction glass" data-form="direction">
      <div class="direction-row"><input name="direction" data-ui="direction" value="${esc(ui.direction)}" maxlength="80" placeholder="想往哪个方向调整？例如：更休闲一点、适合见客户、多用深色" autocomplete="off" aria-label="调整方向">
        <button class="btn primary sm" ${adding ? 'disabled' : ''}>按这个方向出 2 套</button><button type="button" class="linkish" data-act="closeDirection">收起</button></div>
      <div class="chips">${dirs.map((t) => `<button type="button" class="chip ${ui.direction === t ? 'on' : ''}" data-act="fillDirection" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    </form>` : ''}
    <div id="dailyDetail">${dailyDetail(sel)}</div>
  </section>`;
}

function buySection() {
  const { db, library, ui } = S;
  if (!library) return '';
  const current = db.weather?.season === '冬' ? '冬' : db.weather?.season === '夏' ? '夏' : db.seasonName?.[0] || '秋';
  const rank = (item) => fitOf(item.id) + (item.kind === 'seasonal' ? 3 : 0) + (item.purchase ? 4 : 0) + (item.season === '四季' ? 0 : 2);
  const picks = library.items.filter((item) => !db.hidden[item.id] && !owned(item.id) && inSeason(item.season, current)).sort((a, b) => rank(b) - rank(a)).slice(0, 7);
  if (!picks.length) return '';
  const total = library.items.filter((item) => !db.hidden[item.id]).length;
  return `<section class="section" id="buy">
    ${head('03', '值得入手', `按适合度挑的当季单品 · 每周一上新`)}
    <div class="buys">${picks.map((item) => {
      const saved = library.favorites.includes(item.id);
      return `<article class="buy">
        <a class="buy-img" href="${libraryHref({ item: item.id })}" aria-label="查看${esc(item.name)}"><img src="${esc(item.image)}" loading="lazy" alt="${esc(item.name)}"></a>
        <div class="tools"><button data-act="libraryFavorite" data-id="${esc(item.id)}" aria-pressed="${saved}" title="${saved ? '取消收藏' : '收藏'}">${saved ? '♥' : '♡'}</button><button data-act="own" data-id="${esc(item.id)}" title="我已经有这件了，加入衣橱">已有</button><button data-act="askDislike" data-kind="item" data-id="${esc(item.id)}" title="不喜欢，换一件">✕</button></div>
        <p class="meta">${esc(item.category)}</p>
        <h3><a href="${libraryHref({ item: item.id })}">${esc(item.name)}</a></h3>
      </article>`; }).join('')}
      <a class="buy buy-more" href="${libraryHref({ tab: 'items' })}"><span class="buy-img"><i>→</i></span><p class="meta">素材库</p><h3>全部 ${total} 件</h3></a></div>
    ${ui.disliking?.kind === 'item' ? reasonBar('item', ui.disliking.id) : ''}
  </section>`;
}

function articleTools(item) {
  const id = esc(item.id);
  if (S.ui.disliking?.kind === 'article' && S.ui.disliking.id === item.id) return reasonBar('article', item.id);
  return `<div class="tools"><button data-act="favArticle" data-id="${id}" aria-pressed="${Boolean(item.fav)}">${item.fav ? '♥ 已收藏' : '♡ 收藏'}</button><button data-act="askDislike" data-kind="article" data-id="${id}">不感兴趣</button></div>`;
}

function mediaLabel(item) {
  if (item.format === 'gallery') return '图集';
  if (item.format !== 'video') return item.format === 'article' ? '文章' : '';
  if (!item.duration) return '视频';
  const minutes = Math.floor(item.duration / 60), seconds = String(item.duration % 60).padStart(2, '0');
  return `视频 · ${minutes}:${seconds}`;
}

export function story(item, from) {
  const href = `#/home?article=${encodeURIComponent(item.id)}${from === 'favs' ? '&amp;from=favs' : ''}`, src = https(item.image);
  const summary = item.summary || item.excerpt;
  const mediaClass = item.format === 'gallery' ? 'story-gallery' : item.format === 'video' ? 'story-video' : '';
  return `<article class="story">
    <a class="story-img ${src ? '' : 'noimg'} ${mediaClass}" href="${href}" aria-hidden="true" tabindex="-1">${src ? `<img src="${src}" referrerpolicy="no-referrer" loading="lazy" alt="" onerror="this.parentElement.classList.add('noimg');this.remove()">` : ''}<span>${esc(item.source)}</span>${item.format === 'video' ? '<i class="story-play">▶</i>' : ''}</a>
    <div class="story-body">
      <p class="meta">${[mediaLabel(item) || item.tag, item.creator || item.source, Number.isFinite(item.publishedAt) && ago(item.publishedAt)].filter(Boolean).map(esc).join(' · ')}</p>
      <h3><a href="${href}">${esc(item.zh || item.title)}</a></h3>
      ${summary ? `<p>${esc(summary)}</p>` : ''}
      ${articleTools(item)}
    </div></article>`;
}

function articleDetail(id, from) {
  const item = S.db.feed.items.find((entry) => entry.id === id);
  const back = from === 'favs' ? '#/mine?v=favs' : '#/home?journal=1';
  const backLabel = from === 'favs' ? '返回收藏' : '返回读物';
  if (!item) return `<div class="empty glass"><h1 class="cn">这篇读物已不在存档中</h1><a class="btn ghost sm" href="${back}">${backLabel}</a></div>`;

  const original = https(item.url), cover = https(item.image);
  const summary = item.summary?.trim(), excerpt = item.excerpt?.trim();
  const meta = [mediaLabel(item), item.source, item.creator, Number.isFinite(item.publishedAt) && day(item.publishedAt), item.tag].filter(Boolean).map(esc).join(' · ');
  const showSummary = summary && (item.zh || !excerpt || !excerpt.startsWith(summary));
  const gallery = item.format === 'gallery' ? [...new Set([cover, ...(item.images || []).map(https)].filter(Boolean))] : [];
  const action = item.format === 'video' ? '观看原视频' : item.format === 'gallery' ? '打开原图集' : '阅读原文';
  return `<article class="article-reader" aria-labelledby="articleTitle">
    <a class="linkish back" href="${back}">← ${backLabel}</a>
    <div class="article-reader-page glass">
      <header>
        <p class="eyebrow">${meta}</p>
        <h1 id="articleTitle" class="cn" tabindex="-1">${esc(item.zh || item.title)}</h1>
        ${item.zh && item.title && item.zh !== item.title ? `<p class="muted">${esc(item.title)}</p>` : ''}
      </header>
      ${showSummary ? `<section class="article-copy"><h2>${item.format && item.zh ? '穿搭看点' : item.zh ? '中文摘要' : '摘要'}</h2><p>${esc(summary)}</p></section>` : ''}
      ${excerpt && (!showSummary || excerpt !== summary) ? `<section class="article-copy"><h2>${item.format === 'video' ? '视频简介节选' : '订阅源节选'}</h2><p>${esc(excerpt)}</p></section>` : ''}
      ${!summary && !excerpt ? '<p class="muted">这条内容暂无摘要。</p>' : ''}
      <div class="article-reader-actions">
        ${original ? `<a class="btn primary sm" href="${original}" target="_blank" rel="noopener noreferrer">${action} <span aria-hidden="true">↗</span></a>` : '<p class="muted">来源链接暂不可用。</p>'}
        ${articleTools(item)}
      </div>
      ${gallery.length ? `<div class="article-gallery">${gallery.map((src, index) => `<img src="${src}" referrerpolicy="no-referrer" loading="lazy" alt="造型图 ${index + 1}" onerror="this.remove()">`).join('')}</div>` : cover ? `<img class="article-reader-image" src="${cover}" referrerpolicy="no-referrer" alt="" onerror="this.remove()">` : ''}
    </div>
  </article>`;
}

function feedSection() {
  const { db, ui } = S, { items, refresh, limit } = db.feed;
  const cutoff = localDaysAgo(db.today, 6), recent = items.filter((item) => item.day >= cutoff);
  const selected = recent.filter((item) => item.format), editions = selected.length ? selected : recent;
  const latest = editions.reduce((max, item) => item.day > max ? item.day : max, '');
  const edition = editions.filter((item) => item.day === latest), saved = items.filter((item) => item.fav);
  const lead = [...new Set(edition.map((item) => item.format))].map((format) => edition.find((item) => item.format === format));
  const shown = ui.feed === 'week' ? recent : ui.feed === 'fav' ? saved : [...lead, ...edition.filter((item) => !lead.includes(item))];
  const tab = (k, label, n) => `<button class="chip ${ui.feed === k ? 'on' : ''}" data-act="set" data-k="feed" data-v="${k}">${label}${n ? ` ${n}` : ''}</button>`;
  const status = refresh.status === 'running' ? '<i class="pulse" style="display:inline-block;margin-right:8px"></i>正在挑选今天的内容'
    : refresh.status === 'failed' ? esc(refresh.error || '暂时无法更新')
    : latest === db.today ? '今天更新' : latest ? `最近一次精选 · ${short(latest)}` : '每天早上 6 点后更新';
  return `<section class="section" id="journal">
    <div class="section-head"><h2><span class="num">02</span>穿搭读物</h2><div class="chips">${tab('today', latest && latest !== db.today ? short(latest) : '今天', edition.length)}${tab('week', '近 7 天', recent.length)}${tab('fav', '收藏', saved.length)}</div></div>
    <p class="feed-status muted">${status}${refresh.status !== 'running' && (!selected.length || latest !== db.today || edition.length < limit) ? ' · <button class="linkish" data-act="refreshFeed">现在更新</button>' : ''}</p>
    ${shown.length ? `<div class="stories">${shown.map((item) => story(item)).join('')}</div>`
    : `<div class="empty glass"><h3>${ui.feed === 'fav' ? '还没有收藏的读物' : refresh.status === 'running' ? '正在找值得看的穿搭' : '暂时没有新读物'}</h3><p>${ui.feed === 'fav' ? '收藏的内容会一直保留。' : '实穿教程、真人造型和时装文章会出现在这里。'}</p></div>`}
  </section>`;
}

export function renderHome(query = new URLSearchParams()) {
  if (query.has('article')) return articleDetail(query.get('article'), query.get('from'));
  const { db } = S, a = A(), p = db.profile;
  const invite = db.settings.styleQuizDone === STYLE_QUIZ_VERSION ? '' : `<a class="quiz-invite glass" href="${STYLE_QUIZ_HREF}&from=home">
    <span class="quiz-invite-photo" aria-hidden="true"></span>
    <span><strong>你想试试哪些风格？</strong><small>看图选喜欢的风格，让穿搭推荐更合口味。</small></span>
    <span class="quiz-invite-link">看图选择 <span aria-hidden="true">→</span></span>
  </a>`;
  if (!a) return `
    ${invite}
    <section class="hero"><div><span class="eyebrow">Atelier — 个人形象设计</span><h1 class="display">${esc(p.name || 'Hello')}</h1>
      <p class="lead">先建立你的形象档案：系统会读取你上传的照片，建立脸型、头型、身形与色彩档案。之后每天早上，这里会有按当天天气准备的穿搭、时装读物和值得入手的单品。</p></div>
      <div>${analyzing() ? `<div class="empty glass shimmer"><span class="eyebrow">Analyzing · ${elapsed(db.analysisJob.startedAt)}</span><h3>正在阅读你的照片</h3><p>形象顾问正在逐张查看脸型、头型、发质与身形，并撰写风格诊断。通常需要 5–8 分钟，完成后本页会自动更新。</p></div>`
        : `<div class="empty glass"><span class="eyebrow">Get started</span><h3>${photos().length ? '开始建立形象档案' : '先上传几张照片'}</h3><p>正脸、侧面、头顶与全身照越齐全，诊断越准。</p>${db.analysisJob?.status === 'failed' ? `<p class="error">上次分析失败：${esc(db.analysisJob.error)}</p>` : ''}<div class="actions"><button class="btn ghost" data-act="upload" data-kind="photo">上传照片</button>${photos().length ? '<button class="btn primary" data-act="analyze">开始分析</button>' : ''}</div></div>`}</div></section>
    ${feedSection()}`;
  return `${invite}${dailySection()}${feedSection()}${buySection()}`;
}
