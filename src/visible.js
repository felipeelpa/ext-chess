// Roda na própria página (world MAIN), antes do site. Em segundo plano o navegador:
//  - não dispara requestAnimationFrame (o site não desenha o lance do adversário no tabuleiro);
//  - atrasa setTimeout/setInterval para 1 vez por segundo e, depois de ~5 min, 1 vez por minuto.
// Resultado: o tabuleiro fica velho e a jogada automática só anda quando você volta para a aba.
// Aqui, com a aba escondida, esses temporizadores passam a ser contados num Web Worker (que o navegador
// não atrasa), e o site passa a achar que a aba está visível. Tudo cai no comportamento normal se der erro.
(function () {
    try {
        const docProto = Document.prototype;
        let realHiddenGet = null;
        try { realHiddenGet = Object.getOwnPropertyDescriptor(docProto, 'hidden').get; } catch (e) { /* ignora */ }
        const hiddenNow = () => { try { return realHiddenGet ? !!realHiddenGet.call(document) : false; } catch (e) { return false; } };

        const def = (obj, name, value) => {
            try { Object.defineProperty(obj, name, { get: () => value, configurable: true }); } catch (e) { /* ignora */ }
        };
        def(docProto, 'hidden', false);
        def(docProto, 'webkitHidden', false);
        def(docProto, 'visibilityState', 'visible');
        def(docProto, 'webkitVisibilityState', 'visible');
        try { docProto.hasFocus = () => true; } catch (e) { /* ignora */ }
        const stop = (e) => { e.stopImmediatePropagation(); };
        document.addEventListener('visibilitychange', stop, true);
        document.addEventListener('webkitvisibilitychange', stop, true);
        window.addEventListener('blur', stop, true);
        window.addEventListener('pagehide', stop, true);

        // ---- temporizadores em Web Worker (só com a aba escondida) ----
        const nSetTimeout = window.setTimeout.bind(window);
        const nClearTimeout = window.clearTimeout.bind(window);
        const nSetInterval = window.setInterval.bind(window);
        const nClearInterval = window.clearInterval.bind(window);
        const nRAF = window.requestAnimationFrame.bind(window);
        const nCAF = window.cancelAnimationFrame.bind(window);

        const CODE = 'const t=new Map();onmessage=e=>{const d=e.data;' +
            'if(d.c==="to")t.set(d.id,setTimeout(()=>{t.delete(d.id);postMessage(d.id)},d.ms));' +
            'else if(d.c==="iv")t.set(d.id,setInterval(()=>postMessage(d.id),d.ms));' +
            'else{clearTimeout(t.get(d.id));clearInterval(t.get(d.id));t.delete(d.id)}};';
        let worker = null, workerFailed = false;
        const jobs = new Map();
        let nextId = 1e9;

        function getWorker() {
            if (worker || workerFailed) return worker;
            try {
                worker = new Worker(URL.createObjectURL(new Blob([CODE], { type: 'application/javascript' })));
                worker.onmessage = (e) => {
                    const job = jobs.get(e.data);
                    if (!job) return;
                    if (!job.rep) jobs.delete(e.data);
                    try { job.fn.apply(window, job.args); } catch (err) { setTimeout(() => { throw err; }, 0); }
                };
                worker.onerror = () => { workerFailed = true; worker = null; };
            } catch (e) { workerFailed = true; worker = null; }
            return worker;
        }

        function viaWorker(rep, fn, ms, args) {
            const w = getWorker();
            if (!w) return null;
            const id = ++nextId;
            jobs.set(id, { fn, args, rep });
            try { w.postMessage({ c: rep ? 'iv' : 'to', id, ms: Math.max(0, +ms || 0) }); } catch (e) { jobs.delete(id); return null; }
            return id;
        }

        window.setTimeout = function (fn, ms, ...args) {
            if (typeof fn === 'function' && hiddenNow()) {
                const id = viaWorker(false, fn, ms, args);
                if (id !== null) return id;
            }
            return nSetTimeout(fn, ms, ...args);
        };
        window.setInterval = function (fn, ms, ...args) {
            if (typeof fn === 'function' && hiddenNow()) {
                const id = viaWorker(true, fn, ms, args);
                if (id !== null) return id;
            }
            return nSetInterval(fn, ms, ...args);
        };
        const clear = (id, nativeClear) => {
            if (typeof id === 'number' && id > 1e9 && jobs.has(id)) {
                jobs.delete(id);
                try { if (worker) worker.postMessage({ c: 'x', id }); } catch (e) { /* ignora */ }
                return;
            }
            nativeClear(id);
        };
        window.clearTimeout = (id) => clear(id, nClearTimeout);
        window.clearInterval = (id) => clear(id, nClearInterval);

        // requestAnimationFrame: com a aba escondida, roda a cada ~33 ms pelo worker
        const rafQueue = new Map();
        let rafId = 0, rafTick = null;
        function flushRaf(ts) {
            const items = Array.from(rafQueue.entries());
            rafQueue.clear();
            for (const [, cb] of items) {
                try { cb(ts); } catch (err) { setTimeout(() => { throw err; }, 0); }
            }
        }
        window.requestAnimationFrame = function (cb) {
            if (typeof cb !== 'function') return nRAF(cb);
            const id = ++rafId;
            rafQueue.set(id, cb);
            nRAF((ts) => { if (rafQueue.has(id)) { const c = rafQueue.get(id); rafQueue.delete(id); try { c(ts); } catch (err) { setTimeout(() => { throw err; }, 0); } } });
            if (!rafTick) {   // o relógio fica ligado desde o 1º pedido: ao esconder a aba não há quem o ligue
                const t = viaWorker(true, () => {
                    if (!rafQueue.size) return;
                    if (hiddenNow()) flushRaf(performance.now());
                }, 33, []);
                if (t !== null) rafTick = t;
            }
            return id;
        };
        window.cancelAnimationFrame = function (id) {
            if (rafQueue.delete(id)) return;
            nCAF(id);
        };
    } catch (e) { /* o site continua normal */ }
})();
