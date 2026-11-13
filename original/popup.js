
document.addEventListener('DOMContentLoaded', () => {
    const statusBar = document.getElementById('status');
    const statusText = statusBar.querySelector('.status-text');
    const connectionStatus = document.getElementById('connection-status');
    const togglePanelBtn = document.getElementById('toggle-panel');

    async function checkConnection() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab || !tab.url || !tab.url.includes('chess.com')) {
                updateStatus('disconnected', 'Not on Chess.com');
                return false;
            }

            const response = await chrome.tabs.sendMessage(tab.id, { action: 'showPanel' }).catch(() => null);

            if (response) {
                updateStatus('connected', 'Ready');
                return true;
            } else {
                updateStatus('error', 'Reload page');
                return false;
            }
        } catch (error) {
            updateStatus('error', 'Connection error');
            return false;
        }
    }

    function updateStatus(state, message) {
        statusBar.className = `status-bar ${state}`;
        statusText.textContent = state === 'connected' ? 'Status' : 'Status';
        connectionStatus.textContent = message;
        togglePanelBtn.disabled = state !== 'connected';
    }

    async function sendAction(action) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                await chrome.tabs.sendMessage(tab.id, { action });
            }
        } catch (error) {
            console.error(error);
        }
    }

    togglePanelBtn.addEventListener('click', () => sendAction('togglePanel'));

    checkConnection();
});
