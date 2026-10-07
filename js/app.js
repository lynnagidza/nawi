const TIERS = {
    quick: { label: 'Quick', count: 10, minutes: 15, feedback: 'instant', cases: 0 },
    standard: { label: 'Standard', count: 25, minutes: 40, feedback: 'end', cases: 1 },
    exam: { label: 'Exam-like', count: 50, minutes: 100, feedback: 'end', cases: 2 },
};

let bank = [];
let resources = {};
let domains = [];
let questions = [];
let tier = null;
let current = 0;
let answers = [];
let views = [];
let pendingItem = null;
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

function shuffledOrder(n) {
    const base = [...Array(n).keys()];
    let s = shuffle(base);
    while (n > 1 && s.every((v, i) => v === i)) s = shuffle(base);
    return s;
}

/* ---------- question types ---------- */

function typeOf(q) {
    return q.type || 'single';
}

function matchItems(q) {
    return [...q.pairs.map((p) => p[1]), ...(q.extras || [])];
}

function isCorrect(q, a) {
    if (a === undefined) return false;
    switch (typeOf(q)) {
        case 'multi':
            return a.length === q.answer.length && q.answer.every((x) => a.includes(x));
        case 'order':
            return a.every((v, i) => v === i);
        case 'match':
            return a.length === q.pairs.length && a.every((v, i) => v === i);
        default:
            return a === q.answer;
    }
}

function isChosen(i) {
    const a = answers[current];
    return Array.isArray(a) ? a.includes(i) : a === i;
}

/* ---------- loading and starting ---------- */

async function loadQuestions() {
    const [qRes, rRes, dRes] = await Promise.all([
        fetch('data/questions.json'),
        fetch('data/resources.json'),
        fetch('data/domains.json'),
    ]);
    bank = await qRes.json();
    resources = await rRes.json();
    domains = await dRes.json();
}

function expandCase(c) {
    return c.questions.map((q, i) => ({
        ...q,
        caseId: c.id,
        caseTitle: c.title,
        scenario: c.scenario,
        caseIndex: i + 1,
        caseTotal: c.questions.length,
    }));
}

function startQuiz(tierKey) {
    tier = TIERS[tierKey];

    const singles = bank.filter((q) => q.type !== 'case');
    const cases = shuffle(bank.filter((q) => q.type === 'case')).slice(0, tier.cases);
    const caseQuestions = cases.flatMap(expandCase);
    const room = Math.max(0, tier.count - caseQuestions.length);

    // Case studies go at the end, like sections of the real exam
    questions = [...shuffle(singles).slice(0, room), ...caseQuestions];
    current = 0;
    answers = [];
    views = [];
    show('quiz');
    startTimer(Math.round(tier.minutes * 60));
    renderQuestion();
}

/* ---------- timer ---------- */

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

/* ---------- rendering a question ---------- */

function sourceLink(q) {
    const a = document.createElement('a');
    a.href = q.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = q.source;
    return a;
}

function renderCasePanel(q) {
    const box = $('case');
    if (!q.scenario) {
        box.hidden = true;
        return;
    }
    const prev = questions[current - 1];
    const newCase = !prev || prev.caseId !== q.caseId;
    box.hidden = false;
    if (newCase) box.open = true;
    $('case-title').textContent = 'Case study: ' + q.caseTitle;
    const text = $('case-text');
    text.innerHTML = '';
    q.scenario.split('\n\n').forEach((para) => text.appendChild(reviewLine(para)));
}

function renderQuestion() {
    const q = questions[current];
    const type = typeOf(q);
    const instant = tier.feedback === 'instant';
    pendingItem = null;

    $('progress').textContent =
        `${tier.label} · Question ${current + 1} of ${questions.length}` +
        (q.caseId ? ` · Case study (${q.caseIndex}/${q.caseTotal})` : '');
    renderCasePanel(q);
    $('q-skill').textContent = q.skill;
    $('q-text').textContent = q.question;
    $('feedback').hidden = true;

    $('next').hidden = instant;
    $('next').textContent = current === questions.length - 1 ? 'Finish' : 'Next';
    $('prev').hidden = instant || current === 0;
    $('check').hidden = !(instant && type !== 'single');

    if (type === 'order') {
        renderOrder(q, false);
        return;
    }
    if (type === 'match') {
        renderMatch(q, false);
        return;
    }

    const box = $('options');
    box.innerHTML = '';
    q.options.forEach((text, i) => {
        const btn = document.createElement('button');
        btn.className = 'option';
        btn.textContent = text;
        if (isChosen(i)) btn.classList.add('selected');
        btn.addEventListener('click', () => (type === 'multi' ? toggleMulti(i) : selectAnswer(i)));
        box.appendChild(btn);
    });
}

function renderOrder(q, locked) {
    const view = views[current] || (views[current] = shuffledOrder(q.items.length));
    const box = $('options');
    box.innerHTML = '';

    view.forEach((orig, pos) => {
        const row = document.createElement('div');
        row.className = 'order-row';
        if (locked) row.classList.add(orig === pos ? 'correct' : 'wrong');
        row.draggable = !locked;

        row.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', String(pos));
            e.dataTransfer.effectAllowed = 'move';
            row.classList.add('dragging');
        });
        row.addEventListener('dragend', () => row.classList.remove('dragging'));
        row.addEventListener('dragover', (e) => {
            if (!locked) e.preventDefault();
        });
        row.addEventListener('drop', (e) => {
            e.preventDefault();
            if (locked) return;
            const from = Number(e.dataTransfer.getData('text/plain'));
            if (!Number.isNaN(from) && from < view.length) moveTo(from, pos);
        });

        const label = document.createElement('span');
        label.textContent = `${pos + 1}. ${q.items[orig]}`;

        const controls = document.createElement('span');
        controls.className = 'order-controls';
        [['↑', -1], ['↓', 1]].forEach(([symbol, delta]) => {
            const b = document.createElement('button');
            b.className = 'btn-move';
            b.textContent = symbol;
            b.setAttribute('aria-label', delta < 0 ? 'Move up' : 'Move down');
            b.disabled = locked || pos + delta < 0 || pos + delta >= view.length;
            b.addEventListener('click', () => moveTo(pos, pos + delta));
            controls.appendChild(b);
        });

        row.append(label, controls);
        box.appendChild(row);
    });
}

/* ---------- matching (drag and drop) ---------- */

function placeItem(itemIdx, targetIdx) {
    const placed = answers[current];
    const from = placed.indexOf(itemIdx);
    const displaced = placed[targetIdx];
    if (from !== -1) placed[from] = displaced; // swap back into the source slot
    placed[targetIdx] = itemIdx;
    pendingItem = null;
    renderMatch(questions[current], false);
}

function unplaceItem(itemIdx) {
    const placed = answers[current];
    const from = placed.indexOf(itemIdx);
    if (from !== -1) placed[from] = -1;
    pendingItem = null;
    renderMatch(questions[current], false);
}

function renderMatch(q, locked) {
    const items = matchItems(q);
    if (!views[current]) views[current] = shuffledOrder(items.length);
    if (!answers[current]) answers[current] = new Array(q.pairs.length).fill(-1);
    const placed = answers[current];

    const makeChip = (idx) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip' + (pendingItem === idx ? ' picked' : '');
        chip.textContent = items[idx];
        chip.disabled = locked;
        chip.draggable = !locked;
        chip.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', String(idx));
            e.dataTransfer.effectAllowed = 'move';
        });
        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            const slotOfThis = placed.indexOf(idx);
            if (pendingItem !== null && pendingItem !== idx && slotOfThis !== -1) {
                placeItem(pendingItem, slotOfThis); // tap-to-swap
                return;
            }
            pendingItem = pendingItem === idx ? null : idx;
            renderMatch(q, false);
        });
        return chip;
    };

    const wrap = document.createElement('div');
    wrap.className = 'match';

    const pool = document.createElement('div');
    pool.className = 'match-pool';
    const free = views[current].filter((idx) => !placed.includes(idx));
    free.forEach((idx) => pool.appendChild(makeChip(idx)));
    if (free.length === 0 && !locked) {
        const note = document.createElement('span');
        note.className = 'match-empty';
        note.textContent = 'All items placed';
        pool.appendChild(note);
    }
    if (!locked) {
        pool.addEventListener('dragover', (e) => e.preventDefault());
        pool.addEventListener('drop', (e) => {
            e.preventDefault();
            const idx = Number(e.dataTransfer.getData('text/plain'));
            if (!Number.isNaN(idx) && idx < items.length) unplaceItem(idx);
        });
        pool.addEventListener('click', () => {
            if (pendingItem !== null && placed.includes(pendingItem)) unplaceItem(pendingItem);
        });
    }
    wrap.appendChild(pool);

    q.pairs.forEach(([label], t) => {
        const row = document.createElement('div');
        row.className = 'match-row';
        if (locked) row.classList.add(placed[t] === t ? 'correct' : 'wrong');

        const text = document.createElement('span');
        text.textContent = label;

        const slot = document.createElement('div');
        slot.className = 'match-slot';
        if (placed[t] !== -1) slot.appendChild(makeChip(placed[t]));
        if (locked && placed[t] !== t) {
            const hint = document.createElement('span');
            hint.className = 'match-correct';
            hint.textContent = 'Correct: ' + q.pairs[t][1];
            slot.appendChild(hint);
        }
        if (!locked) {
            slot.addEventListener('dragover', (e) => {
                e.preventDefault();
                slot.classList.add('over');
            });
            slot.addEventListener('dragleave', () => slot.classList.remove('over'));
            slot.addEventListener('drop', (e) => {
                e.preventDefault();
                const idx = Number(e.dataTransfer.getData('text/plain'));
                if (!Number.isNaN(idx) && idx < items.length) placeItem(idx, t);
            });
            slot.addEventListener('click', () => {
                if (pendingItem !== null) placeItem(pendingItem, t);
            });
        }

        row.append(text, slot);
        wrap.appendChild(row);
    });

    const box = $('options');
    box.innerHTML = '';
    box.appendChild(wrap);
}

/* ---------- answering ---------- */

function selectAnswer(i) {
    answers[current] = i;
    if (tier.feedback === 'instant') {
        reveal();
    } else {
        [...$('options').children].forEach((btn, idx) => btn.classList.toggle('selected', idx === i));
    }
    $('next').hidden = false;
}

function toggleMulti(i) {
    const cur = answers[current] || [];
    answers[current] = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i];
    [...$('options').children].forEach((btn, idx) => {
        btn.classList.toggle('selected', answers[current].includes(idx));
    });
}

function moveTo(from, to) {
    const v = views[current];
    v.splice(to, 0, v.splice(from, 1)[0]);
    if (tier.feedback !== 'instant') answers[current] = [...v];
    renderOrder(questions[current], false);
}

function checkAnswer() {
    const q = questions[current];
    if (typeOf(q) === 'order') answers[current] = [...views[current]];
    reveal();
    $('next').hidden = false;
}

function reveal() {
    const q = questions[current];
    const type = typeOf(q);

    if (type === 'order') {
        renderOrder(q, true);
    } else if (type === 'match') {
        renderMatch(q, true);
    } else {
        [...$('options').children].forEach((btn, idx) => {
            btn.disabled = true;
            const right = type === 'multi' ? q.answer.includes(idx) : idx === q.answer;
            if (right) btn.classList.add('correct');
            else if (isChosen(idx)) btn.classList.add('wrong');
        });
    }

    $('check').hidden = true;
    const ok = isCorrect(q, answers[current]);
    $('fb-text').textContent = (ok ? 'Correct. ' : 'Not quite. ') + q.explanation;
    $('fb-source').textContent = 'Source: ';
    $('fb-source').appendChild(sourceLink(q));
    $('feedback').hidden = false;
}

function nextQuestion() {
    if (current === questions.length - 1) {
        finishQuiz(false);
    } else {
        current++;
        renderQuestion();
    }
}

/* ---------- results ---------- */

function reviewLine(text, className) {
    const p = document.createElement('p');
    if (className) p.className = className;
    p.textContent = text;
    return p;
}

function answerLines(q, chosen, ok) {
    const type = typeOf(q);

    if (type === 'order') {
        const fmt = (arr) => arr.map((o, n) => `${n + 1}. ${q.items[o]}`).join(' → ');
        const lines = ['Your order: ' + (chosen ? fmt(chosen) : 'no answer')];
        if (!ok) lines.push('Correct order: ' + fmt(q.items.map((_, i) => i)));
        return lines;
    }

    if (type === 'match') {
        const items = matchItems(q);
        const mine = q.pairs
            .map(([label], t) => `${label} → ${chosen && chosen[t] !== -1 ? items[chosen[t]] : '(empty)'}`)
            .join('; ');
        const lines = ['Your matches: ' + (chosen ? mine : 'no answer')];
        if (!ok) lines.push('Correct matches: ' + q.pairs.map((p) => `${p[0]} → ${p[1]}`).join('; '));
        return lines;
    }

    if (type === 'multi') {
        const names = (arr) => arr.map((i) => q.options[i]).join('; ');
        const lines = ['Your answers: ' + (chosen && chosen.length ? names(chosen) : 'no answer')];
        if (!ok) lines.push('Correct answers: ' + names(q.answer));
        return lines;
    }

    const lines = ['Your answer: ' + (chosen === undefined ? 'no answer' : q.options[chosen])];
    if (!ok) lines.push('Correct answer: ' + q.options[q.answer]);
    return lines;
}

function renderBreakdown() {
    const stats = {};
    questions.forEach((q, i) => {
        if (!stats[q.skill]) stats[q.skill] = { correct: 0, total: 0 };
        stats[q.skill].total++;
        if (isCorrect(q, answers[i])) stats[q.skill].correct++;
    });

    // Group skills under their exam domain; anything unmapped goes under "Other"
    const groups = domains.map((d) => ({ name: d.name, weight: d.weight, skills: d.skills }));
    const mapped = new Set(domains.flatMap((d) => d.skills));
    const unmapped = Object.keys(stats).filter((s) => !mapped.has(s));
    if (unmapped.length) groups.push({ name: 'Other', weight: '', skills: unmapped });

    const domainRows = groups
        .map((g) => {
            const skillRows = g.skills
                .filter((s) => stats[s])
                .map((s) => ({
                    skill: s,
                    ...stats[s],
                    pct: Math.round((stats[s].correct / stats[s].total) * 100),
                }))
                .sort((a, b) => a.pct - b.pct);
            const correct = skillRows.reduce((n, r) => n + r.correct, 0);
            const total = skillRows.reduce((n, r) => n + r.total, 0);
            return { ...g, skillRows, correct, total, pct: total ? Math.round((correct / total) * 100) : 0 };
        })
        .filter((g) => g.total > 0)
        .sort((a, b) => a.pct - b.pct);

    const breakdown = $('breakdown');
    breakdown.innerHTML = '';
    const allSkillRows = [];

    domainRows.forEach((g) => {
        const block = document.createElement('div');
        block.className = 'domain-block';

        const head = document.createElement('div');
        head.className = 'domain-head';
        const title = document.createElement('span');
        title.textContent = g.name;
        const meta = document.createElement('span');
        meta.className = 'domain-meta';
        meta.textContent = `${g.weight ? g.weight + ' of exam · ' : ''}${g.correct}/${g.total} · ${g.pct}%`;
        head.append(title, meta);
        block.appendChild(head);

        g.skillRows.forEach((r) => {
            allSkillRows.push(r);

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
            block.appendChild(row);
        });

        breakdown.appendChild(block);
    });

    const focus = $('focus');
    focus.innerHTML = '';
    const weak = allSkillRows.filter((r) => r.pct < 70).sort((a, b) => a.pct - b.pct);

    if (weak.length === 0) {
        focus.appendChild(reviewLine(
            tier === TIERS.exam
                ? 'No weak areas in this run.'
                : 'No weak areas in this run. Try a longer tier to check again.'
        ));
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
    const score = questions.filter((q, i) => isCorrect(q, answers[i])).length;
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

    renderBreakdown();

    const review = $('review');
    review.innerHTML = '';
    questions.forEach((q, i) => {
        const chosen = answers[i];
        const ok = isCorrect(q, chosen);
        const type = typeOf(q);
        const unanswered =
            chosen === undefined ||
            (type === 'multi' && chosen.length === 0) ||
            (type === 'match' && chosen.every((v) => v === -1));
        const status = ok ? 'Correct' : unanswered ? 'Unanswered' : 'Incorrect';

        const item = document.createElement('article');
        item.className = 'review-item ' + (ok ? 'ok' : 'bad');
        item.appendChild(reviewLine(
            `${i + 1}. ${q.skill} · ${status}` + (q.caseTitle ? ` · Case: ${q.caseTitle}` : ''),
            'review-head'
        ));
        item.appendChild(reviewLine(q.question, 'review-q'));
        answerLines(q, chosen, ok).forEach((line) => item.appendChild(reviewLine(line)));
        item.appendChild(reviewLine(q.explanation, 'review-why'));
        const src = reviewLine('Source: ', 'meta');
        src.appendChild(sourceLink(q));
        item.appendChild(src);
        review.appendChild(item);
    });

    show('done');
    window.scrollTo(0, 0);
}

/* ---------- wiring ---------- */

document.querySelectorAll('.start').forEach((btn) => {
    btn.addEventListener('click', () => startQuiz(btn.dataset.tier));
});
$('next').addEventListener('click', nextQuestion);
$('check').addEventListener('click', checkAnswer);
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
$('restart').addEventListener('click', () => show('home'));

loadQuestions().catch(() => {
    document.querySelectorAll('.start').forEach((btn) => {
        btn.disabled = true;
        btn.textContent = 'Could not load questions';
    });
});