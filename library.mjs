import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DAYS = 86_400_000;
const RETRY = 60 * 60 * 1000;
export const MAX_WEEKLY_ITEMS = 12;
export const MAX_WEEKLY_CANDIDATES = 30;
export const LOOKS_PER_PERSON = 20;
export const categories = new Set(['外套', '上装', '下装', '鞋履', '配饰']);
export const seasons = new Set(['四季', '春秋', '夏', '冬']);
const contexts = new Set(['日常', '出行', '编辑拍摄', '公开活动']);
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const validId = (id) => typeof id === 'string' && id.length <= 94 && idPattern.test(id);
const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const colorPattern = /^#[a-f0-9]{6}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
export const secureUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
};

function dateIsValid(date) {
  if (!datePattern.test(date)) return false;
  const time = new Date(date);
  return Number.isFinite(+time) && time.toISOString().startsWith(date);
}

function validSource(source) {
  return secureUrl(source?.url) && hasText(source?.title);
}

function validPiece(piece) {
  return hasText(piece?.name) && categories.has(piece.category) && colorPattern.test(piece.color) && hasText(piece.shape);
}

function validItem(item) {
  return validPiece(item) && validId(item.id) && seasons.has(item.season) && hasText(item.why)
    && Array.isArray(item.wears) && new Set(item.wears.filter(hasText).map((wear) => wear.trim())).size >= 2
    && ['classic', 'seasonal'].includes(item.kind);
}

function validPhotoOutfit(look) {
  return validId(look?.id) && hasText(look.name) && hasText(look.occasion) && seasons.has(look.season)
    && validSource(look.source) && hasText(look.source.locator)
    && hasText(look.tip) && Array.isArray(look.pieces) && look.pieces.length >= 2 && look.pieces.every(validPiece);
}

function validLook(look) {
  return validPhotoOutfit(look) && dateIsValid(look.date) && contexts.has(look.source.context);
}

function uniqueLooks(person) {
  const ids = new Set();
  const citations = new Set();
  return person.looks.filter((look) => {
    if (!validLook(look) || ids.has(look.id)) return false;
    const url = new URL(look.source.url);
    const citation = [url.origin + url.pathname, look.source.locator.trim()].join('#');
    if (citations.has(citation)) return false;
    ids.add(look.id);
    citations.add(citation);
    return true;
  });
}

function imageForPiece(piece) {
  const options = new URLSearchParams({ category: piece.category, color: piece.color, shape: piece.shape, name: piece.name });
  return '/api/library/illustration?' + options;
}

function photoOutfit(look, source) {
  return {
    id: look.id, name: look.name, occasion: look.occasion, season: look.season, why: look.tip, itemIds: [], source,
    items: look.pieces.map((piece, index) => ({ ...piece, libraryId: `${look.id}-piece-${index + 1}`, image: imageForPiece(piece) })),
  };
}

export function refreshWeek(time) {
  // Singapore is UTC+8. Shifting by 8−9 hours makes Monday 09:00 local the start of a week.
  const date = new Date(time - 60 * 60 * 1000);
  return new Date(+date - ((date.getUTCDay() + 6) % 7) * DAYS).toISOString().slice(0, 10);
}

function fingerprint(item) {
  return [item.category, item.name, item.shape, item.color.toLowerCase()].join(' ').normalize('NFKC')
    .toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
}

function validPurchase(purchase) {
  return secureUrl(purchase?.url) && ['product', 'same'].includes(purchase.match)
    && (purchase.match !== 'same' || (hasText(purchase.brand) && hasText(purchase.sku)));
}

export async function createLibrary({ dataDir, seed, clock = Date.now, discover = async () => [],
  makeImage = async () => null, checkPurchase = async () => 'unknown', photoFor = () => null }) {
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'library.json');
  let state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {
    items: [], candidates: [], favorites: [], purchases: {}, refresh: { status: 'idle' },
  };
  const boot = Date.now().toString(36);
  let revision = 0;
  let currentJob;
  let snapshot;
  if (state.refresh.status === 'running') state.refresh = { ...state.refresh, status: 'failed', error: '上次检查因服务重启中断', retryAt: 0 };

  const starterItems = seed.items.filter(validItem);
  const seededPeople = seed.people
    .filter((person) => validId(person.id) && hasText(person.name) && hasText(person.summary) && Array.isArray(person.looks))
    .map((person) => ({ ...person, looks: uniqueLooks(person) }));

  const starters = new Map(starterItems.map((item) => [item.id, item]));
  const curated = seed.outfits
    .filter((outfit) => validId(outfit.id) && hasText(outfit.name) && seasons.has(outfit.season) && hasText(outfit.occasion)
      && hasText(outfit.why) && Array.isArray(outfit.itemIds) && outfit.itemIds.length && outfit.itemIds.every((id) => starters.has(id)));
  const results = seededPeople.flatMap((person) => person.looks.map((look) => {
    const file = look.source.imageFile;
    const image = file === `${look.id}.jpg` ? photoFor({ id: look.id, imageFile: file }) : null;
    return {
      ...photoOutfit(look, look.source), personId: person.id, date: look.date,
      ...(image && { image }), ...((look.archived || !image) && { archived: true }),
    };
  }));
  const lookIdsByPerson = new Map(seededPeople.map((person) => [person.id, []]));
  for (const look of results) if (!look.archived) lookIdsByPerson.get(look.personId).push(look.id);
  const people = seededPeople.map(({ id, name, summary }) => ({ id, name, summary, lookIds: lookIdsByPerson.get(id) }))
    .filter((person) => person.lookIds.length >= LOOKS_PER_PERSON);
  const manifest = path.join(dataDir, 'outfit-lookbook.json');
  const identifiers = new Set([...starterItems, ...state.items, ...curated, ...results].map((entry) => entry.id));
  for (const outfit of results) for (const piece of outfit.items) identifiers.add(piece.libraryId);
  const lookbook = [];
  for (const look of existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : []) {
    if (!validPhotoOutfit(look) || !secureUrl(look.source.imageUrl) || identifiers.has(look.id)) continue;
    const imageFile = `${look.id}.jpg`;
    const image = photoFor({ id: look.id, imageFile });
    if (!image) continue;
    const outfit = photoOutfit(look, { ...look.source, imageFile });
    if (outfit.items.some((piece) => identifiers.has(piece.libraryId))) continue;
    identifiers.add(outfit.id);
    for (const piece of outfit.items) identifiers.add(piece.libraryId);
    lookbook.push({ ...outfit, image });
  }
  const referencePieces = new Map([...results, ...lookbook].flatMap((outfit) => outfit.items.map((piece) => [piece.libraryId, { ...piece, id: piece.libraryId, outfitId: outfit.id }])));

  function rebuild() {
    const items = [...state.items.filter(validItem).reverse(), ...starterItems].map((item) => {
      const image = photoFor(item, starters.has(item.id));
      const purchase = state.purchases[item.id] ?? item.initialPurchase ?? null;
      return { ...item, image: image || imageForPiece(item), hasPhoto: Boolean(image),
        purchase: purchase?.status === 'verified' ? purchase : null };
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    const outfits = [
      ...curated.map((outfit) => ({ ...outfit, items: outfit.itemIds.map((id) => byId.get(id)) })),
      ...lookbook,
      ...results,
    ];
    snapshot = { items, outfits, people, favorites: state.favorites, revision: boot + '-' + revision, refresh: state.refresh };
  }

  function commit(next) {
    const temporary = file + '.tmp';
    writeFileSync(temporary, JSON.stringify(next, null, 2));
    renameSync(temporary, file);
    state = next;
    revision++;
    rebuild();
  }

  function find(id) {
    if (!validId(id)) return null;
    const item = snapshot.items.find((entry) => entry.id === id);
    if (item) return { kind: 'item', entry: item };
    const outfit = snapshot.outfits.find((entry) => entry.id === id);
    if (outfit) return { kind: 'outfit', entry: outfit };
    const piece = referencePieces.get(id);
    return piece ? { kind: 'item', entry: piece } : null;
  }

  async function reviewPurchase(item, now) {
    if (!validPurchase(item.purchase)) return null;
    try {
      const status = await checkPurchase(item);
      return { ...item.purchase, status, checkedAt: now };
    } catch {
      return { ...item.purchase, status: 'unknown', checkedAt: now };
    }
  }

  async function checkPurchases(items, purchases, now) {
    const linked = items.filter((item) => validPurchase(item.purchase));
    for (let i = 0; i < linked.length; i += 4) {
      await Promise.all(linked.slice(i, i + 4).map(async (item) => {
        const check = await reviewPurchase(item, now);
        if (check.status !== 'unknown' || !(purchases[item.id] || item.initialPurchase)) purchases[item.id] = check;
      }));
    }
  }

  async function performRefresh() {
    const now = clock();
    const week = refreshWeek(now);
    const baseRefresh = { ...state.refresh, status: 'running', checkedWeek: week, startedAt: now, added: 0, error: undefined };
    commit({ ...state, refresh: baseRefresh });
    const currentItems = [...starterItems, ...state.items];
    const purchases = { ...state.purchases };
    const existingPurchases = checkPurchases(currentItems, purchases, now);
    try {
      const candidates = await discover(currentItems);
      if (!Array.isArray(candidates)) throw new Error('资料来源未返回可检查的条目');
      const added = [];
      const pending = [];
      const identifiers = new Set([...currentItems, ...curated, ...results, ...lookbook, ...referencePieces.values()].map((item) => item.id));
      const signatures = new Set(currentItems.map(fingerprint));
      const remaining = Math.max(0, MAX_WEEKLY_ITEMS - state.items.filter((item) => refreshWeek(item.publishedAt) === week).length);
      for (const candidate of candidates.slice(0, MAX_WEEKLY_CANDIDATES)) {
        if (!validItem(candidate) || !validSource(candidate.source)) {
          if (candidate && hasText(candidate.name)) pending.push({ name: candidate.name, reason: '资料或搭配理由不完整' });
          continue;
        }
        const signature = fingerprint(candidate);
        if (identifiers.has(candidate.id) || signatures.has(signature)) continue;
        if (added.length >= remaining || candidate.uncertain) {
          pending.push({ name: candidate.name, source: candidate.source, reason: candidate.uncertain || '达到本周上新上限' });
          continue;
        }
        let image;
        try { image = await makeImage(candidate); } catch {}
        if (!image) {
          pending.push({ name: candidate.name, source: candidate.source, reason: '图片尚未通过检查' });
          continue;
        }
        identifiers.add(candidate.id);
        signatures.add(signature);
        const item = { ...candidate, imageFile: image, publishedAt: now };
        added.push(item);
        commit({ ...state, items: [...state.items, item], refresh: { ...baseRefresh, added: added.length } });
      }
      await Promise.all([existingPurchases, checkPurchases(added, purchases, now)]);
      commit({ ...state, purchases, candidates: pending,
        refresh: { ...baseRefresh, status: 'done', lastSuccess: clock(), added: added.length } });
    } catch (e) {
      await existingPurchases;
      commit({ ...state, purchases, refresh: { ...state.refresh, status: 'failed', retryAt: clock() + RETRY, error: String(e.message).slice(0, 180) } });
    }
    return state.refresh;
  }

  function refresh() {
    if (!currentJob) currentJob = performRefresh().finally(() => { currentJob = null; });
    return currentJob;
  }

  function tick() {
    const now = clock();
    if (currentJob) return currentJob;
    if (state.refresh.checkedWeek !== refreshWeek(now) || (state.refresh.status === 'failed' && now >= state.refresh.retryAt)) return refresh();
    return Promise.resolve(state.refresh);
  }

  rebuild();
  return {
    get: () => snapshot, find, refresh, tick,
    async favorite(id, favorite) {
      if (!find(id) || typeof favorite !== 'boolean') throw new Error('无效的素材收藏请求');
      const favorites = new Set(state.favorites);
      if (favorite) favorites.add(id); else favorites.delete(id);
      commit({ ...state, favorites: [...favorites] });
      return [...favorites];
    },
  };
}
