const CITIES = [
  ['北京', 39.9, 116.4], ['上海', 31.23, 121.47], ['广州', 23.13, 113.26], ['深圳', 22.54, 114.06], ['杭州', 30.27, 120.15],
  ['成都', 30.57, 104.07], ['重庆', 29.56, 106.55], ['南京', 32.06, 118.8], ['武汉', 30.59, 114.31], ['西安', 34.27, 108.95],
  ['天津', 39.13, 117.2], ['苏州', 31.3, 120.58], ['长沙', 28.23, 112.94], ['郑州', 34.75, 113.63], ['青岛', 36.07, 120.38],
  ['厦门', 24.48, 118.09], ['昆明', 25.04, 102.71], ['沈阳', 41.8, 123.43], ['大连', 38.91, 121.61], ['哈尔滨', 45.8, 126.53],
  ['济南', 36.65, 117.12], ['合肥', 31.82, 117.23], ['福州', 26.07, 119.3], ['宁波', 29.87, 121.55], ['无锡', 31.49, 120.31],
  ['南昌', 28.68, 115.86], ['贵阳', 26.65, 106.63], ['南宁', 22.82, 108.37], ['太原', 37.87, 112.55], ['石家庄', 38.04, 114.51],
  ['长春', 43.82, 125.32], ['兰州', 36.06, 103.83], ['乌鲁木齐', 43.83, 87.62], ['呼和浩特', 40.84, 111.75], ['银川', 38.49, 106.23],
  ['西宁', 36.62, 101.78], ['拉萨', 29.65, 91.14], ['海口', 20.04, 110.2], ['三亚', 18.25, 109.51], ['珠海', 22.27, 113.58],
  ['东莞', 23.02, 113.75], ['佛山', 23.02, 113.12], ['香港', 22.32, 114.17], ['澳门', 22.2, 113.55], ['台北', 25.03, 121.57],
];
export const DEFAULT_CITY = { name: '北京', lat: 39.9, lon: 116.4 };
const UA = { 'user-agent': 'AtelierPersonalStylist/1.0 (local personal tool)' };
const getJson = async (url) => {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`天气服务返回 ${res.status}`);
  return res.json();
};

const inChina = (lat, lon) => lat > 17 && lat < 54 && lon > 73 && lon < 136;
export function nearestCity(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inChina(lat, lon)) return null;
  const [name, la, lo] = CITIES.map((c) => [...c, (c[1] - lat) ** 2 + ((c[2] - lon) * Math.cos((lat * Math.PI) / 180)) ** 2]).sort((a, b) => a[3] - b[3])[0];
  return { name, lat: la, lon: lo };
}

export async function findCity(query) {
  const q = String(query || '').trim().replace(/[市区县]$/, '').slice(0, 20);
  if (!q) throw new Error('请输入城市名');
  const local = CITIES.find((c) => c[0] === q);
  if (local) return { name: local[0], lat: local[1], lon: local[2] };
  const search = (name) => getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&language=zh&countryCode=CN&count=5`).then((d) => d.results || []).catch(() => []);
  const rank = (r) => ({ PPLC: 5, PPLA: 4, PPLA2: 3, PPLA3: 2 }[r.feature_code] || 0) * 1e9 + (r.population || 0);
  const hit = (await Promise.all([search(q + '市'), search(q)])).flat().sort((a, b) => rank(b) - rank(a))[0];
  if (!hit) throw new Error(`没有找到「${q}」，目前只支持中国的城市`);
  return { name: hit.name.replace(/市$/, ''), lat: +hit.latitude.toFixed(2), lon: +hit.longitude.toFixed(2) };
}

const CODES = [[0, '晴'], [2, '少云'], [3, '多云'], [48, '雾'], [57, '毛毛雨'], [67, '雨'], [77, '雪'], [82, '阵雨'], [86, '阵雪'], [99, '雷雨']];
const codeText = (code) => (CODES.find(([max]) => code <= max) || [0, '多云'])[1];
const AIR = [[50, '优'], [100, '良'], [150, '轻度污染'], [200, '中度污染'], [300, '重度污染'], [Infinity, '严重污染']];

export function localDate(time = Date.now()) {
  return new Date(time + 8 * 3600_000).toISOString().slice(0, 10);
}
export const localHour = (time = Date.now()) => new Date(time + 8 * 3600_000).getUTCHours();

// 把接口的原始数值归纳成穿搭要用的几个事实，阈值都集中在这里。
export function summarize({ date, city, tmax, tmin, feelMax, feelMin, rainProb, rain, snow, code, wind, pm25, aqi }) {
  const flags = {
    rain: (rainProb >= 55 && rain >= 0.5) || rain >= 3 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95,
    snow: snow >= 0.3 || (code >= 71 && code <= 77) || code === 85 || code === 86,
    haze: aqi >= 150 || pm25 >= 75,
    wind: wind >= 39,
  };
  const feel = (feelMax + feelMin) / 2;
  const season = feel < 9 ? '冬' : feel >= 23 ? '夏' : '春秋';
  const air = aqi == null ? '' : AIR.find(([max]) => aqi <= max)[1];
  const text = `${city} ${codeText(code)}，${Math.round(tmin)}–${Math.round(tmax)}℃，体感 ${Math.round(feelMin)}–${Math.round(feelMax)}℃`
    + (flags.rain ? `，有雨（概率 ${Math.round(rainProb)}%）` : '') + (flags.snow ? '，有雪' : '') + (flags.wind ? '，风大' : '') + (air ? `，空气${air}` : '');
  return { date, city, tmax, tmin, feelMax, feelMin, rainProb, rain, snow, code, wind, pm25, aqi, sky: codeText(code), air, flags, season, text };
}

export async function fetchWeather(city, now = Date.now()) {
  const at = `latitude=${city.lat}&longitude=${city.lon}&timezone=Asia%2FShanghai&forecast_days=1`;
  const [w, air] = await Promise.all([
    getJson(`https://api.open-meteo.com/v1/forecast?${at}&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum,snowfall_sum,weather_code,wind_speed_10m_max`),
    getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${at}&hourly=pm2_5,us_aqi`).catch(() => null),
  ]);
  const d = w.daily, first = (k) => Number(d[k]?.[0] ?? 0);
  const daytime = (k) => { const xs = (air?.hourly?.[k] || []).slice(7, 22).filter((x) => x != null); return xs.length ? Math.max(...xs) : null; };
  return { ...summarize({
    date: d.time?.[0] || localDate(now), city: city.name,
    tmax: first('temperature_2m_max'), tmin: first('temperature_2m_min'), feelMax: first('apparent_temperature_max'), feelMin: first('apparent_temperature_min'),
    rainProb: first('precipitation_probability_max'), rain: first('precipitation_sum'), snow: first('snowfall_sum'), code: first('weather_code'), wind: first('wind_speed_10m_max'),
    pm25: daytime('pm2_5'), aqi: daytime('us_aqi'),
  }), fetchedAt: now };
}

// 旧方案与今天的天气是否「严重不符」：体感差 8 度以上，或今天新出现了雨、雪、霾。
export function mismatch(old, now) {
  if (!old || !now) return '';
  const feel = (w) => (w.feelMax + w.feelMin) / 2;
  const delta = feel(now) - feel(old);
  if (Math.abs(delta) >= 8) return `体感比方案生成那天${delta > 0 ? '高' : '低'}了 ${Math.round(Math.abs(delta))}℃`;
  for (const [k, label] of [['rain', '下雨'], ['snow', '下雪'], ['haze', '有霾']]) if (now.flags[k] && !old.flags?.[k]) return `今天${label}`;
  return '';
}

export function monthSeason(time = Date.now()) {
  const m = new Date(time + 8 * 3600_000).getUTCMonth() + 1;
  return m >= 6 && m <= 8 ? '夏' : m === 12 || m <= 2 ? '冬' : '春秋';
}
export function seasonName(time = Date.now()) {
  const m = new Date(time + 8 * 3600_000).getUTCMonth() + 1;
  return m >= 3 && m <= 5 ? '春季' : m <= 8 && m >= 6 ? '夏季' : m <= 11 && m >= 9 ? '秋季' : '冬季';
}
