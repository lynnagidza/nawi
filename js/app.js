const TIERS = {
    quick: { label: 'Quick', count: 10, minutes: 15, feedback: 'instant', cases: 0 },
    standard: { label: 'Standard', count: 25, minutes: 40, feedback: 'end', cases: 1 },
    exam: { label: 'Exam-like', count: 50, minutes: 100, feedback: 'end', cases: 2, weighted: true },
};

let bank = [];
let resources = {};
let domains = [];
let questions = [];
let tier = null;
let current = 0;
let answers = [];
let views = [];
let flags = [];
let locked = new Set();
let pendingItem = null;
let timerId = null;
let secondsLeft = 0;

const $ = (id) => document.getElementById(id);

function show(view) {
    for (const id of ['home', 'quiz', 'overview', 'done']) {
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

function weightOf(domain) {
    const nums = domain.weight.match(/\d+/g).map(Number);
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function domainQuotas(total) {
    const weights = domains.map(weightOf);
    const sum = weights.reduce((a, b) => a + b, 0);
    const raw = weights.map((w) => (w / sum) * total);
    const quotas = raw.map(Math.floor);
    let rest = total - quotas.reduce((a, b) => a + b, 0);
    raw
        .map((r, i) => [r - quotas[i], i])
        .sort((a, b) => b[0] - a[0])
        .forEach(([, i]) => {
            if (rest > 0) {
                quotas[i]++;
                rest--;
            }
        });
    return quotas;
}

function domainIndex(skill) {
    return domains.findIndex((d) => d.skills.includes(skill));
}

function drawWeighted(singles, caseQuestions, total, room) {
    const quotas = domainQuotas(total);

    // Case study questions use up part of their own domain's share
    caseQuestions.forEach((cq) => {
        const i = domainIndex(cq.skill);
        if (i >= 0 && quotas[i] > 0) quotas[i]--;
    });

    const pools = domains.map(() => []);
    const unmapped = [];
    shuffle(singles).forEach((s) => {
        const i = domainIndex(s.skill);
        (i >= 0 ? pools[i] : unmapped).push(s);
    });

    const picked = [];
    let shortfall = 0;
    pools.forEach((pool, i) => {
        const take = Math.min(quotas[i], pool.length);
        picked.push(...pool.slice(0, take));
        shortfall += quotas[i] - take;
        pools[i] = pool.slice(take);
    });

    // If a domain has too few questions, fill the gap from what's left
    const leftovers = shuffle([...pools.flat(), ...unmapped]);
    picked.push(...leftovers.slice(0, shortfall));

    return shuffle(picked).slice(0, room);
}

const MISSED_KEY = 'nawi-missed';
const HISTORY_KEY = 'nawi-history';

function loadList(key) {
    try {
        return JSON.parse(localStorage.getItem(key)) || [];
    } catch {
        return [];
    }
}

function saveList(key, list) {
    try {
        localStorage.setItem(key, JSON.stringify(list));
    } catch {
        /* storage blocked: the site still works, progress just isn't kept */
    }
}

function recordResults(scaled) {
    const missed = new Set(loadList(MISSED_KEY));
    questions.forEach((q, i) => {
        if (q.caseId) return;
        if (isCorrect(q, answers[i])) missed.delete(q.id);
        else if (isAnswered(i)) missed.add(q.id);
    });
    saveList(MISSED_KEY, [...missed]);

    const history = loadList(HISTORY_KEY);
    history.unshift({
        when: new Date().toISOString(),
        label: tier.label,
        scaled,
        total: questions.length,
    });
    saveList(HISTORY_KEY, history.slice(0, 20));
}

function renderMissed() {
    const ids = new Set(loadList(MISSED_KEY));
    const pool = bank.filter((q) => q.type !== 'case' && ids.has(q.id));
    const box = $('missed-box');
    box.innerHTML = '';
    if (!pool.length) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = `Practice my missed questions (${pool.length})`;
    btn.addEventListener('click', () => startPractice('Missed questions', pool));
    box.appendChild(btn);
    box.appendChild(
        reviewLine('Questions you got wrong in earlier runs. Answer one correctly and it leaves this list.', 'hint')
    );
}

function renderHistory() {
    const history = loadList(HISTORY_KEY).slice(0, 5);
    const list = $('history-list');
    list.innerHTML = '';
    list.parentElement.hidden = history.length === 0;

    history.forEach((h) => {
        const row = document.createElement('div');
        row.className = 'history-row';
        const left = document.createElement('span');
        const day = new Date(h.when).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
        left.textContent = `${day} · ${h.label}`;
        const right = document.createElement('small');
        right.textContent = `${h.scaled}/1000 · ${h.total} questions`;
        row.append(left, right);
        list.appendChild(row);
    });
}

const NOTES_KEY = 'nawi-notes';
const MIN_READ_SECONDS = 30;
let pendingRead = null;

function loadNotes() {
    try {
        return JSON.parse(localStorage.getItem(NOTES_KEY)) || {};
    } catch {
        return {};
    }
}

function saveNotes(notes) {
    try {
        localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
    } catch {

    }
}

function saveNote(skill, title, text, statusEl) {
    const notes = loadNotes();
    const clean = text.trim();
    if (clean) notes[skill] = { text: clean, title, updated: new Date().toISOString() };
    else delete notes[skill];
    saveNotes(notes);
    statusEl.textContent = 'Saved on this device';
}

function renderNotes() {
    const notes = loadNotes();
    const skills = Object.keys(notes);
    const list = $('notes-list');
    list.innerHTML = '';
    list.parentElement.hidden = skills.length === 0;

    skills.forEach((skill) => {
        const n = notes[skill];
        const item = document.createElement('div');
        item.className = 'note-item';
        item.appendChild(reviewLine(`${skill} · ${n.title}`, 'review-head'));
        item.appendChild(reviewLine(n.text));
        list.appendChild(item);
    });
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !pendingRead) return;
    const awaySeconds = (Date.now() - pendingRead.openedAt) / 1000;
    if (awaySeconds >= MIN_READ_SECONDS) {
        pendingRead.box.hidden = false;
        pendingRead.box.querySelector('textarea').focus();
    }
    pendingRead = null;
});

function renderBundles() {
    const counts = {};
    bank
        .filter((q) => q.type !== 'case')
        .forEach((q) => {
            counts[q.skill] = (counts[q.skill] || 0) + 1;
        });

    const groups = domains.map((d) => ({ name: d.name, weight: d.weight, skills: d.skills }));
    const mapped = new Set(domains.flatMap((d) => d.skills));
    const other = Object.keys(counts).filter((s) => !mapped.has(s));
    if (other.length) groups.push({ name: 'Other', weight: '', skills: other });

    const list = $('bundle-list');
    list.innerHTML = '';

    groups.forEach((g) => {
        const skills = g.skills.filter((s) => counts[s]);
        if (!skills.length) return;

        const head = document.createElement('h3');
        head.className = 'bundle-domain';
        head.textContent = g.name;
        if (g.weight) {
            const w = document.createElement('span');
            w.textContent = g.weight + ' of exam';
            head.appendChild(w);
        }
        list.appendChild(head);

        const grid = document.createElement('div');
        grid.className = 'bundle-grid';
        skills.forEach((s) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bundle-btn';
            btn.textContent = s;
            const n = document.createElement('small');
            n.textContent = counts[s];
            btn.appendChild(n);
            btn.addEventListener('click', () => startBundle(s));
            grid.appendChild(btn);
        });
        list.appendChild(grid);
    });
}

function startPractice(label, pool) {
    tier = { label, count: pool.length, minutes: 0, feedback: 'instant', cases: 0 };
    questions = shuffle(pool);
    current = 0;
    answers = [];
    views = [];
    flags = [];
    locked = new Set();
    show('quiz');
    clearInterval(timerId);
    $('timer').hidden = true;
    renderQuestion();
}

function startBundle(skill) {
    startPractice(skill, bank.filter((q) => q.type !== 'case' && q.skill === skill));
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
    const picked = tier.weighted
        ? drawWeighted(singles, caseQuestions, tier.count, room)
        : shuffle(singles).slice(0, room);
    questions = [...picked, ...caseQuestions];
    current = 0;
    answers = [];
    views = [];
    flags = [];
    locked = new Set();
    show('quiz');
    $('timer').hidden = false;
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
    $('next').textContent =
        current === questions.length - 1 ? (instant ? 'Finish' : 'Review') : 'Next';
    $('flag').hidden = instant;
    $('flag').textContent = flags[current] ? 'Unflag' : 'Flag for review';
    $('open-review').hidden = instant;
    const before = questions[current - 1];
    $('prev').hidden =
        instant || current === 0 || !!(before && before.caseId && before.caseId !== q.caseId);
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
        if (tier.feedback === 'end') openOverview();
        else finishQuiz(false);
        return;
    }
    const here = questions[current];
    const there = questions[current + 1];
    if (tier.feedback === 'end' && here.caseId && there.caseId !== here.caseId) {
        if (!confirm("Once you leave this case study you can't return to its questions. Continue?")) {
            return;
        }
        locked.add(here.caseId);
    }
    current++;
    renderQuestion();
}

function isAnswered(i) {
    const a = answers[i];
    if (a === undefined) return false;
    const t = typeOf(questions[i]);
    if (t === 'multi') return a.length > 0;
    if (t === 'match') return a.some((v) => v !== -1);
    return true;
}

function toggleFlag() {
    flags[current] = !flags[current];
    $('flag').textContent = flags[current] ? 'Unflag' : 'Flag for review';
}

function openOverview() {
    const list = $('overview-list');
    list.innerHTML = '';
    let unanswered = 0;
    let flagged = 0;

    questions.forEach((q, i) => {
        const answered = isAnswered(i);
        const isLocked = !!(q.caseId && locked.has(q.caseId));
        if (!answered) unanswered++;
        if (flags[i]) flagged++;

        const row = document.createElement('button');
        row.type = 'button';
        row.className =
            'overview-row' +
            (answered ? '' : ' unanswered') +
            (flags[i] ? ' flagged' : '') +
            (isLocked ? ' locked' : '');
        row.disabled = isLocked;
        row.textContent = `${i + 1}. ${q.caseTitle ? `${q.skill} · Case: ${q.caseTitle}` : q.skill}`;

        const state = document.createElement('small');
        state.textContent = [
            isLocked ? 'Locked' : '',
            answered ? 'Answered' : 'Unanswered',
            flags[i] ? 'Flagged' : '',
        ]
            .filter(Boolean)
            .join(' · ');
        row.appendChild(state);

        if (!isLocked) {
            row.addEventListener('click', () => {
                current = i;
                show('quiz');
                renderQuestion();
            });
        }
        list.appendChild(row);
    });

    $('overview-summary').textContent =
        `${unanswered} unanswered · ${flagged} flagged. Time keeps running while you review.`;
    show('overview');
}

function finishFromOverview() {
    const unanswered = questions.filter((_, i) => !isAnswered(i)).length;
    if (
        unanswered > 0 &&
        !confirm(`${unanswered} question(s) are unanswered and will score zero. Finish anyway?`)
    ) {
        return;
    }
    finishQuiz(false);
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
        if (!res) {
            item.appendChild(reviewLine('No resource linked yet for this skill.', 'meta'));
            focus.appendChild(item);
            return;
        }

        const p = document.createElement('p');
        const a = document.createElement('a');
        a.href = res.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = res.title;
        p.appendChild(a);
        item.appendChild(p);
        item.appendChild(reviewLine(res.note, 'meta'));

        const existing = loadNotes()[r.skill];
        const box = document.createElement('div');
        box.className = 'note-box';
        box.hidden = !existing;

        const label = reviewLine(
            existing ? 'Your note for this page' : 'Welcome back. What did you learn from this page?',
            'review-head'
        );
        const ta = document.createElement('textarea');
        ta.rows = 3;
        ta.placeholder = 'Write it in your own words...';
        ta.value = existing ? existing.text : '';
        const status = reviewLine('', 'meta');
        let timer = null;
        ta.addEventListener('input', () => {
            status.textContent = 'Saving…';
            clearTimeout(timer);
            timer = setTimeout(() => saveNote(r.skill, res.title, ta.value, status), 500);
        });
        box.append(label, ta, status);
        item.appendChild(box);

        a.addEventListener('click', () => {
            pendingRead = { openedAt: Date.now(), box };
        });

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
    if (tier.weighted) text += ' Questions were drawn in the official exam proportions.';
    if (total < tier.count) {
        text += ` Your bank only has ${total} questions so far, so this ${tier.label} run was shorter than usual.`;
    }
    $('summary').textContent = text;

    renderBreakdown();
    recordResults(scaled);

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
$('restart').addEventListener('click', () => {
    show('home');
    renderMissed();
    renderHistory();
    renderNotes();
});
$('flag').addEventListener('click', toggleFlag);
$('open-review').addEventListener('click', openOverview);
$('overview-back').addEventListener('click', () => {
    show('quiz');
    renderQuestion();
});
$('overview-finish').addEventListener('click', finishFromOverview);

loadQuestions()
    .then(() => {
        renderBundles();
        renderMissed();
        renderHistory();
    })
    .catch(() => {
        document.querySelectorAll('.start').forEach((btn) => {
            btn.disabled = true;
            btn.textContent = 'Could not load questions';
        });
    });