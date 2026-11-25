import { esc, hex } from './html.js';

export { esc, hex };
export const S = {
  db: null,
  library: null,
  libraryError: '',
  ui: { filter: 'all', hair: null, outfit: null, allLooks: false, allPhotos: false, rawBases: false, feed: 'today', dirOpen: false, direction: '', disliking: null, menu: null, cityOpen: false, styleQuiz: null },
  studio: { baseId: null, picked: false, mode: 'outfit', tab: 'rec', outfit: null, entryOutfit: null, reference: null, items: {}, cat: '外套', extra: '', hairId: null, hair: '', season: null, viewId: null, recentOpen: false },
};

export const $ = (s, el = document) => el.querySelector(s);
export const pad = (n) => String(n).padStart(2, '0');
export const elapsed = (t) => { const s = Math.max(0, Math.floor((Date.now() - t) / 1000)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
export const day = (t) => new Date(t).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
export const img = (id, thumb) => `/media/photos/${id}${thumb ? '_t' : ''}.jpg?v=${S.db?.photos.find((p) => p.id === id)?.createdAt || ''}`;
export const lookImg = (id, thumb) => `/media/looks/${id}${thumb ? '_t' : ''}.jpg`;

export async function api(method, url, body) {
  const res = await fetch(url, { method, body: body instanceof Blob || body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200);
}

export const A = () => (S.db.analysis?.diagnosis ? S.db.analysis : null);
export const photos = () => S.db.photos.filter((p) => p.kind === 'photo');
export const avatar = (id) => S.db.photos.find((p) => p.id === id);
export const raws = () => S.db.photos.filter((p) => p.kind === 'photo' && p.source !== 'avatar');
export const garments = () => S.db.photos.filter((p) => p.kind === 'garment');
const RANK = { good: 3, partial: 2, poor: 1 };
export const slotPhoto = (slot) => S.db.photos.filter((p) => p.source === 'real' && p.slot === slot).sort((x, y) => (RANK[y.quality] || 0) - (RANK[x.quality] || 0) || y.createdAt - x.createdAt)[0];
// 适合换装的本人照片：全身正面，质量不能是 poor。
export const tryOnPhotos = () => S.db.photos.filter((p) => p.source === 'real' && p.slot === 'body_front' && p.quality !== 'poor').sort((x, y) => RANK[y.quality] - RANK[x.quality] || y.createdAt - x.createdAt);
export const bodyBase = () => avatar(S.db.settings?.bodyBaseId) || avatar('avatarbody') || tryOnPhotos()[0];
export const bodyEditBusy = () => S.db.bodyEdits?.some((edit) => ['queued', 'running'].includes(edit.status));
export const analyzing = () => S.db.analysisJob?.status === 'running';
export const classifyingNow = () => S.db.classifyJob?.status === 'running';
export const done = () => S.db.looks.filter((l) => l.status === 'done');
export const busy = () => S.db.looks.filter((l) => l.status === 'running' || l.status === 'queued');
export const tags = (l) => [l.hair && '发型', l.garment ? '试穿' : l.outfit && '穿搭', l.scene && '场景'].filter(Boolean);
export const outfitOf = (id) => S.db.outfits.find((o) => o.id === id);
export const hairs = () => S.db.hairs.filter((h) => !h.disliked);
export const fitOf = (id) => S.db.fit?.scores?.[id] ?? 60;
export const owned = (libraryId) => S.db.wardrobe.some((w) => w.libraryId === libraryId);
export const season = () => S.studio.season || S.db.seasonName?.[0] || '秋';
export const inSeason = (tag, current = season()) => !tag || tag === '四季' || (tag === '春秋' ? '春秋'.includes(current) : tag === current);
export const head = (n, title, note = '', aside = '') => `<div class="section-head"><h2><span class="num">${n}</span>${title}</h2><div class="head-side"><p>${note}</p>${aside}</div></div>`;

// 穿搭、发型的预览图：构思中 → 绘制中 → 成图 / 失败可重试。
export function art(e, kind, cls = '') {
  if (e.status === 'drafting') return `<div class="ph shimmer ${cls}"><span>构思中</span></div>`;
  if (e.art === 'done' && e.image) return `<img class="${cls}" src="/media/${esc(e.image)}?t=${e.imageAt || ''}" loading="lazy" alt="${esc(e.name)}">`;
  if (e.art === 'pending' && S.db?.settings?.automatic === false &&
      S.db.jobs.some((job) => job.status === 'queued' && job.priority !== 'user' && job.ids.includes(e.id))) {
    return `<div class="ph ${cls}"><span class="chip" role="button" tabindex="0" data-act="retryArt" data-kind="${kind}" data-id="${e.id}">生成预览</span></div>`;
  }
  if (e.art === 'failed') return `<div class="ph ${cls}"><span>预览没画出来</span><span class="chip" role="button" data-act="retryArt" data-kind="${kind}" data-id="${e.id}">重试</span></div>`;
  return `<div class="ph shimmer ${cls}"><span>绘制中</span></div>`;
}

export const shopLinks = (keyword) => [['淘宝', `https://s.taobao.com/search?q=${encodeURIComponent(keyword)}`], ['京东', `https://search.jd.com/Search?keyword=${encodeURIComponent(keyword)}`]];
export const REASONS = { outfit: ['太老气', '颜色不喜欢', '版型不适合我', '太正式', '太休闲', '不够实用', '已有类似的'], item: ['颜色不喜欢', '款式不适合我', '已有类似的', '太贵或难买'], hair: ['打理太麻烦', '太夸张', '太普通', '不适合我的脸型'], article: ['不感兴趣的话题', '太偏女装', '信息量太少'] };
// 点了「不喜欢」之后原地展开的原因选择，选不选都可以。
export function reasonBar(kind, id) {
  return `<div class="reasons"><span>哪里不合适？</span>${REASONS[kind].map((r) => `<button class="chip" data-act="dislike" data-kind="${kind}" data-id="${esc(id)}" data-reason="${r}">${r}</button>`).join('')}<button class="chip" data-act="dislike" data-kind="${kind}" data-id="${esc(id)}" data-reason="">不说原因</button><button class="linkish" data-act="cancelDislike">取消</button></div>`;
}
