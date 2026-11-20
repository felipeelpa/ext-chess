document.addEventListener('DOMContentLoaded', () => {
    const I = window.I18N;
    const addr = String(window.CPP_BTC_ADDRESS || '').trim();
    const has = document.getElementById('d-has');
    const soon = document.getElementById('d-soon');
    const addrEl = document.getElementById('d-addr');
    const copyBtn = document.getElementById('d-copy');
    const langSel = document.getElementById('d-lang');

    function translate() {
        document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = I.t(el.getAttribute('data-i18n')); });
        document.title = I.t('d.title');
    }

    I.LANGS.forEach(l => {
        const o = document.createElement('option');
        o.value = l.code;
        o.textContent = l.name;
        langSel.appendChild(o);
    });
    langSel.value = I.getLang();
    I.enhanceSelect(langSel, { overlay: true });   // lista com bandeira
    langSel.addEventListener('change', () => I.setLang(langSel.value));
    I.onChange(() => { langSel.value = I.getLang(); translate(); });
    // A página abre já no idioma escolhido na extensão: espera a leitura do idioma salvo antes de mostrar
    I.ready(() => { langSel.value = I.getLang(); translate(); document.body.classList.add('ready'); });
    setTimeout(() => document.body.classList.add('ready'), 600);   // se a leitura demorar, mostra mesmo assim

    if (addr) {
        has.hidden = false;
        addrEl.textContent = addr;
        copyBtn.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(addr); } catch (e) {
                const r = document.createRange(); r.selectNodeContents(addrEl);
                const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
                try { document.execCommand('copy'); } catch (e2) { /* o usuário copia à mão */ }
            }
            copyBtn.textContent = I.t('d.copied');
            setTimeout(() => { copyBtn.textContent = I.t('d.copy'); }, 1600);
        });
    } else {
        soon.hidden = false;
    }
    translate();
});
