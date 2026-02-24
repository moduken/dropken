import { state } from './state.js';
import { showView, showToast, modals } from './utils.js';
import { socket, apiIdentify, apiRename, apiGeneratePairingQR, apiGenerateRoomQR, apiFetchMetadata, apiUploadFile, BLOCKED_EXTENSIONS } from './network.js';
import { appendSingleMessage, chatArea, exitSelectionMode } from './chat.js';

let html5QrcodeScanner = null;

export function setupUI() {
    // --- Home Actions ---
    document.getElementById('btn-edit-name').addEventListener('click', () => {
        const input = document.getElementById('user-name-input');
        input.disabled = false;
        input.focus();
        document.getElementById('btn-edit-name').classList.add('hidden');
        document.getElementById('btn-save-name').classList.remove('hidden');
    });

    document.getElementById('btn-save-name').addEventListener('click', async () => {
        const input = document.getElementById('user-name-input');
        const newName = input.value.trim();
        if (!newName) return;

        input.disabled = true;
        document.getElementById('btn-save-name').classList.add('hidden');
        document.getElementById('btn-edit-name').classList.remove('hidden');

        try {
            await apiRename(state.currentUser.id, newName);
            state.currentUser.name = newName;
            showToast('Name updated');
        } catch (e) { showToast('Failed to update name', true); }
    });

    // Options Modal Name Edit
    document.getElementById('btn-options-edit-name').addEventListener('click', () => {
        const input = document.getElementById('options-user-name-input');
        input.disabled = false;
        input.focus();
        document.getElementById('btn-options-edit-name').classList.add('hidden');
        document.getElementById('btn-options-save-name').classList.remove('hidden');
    });

    document.getElementById('btn-options-save-name').addEventListener('click', async () => {
        const input = document.getElementById('options-user-name-input');
        const newName = input.value.trim();
        if (!newName) return;

        input.disabled = true;
        document.getElementById('btn-options-save-name').classList.add('hidden');
        document.getElementById('btn-options-edit-name').classList.remove('hidden');

        try {
            await apiRename(state.currentUser.id, newName);
            state.currentUser.name = newName;
            document.getElementById('user-name-input').value = newName; // sync back to home
            showToast('Name updated');
        } catch (e) { showToast('Failed to update name', true); }
    });

    document.getElementById('btn-create-room').addEventListener('click', () => {
        joinRoom(null); // Passing null triggers creation
    });

    document.getElementById('btn-show-qr-join').addEventListener('click', async () => {
        try {
            const data = await apiGeneratePairingQR(state.currentUser.id);
            document.getElementById('pairing-qr-img').src = data.qr;
            document.getElementById('home-qr-display').classList.remove('hidden');
        } catch (e) {
            showToast('Failed to generate QR', true);
        }
    });

    document.getElementById('btn-close-pairing-qr').addEventListener('click', () => {
        document.getElementById('home-qr-display').classList.add('hidden');
    });

    document.getElementById('btn-scan-qr-join').addEventListener('click', () => {
        openScanner((decodedText) => {
            if (decodedText.startsWith('join_room:')) {
                const roomId = decodedText.split(':')[1];
                joinRoom(roomId);
                closeScanner();
            } else {
                showToast('Invalid Room QR Code', true);
            }
        });
    });

    // --- Room Actions ---
    document.getElementById('btn-room-options').addEventListener('click', () => {
        document.getElementById('options-user-name-input').value = state.currentUser.name;

        const isMeHost = state.currentMembers.find(m => m.id === state.currentUser.id)?.is_host;
        document.getElementById('host-actions-section').style.display = isMeHost ? 'block' : 'none';

        modals.options.classList.remove('hidden');
    });

    document.getElementById('btn-close-options').addEventListener('click', () => {
        modals.options.classList.add('hidden');
        document.getElementById('invite-qr-display').classList.add('hidden');
    });

    document.getElementById('btn-leave-room').addEventListener('click', () => {
        if (!confirm('Are you sure you want to leave this room?')) return;
        socket.emit('leave_room', { userId: state.currentUser.id });
        state.currentRoom = null;
        document.getElementById('messages-list').innerHTML = '';
        modals.options.classList.add('hidden');
        exitSelectionMode();
        showView('home');
    });

    // --- Selection and Deletion Actions ---
    window.addEventListener('selection_changed', () => {
        const actionBar = document.getElementById('selection-action-bar');
        if (state.isSelectionMode) {
            actionBar.classList.add('visible');
            document.getElementById('selected-count-text').textContent = state.selectedMessageIds.length;

            const isMeHost = state.currentMembers.find(m => m.id === state.currentUser.id)?.is_host;
            if (isMeHost) document.getElementById('btn-restore-selected').classList.remove('hidden');
            else document.getElementById('btn-restore-selected').classList.add('hidden');
        } else {
            actionBar.classList.remove('visible');
        }
    });

    document.getElementById('btn-cancel-select').addEventListener('click', exitSelectionMode);

    document.getElementById('btn-delete-selected').addEventListener('click', () => {
        if (state.selectedMessageIds.length === 0) return;
        if (confirm(`Delete ${state.selectedMessageIds.length} messages?`)) {
            socket.emit('soft_delete_messages', { userId: state.currentUser.id, messageIds: state.selectedMessageIds });
            exitSelectionMode();
        }
    });

    document.getElementById('btn-restore-selected').addEventListener('click', () => {
        if (state.selectedMessageIds.length === 0) return;
        socket.emit('restore_messages', { userId: state.currentUser.id, messageIds: state.selectedMessageIds });
        exitSelectionMode();
    });

    document.getElementById('btn-restore-all').addEventListener('click', () => {
        if (confirm('Restore ALL deleted messages in this room?')) {
            socket.emit('restore_all_messages', { userId: state.currentUser.id });
            modals.options.classList.add('hidden');
        }
    });

    // --- Invite Actions ---
    document.getElementById('btn-invite-show-qr').addEventListener('click', async () => {
        if (!state.currentRoom) return;
        try {
            const data = await apiGenerateRoomQR(state.currentRoom);
            document.getElementById('invite-room-qr-img').src = data.qr;
            document.getElementById('invite-qr-display').classList.remove('hidden');
        } catch (e) {
            showToast('Failed to generate QR', true);
        }
    });

    document.getElementById('btn-invite-scan-qr').addEventListener('click', () => {
        modals.options.classList.add('hidden');
        openScanner((decodedText) => {
            if (decodedText.startsWith('pairing:')) {
                socket.emit('invite_paired_device', { hostId: state.currentUser.id, targetToken: decodedText });
                showToast('Invite sent!');
                closeScanner();
            } else {
                showToast('Invalid Pairing QR Code', true);
            }
        });
    });

    // --- Chat Input ---
    const messageInput = document.getElementById('message-input');
    document.getElementById('btn-send').addEventListener('click', sendMessage);

    messageInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });

    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // --- File Drag & Drop ---
    setupFileHandling();
    document.getElementById('btn-close-scanner').addEventListener('click', closeScanner);
}

export function joinRoom(roomId) {
    document.getElementById('room-status').textContent = 'Connecting...';
    socket.emit('join_room', { userId: state.currentUser.id, roomId });
    showView('room');
}

async function sendMessage() {
    const messageInput = document.getElementById('message-input');
    const content = messageInput.value.trim();
    if (!content) return;

    messageInput.value = '';
    messageInput.style.height = 'auto'; // Reset height

    // Check for URL
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const urls = content.match(urlRegex);
    let url_metadata = null;

    if (urls && urls.length > 0) {
        try {
            const firstUrl = urls[0];
            const data = await apiFetchMetadata(firstUrl);
            if (data.success) {
                url_metadata = data.metadata;
                url_metadata.original_url = firstUrl;
            }
        } catch (e) { console.error('Failed to fetch metadata', e); }
    }

    socket.emit('send_message', { userId: state.currentUser.id, content, url_metadata });
}

function setupFileHandling() {
    const dropOverlay = document.getElementById('drop-overlay');
    const fileInput = document.getElementById('file-input');
    const btnAttach = document.getElementById('btn-attach');

    btnAttach.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        chatArea.addEventListener(eventName, () => dropOverlay.classList.remove('hidden'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        chatArea.addEventListener(eventName, () => dropOverlay.classList.add('hidden'), false);
    });

    const uploadManager = {
        queue: [],
        activeCount: 0,
        maxConcurrent: 2,

        addFiles(files) {
            if (!files || files.length === 0) return;
            if (!state.currentRoom) {
                showToast('Error determining room ID', true);
                return;
            }

            Array.from(files).forEach(file => {
                const ext = file.name.split('.').pop().toLowerCase();
                if (BLOCKED_EXTENSIONS && BLOCKED_EXTENSIONS.includes('.' + ext)) {
                    showToast(`File type blocked: ${file.name}`, true);
                    return;
                }

                const clientId = 'upload-' + Date.now() + '-' + Math.round(Math.random() * 10000);

                // Create local object URL for instant preview if it's an image
                let localPreview = null;
                const isImage = file.name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
                if (isImage) {
                    localPreview = URL.createObjectURL(file);
                }

                // Push dummy message into state
                const currentISOTime = new Date().toISOString();
                const dummyMsg = {
                    id: clientId, // Use client ID temporarily as the DOM ID
                    client_id: clientId,
                    room_id: state.currentRoom,
                    user_id: state.currentUser.id,
                    user_name: state.currentUser.name,
                    type: 'file',
                    content: localPreview || '#',
                    file_name: file.name,
                    file_size: file.size,
                    file_thumbnail: localPreview,
                    created_at: currentISOTime.replace('Z', ''), // utils formats expecting no Z
                    is_uploading: true,
                    progress: 0
                };
                state.allMessages.push(dummyMsg);
                appendSingleMessage(dummyMsg);

                this.queue.push({ file, clientId });
            });
            this.processQueue();
        },

        async processQueue() {
            if (this.queue.length === 0 || this.activeCount >= this.maxConcurrent) return;

            const task = this.queue.shift();
            this.activeCount++;

            const formData = new FormData();
            formData.append('userId', state.currentUser.id);
            formData.append('room_id', state.currentRoom);
            formData.append('client_id', task.clientId);
            formData.append('file', task.file);

            try {
                await apiUploadFile(formData, (percent) => {
                    this.updateProgressUI(task.clientId, Math.round(percent));
                });
            } catch (e) {
                showToast(`Upload failed: ${task.file.name}`, true);
                // Remove the dummy message from state and DOM
                state.allMessages = state.allMessages.filter(m => m.client_id !== task.clientId);
                const el = document.getElementById(`msg-${task.clientId}`);
                if (el) el.remove();
            } finally {
                this.activeCount--;
                this.processQueue();
            }
        },

        updateProgressUI(clientId, percent) {
            const el = document.getElementById(`msg-${clientId}`);
            if (el) {
                if (percent >= 100) {
                    el.remove();
                    state.allMessages = state.allMessages.filter(m => m.client_id !== clientId);
                    return;
                }
                const textEl = el.querySelector('.progress-text');
                if (textEl) {
                    textEl.textContent = `${percent}%`;
                }
                const circleEl = el.querySelector('.progress-circle-value');
                if (circleEl) {
                    const radius = circleEl.r.baseVal.value;
                    const circumference = radius * 2 * Math.PI;
                    const offset = circumference - (percent / 100) * circumference;
                    circleEl.style.strokeDashoffset = offset;
                }
            }
        }
    };

    chatArea.addEventListener('drop', (e) => {
        uploadManager.addFiles(e.dataTransfer.files);
    });

    chatArea.addEventListener('scroll', () => {
        if (chatArea.scrollTop === 0 && !state.isLoadingMore && state.hasMoreMessages && state.allMessages.length > 0) {
            state.isLoadingMore = true;
            socket.emit('load_more_messages', { roomId: state.currentRoom, beforeId: state.allMessages[0].id, limit: 20 });
        }
    });

    fileInput.addEventListener('change', (e) => {
        uploadManager.addFiles(e.target.files);
        fileInput.value = '';
    });
}

export function openScanner(onSuccess) {
    modals.scanner.classList.remove('hidden');
    // Assuming html5-qrcode is globally available from the CDN in index.html
    html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: { width: 250, height: 250 } }, false);
    html5QrcodeScanner.render((decodedText) => {
        onSuccess(decodedText);
    }, (err) => { });
}

export function closeScanner() {
    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear().catch(e => console.error(e));
        html5QrcodeScanner = null;
    }
    modals.scanner.classList.add('hidden');
}
