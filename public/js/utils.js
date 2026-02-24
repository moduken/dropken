// DOM Elements
export const views = {
    home: document.getElementById('view-home'),
    room: document.getElementById('view-room')
};

export const toastEl = document.getElementById('toast');

export const modals = {
    options: document.getElementById('modal-options'),
    scanner: document.getElementById('modal-scanner')
};

export function showView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[viewName].classList.remove('hidden');
}

export function showToast(msg, isError = false) {
    toastEl.textContent = msg;
    toastEl.style.backgroundColor = isError ? 'var(--danger-color)' : 'var(--surface-color)';
    toastEl.classList.remove('hidden');
    setTimeout(() => { toastEl.classList.add('hidden'); }, 3000);
}

export function formatDateSeparator(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + "Z");
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";

    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

export function formatTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + "Z");
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
