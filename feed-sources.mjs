// 中文实穿优先。日本男刊只取搭配栏目和真人私服；保留少量有实穿价值的品牌造型图。
const styling = /穿搭|叠搭|叠穿|搭配|配色|版型|穿法|穿衣|衣橱|剪裁|廓形/i;
const offTopic = /女[装生]|美妆|护肤|香水|开店|开幕|财报|换帅|抽奖|带货|必买|购物清单|断货|出圈|Jennie/i;

export const SOURCES = [
  {
    source: 'NOWRE 穿搭学堂', url: 'https://nowre.com/topic/style/feed/', format: 'article', local: true,
    include: styling, exclude: offTopic, maxDays: 180,
  },
  {
    source: 'NOWRE 男装造型', url: 'https://nowre.com/?feed=rss2&s=%E7%94%B7%E8%A3%85%20%E7%A9%BF%E6%90%AD', format: 'gallery', local: true,
    include: /男装造型|造型特辑|造型图集|Lookbook/i, exclude: offTopic, maxDays: 45,
  },
  {
    source: 'MEN’S NON-NO', url: 'https://www.mensnonno.jp/fashion/how-to-wear/feed/', format: 'article',
    exclude: /買うべき|発売日|新作ニュース/, maxDays: 90,
  },
  {
    source: 'MEN’S NON-NO', url: 'https://www.mensnonno.jp/modelsnap/feed/', format: 'gallery', maxDays: 180,
  },
  {
    source: 'HOUYHNHNM', url: 'https://www.houyhnhnm.jp/snap/feed/', format: 'gallery', maxDays: 365,
    include: /SNAP/i,
  },
  { source: '哔哩哔哩', format: 'video', local: true, topics: ['比例 裤长', '配色', '通勤', '一衣多穿', '基础款', '叠穿'] },
];

// 可跨期复习的公开教程。搜索结果不足时，仍从原视频页确认可用性与发布日期。
export const VIDEO_RESERVE = ['BV1JbrbBHE2p', 'BV1kS26BPEmF', 'BV1aE2qYEEz6', 'BV1F7Mk63EDj', 'BV17eh46XEqL', 'BV1Tjk4YKExN'];
