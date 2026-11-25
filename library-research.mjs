import { MAX_WEEKLY_CANDIDATES, secureUrl } from './library.mjs';

const editorialHosts = ['uniqlo.com', 'uniqlo.cn', 'mensnonno.jp', 'gqjapan.jp', 'vogue.com.tw',
  'vogue.com.cn', 'gq.com.tw', 'muji.com', 'cos.com', 'beams.co.jp', 'united-arrows.co.jp',
  'popeyemagazine.jp', 'fudge.jp', 'urban-research.jp'];
const retailHosts = ['uniqlo.com', 'uniqlo.cn', 'muji.com', 'cos.com', 'beams.co.jp', 'united-arrows.co.jp', 'urban-research.jp'];
const hostIs = (hostname, hosts) => hosts.some((host) => hostname === host || hostname.endsWith('.' + host));
const str = { type: 'string' };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items) => ({ type: 'array', items });
export const researchSchema = obj({
  completed: { type: 'boolean' },
  reason: str,
  items: arr(obj({
    id: str, name: str, category: str, season: str, kind: { type: 'string', enum: ['classic', 'seasonal'] },
    color: str, shape: str, why: str, wears: arr(str),
    source: obj({ url: str, title: str, evidence: str }),
    purchase: obj({ url: str, brand: str, sku: str, name: str, color: str, shape: str }),
    uncertain: str,
  })),
});

export const pictureSchema = obj({ approved: { type: 'boolean' }, reason: str });

export function researchPrompt(items, now, profile) {
  const existing = items.map(({ id, name, color, shape }) => ({ id, name, color, shape }));
  return `为这位用户的男装素材库做每周单品筛选。日期 ${new Date(now).toISOString().slice(0, 10)}。
用户档案（仅作挑款判断，联网搜索时只使用公开的服装款式和品牌关键词）：\n${profile}
已有清单（用于去重）：${JSON.stringify(existing)}。
必须使用实时网页搜索，并打开公开的原始品牌型录或编辑部原创专题。来源网站仅可从 ${editorialHosts.join('、')} 中选择。找适合用户身形、用色和偏好，同时适合当季或全年、有区分度、可在日常反复搭配的单品。涵盖外套、上装、下装、鞋履和配饰中的多个品类。最多提供 ${MAX_WEEKLY_CANDIDATES} 条候选，候选不足就少交。已有款式的轻微换色、商品标题变化或面料资料不清楚的只作为存疑候选。购物链接不参与判断。
每件给一个小写英文短横线 ID、短中文名、类目（外套、上装、下装、鞋履、配饰）、季节（四季、春秋、夏、冬）、#rrggbb 主色、明确版型和可知的面料、入选理由、两条以上不同的穿法。kind 给 classic（长期可反复搭配的基础款）或 seasonal（结合当季元素的新选款）。source 的 evidence 是原页面中逐字复制的 6–15 个词或 8–30 个汉字，必须能直接支持款式并可在可见正文找到。source.url 必须是具体原始页面。不要猜测商品图看不清的细节。
最后可选寻找 ${retailHosts.join('、')} 官方具体商品页。只有页面款号、名称、颜色和关键版型与单品吻合、页面显示商品时才填写 purchase，name/color/shape 用该页可核对的原文词组，无法确认则所有 purchase 字段留空。uncertain 留空表示可自动上新，有疑点就注明原因。
已成功检查可访问原始来源则 completed=true，items 可以为空。网页不可用或仅找到缓存摘要、未实际核对原始来源则 completed=false 并用中文简短解释。非网页内容无法支撑入库。`;
}

function normalized(value) {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<img\b[^>]*\balt=["']([^"']*)["'][^>]*>/gi, ' $1 ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|amp|quot|apos|#\d+);/gi, ' ')
    .normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
}

async function publicPage(link, hosts, signal, fetcher = fetch) {
  for (let redirects = 0; redirects < 4; redirects++) {
    if (!secureUrl(link) || !hostIs(new URL(link).hostname, hosts) || new URL(link).port) return { status: 0 };
    const res = await fetcher(link, { redirect: 'manual', signal, headers: {
      'user-agent': 'AtelierPersonalStylist/1.0 (personal clothing references)',
      'accept': 'text/html,application/xhtml+xml',
    } });
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get('location')) {
      link = new URL(res.headers.get('location'), link).href;
      await res.body?.cancel();
      continue;
    }
    if (!res.ok) { await res.body?.cancel(); return { status: res.status }; }
    if (!res.body || !res.headers.get('content-type')?.includes('html')) {
      await res.body?.cancel();
      return { status: 0 };
    }
    const read = res.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let html = '';
    try {
      for (;;) {
        const { done, value } = await read.read();
        if (done) break;
        bytes += value.byteLength;
        html += decoder.decode(value, { stream: true });
        if (bytes > 2_000_000) { await read.cancel(); break; }
      }
    } finally { read.releaseLock(); }
    return { status: res.status, url: link, html: html + decoder.decode() };
  }
  return { status: 0 };
}

export async function verifyCandidates(result) {
  if (!result.completed) throw new Error(result.reason || '暂时无法检查品牌型录和原创专题');
  const pages = new Map();
  const candidates = await Promise.all(result.items.slice(0, MAX_WEEKLY_CANDIDATES).map(async (candidate) => {
    const { url, evidence } = candidate.source;
    if (!pages.has(url)) pages.set(url, publicPage(url, editorialHosts, AbortSignal.timeout(12_000)).catch(() => ({})));
    const page = await pages.get(url);
    const excerpt = normalized(evidence);
    const verified = page.html && excerpt.length >= 8 && normalized(page.html).includes(excerpt);
    return { ...candidate, uncertain: candidate.uncertain || (verified ? '' : '未能在原页核对款式'),
      purchase: candidate.purchase.url ? { ...candidate.purchase, match: 'product' } : undefined };
  }));
  if (candidates.length && pages.size && !(await Promise.all(pages.values())).some((page) => page.html)) {
    throw new Error('未能连接公开资料页，已保留素材库');
  }
  return candidates;
}

export function rankNewItems(candidates, scores) {
  const byIndex = new Map(scores.map(({ index, score }) => [index, score]));
  return candidates.map((candidate, index) => {
    const score = byIndex.get(index + 1);
    return { candidate: { ...candidate, uncertain: candidate.uncertain || (score >= 75 ? '' : '与个人档案的匹配度不足或尚未评分') }, score: score ?? 0 };
  }).sort((a, b) => b.score - a.score).map(({ candidate }) => candidate);
}

const listing = (link) => /^\/?$|\/(?:search|category|collections)(?:\/|\.html|$)/i.test(new URL(link).pathname);

export async function verifyPurchase({ purchase }, fetcher = fetch) {
  if (!purchase?.url || !purchase.sku || !purchase.name || !purchase.color || !purchase.shape) return 'unknown';
  if (!secureUrl(purchase.url) || listing(purchase.url)) return 'unavailable';
  const page = await publicPage(purchase.url, retailHosts, AbortSignal.timeout(10_000), fetcher);
  if ([404, 410].includes(page.status)) return 'unavailable';
  if (!page.html) return 'unknown';
  if (listing(page.url)) return 'unavailable';
  const text = normalized(page.html);
  if (/商品已下架|该商品已售罄|该商品不存在|商品不存在|productnolongeravailable|この商品は販売を終了/.test(text)) return 'unavailable';
  const tokens = [purchase.sku, purchase.name, purchase.color, purchase.shape].map(normalized);
  if (tokens.every((token) => token.length >= 2 && text.includes(token))) return 'verified';
  const productTitle = normalized(page.html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const skuMismatch = /商品(?:编号|id|コード)|product(?:id|number|code)|品番/i.test(text) && !text.includes(tokens[0]);
  const identifiedOtherProduct = text.length >= 80 && productTitle.length >= 10 && !productTitle.includes(tokens[1])
    && !text.includes(tokens[0]) && !text.includes(tokens[1]);
  if (skuMismatch || identifiedOtherProduct) return 'unavailable';
  return 'unknown';
}
