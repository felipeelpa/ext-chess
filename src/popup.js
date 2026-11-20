document.addEventListener('DOMContentLoaded', () => {
    const I = window.I18N;
    const statusBar = document.getElementById('status');
    const connectionStatus = document.getElementById('connection-status');
    const togglePanelBtn = document.getElementById('toggle-panel');
    const powerBtn = document.getElementById('power-btn');
    const powerHint = document.getElementById('power-hint');
    const langSelect = document.getElementById('lang-select');
    let enabled = true;
    let lastState = 'checking';   // checking | disconnected | error | connected
    let lastMessageKey = 'p.checking';

    try {
        const v = chrome.runtime.getManifest().version;
        document.getElementById('version').textContent = 'v' + v;
    } catch (e) { /* sem versão */ }

    // Textos fixos do HTML (data-i18n) + título da aba
    function translateStatic() {
        document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = I.t(el.getAttribute('data-i18n')); });
        document.title = I.t('p.title');
    }

    function renderPower() {
        powerBtn.textContent = enabled ? I.t('p.powerOn') : I.t('p.powerOff');
        powerBtn.className = 'power-btn ' + (enabled ? 'on' : 'off');
        powerHint.textContent = enabled ? I.t('p.hintOn') : I.t('p.hintOff');
        togglePanelBtn.disabled = !enabled || togglePanelBtn.dataset.ok !== '1';
    }

    function renderAll() {
        translateStatic();
        connectionStatus.textContent = I.t(lastMessageKey);
        renderPower();
    }

    // Seletor de idioma
    I.LANGS.forEach(l => {
        const o = document.createElement('option');
        o.value = l.code;
        o.textContent = l.name;
        langSelect.appendChild(o);
    });
    langSelect.value = I.getLang();
    I.enhanceSelect(langSelect, { overlay: true });   // lista com bandeira
    langSelect.addEventListener('change', () => { I.setLang(langSelect.value); });
    // Idioma lido do armazenamento (ou trocado em outro lugar, como no painel): refaz os textos
    I.onChange(() => { langSelect.value = I.getLang(); renderAll(); });

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
                updateStatus('disconnected', 'p.outside');
                return false;
            }

            const response = await chrome.tabs.sendMessage(tab.id, { action: 'showPanel' }).catch(() => null);

            if (response) {
                updateStatus('connected', 'p.ready');
                return true;
            } else {
                updateStatus('error', 'p.reload');
                return false;
            }
        } catch (error) {
            updateStatus('error', 'p.connError');
            return false;
        }
    }

    function updateStatus(state, messageKey) {
        lastState = state;
        lastMessageKey = messageKey;
        statusBar.className = `status-bar ${state}`;
        connectionStatus.textContent = I.t(messageKey);
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

    renderAll();
    checkConnection();
});
