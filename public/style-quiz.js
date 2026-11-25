import { STYLE_OPTIONS, STYLE_QUIZ_COLUMNS, STYLE_QUIZ_ROWS } from './style-questions.js';

export const STYLE_QUIZ_HREF = '#/mine?v=style';
export const styleQuizBack = (query) => query.get('from') === 'home' ? '#/home' : '#/mine?v=prefs';

function picture(tile) {
  const x = (tile % STYLE_QUIZ_COLUMNS) * 100 / (STYLE_QUIZ_COLUMNS - 1);
  const y = Math.floor(tile / STYLE_QUIZ_COLUMNS) * 100 / (STYLE_QUIZ_ROWS - 1);
  return `<span class="quiz-photo" style="background-position:${x}% ${y}%" aria-hidden="true"></span>`;
}

export function renderStyleQuiz(quiz, back) {
  const canSave = quiz.choices.length > 0 || quiz.hadChoices;
  const saveLabel = quiz.hadChoices && !quiz.choices.length ? '清除风格偏好' : '保存偏好';
  return `<section class="style-quiz" aria-labelledby="style-quiz-title">
    <a class="linkish" href="${back}">← ${back === '#/home' ? '首页' : '推荐偏好'}</a>
    <div class="quiz-title">
      <h1 id="style-quiz-title">你想试试哪些风格？</h1>
      <p id="style-quiz-hint">点选你想穿的风格，可以多选。</p>
    </div>
    <div class="quiz-grid" role="group" aria-labelledby="style-quiz-title" aria-describedby="style-quiz-hint">
      ${STYLE_OPTIONS.map((option) => {
        const on = quiz.choices.includes(option.id);
        return `<button type="button" class="quiz-option" aria-pressed="${on}" data-act="styleQuizChoose" data-id="${option.id}" ${quiz.saving ? 'disabled' : ''}>
          ${picture(option.tile)}<span class="quiz-label">${option.label}</span><span class="quiz-check" aria-hidden="true">✓</span>
        </button>`;
      }).join('')}
    </div>
    <div class="quiz-actions">
      ${quiz.hadChoices ? '' : `<button class="btn ghost sm" data-act="styleQuizSkip" ${quiz.saving ? 'disabled' : ''}>跳过</button>`}
      <button class="btn primary sm" data-act="styleQuizSave" ${canSave && !quiz.saving ? '' : 'disabled'}>${quiz.saving ? '保存中…' : saveLabel}</button>
    </div>
  </section>`;
}
