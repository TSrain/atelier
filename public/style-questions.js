export const STYLE_QUIZ_VERSION = 3;
export const STYLE_QUIZ_COLUMNS = 3;
export const STYLE_QUIZ_ROWS = 3;
export const STYLE_OPTIONS = [
  { id: 'style-old-money', label: '老钱风', tile: 0 },
  { id: 'style-preppy', label: '学院风', tile: 1 },
  { id: 'style-minimal', label: '都市极简', tile: 2 },
  { id: 'style-americana', label: '美式复古', tile: 3 },
  { id: 'style-city-boy', label: '日系 City Boy', tile: 4 },
  { id: 'style-sport-street', label: '运动街头', tile: 5 },
  { id: 'style-techwear', label: '科技风', tile: 6 },
  { id: 'style-outdoor', label: '户外风', tile: 7 },
  { id: 'style-workwear', label: '工装风', tile: 8 },
];

const SOURCE = 'style-quiz';
const activeQuizNotes = (notes) => notes.filter((note) => note.source === SOURCE && STYLE_OPTIONS.some((option) => option.id === note.id));
export const styleQuizIds = (notes) => activeQuizNotes(notes).map((note) => note.id);
export const styleQuizText = (notes) => activeQuizNotes(notes).map((note) => note.text);
export const visibleStylePrefs = (notes) => [...activeQuizNotes(notes), ...notes.filter((note) => note.source !== SOURCE)];

export function styleQuizNotes(ids, notes) {
  if (!Array.isArray(ids) || ids.some((id) => !STYLE_OPTIONS.some((option) => option.id === id))) throw new Error('风格选项无效');
  const chosen = new Set(ids);
  return [
    ...STYLE_OPTIONS.filter(({ id }) => chosen.has(id)).map(({ id, label }) => ({ id, text: `想尝试：${label}`, source: SOURCE, auto: false })),
    ...notes.filter((note) => note.source !== SOURCE),
  ];
}
