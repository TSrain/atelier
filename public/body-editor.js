import { $, S, api, esc, img, toast } from './state.js';
import { BODY_CONTROLS, drawBodyMask, emptyBodyShape, isModeledBody, makeBodyCutout } from './body-shape.js';

const busy = (edit) => ['queued', 'running'].includes(edit?.status);
const ready = (edit) => edit?.status === 'done';
const valueLabel = ({ key, ends }, value, height) => {
  if (key === 'height' && height) return `${height + value} cm${value ? `（${value > 0 ? '+' : '−'}${Math.abs(value)}）` : ''}`;
  return value ? `${ends[value > 0 ? 1 : 0]} ${Math.abs(value)} 档` : '建模原图';
};
const slider = ({ key, label, ends, limit }, values, height) => `<div class="shape-setting">
    <div class="shape-line"><label for="shape-${key}">${label}</label><output for="shape-${key}" data-value="${key}">${valueLabel({ key, ends }, values[key], height)}</output></div>
    <input type="range" id="shape-${key}" data-shape-range="${key}" value="${values[key]}" min="${-limit}" max="${limit}">
    <div class="shape-ends"><span>${ends[0]}</span><span>建模原图</span><span>${ends[1]}</span></div>
  </div>`;

export function createBodyEditor(dialog, { applyOnce, saveDefault, restoreDefault }) {
  let state;
  let observer;
  let opener;
  const used = new Set();
  const cutoutRequests = new Map();
  const body = $('.shape-body', dialog);
  const footer = $('.shape-footer', dialog);
  const status = $('.shape-status', dialog);
  const title = $('#bodyEditorTitle', dialog);

  function paint() {
    const canvas = $('canvas', body);
    if (!state || !canvas) return;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, pixelWidth / dpr, pixelHeight / dpr);
    const cutout = state.cutout;
    if (!cutout) return;
    const scale = Math.min((height - 25) / (cutout.height * 1.09), (width * 0.46) / (cutout.width * 1.32));
    const floor = height - 12;
    const left = width * 0.25, right = width * 0.75;
    const personWidth = cutout.width * scale;
    const personHeight = cutout.height * scale;
    ctx.strokeStyle = '#d7c9b6';
    ctx.beginPath();
    for (const level of [0, 0.25, 0.5, 0.75, 1]) {
      const y = floor - level * personHeight;
      ctx.moveTo(8, y);
      ctx.lineTo(width - 8, y);
    }
    ctx.stroke();
    ctx.strokeStyle = '#dfd3c3';
    ctx.beginPath();
    ctx.moveTo(width / 2, 8);
    ctx.lineTo(width / 2, floor + 4);
    ctx.stroke();

    ctx.drawImage(cutout.portrait, left - personWidth / 2, floor - personHeight, personWidth, personHeight);
    drawBodyMask(ctx, cutout, state.values, right, floor, scale, '#9d7955');
    if (state.outline && Object.values(state.values).some(Boolean)) {
      ctx.drawImage(cutout.outline, right - personWidth / 2, floor - personHeight, personWidth, personHeight);
    }
  }

  function exportContour() {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 540;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 480, 540);
    const cutout = state.cutout;
    const scale = Math.min(420 / cutout.height, 275 / cutout.width);
    drawBodyMask(ctx, cutout, state.values, 240, 492, scale, '#202020');
    return canvas.toDataURL('image/png').split(',')[1];
  }

  function updateControls() {
    const locked = busy(state.edit) || state.sending;
    const cutout = state.cutout;
    for (const spec of BODY_CONTROLS) {
      const input = $(`[data-shape-range="${spec.key}"]`, body);
      if (!input) continue;
      const cropped = spec.key === 'height' && cutout?.cropped;
      const label = cropped ? '需完整全身照' : valueLabel(spec, state.values[spec.key], state.height);
      $(`[data-value="${spec.key}"]`, body).value = label;
      input.setAttribute('aria-valuetext', label);
      input.disabled = locked || !cutout || Boolean(cropped);
    }
    const hasChanges = Object.values(state.values).some(Boolean);
    for (const button of dialog.querySelectorAll('[data-shape-action="generate"], [data-shape-action="reset"]')) button.disabled = !cutout || !hasChanges || locked;
    const restore = $('[data-shape-action="restore"]', dialog);
    if (restore) restore.disabled = locked;
  }

  function updatePreview() {
    const preview = $('.shape-preview', body);
    if (!preview) return;
    const cutout = state.cutout;
    const message = state.cutoutError;
    const image = $('.shape-comparison', preview);
    const placeholder = $('.shape-placeholder', preview);
    image.hidden = !cutout;
    placeholder.hidden = Boolean(cutout);
    $('.shape-placeholder-text', placeholder).textContent = message || '正在从建模全身照提取轮廓…';
    $('[data-shape-action="retry"]', placeholder).hidden = !message;
    $('.shape-source-note', preview).hidden = !cutout?.cropped;
    paint();
    updateControls();
  }

  function loadCutout(current) {
    const photo = current.base;
    if (!photo) return;
    current.cutoutError = '';
    updatePreview();
    const key = img(photo.id);
    if (!cutoutRequests.has(key)) {
      cutoutRequests.set(key, api('GET', `/api/body-cutout?id=${encodeURIComponent(photo.id)}`).then(async ({ image, landmarks }) => {
        const cutout = new Image();
        cutout.src = image;
        await cutout.decode();
        return makeBodyCutout(cutout, landmarks);
      }).catch((error) => { cutoutRequests.delete(key); throw error; }));
    }
    cutoutRequests.get(key).then((cutout) => {
      current.cutout = cutout;
      if (cutout.cropped) {
        current.values.height = 0;
        const input = $('#shape-height', body);
        if (state === current && input) input.value = 0;
      }
    }).catch((error) => { current.cutoutError = error.message; }).finally(() => {
      if (state === current && dialog.open) updatePreview();
    });
  }

  function render() {
    observer?.disconnect();
    title.textContent = '调整身形';
    footer.hidden = false;
    const photo = state.edit && S.db.photos.find((p) => p.id === state.edit.photoId);
    if (ready(state.edit) && photo) {
      title.textContent = '确认基础形象';
      const before = S.db.photos.find((p) => p.id === state.edit.baseId);
      const summary = BODY_CONTROLS.filter(({ key }) => state.edit.values[key]).map((spec) =>
        `${spec.label} ${valueLabel(spec, state.edit.values[spec.key], state.edit.height)}`).join(' · ');
      const pic = (p, label) => p ? `<img src="${esc(img(p.id))}" alt="${label}">` : '<div class="shape-missing">原底图已删除</div>';
      body.innerHTML = `<div class="shape-results"><figure>${pic(before, '调整前的全身照')}<figcaption>调整前</figcaption></figure>
        <figure>${pic(photo, '调整后的全身预览')}<figcaption>真人预览</figcaption></figure></div><p class="shape-summary">${esc(summary)}</p>`;
      status.textContent = '确认身形与本人特征后再使用。';
      footer.innerHTML = `<button class="btn ghost sm" type="button" data-shape-action="edit">继续微调</button>
        ${state.from === 'studio' ? '<button class="btn ghost sm" type="button" data-shape-action="once">仅用于本次试穿</button>' : ''}
        <button class="btn primary sm" type="button" data-shape-action="default">设为默认形象</button>`;
      return;
    }

    if (!state.base) {
      body.innerHTML = '<div class="shape-empty"><h3>先生成建模全身照</h3><p>建模完成后，可以在这里调整它的轮廓。</p><a class="btn primary sm" href="#/mine?v=materials" data-shape-action="materials">照片与建模</a></div>';
      if (state.from === 'mine' && S.db.bodyBaseHistory?.length) footer.innerHTML = '<button class="btn ghost sm" type="button" data-shape-action="restore">切回上一版</button>';
      else footer.hidden = true;
      return;
    }

    body.innerHTML = `<div class="shape-grid">
      <section class="shape-preview" aria-label="实时身形预览">
        <div class="shape-placeholder" role="status"><span class="shape-placeholder-text"></span><button class="linkish" type="button" data-shape-action="retry" hidden>重试</button></div>
        <div class="shape-comparison" hidden>
          <div class="shape-comparison-labels"><span>建模抠图</span><span>调整轮廓</span></div>
          <canvas role="img" aria-label="左边是建模全身照的抠图，右边是同一比例尺下可调整的轮廓"></canvas>
          <div class="shape-line shape-legend"><span>同一比例 · 下沿对齐</span><label><input type="checkbox" data-shape-outline ${state.outline ? 'checked' : ''}> 叠加原轮廓</label></div>
        </div>
        <p class="shape-source-note" hidden>建模图没有完整拍到脚。要调整身高，请先<a href="#/mine?v=materials" data-shape-action="materials">更新建模全身照</a>。</p>
      </section>
      <section class="shape-controls" aria-label="身形滑杆">
        ${BODY_CONTROLS.slice(0, 2).map((spec) => slider(spec, state.values, state.height)).join('')}
        <details ${state.details ? 'open' : ''}><summary>局部微调</summary>${BODY_CONTROLS.slice(2).map((spec) => slider(spec, state.values, state.height)).join('')}</details>
        <button class="linkish" type="button" data-shape-action="reset">恢复建模轮廓</button>
      </section></div>`;
    footer.innerHTML = `${S.db.bodyBaseHistory?.length && state.from === 'mine' ?
      '<button class="btn ghost sm" type="button" data-shape-action="restore">切回上一版</button>' : ''}
      <button class="btn primary sm" type="button" data-shape-action="generate">生成真人预览</button>`;
    $('.shape-controls details', body).addEventListener('toggle', (event) => { state.details = event.target.open; });
    const canvas = $('canvas', body);
    observer = new ResizeObserver(paint);
    observer.observe(canvas);
    updatePreview();
  }

  function sync() {
    if (!dialog.open || !state.base) return;
    const next = state.edit && S.db.bodyEdits?.find((edit) => edit.id === state.edit.id);
    if (next && next.status !== state.edit.status) {
      state.edit = next;
      if (ready(next)) render();
      else updateControls();
    }
    const message = state.sending ? '正在提交…' :
      state.edit?.status === 'queued' ? '真人预览已排队，你可以先继续挑衣服。' :
      state.edit?.status === 'running' ? '正在生成真人预览，你可以先继续挑衣服。' :
      state.edit?.status === 'failed' ? `生成失败：${state.edit.error || '请重试'}` :
      ready(state.edit) ? '确认身形与本人特征后再使用。' : '确认真人预览后，可用于试穿或设为默认。';
    if (status.textContent !== message) status.textContent = message;
    status.classList.toggle('error', state.edit?.status === 'failed');
    return next;
  }

  function open(from, base, button, editId) {
    if (dialog.open) return;
    const active = S.db.bodyEdits?.find(busy);
    const requested = editId && S.db.bodyEdits?.find((edit) => edit.id === editId && ready(edit));
    const latest = requested || active || S.db.bodyEdits?.find((edit) => edit.baseId === base?.id &&
      edit.baseCreatedAt === base?.createdAt && !edit.adoptedAt && !edit.referenceId && !used.has(edit.id));
    const previousBase = latest && S.db.photos.find((photo) => photo.id === latest.baseId);
    const source = isModeledBody(previousBase) ? previousBase : isModeledBody(base) ? base : null;
    const prior = source?.bodyEditId && S.db.bodyEdits?.find((edit) => edit.id === source.bodyEditId);
    const rawHeight = prior?.height ? prior.height + prior.values.height : Number(S.db.profile.height);
    const sameDraft = state?.base?.id === source?.id && state?.base?.createdAt === source?.createdAt && !state?.edit && !latest;
    const current = state = {
      from, base: source, cutout: null, cutoutError: '',
      values: latest ? { ...latest.values } : sameDraft ? state.values : emptyBodyShape(),
      height: rawHeight >= 100 && rawHeight <= 250 ? rawHeight : null, edit: latest, outline: true,
      details: Boolean(latest?.values.shoulders || latest?.values.waist || (sameDraft && state.details)),
    };
    opener = button;
    status.textContent = '';
    dialog.showModal();
    render();
    sync();
    if (!ready(latest)) loadCutout(current);
  }

  async function generate(button) {
    if (state.sending || busy(state.edit) || !state.cutout) return;
    state.sending = true;
    updateControls();
    sync();
    try {
      state.edit = await api('POST', '/api/body-edits', {
        baseId: state.base.id, baseCreatedAt: state.base.createdAt, entry: state.from, values: state.values, contour: exportContour(),
      });
    } catch (error) {
      state.edit = { status: 'failed', error: error.message };
    } finally {
      state.sending = false;
      updateControls();
      sync();
      if (!button.disabled && dialog.open) button.focus({ preventScroll: true });
    }
  }

  dialog.addEventListener('input', ({ target }) => {
    if (target.matches('[data-shape-outline]')) { state.outline = target.checked; paint(); }
    if (!target.matches('[data-shape-range]')) return;
    state.values[target.dataset.shapeRange] = target.valueAsNumber;
    updateControls();
    paint();
  });

  dialog.addEventListener('click', async ({ target }) => {
    const button = target.closest('[data-shape-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.shapeAction;
    if (action === 'close' || action === 'materials') { if (!state.sending) dialog.close(); return; }
    if (action === 'retry') { loadCutout(state); return; }
    if (action === 'generate') { await generate(button); return; }
    if (action === 'reset') {
      state.values = emptyBodyShape();
      for (const input of body.querySelectorAll('[data-shape-range]')) input.value = 0;
      updateControls();
      paint();
      return;
    }
    if (action === 'edit') {
      used.add(state.edit.id);
      state.edit = null;
      render();
      sync();
      if (!state.cutout) loadCutout(state);
      return;
    }
    if (action === 'once') {
      used.add(state.edit.id);
      dialog.close();
      applyOnce(state.edit.photoId);
      return;
    }
    button.disabled = true;
    try {
      if (action === 'default') await saveDefault(state.edit.id);
      if (action === 'restore') await restoreDefault();
      dialog.close();
    } catch (error) {
      button.disabled = false;
      status.classList.add('error');
      status.textContent = error.message;
      toast(error.message);
    }
  });
  dialog.addEventListener('cancel', (event) => { if (state.sending) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    observer?.disconnect();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  });
  return { open, sync, close: () => { if (dialog.open && !state.sending) dialog.close(); } };
}
