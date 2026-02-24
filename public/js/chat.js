import { state } from './state.js';
import { formatDateSeparator, formatTime } from './utils.js';
import { socket } from './network.js';

export const chatArea = document.getElementById('chat-area');

export function appendSingleMessage(msg) {
    const list = document.getElementById('messages-list');
    const isFirst = state.allMessages.length === 1;
    const prevMsg = isFirst ? null : state.allMessages[state.allMessages.length - 2];

    const newDateStr = formatDateSeparator(msg.created_at);
    const prevDateStr = prevMsg ? formatDateSeparator(prevMsg.created_at) : null;

    let dateDiv = null;
    if (newDateStr !== prevDateStr) {
        dateDiv = document.createElement('div');
        dateDiv.className = 'msg-date-separator';
        dateDiv.innerHTML = `<span>${newDateStr}</span>`;
        list.appendChild(dateDiv);
    }

    let showSender = true;
    if (prevMsg && prevMsg.type !== 'system' && msg.type !== 'system' && prevMsg.user_id === msg.user_id && newDateStr === prevDateStr) {
        showSender = false;
    }

    const div = buildMessageNode(msg, showSender);
    if (div) {
        list.appendChild(div);
        scrollToBottom();
    }
}

export function renderMembers(members) {
    const list = document.getElementById('members-list');
    document.getElementById('member-count').textContent = members.length;
    list.innerHTML = '';

    members.forEach(m => {
        const li = document.createElement('li');
        li.className = 'member-item';
        const isMe = m.id === state.currentUser.id;
        li.innerHTML = `
            <div class="member-info">
                <span class="member-name">${m.name} ${isMe ? '(You)' : ''}</span>
                ${m.is_host ? '<span class="badge-host">Host</span>' : ''}
            </div>
        `;

        // Only host can kick others
        const amIHost = state.currentMembers.find(curr => curr.id === state.currentUser.id)?.is_host;
        if (amIHost && !isMe && !m.is_host) {
            const kickBtn = document.createElement('button');
            kickBtn.className = 'btn-kick';
            kickBtn.textContent = 'Kick';
            kickBtn.onclick = () => {
                if (confirm(`Kick ${m.name}?`)) {
                    socket.emit('kick_member', { actionUserId: state.currentUser.id, targetUserId: m.id });
                }
            };
            li.appendChild(kickBtn);
        }

        list.appendChild(li);
    });
}

export function renderAllMessages() {
    const list = document.getElementById('messages-list');
    list.innerHTML = '';

    let lastDateStr = null;
    let lastUserId = null;

    state.allMessages.forEach(msg => {
        const dateStr = formatDateSeparator(msg.created_at);
        let dateDiv = null;
        if (dateStr !== lastDateStr) {
            const dateDiv = document.createElement('div');
            dateDiv.className = 'msg-date-separator';
            dateDiv.innerHTML = `<span>${dateStr}</span>`;
            list.appendChild(dateDiv);
            lastDateStr = dateStr;
            lastUserId = null; // reset grouping
        }

        let showSender = true;
        if (msg.type !== 'system' && lastUserId === msg.user_id) {
            showSender = false;
        }

        const div = buildMessageNode(msg, showSender);
        if (div) {
            list.appendChild(div);
            if (msg.type !== 'system') {
                lastUserId = msg.user_id;
            }
        }
    });
}

export function buildMessageNode(msg, showSender) {
    const isMeHost = state.currentMembers.find(m => m.id === state.currentUser.id)?.is_host;

    if (msg.deleted_at) {
        if (!isMeHost) return null; // Regular users see nothing
    }

    const div = document.createElement('div');

    if (msg.deleted_at) {
        div.classList.add('msg-deleted');
    }

    if (msg.type === 'system') {
        div.className = 'msg msg-system';
        div.textContent = msg.content;
        return div;
    }

    const isMe = msg.user_id === state.currentUser.id;
    div.classList.add('msg');
    div.classList.add(isMe ? 'msg-self' : 'msg-other');
    div.id = `msg-${msg.id}`;
    div.dataset.userId = msg.user_id;

    if (!showSender) {
        div.classList.add('msg-grouped');
    } else {
        const senderSpan = document.createElement('span');
        senderSpan.className = 'msg-sender';
        senderSpan.textContent = isMe ? 'You' : msg.user_name;
        div.appendChild(senderSpan);
    }

    if (msg.type === 'text') {
        const contentDiv = document.createElement('div');
        contentDiv.className = 'msg-content';
        contentDiv.textContent = msg.content;
        div.appendChild(contentDiv);

        if (msg.url_metadata) {
            try {
                const meta = typeof msg.url_metadata === 'string' ? JSON.parse(msg.url_metadata) : msg.url_metadata;
                const previewLink = document.createElement('a');
                previewLink.className = 'url-preview';
                previewLink.href = meta.original_url;
                previewLink.target = '_blank';
                previewLink.rel = 'noopener noreferrer';

                let innerHtml = '';
                if (meta.image) {
                    innerHtml += `<img src="${meta.image}" class="url-preview-img" alt="Preview Image" onload="window.scrollToBottom()" onerror="this.style.display='none'">`;
                }
                if (meta.title) {
                    innerHtml += `<div class="url-preview-title">${meta.title}</div>`;
                } else {
                    innerHtml += `<div class="url-preview-title">${meta.original_url}</div>`;
                }

                previewLink.innerHTML = innerHtml;
                div.appendChild(previewLink);
            } catch (e) { }
        }
    } else if (msg.type === 'file') {
        const containerDiv = document.createElement('div');
        containerDiv.className = 'msg-file-container';
        if (msg.is_uploading) {
            containerDiv.classList.add('msg-uploading');
        }

        const isImage = msg.file_name.match(/\.(jpg|jpeg|png|gif|webp)$/i);

        if (isImage) {
            const imgWrapper = document.createElement('div');
            imgWrapper.className = 'msg-img-wrapper';

            const img = document.createElement('img');
            img.src = msg.file_thumbnail || msg.content;
            img.className = 'msg-file-img';
            img.onload = scrollToBottom;
            if (!msg.is_uploading) {
                img.onclick = () => window.open(msg.content, '_blank');
                img.style.cursor = 'pointer';
            }
            imgWrapper.appendChild(img);

            if (msg.is_uploading) {
                const overlay = document.createElement('div');
                overlay.className = 'upload-overlay';
                overlay.innerHTML = `
                    <svg class="progress-circle" width="50" height="50" viewBox="0 0 50 50">
                        <circle class="progress-circle-bg" cx="25" cy="25" r="20" fill="none" stroke-width="4"></circle>
                        <circle class="progress-circle-value" cx="25" cy="25" r="20" fill="none" stroke-width="4"></circle>
                    </svg>
                    <span class="progress-text">Waiting...</span>
                `;
                imgWrapper.appendChild(overlay);
            }

            containerDiv.appendChild(imgWrapper);
        }

        const infoDiv = document.createElement('div');
        infoDiv.className = 'msg-file-info';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'msg-file-name';
        nameDiv.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg> <span>${msg.file_name}</span>`;

        const metaDiv = document.createElement('div');
        metaDiv.className = 'msg-file-meta';

        if (msg.is_uploading && !isImage) {
            const uploadText = document.createElement('span');
            uploadText.className = 'upload-text-indicator';
            uploadText.innerHTML = `<span class="progress-text" style="color: var(--primary-color);">Waiting...</span>`;
            metaDiv.appendChild(uploadText);
        } else {
            const sizeSpan = document.createElement('span');
            sizeSpan.className = 'msg-file-size';
            if (msg.file_size) {
                const sizeInKb = (msg.file_size / 1024).toFixed(1);
                sizeSpan.textContent = sizeInKb > 1024 ? (sizeInKb / 1024).toFixed(1) + ' MB' : sizeInKb + ' KB';
            } else {
                sizeSpan.textContent = 'Unknown Size';
            }
            metaDiv.appendChild(sizeSpan);

            if (!msg.is_uploading) {
                const downloadBtn = document.createElement('a');
                downloadBtn.className = 'msg-file-download';
                downloadBtn.href = msg.content;
                downloadBtn.download = msg.file_name;
                downloadBtn.title = "Download File";
                downloadBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
                metaDiv.appendChild(downloadBtn);
            }
        }

        infoDiv.appendChild(nameDiv);
        infoDiv.appendChild(metaDiv);
        containerDiv.appendChild(infoDiv);

        div.appendChild(containerDiv);
    }

    const timeSpan = document.createElement('span');
    timeSpan.className = 'msg-time';
    timeSpan.textContent = formatTime(msg.created_at);
    div.appendChild(timeSpan);

    if (msg.is_pinned) {
        div.innerHTML += '<span class="pinned-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.68V6a3 3 0 0 0-3-3h-0a3 3 0 0 0-3 3v4.68a2 2 0 0 1-1.11 1.87l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg></span>';
    }

    const actBtn = document.createElement('button');
    actBtn.className = 'msg-actions';
    actBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-top:2px"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.68V6a3 3 0 0 0-3-3h-0a3 3 0 0 0-3 3v4.68a2 2 0 0 1-1.11 1.87l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>';
    actBtn.onclick = (e) => {
        e.stopPropagation();
        socket.emit('toggle_pin', { userId: state.currentUser.id, messageId: msg.id });
    };
    div.appendChild(actBtn);

    // Selection Checkbox
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'msg-checkbox';
    cb.onclick = (e) => {
        e.stopPropagation();
        toggleSelection(msg.id);
    };
    // Sync state if already selected
    if (state.selectedMessageIds.includes(msg.id)) cb.checked = true;
    div.appendChild(cb);

    // Long press and click selection logic
    let pressTimer;
    const startPress = () => {
        pressTimer = setTimeout(() => {
            enterSelectionMode(msg.id);
        }, 500);
    };
    const cancelPress = () => clearTimeout(pressTimer);

    div.addEventListener('mousedown', startPress);
    div.addEventListener('mouseup', cancelPress);
    div.addEventListener('mouseleave', cancelPress);
    div.addEventListener('touchstart', startPress);
    div.addEventListener('touchend', cancelPress);
    div.addEventListener('touchcancel', cancelPress);

    div.addEventListener('click', (e) => {
        if (state.isSelectionMode && e.target.type !== 'checkbox' && !e.target.closest('.msg-actions') && !e.target.closest('.msg-file-download')) {
            e.preventDefault();
            toggleSelection(msg.id);
        }
    });

    return div;
}

// --- Selection Logic ---
export function toggleSelection(msgId) {
    const idx = state.selectedMessageIds.indexOf(msgId);
    if (idx > -1) {
        state.selectedMessageIds.splice(idx, 1);
    } else {
        state.selectedMessageIds.push(msgId);
    }

    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
        const cb = el.querySelector('.msg-checkbox');
        if (cb) cb.checked = idx === -1;
    }

    // Dispatch custom event to let ui.js rebuild action bar
    window.dispatchEvent(new Event('selection_changed'));
}

export function enterSelectionMode(msgId = null) {
    if (state.isSelectionMode) return;
    state.isSelectionMode = true;
    document.getElementById('messages-list').classList.add('selection-mode-active');
    state.selectedMessageIds = [];
    if (msgId) toggleSelection(msgId);
    else window.dispatchEvent(new Event('selection_changed'));
}

export function exitSelectionMode() {
    state.isSelectionMode = false;
    document.getElementById('messages-list').classList.remove('selection-mode-active');
    state.selectedMessageIds = [];
    document.querySelectorAll('.msg-checkbox').forEach(cb => cb.checked = false);
    window.dispatchEvent(new Event('selection_changed'));
}

export function scrollToBottom() {
    chatArea.scrollTop = chatArea.scrollHeight;
}

window.scrollToBottom = scrollToBottom; // Global for inline generic string event handler

export function updatePinnedMessages(pinnedMessages) {
    state.currentPinnedMessages = pinnedMessages;
    renderPinnedList();
}

export function renderPinnedList() {
    const container = document.getElementById('pinned-messages-container');
    const list = document.getElementById('pinned-list');
    const countSpan = document.getElementById('pin-count');

    list.innerHTML = '';
    countSpan.textContent = state.currentPinnedMessages.length;

    if (state.currentPinnedMessages.length > 0) {
        container.classList.remove('hidden');
        container.classList.add('show');

        state.currentPinnedMessages.forEach(msg => {
            const item = document.createElement('div');
            item.className = 'pinned-item';
            let fileIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="position:relative;top:2px;margin-right:4px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
            let text = msg.type === 'file' ? `${fileIcon}${msg.file_name}` : msg.content;
            item.innerHTML = `<strong>${msg.user_name}:</strong> ${text}`;

            item.onclick = () => {
                const targetMsg = document.getElementById(`msg-${msg.id}`);
                if (targetMsg) {
                    targetMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetMsg.classList.add('highlighted');
                    setTimeout(() => targetMsg.classList.remove('highlighted'), 2000);
                }
            };
            list.appendChild(item);
        });
    } else {
        container.classList.remove('show');
        container.classList.add('hidden');
    }
}
