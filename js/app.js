let questions = [];
let current = 0;
let answers = [];

const $ = (id) => document.getElementById(id);

function show(view) {
    for (const id of ['home', 'quiz', 'done']) {
        $(id).hidden = id !== view;
    }
}

async function loadQuestions() {
    const res = await fetch('data/questions.json');
    questions = await res.json();
}

function startQuiz() {
    current = 0;
    answers = [];
    show('quiz');
    renderQuestion();
}

function renderQuestion() {
    const q = questions[current];
    $('progress').textContent = `Question ${current + 1} of ${questions.length}`;
    $('q-skill').textContent = q.skill;
    $('q-text').textContent = q.question;
    $('feedback').hidden = true;
    $('next').hidden = true;

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

    [...$('options').children].forEach((btn, idx) => {
        btn.disabled = true;
        if (idx === q.answer) btn.classList.add('correct');
        else if (idx === i) btn.classList.add('wrong');
    });

    $('fb-text').textContent = (i === q.answer ? 'Correct. ' : 'Not quite. ') + q.explanation;
    $('fb-source').textContent = 'Source: ' + q.source;
    $('feedback').hidden = false;

    $('next').textContent = current === questions.length - 1 ? 'Finish' : 'Next';
    $('next').hidden = false;
}

function nextQuestion() {
    if (current === questions.length - 1) {
        finishQuiz();
    } else {
        current++;
        renderQuestion();
    }
}

function finishQuiz() {
    const score = answers.filter((a, i) => a === questions[i].answer).length;
    $('summary').textContent = `You got ${score} of ${questions.length} correct. The full results screen comes in Step 5.`;
    show('done');
}

$('start-quick').addEventListener('click', startQuiz);
$('next').addEventListener('click', nextQuestion);
$('restart').addEventListener('click', () => show('home'));

loadQuestions().catch(() => {
    $('start-quick').disabled = true;
    $('start-quick').textContent = 'Could not load questions';
});