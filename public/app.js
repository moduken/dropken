import { state } from './js/state.js';
import { apiIdentify, setupSocketListeners } from './js/network.js';
import { setupUI, joinRoom } from './js/ui.js';
import { showView, showToast } from './js/utils.js';

async function initApp() {
    let userId = localStorage.getItem('myflow_uid');

    try {
        const data = await apiIdentify(userId);
        if (data.success) {
            state.currentUser = data.user;
            localStorage.setItem('myflow_uid', state.currentUser.id);
            document.getElementById('user-name-input').value = state.currentUser.name;

            const urlParams = new URLSearchParams(window.location.search);
            const joinRoomId = urlParams.get('join');

            if (joinRoomId) {
                window.history.replaceState({}, document.title, "/");
                joinRoom(joinRoomId);
            } else if (state.currentUser.room_id) {
                joinRoom(state.currentUser.room_id);
            } else {
                showView('home');
            }
        }
    } catch (err) {
        showToast('Connection error. Retrying...', true);
        setTimeout(initApp, 3000);
    }
}

// Bootstrap Application
console.log("%cDropken %cby Moduken • github.com/moduken/dropken • threads.net/@moduken", "color: #3b82f6; font-weight: bold; font-size: 14px;", "color: gray; font-size: 12px;");
setupUI();
setupSocketListeners();
initApp();
