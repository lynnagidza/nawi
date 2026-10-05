const root = document.documentElement;
const saved = localStorage.getItem('nawi-theme');
if (saved) root.dataset.theme = saved;

document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = root.dataset.theme === 'agojie' ? 'nawi' : 'agojie';
    root.dataset.theme = next;
    localStorage.setItem('nawi-theme', next);
});