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

function finishQuiz(timedOut) {
    clearInterval(timerId);
    const score = questions.filter((q, i) => answers[i] === q.answer).length;

    let text = timedOut ? 'Time is up. ' : '';
    text += `You got ${score} of ${questions.length} correct (unanswered questions count as wrong).`;
    if (questions.length < tier.count) {
        text += ` Your bank only has ${questions.length} questions so far, so this ${tier.label} run was shorter than usual.`;
    }
    text += ' The full review comes in Step 5.';

    $('summary').textContent = text;
    show('done');
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