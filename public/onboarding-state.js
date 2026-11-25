export const SETUP_SLOTS = [
  { key: 'face', title: '正脸', tip: '平视镜头，光线均匀，五官清晰。', angles: ['face_front', 'natural_light'] },
  { key: 'body', title: '全身正面', tip: '自然站立，从头顶拍到鞋底。', angles: ['body_front'] },
  { key: 'side', title: '侧脸', tip: '头转约 45° 或拍一张正侧脸。', angles: ['face_34', 'side_left', 'side_right'] },
];

export function onboardingState(db) {
  const settings = db.settings?.onboarding;
  const body = db.photos.find((photo) => photo.id === 'avatarbody' && photo.source === 'avatar');
  if (settings?.confirmedAt || (!settings && body)) return { stage: 'ready' };

  const slots = SETUP_SLOTS.map((slot) => {
    const photo = db.photos.findLast((entry) => entry.kind === 'photo' && entry.source === 'real' && entry.setupSlot === slot.key);
    const status = !photo ? 'missing' : !photo.slot ? 'checking'
      : photo.quality === 'poor' || !slot.angles.includes(photo.slot) ? 'replace' : 'ready';
    return { ...slot, photo, status };
  });
  const job = db.sheets?.avatarBody;
  const analysis = db.analysisJob;
  const building = analysis?.status === 'running' || ['queued', 'running'].includes(job?.status);
  const error = job?.status === 'failed' ? job.error : analysis?.status === 'failed' ? analysis.error : '';
  const stage = building ? 'building' : body && job?.status !== 'failed' ? 'preview' : 'photos';
  return { stage, slots, body, error, canBuild: slots.every((slot) => slot.status === 'ready') };
}
