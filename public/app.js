// SUBJECT / COHORT は quiz_play.html が URL から取り出して設定する

let questions = [];
let answers = {};
let order = [];
let mode = 'learn';
let currentIndex = 0;

async function init() {
  const params = new URLSearchParams(location.search);
  mode = params.get('mode') || 'learn';
  currentIndex = parseInt(params.get('i') || '0', 10);

  const res = await fetch(`/api/questions/${encodeURIComponent(SUBJECT)}/${COHORT}`);
  if (res.status === 401) { location.href = '/login'; return; }
  if (!res.ok) { location.href = `/quiz/${encodeURIComponent(SUBJECT)}`; return; }
  questions = await res.json();

  TOTAL = questions.length;

  order = mode === 'exam'
    ? shuffle(questions.map((_, i) => i))
    : questions.map((_, i) => i);

  answers = {};

  render();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function navigate(index) {
  currentIndex = index;
  const params = new URLSearchParams({ mode, i: index });
  history.pushState({}, '', `?${params}`);
  render();
}

// テストモード専用：現在の選択を記録してから移動
function recordAndNavigate(index) {
  const form = document.getElementById('answer-form');
  const qData = questions[order[currentIndex]];
  const isMultiple = Array.isArray(qData.answer);

  if (isMultiple) {
    const checked = [...form.querySelectorAll('input[name="selected"]:checked')]
      .map(el => parseInt(el.value, 10));
    if (checked.length > 0) {
      const correct = checked.length === qData.answer.length &&
        checked.every(v => qData.answer.includes(v));
      answers[currentIndex] = { selected: checked, correct };
    }
  } else {
    const selectedEl = form.querySelector('input[name="selected"]:checked');
    if (selectedEl) {
      const selected = parseInt(selectedEl.value, 10);
      answers[currentIndex] = { selected, correct: selected === qData.answer };
    }
  }
  navigate(index);
}

// 学習モード：その問題だけ未回答に戻す
function retry() {
  delete answers[currentIndex];
  render();
}

function render() {
  if (currentIndex === -1) {
    renderResult();
    return;
  }

  const qData = questions[order[currentIndex]];
  const answer = answers[currentIndex];
  const container = document.getElementById('quiz-container');

  const progressPct = Math.round((currentIndex + 1) / TOTAL * 100);
  const modeLabel = mode === 'exam' ? 'テストモード &nbsp;|&nbsp; ' : '';

  const isMultiple = Array.isArray(qData.answer);
  const inputType = isMultiple ? 'checkbox' : 'radio';

  const choicesHtml = qData.choices.map((choice, i) => {
    let cls = 'choice-label';
    const isSelected = answer !== undefined && (
      Array.isArray(answer.selected)
        ? answer.selected.includes(i)
        : i === answer.selected
    );
    if (isSelected) cls += ' choice-selected';
    return `
      <li>
        <label class="${cls}">
          <input type="${inputType}" name="selected" value="${i}"
            ${isSelected ? 'checked' : ''}>
          ${choice}
        </label>
      </li>
    `;
  }).join('');

  let cardClass = 'question-card';
  if (answer !== undefined && mode === 'learn') {
    cardClass += answer.correct ? ' card-correct' : ' card-incorrect';
  }

  const resultLabel = answer !== undefined && mode === 'learn'
    ? `<p class="result-label ${answer.correct ? 'correct' : 'incorrect'}">${answer.correct ? '✓ 正解' : '✗ 不正解'}</p>`
    : '';

  const correctAnswerText = Array.isArray(qData.answer)
    ? qData.answer.map(i => qData.choices[i]).join('、')
    : qData.choices[qData.answer];

  const explanation = answer !== undefined && mode !== 'exam'
    ? `<div class="explanation">
        <p class="correct-answer">解答：${correctAnswerText}</p>
        <strong>解説</strong><p>${qData.explanation}</p>
      </div>`
    : '';

  // 学習モード: 未回答→「回答する」、回答済み→「リトライ」
  // テストモード: ボタンなし
  let submitBtn = '';
  if (mode === 'learn') {
    submitBtn = answer !== undefined
      ? `<button type="button" class="btn btn-change" onclick="retry()">リトライ</button>`
      : `<button type="submit" class="btn btn-primary">回答する</button>`;
  }

  const prevBtn = currentIndex > 0
    ? `<button class="btn btn-nav" onclick="navigate(${currentIndex - 1})">← 前の問題</button>`
    : `<span class="btn btn-disabled">← 前の問題</span>`;

  const subjectUrl = `/quiz/${encodeURIComponent(SUBJECT)}`;
  let nextBtn;
  if (currentIndex + 1 < TOTAL) {
    if (mode === 'exam') {
      // テストモード: 常に「次の問題」（選択を自動記録してから移動）
      nextBtn = `<button class="btn btn-nav-next" onclick="recordAndNavigate(${currentIndex + 1})">次の問題 →</button>`;
    } else {
      const btnClass = answer !== undefined ? 'btn-nav-next' : 'btn-nav';
      nextBtn = `<button class="btn ${btnClass}" onclick="navigate(${currentIndex + 1})">次の問題 →</button>`;
    }
  } else if (mode === 'learn') {
    nextBtn = `<a href="${subjectUrl}" class="btn btn-nav">年度一覧に戻る</a>`;
  } else {
    // テストモード最終問題: 「結果を見る」（最後の選択も記録）
    nextBtn = `<button class="btn btn-result" onclick="recordAndNavigate(-1)">結果を見る →</button>`;
  }

  const backLink = `<div class="back-to-list"><a href="${subjectUrl}">← 年度一覧に戻る</a></div>`;

  container.innerHTML = `
    <div class="progress-bar-wrap">
      <div class="progress-bar-fill" style="width: ${progressPct}%"></div>
    </div>
    <p class="progress-text">${modeLabel}第${currentIndex + 1}問 / 全${TOTAL}問</p>

    <div class="${cardClass}">
      <p class="genre-badge">${SUBJECT} ${COHORT}期</p>
      <p class="question-text">${qData.question}</p>
      ${resultLabel}

      <form id="answer-form">
        <ul class="choices">${choicesHtml}</ul>
        ${submitBtn}
      </form>
      ${explanation}
    </div>

    <div class="question-nav">
      ${prevBtn}
      ${nextBtn}
    </div>
    ${backLink}
  `;

  // 学習モードのみ: フォーム送信で正誤判定
  if (mode === 'learn') {
    document.getElementById('answer-form').addEventListener('submit', (e) => {
      e.preventDefault();

      if (isMultiple) {
        const checked = [...e.target.querySelectorAll('input[name="selected"]:checked')]
          .map(el => parseInt(el.value, 10));
        if (checked.length !== qData.answer.length) {
          alert(`${qData.answer.length}個選んでください（現在${checked.length}個）`);
          return;
        }
        const correct = checked.every(v => qData.answer.includes(v));
        answers[currentIndex] = { selected: checked, correct };
      } else {
        const selected = parseInt(
          e.target.querySelector('input[name="selected"]:checked')?.value,
          10,
        );
        if (isNaN(selected)) return;
        answers[currentIndex] = { selected, correct: selected === qData.answer };
      }
      render();
    });
  }

  document.querySelectorAll('.choice-label').forEach(label => {
    label.addEventListener('click', () => {
      document.querySelectorAll('.choice-label').forEach(l => {
        l.style.background = '';
        l.style.borderColor = '';
      });
      label.style.background = '#e8edf2';
      label.style.borderColor = '#1a3a5c';
    });
  });
}

function renderResult() {
  const container = document.getElementById('quiz-container');
  const correctCount = Object.values(answers).filter(a => a.correct).length;

  const resultsHtml = order.map((qIdx, i) => {
    const q = questions[qIdx];
    const a = answers[i];
    const choicesHtml = q.choices.map((choice, ci) => {
      let cls = '';
      const isCorrectChoice = Array.isArray(q.answer)
        ? q.answer.includes(ci)
        : ci === q.answer;
      const isWrongSelected = a && !a.correct && (
        Array.isArray(a.selected) ? a.selected.includes(ci) : ci === a.selected
      );
      if (isCorrectChoice) cls = 'choice-correct';
      else if (isWrongSelected) cls = 'choice-wrong';
      const correctMark = isCorrectChoice && a && !a.correct ? ' ← 正解' : '';
     return `<li class="${cls}">${choice}${correctMark}</li>`;
    }).join('');

    const itemClass = a?.correct ? 'item-correct' : 'item-incorrect';
    return `
      <div class="result-item ${itemClass}">
        <p class="question-text">${i + 1}. ${q.question}</p>
        <ul class="result-choices">${choicesHtml}</ul>
        <div class="explanation"><strong>解説</strong><p>${q.explanation}</p></div>
      </div>
    `;
  }).join('');

  const subjectUrl = `/quiz/${encodeURIComponent(SUBJECT)}`;
  container.innerHTML = `
    <h2>${SUBJECT} ${COHORT}期</h2>
    <div class="score-display">
      ${correctCount} <span class="score-denom">/ ${TOTAL} 問正解</span>
    </div>
    <div class="result-list">${resultsHtml}</div>
    <div class="result-actions">
      <button class="btn btn-secondary" onclick="resetQuiz()">もう一度解く</button>
      <a href="${subjectUrl}" class="btn btn-primary">年度一覧に戻る</a>
    </div>
  `;
}

function resetQuiz() {
  answers = {};
  order = mode === 'exam'
    ? shuffle(questions.map((_, i) => i))
    : questions.map((_, i) => i);
  navigate(0);
}

window.addEventListener('popstate', () => {
  const params = new URLSearchParams(location.search);
  currentIndex = parseInt(params.get('i') || '0', 10);
  render();
});

init();
