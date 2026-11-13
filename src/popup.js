document.addEventListener('DOMContentLoaded', () => {
    const statusBar = document.getElementById('status');
    const connectionStatus = document.getElementById('connection-status');
    const togglePanelBtn = document.getElementById('toggle-panel');
    const powerBtn = document.getElementById('power-btn');
    const powerHint = document.getElementById('power-hint');
    let enabled = true;

    function renderPower() {
        powerBtn.textContent = enabled ? 'Extensão ligada' : 'Extensão desligada';
        powerBtn.className = 'power-btn ' + (enabled ? 'on' : 'off');
        powerHint.textContent = enabled
            ? 'Clique para desligar tudo (painel, motor e maratona).'
            : 'Desligada: nada roda nem clica no chess.com. Clique para ligar.';
        togglePanelBtn.disabled = !enabled || togglePanelBtn.dataset.ok !== '1';
    }

    powerBtn.addEventListener('click', () => {
        enabled = !enabled;
        renderPower();
        try { chrome.storage.local.set({ cppEnabled: enabled }); } catch (e) { console.log(e); }
    });

    try {
        chrome.storage.local.get('cppEnabled', (res) => {
            enabled = !(res && res.cppEnabled === false);
            renderPower();
        });
    } catch (e) { console.log(e); }

    async function checkConnection() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab || !tab.url || !tab.url.includes('chess.com')) {
                updateStatus('disconnected', 'Fora do Chess.com');
                return false;
            }

            const response = await chrome.tabs.sendMessage(tab.id, { action: 'showPanel' }).catch(() => null);

            if (response) {
                updateStatus('connected', 'Pronto');
                return true;
            } else {
                updateStatus('error', 'Recarregue a página');
                return false;
            }
        } catch (error) {
            updateStatus('error', 'Erro de conexão');
            return false;
        }
    }

    function updateStatus(state, message) {
        statusBar.className = `status-bar ${state}`;
        connectionStatus.textContent = message;
        togglePanelBtn.dataset.ok = state === 'connected' ? '1' : '0';
        togglePanelBtn.disabled = !enabled || state !== 'connected';
    }

    async function sendAction(action) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                await chrome.tabs.sendMessage(tab.id, { action });
            }
        } catch (error) {
            console.log(error);
        }
    }

    togglePanelBtn.addEventListener('click', () => sendAction('togglePanel'));

    checkConnection();
});
