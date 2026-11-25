export const BODY_CONTROLS = [
  { key: 'fullness', label: '整体胖瘦', ends: ['更瘦', '更宽厚'], limit: 5 },
  { key: 'height', label: '身高', ends: ['更矮', '更高'], limit: 10 },
  { key: 'shoulders', label: '肩宽', ends: ['更窄', '更宽'], limit: 5 },
  { key: 'waist', label: '腰腹', ends: ['更收', '更饱满'], limit: 5 },
];

export const emptyBodyShape = () => Object.fromEntries(BODY_CONTROLS.map(({ key }) => [key, 0]));
export const isModeledBody = (photo) => photo?.kind === 'photo' && photo.source === 'avatar' &&
  (photo.id === 'avatarbody' || Boolean(photo.bodyEditId));
export const isBodyBase = (photo) => photo?.kind === 'photo' &&
  (photo.id === 'avatarbody' || Boolean(photo.bodyEditId) || (photo.source === 'real' && photo.slot === 'body_front' && photo.quality !== 'poor'));
export const usableBodySide = (photo) => photo?.source === 'real' && photo.slot === 'body_side' && ['good', 'partial'].includes(photo.quality);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const smooth = (u) => { const t = clamp(u, 0, 1); return t * t * (3 - 2 * t); };
const area = (u, center, radius) => smooth(1 - Math.abs(u - center) / radius);

export function bodyPhotoBounds(data, width, height, clean = false) {
  const labels = new Int32Array(width * height);
  const queue = new Int32Array(labels.length);
  let component = 0, largest = 0, largestCount = 0, bounds = null;
  let tail;
  function enqueue(pixel) {
    if (labels[pixel] || data[pixel * 4 + 3] <= 32) return;
    labels[pixel] = component;
    queue[tail++] = pixel;
  }
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] || data[start * 4 + 3] <= 32) continue;
    component++;
    tail = 0;
    enqueue(start);
    let left = width, top = height, right = -1, bottom = -1;
    for (let head = 0; head < tail; head++) {
      const pixel = queue[head], x = pixel % width, y = Math.floor(pixel / width);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      if (x > 0) enqueue(pixel - 1);
      if (x < width - 1) enqueue(pixel + 1);
      if (y > 0) enqueue(pixel - width);
      if (y < height - 1) enqueue(pixel + width);
    }
    if (tail > largestCount) {
      largestCount = tail;
      largest = component;
      bounds = { x: left, y: top, width: right - left + 1, height: bottom - top + 1, cropped: top <= 1 || bottom >= height - 2 };
    }
  }
  if (clean && bounds) for (let pixel = 0; pixel < labels.length; pixel++) {
    if (labels[pixel] === largest || data[pixel * 4 + 3] === 0) continue;
    const x = pixel % width;
    if (labels[pixel - width] === largest || labels[pixel + width] === largest ||
        (x > 0 && labels[pixel - 1] === largest) || (x < width - 1 && labels[pixel + 1] === largest)) continue;
    data[pixel * 4 + 3] = 0;
  }
  return bounds;
}

export function bodyRowTransform(row, height, values, { shoulder = 0.25, waist = 0.45 } = {}) {
  const u = row / height;
  const head = Math.max(0.12, shoulder - 0.09);
  const bodyWeight = smooth((u - head) / 0.10);
  const shoulderEffect = values.shoulders * 0.027 * area(u, shoulder, 0.13);
  const waistEffect = values.waist * 0.032 * area(u, waist, 0.19);
  const widthScale = 1 + bodyWeight * (values.fullness * 0.038 + shoulderEffect + waistEffect);
  const lift = values.height * height * 0.0058;
  const y = (at) => at - lift * Math.min(1, (height - at) / (height * (1 - head)));
  return { widthScale, top: y(row), bottom: y(row + 1) };
}

export function makeBodyCutout(image, landmarks) {
  const w = image.naturalWidth, h = image.naturalHeight;
  const source = document.createElement('canvas');
  source.width = w;
  source.height = h;
  const ctx = source.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, w, h);
  const bounds = bodyPhotoBounds(pixels.data, w, h, true);
  if (!bounds || bounds.height < h * 0.25) throw new Error('照片里没有提取到清晰的人像');
  ctx.putImageData(pixels, 0, 0);
  const layer = () => Object.assign(document.createElement('canvas'), { width: bounds.width, height: bounds.height });
  const portrait = layer(), mask = layer(), outline = layer();
  portrait.getContext('2d').drawImage(source, -bounds.x, -bounds.y);
  const maskCtx = mask.getContext('2d');
  maskCtx.drawImage(portrait, 0, 0);
  maskCtx.globalCompositeOperation = 'source-in';
  maskCtx.fillStyle = '#fff';
  maskCtx.fillRect(0, 0, bounds.width, bounds.height);

  const outlineCtx = outline.getContext('2d');
  const crop = portrait.getContext('2d').getImageData(0, 0, bounds.width, bounds.height).data;
  const edge = outlineCtx.createImageData(bounds.width, bounds.height);
  const alpha = (x, y) => (x >= 0 && x < bounds.width && y >= 0 && y < bounds.height) ? crop[(y * bounds.width + x) * 4 + 3] : 0;
  for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) {
    if (alpha(x, y) <= 40 || Math.min(alpha(x-3, y), alpha(x+3, y), alpha(x, y-3), alpha(x, y+3)) > 40) continue;
    const i = (y * bounds.width + x) * 4;
    edge.data.set([77, 58, 41, 165], i);
  }
  outlineCtx.putImageData(edge, 0, 0);

  const relative = (value, fallback) => Number.isFinite(value) ? (value * h - bounds.y) / bounds.height : fallback;
  const shoulder = clamp(relative(landmarks?.shoulder, bounds.cropped ? 0.31 : 0.25), 0.19, 0.43);
  const hip = relative(landmarks?.hip, bounds.cropped ? 0.72 : 0.52);
  const waist = clamp(shoulder + (hip - shoulder) * 0.7, shoulder + 0.09, 0.77);
  return { portrait, mask, outline, width: bounds.width, height: bounds.height, cropped: bounds.cropped, landmarks: { shoulder, waist } };
}

export function drawBodyMask(destination, cutout, values, x, floor, scale, color) {
  const { mask, width, height, landmarks } = cutout;
  if (!cutout.drawing) {
    cutout.drawing = Object.assign(document.createElement('canvas'), { width: Math.ceil(width * 1.55), height: Math.ceil(height * 1.14) });
  }
  const layer = cutout.drawing, ctx = layer.getContext('2d');
  const center = layer.width / 2, padding = layer.height - height;
  ctx.clearRect(0, 0, layer.width, layer.height);
  ctx.globalCompositeOperation = 'source-over';
  if (Object.values(values).every((value) => value === 0)) {
    ctx.drawImage(mask, Math.floor(center - width / 2), padding);
  } else {
    for (let y = 0; y < height; y++) {
      const { widthScale, top, bottom } = bodyRowTransform(y, height, values, landmarks);
      const targetWidth = width * widthScale;
      ctx.drawImage(mask, 0, y, width, 1, center - targetWidth / 2, padding + top, targetWidth, (bottom - top) + 0.15);
    }
  }
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, layer.width, layer.height);
  destination.drawImage(layer, x - (Math.floor(center - width / 2) + width / 2) * scale, floor - layer.height * scale,
    layer.width * scale, layer.height * scale);
}
