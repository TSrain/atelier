import { S, A, analyzing, art, avatar, bodyBase, bodyEditBusy, classifyingNow, day, done, elapsed, esc, hairs, head, hex, img, lookImg, pad, photos, raws, reasonBar, shopLinks, slotPhoto, tags } from './state.js';
import { libraryHref } from './library.js';
import { story } from './home.js';
import { renderStyleQuiz, STYLE_QUIZ_HREF, styleQuizBack } from './style-quiz.js';
import { STYLE_QUIZ_VERSION, visibleStylePrefs } from './style-questions.js';

const SLOTS = [
  ['face_front', '正脸', '平视镜头，露出额头和双耳', 'face'],
  ['face_34', '四分之三侧', '头转向一侧约 45°', 'face34'],
  ['side_left', '左侧面', '严格侧面，头颈自然直立', 'profile'],
  ['side_right', '右侧面', '严格侧面，头颈自然直立', 'profileR'],
  ['back_head', '后脑', '请人从正后方平视拍摄', 'back'],
  ['top_head', '头顶', '低头俯拍，拍到发旋', 'top'],
  ['body_front', '全身正面', '穿贴身薄衣，从头顶拍到鞋底', 'body'],
  ['body_side', '全身侧面', '自然站立，双臂下垂', 'bodySide'],
  ['body_back', '全身背面', '自然站立，从头顶拍到鞋底', 'bodyBack'],
  ['natural_light', '自然光正脸', '白天窗边，无美颜和滤镜', 'sun'],
];
const HEAD = '<circle cx="24" cy="19" r="10"/><path d="M8 44c2-9 8-13 16-13s14 4 16 13"/>';
const BODY = '<circle cx="24" cy="8" r="4.5"/><path d="M16 17h16l2 13h-4v14h-4.5V31h-3v13H18V30h-4z"/>';
const GLYPHS = {
  face: `${HEAD}<path d="M20 18h.01M28 18h.01M21 24c2 1.5 4 1.5 6 0"/>`,
  face34: `${HEAD}<path d="M23 18h.01M30 18h.01M25 24c1.6 1.2 3.2 1.2 4.6 0M31 12c2 4 2 10 0 14"/>`,
  profile: '<path d="M30 9c-9-2-17 4-16 13l-3 5 3 1v4c0 2 2 3 4 3h3v9M30 9c5 2 7 8 6 14-1 5-3 8-4 12v9"/><path d="M19 19h.01"/>',
  profileR: '<path d="M18 9c9-2 17 4 16 13l3 5-3 1v4c0 2-2 3-4 3h-3v9M18 9c-5 2-7 8-6 14 1 5 3 8 4 12v9"/><path d="M29 19h.01"/>',
  back: `${HEAD}<path d="M15 16c3-5 15-5 18 0M17 25c4 3 10 3 14 0"/>`,
  top: '<circle cx="24" cy="24" r="14"/><path d="M24 24c0-4 5-4 5 0s-8 6-9 0 7-11 12-5"/>',
  body: BODY,
  bodySide: '<circle cx="24" cy="8" r="4.5"/><path d="M21 17h6l1.5 13H27v14h-5V30h-1.5z"/>',
  bodyBack: `${BODY}<path d="M24 17v13"/>`,
  sun: `${HEAD}<path d="M40 6v3M40 15v3M34 12h3M43 12h3"/><circle cx="40" cy="12" r="1.6"/>`,
};
const glyph = (k) => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[k]}</svg>`;
const FIELDS = [['age', '年龄'], ['height', '身高 cm'], ['weight', '体重 kg'], ['shoulder', '肩宽 cm'], ['chest', '胸围 cm'], ['waist', '腰围 cm'], ['topSize', '上装尺码'], ['bottomSize', '下装尺码'], ['shoe', '鞋码']];
const TABS = [['profile', '形象档案'], ['looks', '试穿记录'], ['favs', '收藏'], ['wardrobe', '衣橱'], ['materials', '照片与建模'], ['prefs', '推荐偏好']];
const fresh = () => {
  const a = A();
  return a ? photos().filter((p) => p.source === 'real').slice(-12).filter((p) => !a.photoIds.includes(p.id)).length : 0;
};
const lock = (key) => `<button class="btn ghost sm lock" data-act="lock" data-key="${key}">${S.db.locks[key] ? '已锁定，重新分析时不改 · 解锁' : '我已确认，锁定这部分'}</button>`;

function diagBlock(d, di) {
  const { db } = S;
  const av = d.avatar && db.photos.find((p) => p.id === d.avatar.photoId && p.createdAt === d.avatar.ver) ? d.avatar : null;
  const ph = db.photos.find((p) => p.id === (av ? av.photoId : d.photoId));
  if (!ph) return '';
  const c = av ? av.crop : d.crop, pos = (i) => (av ? av.points[i] : d.points[i]);
  const ar = (c.w * ph.w) / (c.h * ph.h);
  const locked = d.points.filter((p) => p.locked);
  return `<article class="diag" data-diag="${di}">
    <svg class="wires" aria-hidden="true"></svg>
    <div class="figure" style="aspect-ratio:${ar}">
      <img src="${img(ph.id)}" alt="" style="width:${100 / c.w}%;height:${100 / c.h}%;left:${(-c.x / c.w) * 100}%;top:${(-c.y / c.h) * 100}%">
      ${d.points.map((p, i) => `<button class="mark ${p.locked ? 'locked' : ''}" data-pt="${i}" style="left:${((pos(i).x - c.x) / c.w) * 100}%;top:${((pos(i).y - c.y) / c.h) * 100}%">${i + 1}</button>`).join('')}
    </div>
    <div class="notes">
      <span class="eyebrow">${['Face', 'Head & Hair', 'Body'][di] || ''}</span>
      <h3>${esc(d.title)}</h3>
      <p class="headline">${esc(d.headline)}</p>
      <ol>${d.points.map((p, i) => `<li class="${p.locked ? 'locked' : ''}" data-pt="${i}"><i>${p.locked ? '?' : i + 1}</i><div><b>${esc(p.title)}</b><p>${esc(p.text)}</p>${p.locked && p.need ? `<em>待补：${esc(p.need)}</em>` : ''}</div></li>`).join('')}</ol>
      ${locked.length ? `<div class="unlock"><div><b>还有 ${locked.length} 项等你补全</b><p>${esc([...new Set(locked.map((p) => p.need).filter(Boolean))].slice(0, 2).join('；') || '补充更完整的照片')}，上传后重新分析即可解锁。</p></div><a class="btn primary sm" href="#/mine?v=materials">去补拍</a></div>` : ''}
      ${d.key === 'body' ? `<div class="mini-fields">${FIELDS.map(([k, label]) => `<div class="field"><label>${label}</label><input data-field="${k}" value="${esc(db.profile[k])}" placeholder="未填"></div>`).join('')}</div>` : ''}
    </div></article>`;
}

function keywordBubbles(keywords) {
  if (!keywords.length) return '';
  return `<ul class="style-bubbles${keywords.length === 5 ? ' arranged' : ''}" aria-label="风格关键词" role="list">
    ${keywords.map((word) => `<li><span>${esc(word)}</span></li>`).join('')}
  </ul>`;
}

function profileTab() {
  const { db, ui, library } = S, a = A(), p = db.profile;
  const active = analyzing(), hasPhotos = photos().some((p) => p.source === 'real');
  const progress = active ? `<span class="archive-progress"><i class="pulse" aria-hidden="true"></i>正在分析 ${elapsed(db.analysisJob.startedAt)} · 通常需要 5–8 分钟</span>` : '';
  const error = db.analysisJob?.status === 'failed' ? `<p class="error">上次分析失败：${esc(db.analysisJob.error)}</p>` : '';
  if (!a) return `<div class="empty glass"><h3>${active ? '正在建立形象档案' : '还没有形象档案'}</h3>
    ${active ? `<p>${progress}</p>` : `<p>上传正脸、侧面、头顶和全身照，建立你的形象档案。</p>${error}
      <div class="archive-start-actions">${hasPhotos ? '<button class="btn primary" data-act="analyze">开始分析</button>' : ''}<a class="btn ghost" href="#/mine?v=materials">去上传照片</a></div>`}</div>`;
  const list = hairs();
  const h = list.find((x) => x.id === ui.hair) || list[0];
  const sw = (c, cls = '') => `<div class="swatch ${cls}"><i style="background-color:${hex(c.hex)}"></i><b>${esc(c.name)}</b></div>`;
  const itemsStatus = db.sheets?.items?.status;
  const itemsDone = itemsStatus === 'done';
  const itemsDeferred = itemsStatus === 'queued' && db.settings.automatic === false && !db.sheets.items.manual;
  const itemsAction = itemsDeferred ? '生成预览' : itemsStatus === 'failed' ? '重试' : '';
  const itemPlaceholder = `<div class="ph ${itemsAction ? '' : 'shimmer'}"><span>${itemsDeferred ? '待生成' : itemsStatus === 'failed' ? '生成失败' : '绘制中'}</span>${itemsAction ? `<button class="chip" data-act="retrySheet" data-key="items">${itemsAction}</button>` : ''}</div>`;
  const newPhotos = fresh();
  return `
    ${db.drift && !active && hasPhotos ? `<div class="unlock drift"><div><b>新照片和现在的档案差距比较大</b><p>${esc(db.drift.note)}</p></div><div class="acts"><button class="btn primary sm" data-act="reanalyze" aria-haspopup="dialog">更新档案</button><button class="btn ghost sm" data-act="dismissDrift">先不用</button></div></div>` : ''}
    <section class="hero archive-hero">
      <div><h1 class="display">${esc(p.name || 'Hello')}</h1>
        <div class="archive-arche"><p class="arche">${esc(a.style.archetype)}</p>
          <button class="btn ghost sm archive-refresh" data-act="reanalyze" aria-haspopup="dialog" ${active || !hasPhotos ? 'disabled' : ''}>
            <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16.5 8.8a6.6 6.6 0 1 0-1.2 5M16.5 4.5v4.3h-4.3"/></svg>重新分析</button>
        </div>
        <p class="lead">${esc(a.summary)}</p>
        <p class="archive-meta">${progress || (!hasPhotos ? '<a class="linkish" href="#/mine?v=materials">上传照片后可重新分析</a>' : newPhotos ? `有 ${newPhotos} 张新照片还没纳入分析` : `上次分析于 ${day(a.analyzedAt)}`)}</p>
        ${error}
      </div>
      ${keywordBubbles(a.style.keywords)}
    </section>

    <section class="section" id="diagnosis">
      ${head('01', '形象诊断', '每条结论都连到形象上对应的部位，鼠标移上去可以单独高亮', lock('diagnosis'))}
      <div class="diags">${a.diagnosis.map(diagBlock).join('')}</div>
    </section>

    <section class="section" id="style">
      ${head('02', '风格', esc(a.style.direction), lock('style'))}
      <div class="palette-strip glass">
        <div><span class="eyebrow">适合</span><div class="swatches">${a.color.best.map((c) => sw(c)).join('')}</div></div>
        <div><span class="eyebrow">回避</span><div class="swatches">${a.color.avoid.map((c) => sw(c, 'no')).join('')}</div></div>
        <p>${esc(a.color.season)} · ${esc(a.color.undertone)}</p>
      </div>
      <div class="rules">
        <div class="panel glass"><span class="eyebrow">适合你</span><ol>${a.style.dos.map((d) => `<li><span>${esc(d)}</span></li>`).join('')}</ol></div>
        <div class="panel glass"><span class="eyebrow">穿搭雷区</span><ol>${a.style.donts.map((d) => `<li><span>${esc(d)}</span></li>`).join('')}</ol></div>
      </div>
      <div class="sub"><h3>顾问点名的单品</h3><div class="sub-side"><span>建档时为你挑的 6 件 · 每周上新的单品在首页</span>${lock('outfits')}</div></div>
      <div class="rail six">${a.items.map((x, i) => `<div class="pick item">${itemsDone ? `<img src="/media/assets/${db.sheets.items.ver}_items_${i}.jpg?t=${db.sheets.items.finishedAt}" loading="lazy" alt="">` : itemPlaceholder}<span class="eyebrow">${esc(x.category)}</span><b>${esc(x.name)}</b><p>${esc(x.why)}</p>
        <div class="row">${itemsDone ? `<button class="chip on" data-act="tryItem" data-id="rec:${i}">试穿</button>` : ''}${shopLinks(x.keyword).map(([n, u]) => `<a class="chip" href="${u}" target="_blank" rel="noopener">${n}</a>`).join('')}</div></div>`).join('')}</div>
    </section>

    ${h ? `<section class="section" id="hair">
      ${head('03', '发型方案', '图为你本人的效果预览 · 更多款式可以在试衣间里追加', lock('hairstyles'))}
      <div class="rail six">${list.map((x, i) => `<button class="pick ${x.id === h.id ? 'on' : ''}" data-act="set" data-k="hair" data-v="${x.id}">${art(x, 'hair')}${x.fav ? '<span class="heart">♥</span>' : ''}<span class="eyebrow">N° ${pad(i + 1)}</span><b>${esc(x.name)}</b></button>`).join('')}</div>
      <div class="detail glass">
        <div><span class="eyebrow">${esc(h.tagline)}</span><h4>${esc(h.name)}</h4><p>${esc(h.why)}</p></div>
        <dl><dt>给理发师的话</dt><dd>${esc(h.barber_brief)}</dd><dt>日常打理</dt><dd>${esc(h.maintenance)}</dd></dl>
        <div class="acts"><button class="btn primary sm" data-act="tryHair" data-id="${h.id}">在试衣间试这款</button><button class="btn ghost sm" data-act="favHair" data-id="${h.id}">${h.fav ? '♥ 已收藏' : '♡ 收藏'}</button><button class="btn ghost sm" data-act="askDislike" data-kind="hair" data-id="${h.id}">不喜欢</button>
          <details class="menu"><summary>更多</summary><div class="glass"><button data-act="copy" data-text="${esc(h.barber_brief)}" data-done="已复制，可以直接发给理发师">复制给理发师的话</button>${h.image ? `<a href="/media/${esc(h.image)}" download="${esc(h.name)}.jpg">下载预览图</a>` : ''}</div></details></div>
      </div>${ui.disliking?.id === h.id ? reasonBar('hair', h.id) : ''}
    </section>` : ''}

    ${a.celebrities.length ? `<section class="section" id="celebs">
      ${head('04', '可以参考的人', '按你的气质与日常风格排序 · 点开可看原照和搭配要点', lock('celebrities'))}
      <div class="celebs">${a.celebrities.map((c, i) => {
        const imgs = db.celebs?.[i]?.images || [];
        const person = library?.people.find((entry) => entry.name === c.name);
        const reference = person && library.outfits.find((outfit) => outfit.id === person.lookIds[0]);
        return `<article class="celeb glass">
          <div class="shots">${reference ? `<a class="celeb-outfit-photo" href="${libraryHref({ person: person.id })}" aria-label="查看${esc(c.name)}的日常穿搭"><img src="${esc(reference.image)}" loading="lazy" alt="${esc(reference.name)}"></a>` : imgs.length ? imgs.map((im) => `<img src="/media/${im.file}" loading="lazy" alt="" title="${esc(im.credit)}">`).join('') : `<div class="ph"><span>${db.celebs?.[i] ? '暂无可用的公开照片' : '正在获取照片'}</span></div>`}</div>
          <div class="body"><span class="eyebrow">${esc(c.name_en)}</span><h4>${esc(c.name)}</h4><p>${esc(c.similarity.replace(/^仅作[^：:]*[：:]/, '').replace(/[，,；;]?\s*不作面容相似判断/, ''))}</p>
            <ul>${c.style_points.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
            <div class="row">${person ? `<a class="chip on" href="${libraryHref({ person: person.id })}">看 ${person.lookIds.length} 套日常穿搭</a>` : `<a class="chip" href="https://www.bing.com/images/search?q=${encodeURIComponent(c.name + ' 私服 穿搭')}" target="_blank" rel="noopener">更多穿搭 ↗</a>`}<button class="chip" data-act="tryCeleb" data-i="${i}">试穿相近风格</button></div></div>
        </article>`; }).join('')}</div>
    </section>` : ''}`;
}

const favorites = () => {
  const { db, library } = S, favIds = new Set(library?.favorites || []);
  return {
    outfits: db.outfits.filter((o) => o.fav && o.status === 'ready'),
    libOutfits: (library?.outfits || []).filter((o) => favIds.has(o.id)),
    libItems: (library?.items || []).filter((i) => favIds.has(i.id)),
    hairs: db.hairs.filter((x) => x.fav),
    looks: db.looks.filter((l) => l.fav && l.status === 'done'),
    articles: db.feed.items.filter((x) => x.fav),
  };
};

function favsTab() {
  const { outfits, libOutfits, libItems, hairs: favHairs, looks, articles } = favorites();
  const block = (title, n, body) => (n ? `<div class="sub"><h3>${title}</h3><span>${n} 个</span></div>${body}` : '');
  const all = outfits.length + libOutfits.length + libItems.length + favHairs.length + looks.length + articles.length;
  if (!all) return `<div class="empty glass"><h3>还没有收藏</h3><p>穿搭、单品、发型、试穿图和读物上的 ♡ 都收在这里。不喜欢的内容点一下「不喜欢」，系统会记住并换一个。</p><a class="btn primary" href="#/home">回首页看看</a></div>`;
  return `<div class="favs">
    ${block('穿搭', outfits.length + libOutfits.length, `<div class="rail six tall">${outfits.map((o) => `<button class="pick" data-act="tryOutfit" data-id="${o.id}" title="上身试穿">${art(o, 'outfit')}<span class="eyebrow">${esc(o.occasion)}</span><b>${esc(o.name)}</b></button>`).join('')}
      ${libOutfits.map((o) => `<a class="pick" href="${libraryHref({ outfit: o.id })}">${o.image ? `<img class="studio-reference-photo" src="${esc(o.image)}" loading="lazy" alt="">` : o.personId ? '<span class="ph">全身原照待补</span>' : `<span class="quad" data-n="${Math.min(4, o.items.length)}">${o.items.slice(0, 4).map((x) => `<img src="${esc(x.image)}" loading="lazy" alt="">`).join('')}</span>`}<span class="eyebrow">${esc(o.occasion)} · 素材库</span><b>${esc(o.name)}</b></a>`).join('')}</div>`)}
    ${block('单品', libItems.length, `<div class="rail six">${libItems.map((i) => `<a class="pick item" href="${libraryHref({ item: i.id })}"><img src="${esc(i.image)}" loading="lazy" alt=""><span class="eyebrow">${esc(i.category)}</span><b>${esc(i.name)}</b></a>`).join('')}</div>`)}
    ${block('发型', favHairs.length, `<div class="rail six">${favHairs.map((x) => `<button class="pick" data-act="tryHair" data-id="${x.id}" title="在试衣间试这款">${art(x, 'hair')}<span class="eyebrow">${esc(x.tagline)}</span><b>${esc(x.name)}</b></button>`).join('')}</div>`)}
    ${block('试穿', looks.length, `<div class="looks">${looks.map((l) => `<button class="look" data-act="open" data-id="${l.id}"><img src="${lookImg(l.id, 1)}" loading="lazy" alt=""><span class="heart">♥</span><div class="cap glass"><b>${esc(l.title)}</b><span>${tags(l).join(' · ')} — ${day(l.createdAt)}</span></div></button>`).join('')}</div>`)}
    ${block('穿搭读物', articles.length, `<div class="stories">${articles.map((x) => story(x, 'favs')).join('')}</div>`)}
  </div>`;
}

function looksTab() {
  const { db, ui } = S;
  const all = db.looks.filter((l) => l.status !== 'failed');
  const list = all.filter((l) => ui.filter === 'all' || (ui.filter === 'fav' ? l.fav : tags(l).includes(ui.filter)));
  const f = (k, n) => `<button class="chip ${ui.filter === k ? 'on' : ''}" data-act="set" data-k="filter" data-v="${k}">${n}</button>`;
  const LOOKS = 10, shown = ui.allLooks ? list : list.slice(0, LOOKS);
  return `<div class="section-head"><h2><span class="num">${pad(done().length)}</span>试穿记录</h2><div class="chips">${f('all', '全部')}${f('fav', '收藏')}${f('发型', '发型')}${f('穿搭', '穿搭')}${f('试穿', '试穿')}${f('场景', '场景')}</div></div>
    ${list.length ? `<div class="looks">${shown.map((l) => (l.status === 'done'
      ? `<button class="look" data-act="open" data-id="${l.id}"><img src="${lookImg(l.id, 1)}" loading="lazy" alt="">${l.fav ? '<span class="heart">♥</span>' : ''}<div class="cap glass"><b>${esc(l.title)}</b><span>${tags(l).join(' · ')} — ${day(l.createdAt)}</span></div></button>`
      : `<div class="look pending shimmer"><img src="${img(l.baseId, 1)}" alt=""><div class="cap glass"><b>${esc(l.title)}</b><span>${l.status === 'queued' ? '排队中' : `生成中 ${elapsed(l.startedAt)}`}</span></div></div>`)).join('')}</div>
      ${list.length > LOOKS ? `<div class="more"><button class="btn ghost sm" data-act="toggle" data-k="allLooks">${ui.allLooks ? '收起' : `展开全部 ${list.length} 个`}</button></div>` : ''}`
    : `<div class="empty glass"><h3>${all.length ? '这个分类下还没有试穿图' : '还没有试穿记录'}</h3><p>去试衣间生成第一张试穿图，结果会自动保存在这里。</p><a class="btn primary" href="#/studio">进入试衣间</a></div>`}`;
}

const slotProgress = () => {
  const filled = SLOTS.map(([k]) => slotPhoto(k));
  return { filled, good: filled.filter((p) => p?.quality === 'good').length, partial: filled.filter((p) => p && p.quality !== 'good').length };
};

const editBodyButton = () => `<button class="btn ghost sm" type="button" data-act="editBody">${bodyEditBusy() ? '查看身形预览进度' : '更新基础形象'}</button>`;

function materialsTab() {
  const { db, ui } = S;
  const standard = avatar('avatarbody'), body = bodyBase(), bust = avatar('avatarbust');
  const st = (k) => db.sheets?.[k]?.status;
  const working = ['avatarBody', 'avatarBust'].some((k) => ['queued', 'running'].includes(st(k)));
  const failed = ['avatarBody', 'avatarBust'].find((k) => st(k) === 'failed');
  const pic = (p, k) => (p && !['queued', 'running'].includes(st(k)) ? `<img src="${img(p.id)}" alt="">` : `<div class="ph ${working ? 'shimmer' : ''}"><span>${working ? '绘制中' : '尚未生成'}</span></div>`);
  const { filled, good, partial } = slotProgress();
  const used = new Set(filled.filter(Boolean).map((p) => p.id));
  const rest = db.photos.filter((p) => p.source !== 'avatar' && !used.has(p.id) && !p.owned);
  const shown = ui.allPhotos ? rest : rest.slice(0, 8);
  return `<div class="avatar-card glass">
      <div class="pics">${pic(body, body?.id === 'avatarbody' ? 'avatarBody' : null)}${pic(bust, 'avatarBust')}</div>
      <div><span class="eyebrow">Model — 建模形象</span><h3>你的标准形象</h3>
        <p>全身图是试衣间的默认底图。可以更新身形，或补拍照片后重新生成标准照。</p>
        ${failed ? `<p class="error">生成失败：${esc(db.sheets[failed].error)}</p>` : ''}
        <div class="acts">${body || bodyEditBusy() ? editBodyButton() : ''}<button class="btn ${standard ? 'ghost' : 'primary'} sm" data-act="buildAvatar" ${working || !A() ? 'disabled' : ''}>${working ? '正在生成…' : standard ? '重新生成标准照' : '生成建模形象'}</button>
        <span class="muted">${!A() ? '生成整套标准照需先完成风格分析' : body ? `全身图更新于 ${day(body.createdAt)}` : '约 6–8 分钟，会同时更新发型预览'}</span></div></div>
    </div>
    <div class="sub"><h3>拍摄清单</h3><span>${classifyingNow() ? `<i class="pulse" style="display:inline-block;margin-right:8px"></i>正在识别 ${db.classifyJob.count} 张照片的角度与质量…` : `已合格 ${good} 项${partial ? ` · ${partial} 项可改进` : ''}${SLOTS.length - good - partial ? ` · 还差 ${SLOTS.length - good - partial} 项` : ''} · 照片够用就不必常来，变化大时上传新的即可`}</span></div>
    <div class="slots">${SLOTS.map(([, name, tip, g], i) => {
      const ph = filled[i];
      return ph
        ? `<figure class="slot ${ph.quality === 'good' ? 'ok' : 'warn'}"><div class="pic"><img src="${img(ph.id, 1)}" loading="lazy" alt=""><span class="state">${ph.quality === 'good' ? '✓' : '!'}</span>
            <button class="x glass" data-act="delPhoto" data-id="${ph.id}" title="删除">×</button></div>
            <figcaption><b>${name}</b>${ph.quality === 'good' ? '' : `<span>${esc(ph.issue || '可以拍得更标准')}</span><button data-act="upload" data-kind="photo" data-label="${name}">重拍一张</button>`}</figcaption></figure>`
        : `<button class="slot empty" data-act="upload" data-kind="photo" data-label="${name}">${glyph(g)}<b>${name}</b><span>${tip}</span><em>+ 上传</em></button>`;
    }).join('')}</div>
    <div class="sub"><h3>其他素材</h3><span>未归入清单的照片、试穿用的单品图与参考图 · 点击标签可改名</span></div>
    <div class="mats">${shown.map((ph) => `<figure class="photo"><img src="${img(ph.id, 1)}" loading="lazy" alt="">${ph.kind === 'garment' ? '<span class="ai">单品</span>' : ph.source === 'ai' ? '<span class="ai">AI</span>' : ''}
      <span class="label glass" contenteditable="plaintext-only" spellcheck="false" data-label="${ph.id}">${esc(ph.label)}</span>
      <button class="x glass" data-act="delPhoto" data-id="${ph.id}" title="删除">×</button></figure>`).join('')}
      <button class="drop" data-act="upload" data-kind="photo"><b>+</b>添加照片</button></div>
    ${rest.length > 8 ? `<div class="more"><button class="btn ghost sm" data-act="toggle" data-k="allPhotos">${ui.allPhotos ? '收起' : `展开全部 ${rest.length} 张`}</button></div>` : ''}`;
}

function wardrobeTab() {
  const { db, library } = S;
  const cards = db.wardrobe.map((w) => {
    const item = w.libraryId && library?.items.find((i) => i.id === w.libraryId);
    const src = w.photoId ? img(w.photoId, 1) : item?.image;
    return `<figure class="photo">${src ? `<img src="${esc(src)}" loading="lazy" alt="">` : '<div class="ph"></div>'}<span class="ai">${esc(w.category || '识别中')}</span><span class="label glass">${esc(w.name)}</span><button class="x glass" data-act="dropWardrobe" data-id="${w.id}" title="移出衣橱">×</button></figure>`;
  }).join('');
  return `<div class="section-head"><h2><span class="num">${pad(db.wardrobe.length)}</span>衣橱</h2><p>可选。录入之后，每天的穿搭会优先用你已有的衣服，「值得入手」也不会再推荐同款。</p></div>
    <div class="mats">${cards}<button class="drop" data-act="upload" data-kind="garment" data-owned="1"><b>+</b>拍一件衣服</button></div>
    <p class="muted note" style="margin-top:18px">两种录入方式：在这里上传衣服的照片或商品截图，系统会自动识别名称和品类；或者在首页、素材库的单品上点「已有」。</p>`;
}

function prefsTab() {
  const { db } = S, notes = visibleStylePrefs(db.prefs.notes), log = db.feedback.filter((f) => f.kind !== 'direction').slice(-8).reverse();
  const KIND = { outfit: '穿搭', item: '单品', hair: '发型', article: '读物' };
  const pending = db.feedback.filter((f) => !f.summarized).length;
  return `<div class="section-head"><h2><span class="num">${pad(notes.length)}</span>偏好</h2><p>穿搭会参考你想尝试的风格。你也可以直接添加一条推荐规则。</p>
    <a class="btn ghost sm" href="${STYLE_QUIZ_HREF}">${db.settings.styleQuizDone === STYLE_QUIZ_VERSION ? '重新选择风格' : '看图选择风格'}</a></div>
    <div class="prefs">
      <div class="panel glass"><span class="eyebrow">自动更新</span>
        <p class="muted">自动生成日常穿搭并更新素材、读物和预览，会调用你配置的 AI 服务。</p>
        <button class="btn ghost sm" data-act="automatic" data-enabled="${db.settings.automatic === false}">${db.settings.automatic === false ? '开启自动更新' : '暂停自动更新'}</button>
      </div>
      <div class="panel glass"><span class="eyebrow">推荐时遵守</span>
        ${notes.length ? `<ul class="notes-list">${notes.map((n) => `<li><span>${esc(n.text)}</span><small>${n.source === 'style-quiz' ? '看图选择' : n.auto ? '自动归纳' : '我写的'}</small><button data-act="dropNote" data-id="${n.id}" title="删除">×</button></li>`).join('')}</ul>` : `<p class="muted">还没有保存的偏好。${pending ? `已记录 ${pending} 条反馈，满 3 条后会自动归纳。` : ''}</p>`}
        <form class="city" data-form="note"><input name="note" maxlength="40" placeholder="自己加一条，例如：不穿紧身裤、少推棒球帽" autocomplete="off" aria-label="新增偏好"><button class="btn ghost sm">添加</button></form></div>
      <div class="panel glass"><span class="eyebrow">最近的反馈</span>
        ${log.length ? `<ul class="notes-list">${log.map((f) => `<li><span>不喜欢${KIND[f.kind]}「${esc(f.name)}」${f.reason ? ` · ${esc(f.reason)}` : ''}</span><small>${day(f.at)}</small></li>`).join('')}</ul>` : '<p class="muted">还没有反馈记录。</p>'}
        ${db.prefs.directions?.length ? `<span class="eyebrow" style="margin-top:22px;display:block">提过的调整方向</span><div class="chips" style="margin-top:10px">${db.prefs.directions.map((d) => `<span class="chip">${esc(d)}</span>`).join('')}</div>` : ''}</div>
    </div>`;
}

function overview() {
  const { db, library } = S, a = A();
  const notes = visibleStylePrefs(db.prefs.notes);
  const face = avatar('avatarbody') || avatar('avatarbust') || slotPhoto('body_front') || slotPhoto('face_front') || photos()[0];
  const lockedPts = a ? a.diagnosis.flatMap((d) => d.points).filter((p) => p.locked).length : 0;
  const alert = (text, cta, v) => `<p class="ov-alert">${text}<a class="linkish" href="#/mine?v=${v}">${cta}</a></p>`;
  const heroMain = a ? `<h3 class="ov-arche">${esc(a.style.archetype)}</h3>
      <p class="ov-sum">${esc(a.summary)}</p>`
    : analyzing() ? `<span class="eyebrow">Analyzing</span><h3 class="ov-arche">正在分析</h3>
      <p class="ov-note"><i class="pulse"></i>正在分析 ${elapsed(db.analysisJob.startedAt)}，完成后这里会显示你的形象结论</p>`
    : photos().some((p) => p.source === 'real') ? `<span class="eyebrow">Get started</span><h3 class="ov-arche">还没有形象档案</h3>
      <p class="ov-sum">照片已经在了，开始一次风格分析，就能拿到你的形象结论。</p>
      ${db.analysisJob?.status === 'failed' ? `<p class="error">上次分析失败：${esc(db.analysisJob.error)}</p>` : ''}
      <div class="acts"><button class="btn primary sm" data-act="analyze">开始建立形象档案</button><a class="btn ghost sm" href="#/mine?v=materials">先补几张照片</a></div>`
    : `<span class="eyebrow">Get started</span><h3 class="ov-arche">还没有形象档案</h3>
      <p class="ov-sum">上传正脸、侧面、头顶与全身的照片，系统会建立你的形象档案，之后每天按天气给你穿搭。</p>
      <div class="acts"><a class="btn primary sm" href="#/mine?v=materials">上传照片，建立形象档案</a></div>`;
  const heroFoot = a ? `<div class="chips">${a.style.keywords.slice(0, 4).map((k) => `<span class="chip">${esc(k)}</span>`).join('')}</div>
      <div class="acts"><a class="btn primary sm" href="#/mine?v=profile">查看完整档案</a></div>
      ${db.drift ? alert('新照片和档案有些出入', '去看看', 'profile') : ''}
      ${lockedPts ? alert(`还有 ${lockedPts} 项诊断等你补拍照片`, '去补拍', 'materials') : ''}
      ${fresh() ? alert(`有 ${fresh()} 张新照片还没纳入分析`, '去更新', 'profile') : ''}` : '';
  const okLooks = db.looks.filter((l) => l.status !== 'failed');
  const lookTiles = okLooks.slice(0, 3).map((l) => (l.status === 'done'
    ? `<button class="ov-look" data-act="open" data-id="${l.id}"><img src="${lookImg(l.id, 1)}" loading="lazy" alt=""></button>`
    : `<div class="ov-look pending shimmer"><img src="${img(l.baseId, 1)}" alt=""><span>${l.status === 'queued' ? '排队中' : `生成中 ${elapsed(l.startedAt)}`}</span></div>`)).join('');
  const favs = favorites(), artImg = (e) => (e.art === 'done' && e.image ? `/media/${e.image}` : '');
  const thumbs = [
    ...favs.looks.map((l) => lookImg(l.id, 1)),
    ...favs.outfits.map(artImg),
    ...favs.hairs.map(artImg),
    ...favs.libOutfits.map((o) => o.items[0]?.image),
    ...favs.libItems.map((i) => i.image),
    ...favs.articles.map((x) => ((x.image || '').startsWith('https:') ? x.image : '')),
  ].filter(Boolean).slice(0, 6);
  const counts = [['穿搭', favs.outfits.length + favs.libOutfits.length], ['单品', favs.libItems.length], ['发型', favs.hairs.length], ['试穿', favs.looks.length], ['读物', favs.articles.length]]
    .filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ');
  const wThumbs = db.wardrobe.map((w) => (w.photoId ? img(w.photoId, 1) : w.libraryId && library?.items.find((i) => i.id === w.libraryId)?.image)).filter(Boolean).slice(0, 4);
  const body = bodyBase() || avatar('avatarbust'), st = (k) => db.sheets?.[k]?.status;
  const avBusy = ['avatarBody', 'avatarBust'].some((k) => ['queued', 'running'].includes(st(k)));
  return `<section class="ov-hero glass">
      ${face ? `<img class="ov-img" src="${img(face.id)}" alt="">` : '<div class="ov-img ph"></div>'}
      <div class="ov-main">${heroMain}</div>
      ${heroFoot ? `<div class="ov-foot">${heroFoot}</div>` : ''}
    </section>
    <div class="ov-grid">
      <section class="panel glass ov ov-wide">
        <div class="ov-head"><h3>最近试穿</h3><a href="#/mine?v=looks">全部试穿 ${okLooks.length} →</a></div>
        ${lookTiles ? `<div class="ov-looks">${lookTiles}</div>` : '<p class="ov-note">试衣间里生成的图会收在这里。</p><a class="linkish" href="#/studio">去试衣间</a>'}
      </section>
      <div class="ov-col">
        <section class="panel glass ov">
          <div class="ov-head"><h3>我的收藏</h3><a href="#/mine?v=favs">查看全部 →</a></div>
          ${thumbs.length ? `<div class="ov-thumbs">${thumbs.map((s) => `<a href="#/mine?v=favs"><img src="${esc(s)}" loading="lazy" alt=""></a>`).join('')}</div><p class="ov-counts">${counts}</p>` : '<p class="ov-note">穿搭、单品、发型、试穿图和读物上的 ♡ 都会收在这里</p>'}
        </section>
        <section class="panel glass ov">
          <div class="ov-head"><h3>我的衣橱</h3><a href="#/mine?v=wardrobe">查看衣橱 →</a></div>
          ${db.wardrobe.length ? `<p class="ov-big">${db.wardrobe.length}<small> 件</small></p>` : ''}
          ${wThumbs.length ? `<div class="ov-minis">${wThumbs.map((s) => `<img src="${esc(s)}" loading="lazy" alt="">`).join('')}</div>` : ''}
          <p class="ov-note">录入后，每天的穿搭会优先用你已有的衣服</p>
          <div class="acts"><button class="btn primary sm" data-act="upload" data-kind="garment" data-owned="1">添加衣服</button></div>
        </section>
      </div>
      <section class="panel glass ov ov-wide">
        <div class="ov-head"><h3>照片与建模</h3><a href="#/mine?v=materials">补拍或更新形象 →</a></div>
        <div class="ov-pm">
          ${body ? `<img class="ov-avatar" src="${img(body.id, 1)}" alt="">` : ''}
          <div class="ov-pm-text">
            <p class="ov-note">拍摄清单 已合格 ${slotProgress().good}/${SLOTS.length}</p>
            <p class="ov-note">${avBusy ? '建模形象正在生成' : body ? `建模形象更新于 ${day(body.createdAt)}` : '建模形象尚未生成'}</p>
            ${bodyBase() || bodyEditBusy() ? `<div class="acts">${editBodyButton()}</div>` : ''}
          </div>
        </div>
      </section>
      <section class="panel glass ov">
        <div class="ov-head"><h3>推荐偏好</h3><a href="#/mine?v=prefs">调整推荐规则 →</a></div>
        ${notes.length ? `<p class="ov-big">${notes.length}<small> 条</small></p>` : ''}
        ${notes.length ? notes.slice(0, 2).map((n) => `<p class="ov-note">· ${esc(n.text)}</p>`).join('') : '<p class="ov-note">还没有保存的偏好</p>'}
        ${db.settings.styleQuizDone !== STYLE_QUIZ_VERSION ? `<div class="acts"><a class="btn ghost sm" href="${STYLE_QUIZ_HREF}">看图选择风格</a></div>` : ''}
      </section>
    </div>`;
}

export function renderMine() {
  const { db, ui } = S;
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const v = query.get('v');
  if (v === 'style') return renderStyleQuiz(ui.styleQuiz, styleQuizBack(query));
  if (!TABS.some(([k]) => k === v)) return `<div class="archive-head"><div><span class="eyebrow">My Atelier — 我的</span><h2 class="display cn" style="margin-top:16px">${esc(db.profile.name || '我')} 的形象</h2></div></div>${overview()}`;
  const body = { profile: profileTab, favs: favsTab, looks: looksTab, materials: materialsTab, wardrobe: wardrobeTab, prefs: prefsTab }[v]();
  return `<a class="linkish back" href="#/mine">← 我的</a>
    <div class="archive-head"><div><span class="eyebrow">My Atelier — 我的</span><h2 class="display cn" style="margin-top:16px">${TABS.find(([k]) => k === v)[1]}</h2></div></div>
    <nav class="library-tabs mine-tabs" aria-label="我的">${TABS.map(([k, label]) => `<a href="#/mine?v=${k}" ${v === k ? 'aria-current="page"' : ''}>${label}${k === 'profile' && db.drift ? '<i class="dot"></i>' : ''}</a>`).join('')}<a class="library-saved" href="${libraryHref()}">素材库 →</a></nav>
    <div class="mine-body">${body}</div>`;
}
