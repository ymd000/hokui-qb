// SUBJECT / YEAR は quiz_play.html が URL から取り出して設定する

let questions = [];
let answers = {};
let order = [];
let mode = 'learn';
let currentIndex = 0;

async function init() {
  const params = new URLSearchParams(location.search);
  mode = params.get('mode') || 'learn';
  currentIndex = parseInt(params.get('i') || '0', 10);

  const cacheKey = `questions_${SUBJECT}_${YEAR}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    questions = JSON.parse(cached);
  } else {
    const res = await fetch(`/api/questions/${encodeURIComponent(SUBJECT)}/${YEAR}`);
    if (res.status === 401) { location.href = '/login'; return; }
    questions = await res.json();
    localStorage.setItem(cacheKey, JSON.stringify(questions));
  }

  // TOTAL をここで確定する（サーバー埋め込みではなく questions の長さから）
  TOTAL = questions.length;

  const orderKey = `order_${SUBJECT}_${YEAR}_${mode}`;
  if (mode === 'exam') {
    const storedOrder = localStorage.getItem(orderKey);
    if (storedOrder) {
      order = JSON.parse(storedOrder);
    } else {
      order = shuffle(questions.map((_, i) => i));
      localStorage.setItem(orderKey, JSON.stringify(order));
    }
  } else {
    order = questions.map((_, i) => i);
  }

  const answersKey = `answers_${SUBJECT}_${YEAR}_${mode}`;
  const storedAnswers = localStorage.getItem(answersKey);
  answers = storedAnswers ? JSON.parse(storedAnswers) : {};

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

function saveAnswers() {
  localStorage.setItem(`answers_${SUBJECT}_${YEAR}_${mode}`, JSON.stringify(answers));
}

function navigate(index) {
  currentIndex = index;
  const params = new URLSearchParams({ mode, i: index });
  history.pushState({}, '', `?${params}`);
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

  const choicesHtml = qData.choices.map((choice, i) => {
    let cls = 'choice-label';
    if (answer !== undefined && i === answer.selected) cls += ' choice-selected';
    return `
      <li>
        <label class="${cls}">
          <input type="radio" name="selected" value="${i}"
            ${answer !== undefined && i === answer.selected ? 'checked' : ''}>
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

  const explanation = answer !== undefined && mode === 'learn'
    ? `<div class="explanation"><strong>解説</strong><p>${qData.explanation}</p></div>`
    : '';

  const submitBtn = answer !== undefined
    ? `<button type="submit" class="btn btn-change">回答を変更する</button>`
    : `<button type="submit" class="btn btn-primary">回答する</button>`;

  const prevBtn = currentIndex > 0
    ? `<button class="btn btn-nav" onclick="navigate(${currentIndex - 1})">← 前の問題</button>`
    : `<span class="btn btn-disabled">← 前の問題</span>`;

  const allAnswered = Array.from({ length: TOTAL }, (_, i) => i).every(i => i in answers);
  const subjectUrl = `/quiz/${encodeURIComponent(SUBJECT)}`;
  let nextBtn;
  if (currentIndex + 1 < TOTAL) {
    const btnClass = answer !== undefined ? 'btn-nav-next' : 'btn-nav';
    nextBtn = `<button class="btn ${btnClass}" onclick="navigate(${currentIndex + 1})">次の問題 →</button>`;
  } else if (mode === 'learn') {
    nextBtn = `<a href="${subjectUrl}" class="btn btn-nav">年度一覧に戻る</a>`;
  } else if (allAnswered) {
    nextBtn = `<button class="btn btn-result" onclick="navigate(-1)">結果を見る →</button>`;
  } else {
    nextBtn = `<span class="btn btn-disabled">結果を見る →</span>`;
  }

  const backLink = mode === 'learn'
    ? `<div class="back-to-list"><a href="${subjectUrl}">← 年度一覧に戻る</a></div>`
    : '';

  container.innerHTML = `
    <div class="progress-bar-wrap">
      <div class="progress-bar-fill" style="width: ${progressPct}%"></div>
    </div>
    <p class="progress-text">${modeLabel}第${currentIndex + 1}問 / 全${TOTAL}問</p>

    <div class="${cardClass}">
      <p class="genre-badge">${SUBJECT} ${YEAR}年</p>
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

  document.getElementById('answer-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const selected = parseInt(
      e.target.querySelector('input[name="selected"]:checked')?.value,
      10,
    );
    if (isNaN(selected)) return;
    answers[currentIndex] = { selected, correct: selected === qData.answer };
    saveAnswers();
    render();
  });

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
      if (ci === q.answer) cls = 'choice-correct';
      else if (a && ci === a.selected && !a.correct) cls = 'choice-wrong';
      const correctMark = ci === q.answer && a && !a.correct ? ' ← 正解' : '';
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
    <h2>${SUBJECT} ${YEAR}年</h2>
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
  localStorage.removeItem(`answers_${SUBJECT}_${YEAR}_${mode}`);
  localStorage.removeItem(`order_${SUBJECT}_${YEAR}_${mode}`);
  answers = {};
  if (mode === 'exam') {
    order = shuffle(questions.map((_, i) => i));
    localStorage.setItem(`order_${SUBJECT}_${YEAR}_${mode}`, JSON.stringify(order));
  }
  navigate(0);
}

window.addEventListener('popstate', () => {
  const params = new URLSearchParams(location.search);
  currentIndex = parseInt(params.get('i') || '0', 10);
  render();
});

init();
