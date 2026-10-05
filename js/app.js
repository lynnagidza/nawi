const TIERS = {
    quick: { label: 'Quick', count: 10, minutes: 15, feedback: 'instant' },
    standard: { label: 'Standard', count: 25, minutes: 40, feedback: 'end' },
    exam: { label: 'Exam-like', count: 50, minutes: 100, feedback: 'end' },
};

let bank = [];
let resources = {};
let questions = [];
let tier = null;
let current = 0;
let answers = [];
let timerId = null;
let secondsLeft = 0;

const $ = (id) => document.getElementById(id);

function show(view) {
    for (const id of ['home', 'quiz', 'done']) {
        $(id).hidden = id !== view;
    }
}

function shuffle(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

async function loadQuestions() {
    const [qRes, rRes] = await Promise.all([
        fetch('data/questions.json'),
        fetch('data/resources.json'),
    ]);
    bank = await qRes.json();
    resources = await rRes.json();
}

function startQuiz(tierKey) {
    tier = TIERS[tierKey];
    questions = shuffle(bank).slice(0, tier.count);
    current = 0;
    answers = [];
    show('quiz');
    startTimer(Math.round(tier.minutes * 60));
    renderQuestion();
}

function startTimer(seconds) {
    clearInterval(timerId);
    secondsLeft = seconds;
    updateTimer();
    timerId = setInterval(() => {
        secondsLeft--;
        updateTimer();
        if (secondsLeft <= 0) finishQuiz(true);
    }, 1000);
}

function updateTimer() {
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    $('timer').textContent = `${m}:${String(s).padStart(2, '0')}`;
    $('timer').classList.toggle('low', secondsLeft <= 60);
}

function renderQuestion() {
    const q = questions[current];
    $('progress').textContent = `${tier.label} · Question ${current + 1} of ${questions.length}`;
    $('q-skill').textContent = q.skill;
    $('q-text').textContent = q.question;
    $('feedback').hidden = true;

    const instant = tier.feedback === 'instant';
    $('next').hidden = instant;
    $('next').textContent = current === questions.length - 1 ? 'Finish' : 'Next';
    $('prev').hidden = instant || current === 0;

    const box = $('options');
    box.innerHTML = '';
    q.options.forEach((text, i) => {
        const btn = document.createElement('button');
        btn.className = 'option';
        if (!instant && answers[current] === i) btn.classList.add('selected');
        btn.textContent = text;
        btn.addEventListener('click', () => selectAnswer(i));
        box.appendChild(btn);
    });
}

function sourceLink(q) {
    const a = document.createElement('a');
    a.href = q.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = q.source;
    return a;
}

function selectAnswer(i) {
    const q = questions[current];
    answers[current] = i;

    if (tier.feedback === 'instant') {
        [...$('options').children].forEach((btn, idx) => {
            btn.disabled = true;
            if (idx === q.answer) btn.classList.add('correct');
            else if (idx === i) btn.classList.add('wrong');
        });
        $('fb-text').textContent = (i === q.answer ? 'Correct. ' : 'Not quite. ') + q.explanation;
        $('fb-source').textContent = 'Source: ';
        $('fb-source').appendChild(sourceLink(q));
        $('feedback').hidden = false;
    } else {
        [...$('options').children].forEach((btn, idx) => {
            btn.classList.toggle('selected', idx === i);
        });
    }

    $('next').hidden = false;
}

function nextQuestion() {
    if (current === questions.length - 1) {
        finishQuiz(false);
    } else {
        current++;
        renderQuestion();
    }
}

function reviewLine(text, className) {
    const p = document.createElement('p');
    if (className) p.className = className;
    p.textContent = text;
    return p;
}

function renderBreakdown() {
    const stats = {};
    questions.forEach((q, i) => {
        if (!stats[q.skill]) stats[q.skill] = { correct: 0, total: 0 };
        stats[q.skill].total++;
        if (answers[i] === q.answer) stats[q.skill].correct++;
    });

    const rows = Object.entries(stats)
        .map(([skill, s]) => ({ skill, ...s, pct: Math.round((s.correct / s.total) * 100) }))
        .sort((a, b) => a.pct - b.pct);

    const breakdown = $('breakdown');
    breakdown.innerHTML = '';
    rows.forEach((r) => {
        const row = document.createElement('div');
        row.className = 'skill-row';

        const name = document.createElement('span');
        name.className = 'skill-name';
        name.textContent = r.skill;

        const bar = document.createElement('div');
        bar.className = 'bar';
        const fill = document.createElement('div');
        fill.className = 'bar-fill' + (r.pct < 70 ? ' weak' : '');
        fill.style.width = r.pct + '%';
        bar.appendChild(fill);

        const score = document.createElement('span');
        score.className = 'skill-score';
        score.textContent = `${r.correct}/${r.total} · ${r.pct}%`;

        row.append(name, bar, score);
        breakdown.appendChild(row);
    });

    const focus = $('focus');
    focus.innerHTML = '';
    const weak = rows.filter((r) => r.pct < 70);

    if (weak.length === 0) {
        focus.appendChild(reviewLine('No weak areas in this run. Try a longer tier to check again.'));
        return;
    }

    weak.forEach((r) => {
        const item = document.createElement('div');
        item.className = 'focus-item';
        item.appendChild(reviewLine(`${r.skill} · ${r.pct}%`, 'review-head'));

        const res = resources[r.skill];
        if (res) {
            const p = document.createElement('p');
            const a = document.createElement('a');
            a.href = res.url;
            a.target = '_blank';
            a.rel = 'noopener';
            a.textContent = res.title;
            p.appendChild(a);
            item.appendChild(p);
            item.appendChild(reviewLine(res.note, 'meta'));
        } else {
            item.appendChild(reviewLine('No resource linked yet for this skill.', 'meta'));
        }
        focus.appendChild(item);
    });
}

function finishQuiz(timedOut) {
    clearInterval(timerId);

    const total = questions.length;
    const score = questions.filter((q, i) => answers[i] === q.answer).length;
    const percent = Math.round((score / total) * 100);
    const scaled = Math.round((score / total) * 1000);
    const passed = scaled >= 700;

    $('scaled').textContent = scaled;
    $('verdict').textContent = passed ? 'Pass (estimated)' : 'Not yet (estimated)';
    $('verdict').className = 'verdict ' + (passed ? 'pass' : 'fail');

    let text = timedOut ? 'Time is up. ' : '';
    text += `${score} of ${total} correct (${percent}%). Unanswered questions count as wrong.`;
    if (total < tier.count) {
        text += ` Your bank only has ${total} questions so far, so this ${tier.label} run was shorter than usual.`;
    }
    $('summary').textContent = text;

    const review = $('review');
    review.innerHTML = '';
    questions.forEach((q, i) => {
        const chosen = answers[i];
        const ok = chosen === q.answer;
        const status = ok ? 'Correct' : chosen === undefined ? 'Unanswered' : 'Incorrect';

        const item = document.createElement('article');
        item.className = 'review-item ' + (ok ? 'ok' : 'bad');
        item.appendChild(reviewLine(`${i + 1}. ${q.skill} · ${status}`, 'review-head'));
        item.appendChild(reviewLine(q.question, 'review-q'));
        item.appendChild(reviewLine('Your answer: ' + (chosen === undefined ? 'no answer' : q.options[chosen])));
        if (!ok) item.appendChild(reviewLine('Correct answer: ' + q.options[q.answer]));
        item.appendChild(reviewLine(q.explanation, 'review-why'));
        const src = reviewLine('Source: ', 'meta');
        src.appendChild(sourceLink(q));
        item.appendChild(src);
        review.appendChild(item);
    });
    renderBreakdown();
    show('done');
    window.scrollTo(0, 0);
}

document.querySelectorAll('.start').forEach((btn) => {
    btn.addEventListener('click', () => startQuiz(btn.dataset.tier));
});
$('next').addEventListener('click', nextQuestion);
$('restart').addEventListener('click', () => show('home'));
$('prev').addEventListener('click', () => {
    if (current > 0) {
        current--;
        renderQuestion();
    }
});
$('quit').addEventListener('click', () => {
    if (confirm("Quit this quiz? Your answers so far won't be saved.")) {
        clearInterval(timerId);
        show('home');
    }
});

loadQuestions().catch(() => {
    document.querySelectorAll('.start').forEach((btn) => {
        btn.disabled = true;
        btn.textContent = 'Could not load questions';
    });
});