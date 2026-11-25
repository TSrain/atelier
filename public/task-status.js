const pending = (task) => task?.status === 'queued' || task?.status === 'running';
const materials = '#/mine?v=materials';
const profile = '#/mine?v=profile';
const studio = '#/studio';

function progressText(db) {
  const tries = db.looks.filter(pending).length;
  if (db.classifyJob?.status === 'running') return '正在识别新照片';
  if (db.analysisJob?.status === 'running') return '正在做风格分析';
  if (tries) return `${tries} 张试穿生成中`;
  if (db.bodyEdits?.some(pending)) return '正在生成身形预览';
  if (db.outfits.some((outfit) => outfit.status === 'drafting')) return '造型师正在搭配';
  if (db.hairJob?.status === 'running') return '正在设计新发型';
  if (db.jobs.some(pending)) return '正在绘制预览图';
  if (Object.values(db.sheets || {}).some(pending)) return '正在绘制参考图';
  return '';
}

function completedResults(db) {
  const results = new Map();
  const add = (key, version, group, text, href) => results.set(key, { key, version, group, text, href });

  for (const look of db.looks) {
    if (look.status === 'done') {
      const key = `look:${look.id}`;
      add(key, look.finishedAt, key, '试穿已生成', `${studio}?look=${encodeURIComponent(look.id)}`);
    }
  }
  for (const edit of db.bodyEdits || []) {
    if (edit.status !== 'done' || edit.adoptedAt) continue;
    const key = `shape:${edit.id}`;
    const href = edit.entry === 'studio' ? `${studio}?shape=${edit.id}` : `${materials}&shape=${edit.id}`;
    add(key, edit.finishedAt, 'shape', '身形预览已生成', href);
  }
  if (db.analysisJob?.status === 'done') add('analysis', db.analysis?.ver, 'analysis', '风格分析已完成', profile);
  for (const photo of db.photos) {
    if (photo.source === 'real' && photo.kind === 'photo' && photo.slot) add(`photo:${photo.id}`, photo.slot, 'photos', '照片识别已完成', materials);
  }
  for (const [key, sheet] of Object.entries(db.sheets || {})) {
    if (sheet.status !== 'done') continue;
    if (key.startsWith('avatar')) add(`sheet:${key}`, sheet.finishedAt, 'avatars', '建模照片已更新', materials);
    else add(`sheet:${key}`, sheet.finishedAt, 'sheets', '参考图已绘制', profile);
  }
  for (const hair of db.hairs) {
    if (hair.art === 'done' && !hair.disliked) add(`hair:${hair.id}`, hair.imageAt, 'hair', '发型预览已更新', studio);
  }
  const daily = new Set(db.daily?.outfitIds);
  for (const outfit of db.outfits) {
    if (outfit.art !== 'done' || outfit.disliked) continue;
    if (daily.has(outfit.id)) add(`outfit:${outfit.id}`, outfit.imageAt, 'daily', '今日穿搭预览已更新', '#/home');
    else add(`outfit:${outfit.id}`, outfit.imageAt, 'outfit', '穿搭预览已更新', studio);
  }
  return results;
}

export function createTaskStatus() {
  let previous;
  let notices = new Map();
  return {
    update(db) {
      const current = completedResults(db);
      const recent = new Map();
      // 首次加载以已有结果为基准，之后只提示新完成的任务。
      if (previous) {
        for (const [group, notice] of notices) {
          const result = current.get(notice.key);
          if (!result || result.group !== group) notices.delete(group);
        }
        for (const [key, result] of current) {
          if (!previous.has(key) || previous.get(key).version !== result.version) {
            recent.set(result.group, result);
            notices.delete(result.group);
          }
        }
      }
      previous = current;
      if (recent.size) notices = new Map([...recent, ...notices]);
      return { progress: progressText(db), completion: notices.values().next().value, newCompletion: recent.values().next().value };
    },
    dismiss() { notices.delete(notices.keys().next().value); },
  };
}
