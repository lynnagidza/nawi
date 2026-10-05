const TIERS = {
    quick: { label: 'Quick', count: 10, minutes: 15, feedback: 'instant' },
    standard: { label: 'Standard', count: 25, minutes: 40, feedback: 'end' },
    exam: { label: 'Exam-like', count: 50, minutes: 100, feedback: 'end' },
};

let bank = [];
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
    const res = await fetch('data/questions.json');
    bank = await res.json();
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
    $('next').hidden = true;
    $('next').textContent = current === questions.length - 1 ? 'Finish' : 'Next';

    const box = $('options');
    box.innerHTML = '';
    q.options.forEach((text, i) => {
        const btn = document.createElement('button');
        btn.className = 'option';
        btn.textContent = text;
        btn.addEventListener('click', () => selectAnswer(i));
        box.appendChild(btn);
    });
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
        $('fb-source').textContent = 'Source: ' + q.source;
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
        item.appendChild(reviewLine('Source: ' + q.source, 'meta'));
        review.appendChild(item);
    });

    show('done');
    window.scrollTo(0, 0);
}

document.querySelectorAll('.start').forEach((btn) => {
    btn.addEventListener('click', () => startQuiz(btn.dataset.tier));
});
$('next').addEventListener('click', nextQuestion);
$('restart').addEventListener('click', () => show('home'));

loadQuestions().catch(() => {
    document.querySelectorAll('.start').forEach((btn) => {
        btn.disabled = true;
        btn.textContent = 'Could not load questions';
    });
});