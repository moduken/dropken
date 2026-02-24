import { state } from './state.js';
import { showToast, showView, modals } from './utils.js';
import { renderMembers, appendSingleMessage, renderAllMessages, scrollToBottom, updatePinnedMessages, chatArea } from './chat.js';
import { closeScanner } from './ui.js';

export const socket = io();
export const API_BASE = '/api';
export const BLOCKED_EXTENSIONS = ['.exe', '.dll', '.bat', '.cmd', '.sh', '.bin', '.app', '.scr', '.vbs', '.js', '.msi'];

export async function apiIdentify(userId) {
    const res = await fetch(`${API_BASE}/user/identify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
    });
    return res.json();
}

export async function apiRename(userId, newName) {
    await fetch(`${API_BASE}/user/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, newName })
    });
}

export async function apiGeneratePairingQR(userId) {
    const res = await fetch(`${API_BASE}/qr/generate-pairing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
    });
    return res.json();
}

export async function apiGenerateRoomQR(roomId) {
    const res = await fetch(`${API_BASE}/qr/generate-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId })
    });
    return res.json();
}

export async function apiFetchMetadata(url) {
    const res = await fetch(`${API_BASE}/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
    });
    return res.json();
}

export function apiUploadFile(formData, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE}/upload`);

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable && onProgress) {
                const percentComplete = (event.loaded / event.total) * 100;
                onProgress(percentComplete);
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const response = JSON.parse(xhr.responseText);
                    resolve(response);
                } catch (e) {
                    reject(new Error('Invalid JSON response'));
                }
            } else {
                reject(new Error(`Upload failed with status ${xhr.status}`));
            }
        };

        xhr.onerror = () => reject(new Error('Network error during upload'));

        // Let XMLHttpRequest handle the multipart/form-data boundary automatically
        xhr.send(formData);
    });
}

export function preloadOlderMessages() {
    if (!state.hasMoreMessages || !state.currentRoom || state.allMessages.length === 0) return;

    const oldestMsg = state.allMessages[0];
    const dropOffDate = new Date();
    dropOffDate.setDate(dropOffDate.getDate() - 7);
    const oldestMsgDate = new Date(oldestMsg.created_at + "Z");

    if (oldestMsgDate > dropOffDate) {
        socket.emit('load_more_messages', { roomId: state.currentRoom, beforeId: oldestMsg.id, limit: 20 });
    }
}

// Socket Listeners Setups
export function setupSocketListeners() {
    socket.on('room_data', ({ roomId, members, messages, pinnedMessages }) => {
        if (members.length === 0) return; // Room destroyed

        state.currentMembers = members;
        const me = members.find(m => m.id === state.currentUser.id);
        if (!me) {
            showView('home');
            showToast('You left or were kicked from the room.');
            return;
        }

        state.currentRoom = state.currentUser.room_id = roomId;
        chatArea.style.opacity = '0';

        document.getElementById('room-status').textContent = 'Connected (Secure)';
        renderMembers(members);

        state.allMessages = messages;
        state.hasMoreMessages = messages.length === 20;

        renderAllMessages();
        scrollToBottom();
        updatePinnedMessages(pinnedMessages);

        setTimeout(() => {
            scrollToBottom();
            chatArea.style.transition = 'opacity 0.2s ease';
            chatArea.style.opacity = '1';
            if (state.hasMoreMessages && state.currentRoom) preloadOlderMessages();
        }, 100);
    });

    socket.on('more_messages_loaded', (newMessages) => {
        state.isLoadingMore = false;
        if (newMessages.length === 0 || newMessages.length < 20) {
            state.hasMoreMessages = false;
        }
        if (newMessages.length === 0) return;

        const oldScrollHeight = chatArea.scrollHeight;
        state.allMessages = [...newMessages, ...state.allMessages];
        renderAllMessages();

        if (chatArea.scrollTop === 0) {
            chatArea.scrollTop = chatArea.scrollHeight - oldScrollHeight;
        }
        preloadOlderMessages();
    });

    socket.on('new_message', (msg) => {
        if (msg.client_id) {
            const idx = state.allMessages.findIndex(m => m.client_id === msg.client_id);
            if (idx !== -1) {
                // Replace the temporary uploading message with the real one
                state.allMessages[idx] = msg;
                const existingEl = document.getElementById(`msg-${msg.client_id}`);
                if (existingEl) {
                    const newEl = buildMessageNode(msg, !existingEl.classList.contains('msg-grouped'));
                    if (newEl) {
                        existingEl.replaceWith(newEl);
                        scrollToBottom();
                    }
                }
                return;
            }
        }
        state.allMessages.push(msg);
        appendSingleMessage(msg);
    });

    socket.on('message_updated', (msg) => {
        const existing = document.getElementById(`msg-${msg.id}`);
        if (existing) {
            const badge = existing.querySelector('.pinned-badge');
            if (msg.is_pinned) {
                if (!badge) existing.innerHTML += '<span class="pinned-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.68V6a3 3 0 0 0-3-3h-0a3 3 0 0 0-3 3v4.68a2 2 0 0 1-1.11 1.87l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg></span>';
            } else {
                if (badge) badge.remove();
            }
        }

        const idx = state.allMessages.findIndex(m => m.id === msg.id);
        if (idx !== -1) state.allMessages[idx] = msg;

        if (msg.is_pinned) {
            if (!state.currentPinnedMessages.find(m => m.id === msg.id)) {
                state.currentPinnedMessages.push(msg);
            }
        } else {
            state.currentPinnedMessages = state.currentPinnedMessages.filter(m => m.id !== msg.id);
        }
        updatePinnedMessages(state.currentPinnedMessages);
    });

    socket.on('user_updated', (user) => {
        const idx = state.currentMembers.findIndex(m => m.id === user.id);
        if (idx !== -1) {
            state.currentMembers[idx].name = user.name;
            renderMembers(state.currentMembers);
        }
    });

    socket.on('force_join_room', ({ targetUserId, roomId }) => {
        if (state.currentUser.id === targetUserId) {
            socket.emit('join_room', { userId: state.currentUser.id, roomId });
            showView('room');
            showToast('You were invited to a room!');
        }
    });

    socket.on('user_kicked', ({ userId }) => {
        if (state.currentUser.id === userId) {
            document.getElementById('btn-leave-room').click();
        }
    });

    socket.on('error', (msg) => {
        showToast(msg, true);
        if (msg.includes('exist')) showView('home');
    });

    // --- Deletion State Tracking ---
    socket.on('messages_deleted', ({ messageIds }) => {
        messageIds.forEach(id => {
            const m = state.allMessages.find(msg => msg.id === id);
            if (m) m.deleted_at = new Date().toISOString();
        });
        renderAllMessages();
    });

    socket.on('messages_hard_deleted', ({ messageIds }) => {
        state.allMessages = state.allMessages.filter(msg => !messageIds.includes(msg.id));
        renderAllMessages();
    });

    socket.on('messages_restored', ({ messageIds }) => {
        messageIds.forEach(id => {
            const m = state.allMessages.find(msg => msg.id === id);
            if (m) m.deleted_at = null;
        });
        renderAllMessages();
    });

    socket.on('all_messages_restored', () => {
        state.allMessages.forEach(m => m.deleted_at = null);
        renderAllMessages();
    });
}
