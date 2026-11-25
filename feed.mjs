import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { localDate, localHour } from './weather.mjs';
import { SOURCES, VIDEO_RESERVE } from './feed-sources.mjs';

export { SOURCES };
const DAY = 86_400_000;
export const KEEP_DAYS = 7;
export const PER_DAY = 6;
const EDITION = 2;
const FORMATS = ['article', 'gallery', 'video'];
const PER_FORMAT = 2;
const MAX_AGE = { article: 30, gallery: 180, video: 900 };
const BILIBILI = 'https://www.bilibili.com/video/';
const videoId = /^BV[0-9A-Za-z]{10}$/;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
  const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : '';
});
const cdata = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const text = (s) => decode(decode(cdata(s || '')).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const tag = (xml, name) => xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))?.[1] || '';
const https = (value) => { try { const u = new URL(decode(String(value || '').trim())); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; } };

const attr = (html, name) => decode(html.match(new RegExp(`(?:^|\\s)${name}=["']([^"']+)["']`, 'i'))?.[1] || '');
const imageUrls = (html) => [...new Set([...html.matchAll(/<img\b[^>]*>/gi)]
  .map(([img]) => https(attr(img, 'src') || attr(img, 'data-src'))).filter(Boolean))].slice(0, 6);

function keyFor(url) {
  const parsed = new URL(url);
  parsed.hash = '';
  for (const name of Array.from(parsed.searchParams.keys())) {
    if (/^(utm_|spm_id_from$|from$|ref$|share_source$)/i.test(name)) parsed.searchParams.delete(name);
  }
  parsed.searchParams.sort();
  return parsed.href;
}

export function parseFeed(xml) {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  return blocks.map((block) => {
    const body = cdata(tag(block, 'content:encoded') || tag(block, 'content') || '') + cdata(tag(block, 'description') || tag(block, 'summary') || '');
    const link = https(cdata(tag(block, 'link'))) || https(block.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i)?.[1] || '');
    const image = https(block.match(/<media:(?:content|thumbnail)\b[^>]*\burl=["']([^"']+)["']/i)?.[1] || '')
      || https(block.match(/<enclosure\b[^>]*\burl=["']([^"']+)["'][^>]*type=["']image/i)?.[1] || '')
      || https(decode(body).match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1] || '');
    const publishedAt = Date.parse(text(tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date')));
    const images = imageUrls(decode(body));
    return { title: text(tag(block, 'title')).slice(0, 200), url: link, image, images, publishedAt,
      excerpt: text(tag(block, 'description') || tag(block, 'summary') || body).slice(0, 320) };
  }).filter((entry) => entry.title && entry.url && Number.isFinite(entry.publishedAt));
}

async function download(url, fetcher, { html = false, timeout = 12_000 } = {}) {
  const res = await fetcher(url, {
    signal: AbortSignal.timeout(timeout),
    headers: {
      'user-agent': 'Mozilla/5.0 AtelierPersonalStylist/1.0',
      accept: html ? 'text/html' : 'application/rss+xml, application/xml, text/xml',
    },
  });
  if (!res.ok || !res.body) throw new Error(String(res.status));
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let content = '', bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return content + decoder.decode();
    bytes += value.byteLength;
    if (bytes > (html ? 900_000 : 3_000_000)) {
      await reader.cancel();
      return content + decoder.decode();
    }
    content += decoder.decode(value, { stream: true });
  }
}

async function articleImages(entry, fetcher) {
  try {
    const url = new URL(entry.url);
    // 只向现有公开来源补图，已存档链接和 RSS 中的外链无需再访问。
    if (url.origin !== 'https://nowre.com') return [];
    const html = await download(url.href, fetcher, { html: true, timeout: 8_000 });
    const meta = [...html.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => tag)
      .find((tag) => /^(og:image|twitter:image)$/.test(attr(tag, 'property') || attr(tag, 'name')));
    const cover = https(meta && attr(meta, 'content'));
    const images = imageUrls(html).filter((src) => /^(https:\/\/nowre\.com\/wp-content\/uploads\/|https:\/\/files\.nowre\.com\/articles\/)/.test(src));
    // NOWRE 文章页同时有导航和推荐配图，优先用正文中成组出现的照片。
    const body = [...html.matchAll(/<img\b[^>]*>/gi)].map(([tag]) => tag)
      .filter((tag) => /(?:wp-image-\d+|img-responsive center-table)/.test(attr(tag, 'class'))).join('');
    return [...new Set([cover, ...imageUrls(body), ...images].filter(Boolean))].slice(0, 6);
  } catch { return []; }
}

function videoLinks(html) {
  const ids = new Set();
  for (const [, anchor, heading, title] of html.matchAll(/(<a\b[^>]*>)\s*(<h3\b[^>]*>)([\s\S]*?)<\/h3>/gi)) {
    if (!attr(heading, 'class').includes('bili-video-card__info--tit')) continue;
    const found = attr(anchor, 'href').match(/^(?:https:)?\/\/www\.bilibili\.com\/video\/(BV[0-9A-Za-z]{10})(?:\/|\?|$)/)?.[1];
    const name = text(attr(heading, 'title') || title);
    if (found && /男[生装士性]|男[人孩]/.test(name) && /穿搭|搭配|配色|叠穿|通勤|比例|衣橱|版型|裤长/.test(name)
      && !/女[装生]穿搭|女装|直播切片|带货|必买|店铺分享|男装店铺|裤子推荐|购物清单/.test(name)) ids.add(found);
  }
  return [...ids];
}

function parseVideo(html, id, source) {
  for (const [, opening, data] of html.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/gi)) {
    if (attr(opening, 'type') !== 'application/ld+json') continue;
    let video;
    try { video = JSON.parse(data); } catch { continue; }
    if (video?.['@type'] !== 'VideoObject' || https(video.url) !== `${BILIBILI}${id}/`) continue;
    const publishedAt = Date.parse(video.uploadDate || video.datePublished);
    const title = text(String(video.name || '')).slice(0, 200);
    const image = https(Array.isArray(video.thumbnailUrl) ? video.thumbnailUrl[0] : video.thumbnailUrl);
    if (!title || !image || !Number.isFinite(publishedAt)) return null;
    const duration = String(video.duration || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
    return {
      title, url: video.url, publishedAt, image, creator: text(String(video.author?.name || '')).slice(0, 60),
      excerpt: text(String(video.description || '')).slice(0, 320),
      duration: duration ? Number(duration[1] || 0) * 3600 + Number(duration[2] || 0) * 60 + Number(duration[3] || 0) : 0,
      source, format: 'video', local: true,
    };
  }
  return null;
}

async function videosFor(source, fetcher, { day, wanted, known, now }) {
  const dayIndex = Math.floor(Date.parse(day) / DAY);
  const searchUrls = source.url ? [source.url] : [0, 1].map((offset) => {
    const topic = source.topics[(dayIndex + offset * 3) % source.topics.length];
    return 'https://search.bilibili.com/all?keyword=' + encodeURIComponent('男生穿搭 ' + topic);
  });
  const searches = await Promise.allSettled(searchUrls.map((url) => download(url, fetcher, { html: true, timeout: 10_000 })));
  const results = searches.map((result) => result.status === 'fulfilled' ? videoLinks(result.value).slice(0, 14) : []);
  const ids = new Set();
  for (let i = 0; results.some((list) => list[i]); i++) for (const list of results) if (list[i]) ids.add(list[i]);
  const unseen = (id) => videoId.test(id) && !known.has(`${BILIBILI}${id}/`);
  const check = async (ids) => (await Promise.all(ids.map(async (id) => {
    try {
      const html = await download(`${BILIBILI}${id}/`, fetcher, { html: true, timeout: 8_000 });
      return parseVideo(html, id, source.source);
    } catch { return null; }
  }))).filter((entry) => entry && entry.publishedAt <= now
    && (!entry.duration || (entry.duration >= 45 && entry.duration <= 30 * 60)));
  const active = [...ids].filter(unseen).slice(0, 8);
  const live = await check(active);
  const reachable = Boolean(live.length || (ids.size && active.length === 0));
  if (source.url || live.length >= wanted) return { reachable, entries: live };
  const reserve = VIDEO_RESERVE.filter((id) => unseen(id) && !active.includes(id)).slice(0, 4);
  const older = await check(reserve);
  return { reachable: reachable || Boolean(older.length), entries: [...live, ...older] };
}

const pictureSet = (entry) => [...new Set([...(entry.images || []), entry.image].filter(Boolean))].slice(0, 6);

export function createFeed({ dataDir, select, clock = Date.now, fetcher = fetch, sources = SOURCES }) {
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'feed.json');
  let state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { items: [], seen: {}, refresh: { status: 'idle' } };
  if (state.refresh.status === 'running') state.refresh = { ...state.refresh, status: 'failed', error: '上次更新因服务重启中断', retryAt: 0 };
  const upgrade = sources === SOURCES;
  const config = sources.map((source) => Array.isArray(source) ? { source: source[0], url: source[1] } : source);
  let job;
  const commit = (next) => { writeFileSync(file + '.tmp', JSON.stringify(next, null, 2)); renameSync(file + '.tmp', file); state = next; };

  async function perform() {
    const now = clock(), day = localDate(now);
    const cutoff = localDate(now - (KEEP_DAYS - 1) * DAY);
    const counts = Object.fromEntries(FORMATS.map((format) => [format, state.items.filter((item) => item.day === day && !item.disliked
      && (item.format || (!upgrade && 'article')) === format).length]));
    const slots = Object.fromEntries(FORMATS.map((format) => [format, Math.max(0, PER_FORMAT - counts[format])]));
    const limit = Object.values(slots).reduce((total, count) => total + count, 0);
    if (!limit) return state.refresh;
    const known = new Set([...Object.keys(state.seen), ...state.items.map((item) => item.url)].map(keyFor));
    commit({ ...state, items: state.items.filter((item) => item.fav || item.day >= cutoff), refresh: { ...state.refresh, version: EDITION, status: 'running', startedAt: now, error: undefined } });
    try {
      const fetched = await Promise.all(config.map(async (source) => {
        if (source.format && !slots[source.format]) return { skipped: true, entries: [] };
        if (source.format === 'video') return videosFor(source, fetcher, { day, wanted: slots.video, known, now });
        try {
          const entries = parseFeed(await download(source.url, fetcher));
          return { reachable: Boolean(entries.length), entries: entries.map((entry) => ({
            ...entry, source: source.source, ...(source.format && { format: source.format, local: Boolean(source.local) }),
          })), filter: source };
        } catch { return { reachable: false, entries: [] }; }
      }));

      if (!fetched.some(({ reachable }) => reachable)) {
        if (fetched.every(({ skipped }) => skipped)) {
          commit({ ...state, refresh: { status: 'done', version: EDITION, day, lastSuccess: now, added: 0 } });
          return state.refresh;
        }
        throw new Error('本次查询的穿搭来源暂不可用');
      }

      const seenCandidates = new Set(known);
      const candidatesByFormat = Object.fromEntries(FORMATS.map((format) => [format, []]));
      for (const { entries, filter } of fetched) {
        for (const entry of entries.sort((a, b) => b.publishedAt - a.publishedAt)) {
          const format = entry.format || 'article';
          if (!slots[format] || entry.publishedAt > now || now - entry.publishedAt > (filter?.maxDays || MAX_AGE[format]) * DAY) continue;
          if (filter?.exclude?.test(entry.title) || (filter?.include && !filter.include.test(`${entry.title} ${entry.excerpt}`))) continue;
          const key = keyFor(entry.url);
          if (seenCandidates.has(key)) continue;
          seenCandidates.add(key);
          candidatesByFormat[format].push(entry);
        }
      }
      const pools = FORMATS.map((format) => candidatesByFormat[format]
        .sort((a, b) => Number(Boolean(b.local)) - Number(Boolean(a.local)) || b.publishedAt - a.publishedAt).slice(0, 14));
      const candidates = [];
      for (let i = 0; pools.some((pool) => pool[i]); i++) {
        for (const pool of pools) if (pool[i]) candidates.push(pool[i]);
      }

      let picks;
      if (candidates.length) {
        try { picks = await select(candidates, limit, slots); } catch (e) { console.error('feed select', e.message); }
      }
      const ranked = Array.isArray(picks)
        ? picks.map((pick) => [candidates[pick?.index - 1], pick]).filter(([entry]) => entry)
        : candidates.map((entry) => [entry, null]);
      const used = new Set();
      const fresh = [];
      for (const [entry, pick] of ranked) {
        const key = keyFor(entry.url), format = entry.format || 'article';
        if (!slots[format] || used.has(key)) continue;
        const pictures = pictureSet(entry);
        if ((!pictures.length || (format === 'gallery' && pictures.length === 1)) && entry.format !== 'video') {
          for (const image of await articleImages(entry, fetcher)) if (!pictures.includes(image)) pictures.push(image);
        }
        if (format === 'gallery' && !pictures.length) continue;
        used.add(key);
        slots[format]--;
        fresh.push({
          ...entry, id: crypto.createHash('sha1').update(key).digest('hex').slice(0, 12), day, addedAt: now,
          image: pictures[0] || '', images: pictures.slice(0, 6),
          zh: String(pick?.title || '').slice(0, 60), summary: String(pick?.summary || (!pick ? entry.excerpt : '')).slice(0, 160),
          tag: String(pick?.tag || (entry.format ? '穿搭' : '')).slice(0, 6),
        });
      }
      const seen = Object.fromEntries(Object.entries({ ...state.seen, ...Object.fromEntries([...used].map((url) => [url, now])) })
        .filter(([, at]) => now - at < 900 * DAY));
      const excerpts = new Map(fetched.flatMap(({ entries }) => entries).filter((entry) => entry.excerpt).map((entry) => [keyFor(entry.url), entry.excerpt]));
      const archived = state.items.map((item) => {
        const excerpt = excerpts.get(keyFor(item.url));
        return !item.excerpt && excerpt ? { ...item, excerpt } : item;
      });
      commit({ items: [...archived.filter((item) => item.day === day && item.format && !item.disliked), ...fresh,
        ...archived.filter((item) => item.day !== day || !item.format || item.disliked)], seen,
      refresh: { status: 'done', version: EDITION, day, lastSuccess: now, added: fresh.length } });
    } catch (e) {
      commit({ ...state, refresh: { ...state.refresh, status: 'failed', error: String(e.message).slice(0, 160), retryAt: clock() + 3_600_000 } });
    }
    return state.refresh;
  }
  const refresh = () => (job ||= perform().finally(() => { job = null; }));

  return {
    refresh,
    get: () => ({ items: state.items.filter((item) => !item.disliked), refresh: state.refresh, limit: PER_DAY }),
    find: (id) => state.items.find((item) => item.id === id),
    tick() {
      const now = clock(), r = state.refresh;
      if (job || r.status === 'running') return job;
      if (r.status === 'failed' ? now >= (r.retryAt || 0) : (r.day !== localDate(now) || (upgrade && r.version !== EDITION)) && localHour(now) >= 6) return refresh();
    },
    mark(id, patch) {
      const item = state.items.find((entry) => entry.id === id);
      if (!item) throw new Error('这条内容已经过期');
      if (typeof patch.fav === 'boolean') item.fav = patch.fav;
      if (typeof patch.disliked === 'boolean') item.disliked = patch.disliked;
      commit(state);
      return item;
    },
  };
}
