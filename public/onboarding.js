import { esc, img } from './state.js';

const checkLabels = { node: 'Node.js 24+', ffmpeg: 'FFmpeg', codex: 'Codex CLI', login: 'Codex 登录' };

export function renderOnboarding(setup, client, classifyJob) {
  const environmentReady = client.check && Object.values(client.check).every(Boolean);
  const checks = client.check && Object.entries(checkLabels).map(([key, name]) =>
    `<li><span aria-hidden="true">${client.check[key] ? '✓' : '○'}</span> ${name}${client.check[key] ? '' : '待配置'}</li>`).join('');
  const error = client.error || setup.error || (classifyJob?.status === 'failed' && classifyJob.error);
  const busy = client.busy ? ' disabled' : '';
  let content;
  if (setup.stage === 'building') {
    content = `<div class="setup-wait" role="status"><i class="pulse" aria-hidden="true"></i><h2>正在生成你的建模形象</h2><p>先分析照片，再生成全身标准照。你可以离开这页，回来后会从当前进度继续。</p></div>`;
  } else if (setup.stage === 'preview') {
    content = `<div class="setup-preview">
      <img src="${img(setup.body.id)}?v=${setup.body.createdAt || 0}" alt="生成的全身建模形象">
      <div><h2>确认你的建模形象</h2><p>看看脸和身形是否接近你。这张标准照会作为试衣间的默认底图。</p>
        <div class="setup-actions"><button class="btn primary" data-act="setupConfirm"${busy}>确认并进入试衣间</button>
        <button class="btn ghost" data-act="setupBuild"${busy}>重新生成</button></div></div></div>`;
  } else {
    const slots = setup.slots.map((slot, index) => {
      const text = { missing: '待上传', checking: '正在检查', replace: '请换一张', ready: '已通过' }[slot.status];
      return `<div class="setup-slot">
        <div class="setup-slot-picture setup-slot-picture-${index}">
          ${slot.photo ? `<img src="${img(slot.photo.id, 1)}" alt="你上传的${slot.title}">` : '<span>拍摄示意</span>'}
        </div>
        <div class="setup-slot-details"><p class="setup-slot-status" data-status="${slot.status}">${text}</p><h2>${slot.title}</h2>
        <p>${slot.status === 'replace' && slot.photo.issue ? esc(slot.photo.issue) : slot.tip}</p>
        <button class="btn ghost sm" data-act="setupPick" data-slot="${slot.key}"${client.busy || !environmentReady ? ' disabled' : ''}>${slot.photo ? '更换照片' : '选择照片'}<span class="setup-sr">（${slot.title}）</span></button></div>
      </div>`;
    }).join('');
    content = `<div class="setup-check">
        ${checks ? `<ul aria-label="环境检查">${checks}</ul>` : `<p>${client.checking ? '正在检查本机依赖…' : '检查本机依赖后可以上传照片。'}</p>`}
        ${!environmentReady ? `<button class="btn ghost sm" data-act="setupCheck"${client.checking || client.busy ? ' disabled' : ''}>重新检测</button>` : ''}
        ${client.check && !environmentReady ? '<p>安装缺失项。Codex 未登录时，在终端运行 <code>codex login</code>，完成后重新检测。</p>' : ''}
      </div>
      <p class="setup-privacy">照片和结果保存在这台电脑。检查照片、建模和试穿时，所需的图像与形象信息会通过你配置的 Codex 服务处理。</p>
      <div class="setup-slots">${slots}</div>
      <div class="setup-actions">
        <button class="btn primary" data-act="setupBuild"${!setup.canBuild || !environmentReady || client.busy ? ' disabled' : ''}>生成建模形象</button>
        ${classifyJob?.status === 'failed' ? `<button class="btn ghost" data-act="setupClassify"${busy}>重试照片检查</button>` : ''}
        <span role="status">${client.busy ? '正在保存…' : '三张照片通过检查后即可建模'}</span>
      </div>`;
  }
  return `<section class="setup" aria-labelledby="setup-title">
    <header class="setup-intro"><p>首次设置</p><h1 id="setup-title">先建立你的建模形象</h1>
    <p>准备三张本人照片。建模完成后，你就可以用自己的形象反复试穿。</p></header>
    ${error ? `<p class="setup-error" role="alert">${esc(error)}</p>` : ''}
    ${content}
  </section>`;
}
