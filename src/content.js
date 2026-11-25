// Analisador de Xadrez Pro - Script de conteúdo (Chess.com)
// Análise com o motor Stockfish (3 melhores lances), setas no tabuleiro,
// detecção de peças atacadas e jogada automática.

(function () {
    'use strict';

    // Nenhum erro deve ir para a página de erros da extensão: erros não tratados só são registrados no console
    if (typeof window.addEventListener === 'function') window.addEventListener('error', (e) => { if (e && e.preventDefault) e.preventDefault(); console.log('[Analisador] erro ignorado:', e && e.message); });
    if (typeof window.addEventListener === 'function') window.addEventListener('unhandledrejection', (e) => { if (e && e.preventDefault) e.preventDefault(); console.log('[Analisador] promessa rejeitada:', e && e.reason); });

    // ============= DEFINIÇÃO DAS PEÇAS =============
    // Tipos de peça como aparecem nas classes do chess.com (w = branca, b = preta)
    const PIECE_TYPES = ['wp', 'wn', 'wb', 'wr', 'wq', 'wk', 'bp', 'bn', 'bb', 'br', 'bq', 'bk'];

    const PIECE_TO_FEN = {
        'wp': 'P', 'wn': 'N', 'wb': 'B', 'wr': 'R', 'wq': 'Q', 'wk': 'K',
        'bp': 'p', 'bn': 'n', 'bb': 'b', 'br': 'r', 'bq': 'q', 'bk': 'k',
    };

    const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

    // Estado da análise
    let stockfishWorker = null;
    let isEngineReady = false;
    let isAnalyzing = false;
    // Tradução: textos da interface vêm de i18n.js (português é o padrão)
    const tr = (k, v) => (window.I18N ? window.I18N.t(k, v) : k);
    const trSec = (ms) => (window.I18N ? window.I18N.num(ms / 1000, 1) : (ms / 1000).toFixed(1));
    let panelClosedByUser = false;
    let extEnabled = true;            // interruptor geral (ícone da extensão no navegador)
    let lastEngineMsgAt = 0;         // última mensagem recebida do motor (detecta motor travado)
    let newGamePending = false;      // próxima análise manda "ucinewgame" ao motor
    let lastFEN = '';
    let analysisDepth = 12;
    let currentLines = [];
    let autoAnalyzeEnabled = false;
    let autoMoveEnabled = false;
    let autoAnalyzeInterval = null;
    let currentAnalysisFEN = '';
    let lastGameId = null;
    let pendingRestart = false;      // nova posição chegou enquanto o motor ainda pensava
    let panelUpdateInterval = null;  // intervalo do updatePanel (cancelado ao fechar)
    let dragCleanup = null;          // remove listeners de arraste do document
    let lastPlacement = '';          // só a parte das peças do último FEN visto

    // Segura um "lock" da página enquanto ela existe: o navegador não congela abas que seguram um lock
    // (e a aba continua jogando em segundo plano).
    try {
        if (navigator.locks && navigator.locks.request) {
            navigator.locks.request('cpp-keepalive', () => new Promise(() => { /* nunca solta */ })).catch(() => {});
        }
    } catch (e) { /* sem suporte: segue normal */ }

    // ============= TEMPORIZADORES QUE FUNCIONAM EM SEGUNDO PLANO =============
    // Com a aba em segundo plano (ou a janela encoberta), o navegador atrasa os setTimeout e
    // setInterval da página (para 1 s e, depois de alguns minutos, 1 vez por minuto), e a jogada
    // automática ficaria parada. Os temporizadores de um Web Worker não sofrem esse atraso,
    // então a contagem do tempo é feita lá. Se o worker não puder ser criado, usa os nativos.
    const timers = (function () {
        const WORKER_CODE = `/*cpp-timer*/
            const t = new Map();
            self.onmessage = (e) => {
                const { cmd, id, ms } = e.data;
                if (cmd === 'timeout') t.set(id, setTimeout(() => { t.delete(id); self.postMessage(id); }, ms));
                else if (cmd === 'interval') t.set(id, setInterval(() => self.postMessage(id), ms));
                else if (cmd === 'clear') { clearTimeout(t.get(id)); clearInterval(t.get(id)); t.delete(id); }
            };`;

        let worker = null;
        let failed = false;
        let nextId = 1;
        const entries = new Map();

        function armNative(entry) {
            if (entry.repeat) {
                entry.native = setInterval(entry.fn, entry.ms);
            } else {
                entry.native = setTimeout(() => { entries.delete(entry.id); entry.fn(); }, entry.ms);
            }
        }

        function fallbackToNative() {
            failed = true;
            if (worker) { try { worker.terminate(); } catch (e) { /* ignora */ } worker = null; }
            entries.forEach(entry => { if (entry.native == null) armNative(entry); });
        }

        function ensureWorker() {
            if (worker || failed) return worker;
            try {
                const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
                worker = new Worker(URL.createObjectURL(blob));
                worker.onmessage = (e) => {
                    const entry = entries.get(e.data);
                    if (!entry) return;
                    if (!entry.repeat) entries.delete(entry.id);
                    try { entry.fn(); } catch (err) { console.log('Erro no temporizador:', err); }
                };
                worker.onerror = fallbackToNative;
            } catch (e) {
                failed = true;
                worker = null;
            }
            return worker;
        }

        function create(fn, ms, repeat) {
            const entry = { id: nextId++, fn, ms, repeat, native: null };
            entries.set(entry.id, entry);
            const w = ensureWorker();
            if (w) w.postMessage({ cmd: repeat ? 'interval' : 'timeout', id: entry.id, ms });
            else armNative(entry);
            return entry;
        }

        function clear(entry) {
            if (!entry) return;
            entries.delete(entry.id);
            if (entry.native != null) {
                clearTimeout(entry.native);
                clearInterval(entry.native);
            } else if (worker) {
                worker.postMessage({ cmd: 'clear', id: entry.id });
            }
        }

        return {
            setTimeout: (fn, ms) => create(fn, ms, false),
            setInterval: (fn, ms) => create(fn, ms, true),
            clear
        };
    })();

    // ============= CONFIGURAÇÕES =============
    // Rating aproximado (estimativa) de cada profundidade do Stockfish. Varia com a versão do
    // motor e com a posição; serve como guia para escolher a força de jogo.
    const DEPTH_RATINGS = {
        1: 800, 2: 1000, 3: 1200, 4: 1400, 5: 1600, 6: 1800, 7: 1950, 8: 2100, 9: 2250, 10: 2400,
        11: 2500, 12: 2600, 13: 2700, 14: 2800, 15: 2900, 16: 3000, 17: 3050, 18: 3100, 19: 3150, 20: 3200
    };
    const MIN_DEPTH = 1;
    const MAX_DEPTH = 20;

    function ratingLabel(r) {
        if (r < 1000) return tr('r.beginner');
        if (r < 1400) return tr('r.casual');
        if (r < 1800) return tr('r.intermediate');
        if (r < 2200) return tr('r.advanced');
        if (r < 2500) return tr('r.master');
        if (r < 2800) return tr('r.gm');
        return tr('r.engine');
    }

    // Ritmo da jogada automática.
    //  - inteligente: o tempo depende da dificuldade do lance (óbvio = rápido, difícil = demora mais)
    //  - rápido / normal / calmo: tempo médio fixo em segundos (com pequena variação aleatória)
    const PACE_OPTIONS = [
        { value: 'smart', get label() { return tr('pace.smart'); } },
        { value: 'fast', get label() { return tr('pace.fast'); } },
        { value: 'normal', get label() { return tr('pace.normal'); } },
        { value: 'calm', get label() { return tr('pace.calm'); } }
    ];
    // O tempo de cada lance depende do tipo de partida (bullet, blitz ou rápida), lido do relógio.
    // O ritmo escolhido só multiplica esse tempo.
    const PACE_FACTOR = { smart: 1, fast: 0.6, normal: 1, calm: 1.8 };
    const PACE_HINTS = {
        get smart() { return tr('pace.hint.smart'); },
        get fast() { return tr('pace.hint.fast'); },
        get normal() { return tr('pace.hint.normal'); },
        get calm() { return tr('pace.hint.calm'); }
    };

    const STYLE_OPTIONS = [
        { value: 'aggressive', get label() { return tr('style.aggressive'); } },
        { value: 'defensive', get label() { return tr('style.defensive'); } },
        { value: 'auto', get label() { return tr('style.auto'); } }
    ];
    const STYLE_HINTS = {
        get aggressive() { return tr('style.hint.aggressive'); },
        get defensive() { return tr('style.hint.defensive'); },
        get auto() { return tr('style.hint.auto'); }
    };
    const DEFAULT_SETTINGS = { depth: 12, autoMove: false, pinned: true, pace: 'smart', humanMode: false, style: 'auto',
        marathonOn: false, marathonTotal: 15, marathonDone: 0, marathonPending: false, marathonLastId: '' };
    let settings = { ...DEFAULT_SETTINGS };

    function sanitizeSettings(s) {
        const out = { ...DEFAULT_SETTINGS, ...(s || {}) };
        const d = parseInt(out.depth);
        out.depth = d === 0 ? 0 : Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, d || DEFAULT_SETTINGS.depth));   // 0 = automática
        out.autoMove = !!out.autoMove;
        out.pinned = out.pinned !== false;   // fixo na lateral (padrão) ou solto
        out.humanMode = !!out.humanMode;
        if (!PACE_OPTIONS.some(p => p.value === out.pace)) out.pace = DEFAULT_SETTINGS.pace;
        if (!STYLE_OPTIONS.some(p => p.value === out.style)) out.style = DEFAULT_SETTINGS.style;
        out.marathonOn = !!out.marathonOn;
        out.marathonTotal = Math.min(99, Math.max(1, parseInt(out.marathonTotal) || DEFAULT_SETTINGS.marathonTotal));
        out.marathonDone = Math.min(out.marathonTotal, Math.max(0, parseInt(out.marathonDone) || 0));
        out.marathonPending = !!out.marathonPending;
        out.marathonLastId = String(out.marathonLastId || '');
        if (!out.marathonOn) out.marathonPending = false;
        return out;
    }

    function applySettings() {
        analysisDepth = settings.depth === 0 ? computeAutoDepth() : settings.depth;
        autoMoveEnabled = settings.autoMove;
        if (settings.depth === 0) refreshHistory(false);
    }

    // ============= PROFUNDIDADE AUTOMÁTICA =============
    // A profundidade (e com ela a força de jogo) acompanha o seu histórico de partidas e a partida:
    //  - muitas vitórias seguidas => joga bem pior (profundidade pequena), para você não ganhar sempre;
    //  - derrotas/empates recentes => sobe a profundidade, para jogar um pouco melhor;
    //  - dentro da partida: muito à frente => alivia mais; muito atrás => aperta.
    // O histórico vem da API pública do chess.com (resultado das suas últimas partidas).
    const AUTO_DEFAULT_DEPTH = 9;
    const AUTO_MAX_DEPTH = 16;
    const DRAW_RESULTS = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'];
    let historyResults = null;     // do mais novo para o mais antigo: 'w' vitória, 'd' empate, 'l' derrota
    let historyFetchedAt = 0;
    let historyFetching = false;
    let myUsername = '';

    function detectMyUsername() {
        const sels = ['.player-bottom .user-username-component', '.board-layout-bottom .user-username-component',
            '.board-layout-bottom [data-cy="user-tagline-username"]', '.player-component.player-bottom .user-tagline-username',
            '.board-layout-bottom .user-tagline-username'];
        for (const sel of sels) {
            const el = document.querySelector(sel);
            const t = el && (el.textContent || '').trim();
            if (t) return t.split(/\s+/)[0];
        }
        const a = document.querySelector('.board-layout-bottom a[href*="/member/"], .player-bottom a[href*="/member/"]');
        const m = a && (a.getAttribute('href') || '').match(/\/member\/([^/?#]+)/);
        return m ? m[1] : '';
    }

    function resultCode(me) {
        if (!me || !me.result) return null;
        if (me.result === 'win') return 'w';
        return DRAW_RESULTS.includes(me.result) ? 'd' : 'l';
    }

    // Busca (sem travar nada) os resultados das últimas partidas; no máximo 1 vez por minuto
    async function refreshHistory(force) {
        try {
            if (historyFetching || !extensionAlive()) return;
            if (!force && Date.now() - historyFetchedAt < 60000) return;
            const user = (detectMyUsername() || myUsername || collectUsernames()[0] || '').toLowerCase();
            if (!user) return;
            myUsername = user;
            historyFetching = true;
            const base = 'https://api.chess.com/pub/player/' + encodeURIComponent(user) + '/games';
            const arch = await (await fetch(base + '/archives')).json();
            const urls = (arch && arch.archives || []).slice(-2).reverse();
            const games = [];
            for (const u of urls) {
                const data = await (await fetch(u)).json();
                for (const g of (data && data.games || [])) games.push(g);
            }
            games.sort((a, b) => (b.end_time || 0) - (a.end_time || 0));
            const res = [];
            for (const g of games) {
                if (g.rules && g.rules !== 'chess') continue;
                const me = g.white && (g.white.username || '').toLowerCase() === user ? g.white
                    : g.black && (g.black.username || '').toLowerCase() === user ? g.black : null;
                const c = resultCode(me);
                if (c) res.push(c);
                if (res.length >= 12) break;
            }
            historyResults = res;
            historyFetchedAt = Date.now();
        } catch (e) {
            console.log('[Profundidade automática] histórico indisponível:', e && e.message);
        } finally {
            historyFetching = false;
            refreshAutoDepth(true);
            if (settings.depth === 0) syncSettingsUI();
        }
    }

    // Profundidade de base pelo histórico (resultados do mais novo para o mais antigo)
    function historyDepth(hist) {
        if (!hist || !hist.length) return AUTO_DEFAULT_DEPTH;
        let streak = 0;
        while (streak < hist.length && hist[streak] === hist[0]) streak++;
        let d;
        if (hist[0] === 'w') d = streak >= 4 ? 2 : streak === 3 ? 4 : streak === 2 ? 6 : 8;
        else if (hist[0] === 'l') d = streak >= 2 ? 13 : 11;
        else d = 10;
        const last10 = hist.slice(0, 10);
        const losses = last10.filter(x => x === 'l').length, wins = last10.filter(x => x === 'w').length;
        if (losses >= 5) d += 1;
        if (wins >= 7) d -= 1;
        return d;
    }

    // Ajuste pela partida em andamento (avaliação do ponto de vista do usuário)
    function gameDepthAdjust(hist) {
        const ev = lastWhiteEval;
        if (!ev) return 0;
        const v = userEvalValue();
        const hot = !!(hist && hist.length >= 2 && hist[0] === 'w' && hist[1] === 'w');
        if (ev.type === 'mate') return v > 0 ? -2 : 2;
        if (v >= 600) return hot ? -2 : -1;
        if (v >= 300) return hot ? -1 : 0;
        if (v <= -600) return 3;
        if (v <= -300) return 2;
        return 0;
    }

    function computeAutoDepth() {
        const d = historyDepth(historyResults) + gameDepthAdjust(historyResults);
        return Math.min(AUTO_MAX_DEPTH, Math.max(MIN_DEPTH, d));
    }

    function autoDepthSummary() {
        const L = tr('dep.letters').split('|');
        const letters = { w: L[0], d: L[1], l: L[2] };
        const h = historyResults && historyResults.length ? historyResults.slice(0, 8).map(x => letters[x]).join('') : tr('dep.none');
        return tr('dep.summary', { d: analysisDepth, r: DEPTH_RATINGS[analysisDepth], h });
    }

    // Recalcula a profundidade automática (antes de cada análise e quando o histórico chega)
    function refreshAutoDepth(reanalyze) {
        if (settings.depth !== 0) return;
        const d = computeAutoDepth();
        if (d === analysisDepth) return;
        analysisDepth = d;
        syncSettingsUI();
        if (reanalyze && isEngineReady) {   // o histórico chegou com a análise já feita: refaz com a nova profundidade
            cancelPendingMove();
            currentAnalysisFEN = '';
            lastFEN = '';
            analyzePosition();
        }
    }

    function loadSettings() {
        try {
            chrome.storage.local.get('cppSettings', (res) => {
                if (chrome.runtime.lastError) return;
                settings = sanitizeSettings(res && res.cppSettings);
                applySettings();
                syncSettingsUI();
            });
        } catch (e) {
            // Storage indisponível (ex.: extensão recarregada): segue com os padrões
        }
    }

    function saveSettings() {
        try {
            chrome.storage.local.set({ cppSettings: settings });
        } catch (e) { /* sem persistência, mas continua funcionando */ }
    }

    const START_PLACEMENT ='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

    // Direitos de roque: uma vez perdidos, nunca voltam na mesma partida.
    let castlingLost = { K: false, Q: false, k: false, q: false };

    function resetCastlingTracking() {
        castlingLost = { K: false, Q: false, k: false, q: false };
    }

    // Marca como perdido todo direito cujo rei ou torre não está mais na casa de origem.
    function updateCastlingTracking(positions) {
        const at = (sq, t) => positions[sq]?.type === t;
        if (!at('e1', 'wk')) { castlingLost.K = true; castlingLost.Q = true; }
        if (!at('h1', 'wr')) castlingLost.K = true;
        if (!at('a1', 'wr')) castlingLost.Q = true;
        if (!at('e8', 'bk')) { castlingLost.k = true; castlingLost.q = true; }
        if (!at('h8', 'br')) castlingLost.k = true;
        if (!at('a8', 'br')) castlingLost.q = true;
    }

    // ============= UTILITÁRIOS DE CASAS =============
    function squareToNotation(squareNum) {
        const file = Math.floor(squareNum / 10) - 1;
        const rank = (squareNum % 10) - 1;
        return FILES[file] + RANKS[rank];
    }

    function notationToIndex(sq) {
        const file = sq.charCodeAt(0) - 97; // a=0
        const rank = parseInt(sq[1]) - 1;   // 1=0
        return { file, rank };
    }

    function indexToNotation(file, rank) {
        if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
        return FILES[file] + RANKS[rank];
    }

    function isBoardFlipped() {
        const board = mainBoard();
        return board && board.classList.contains('flipped');
    }

    // Centro de uma casa ("e4") dentro de um retângulo de tabuleiro, em px relativos a ele.
    // Usado pelas setas e pelo arrastar da jogada automática.
    function squareCenter(sq, rect, flipped) {
        const size = rect.width / 8;
        const file = sq.charCodeAt(0) - 97;
        const rank = parseInt(sq[1]) - 1;
        return flipped
            ? { x: (7 - file) * size + size / 2, y: rank * size + size / 2 }
            : { x: file * size + size / 2, y: (7 - rank) * size + size / 2 };
    }

    // ============= LER A POSIÇÃO DO TABULEIRO =============
    function getBoardPosition() {
        const positions = {};
        // Só as peças do tabuleiro principal (o maior da página); sem ele, todas as da página
        let root = document;
        const main = mainBoard();
        if (main && (document.querySelectorAll('.board').length > 1 || main.querySelector('.piece'))) root = main;
        const pieces = root.querySelectorAll('.piece');

        pieces.forEach(piece => {
            const classes = piece.className.split(' ');
            let pieceType = null;
            let square = null;

            classes.forEach(cls => {
                if (PIECE_TYPES.includes(cls)) pieceType = cls;
                if (cls.startsWith('square-')) square = parseInt(cls.replace('square-', ''));
            });

            if (pieceType && square) {
                const notation = squareToNotation(square);
                positions[notation] = {
                    type: pieceType,
                    color: pieceType[0] // 'w' ou 'b'
                };
            }
        });

        return positions;
    }

    // ============= DETECÇÃO DE ATAQUES =============
    // Retorna todas as casas que uma peça ataca
    function getAttackedSquares(positions, square, piece) {
        const { file, rank } = notationToIndex(square);
        const color = piece.color;
        const pieceType = piece.type[1]; // p, n, b, r, q, k
        const attacks = [];

        const addIfValid = (f, r) => {
            const sq = indexToNotation(f, r);
            if (sq) attacks.push(sq);
        };

        const addSlidingAttacks = (directions) => {
            for (const [df, dr] of directions) {
                for (let i = 1; i < 8; i++) {
                    const nf = file + df * i;
                    const nr = rank + dr * i;
                    const sq = indexToNotation(nf, nr);
                    if (!sq) break;
                    attacks.push(sq);
                    if (positions[sq]) break; // bloqueado por uma peça
                }
            }
        };

        switch (pieceType) {
            case 'p': // o peão ataca na diagonal
                const dir = color === 'w' ? 1 : -1;
                addIfValid(file - 1, rank + dir);
                addIfValid(file + 1, rank + dir);
                break;

            case 'n': // Knight
                const knightMoves = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
                for (const [df, dr] of knightMoves) {
                    addIfValid(file + df, rank + dr);
                }
                break;

            case 'b': // Bishop
                addSlidingAttacks([[-1, -1], [-1, 1], [1, -1], [1, 1]]);
                break;

            case 'r': // Rook
                addSlidingAttacks([[-1, 0], [1, 0], [0, -1], [0, 1]]);
                break;

            case 'q': // Queen
                addSlidingAttacks([[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]);
                break;

            case 'k': // King
                const kingMoves = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
                for (const [df, dr] of kingMoves) {
                    addIfValid(file + df, rank + dr);
                }
                break;
        }

        return attacks;
    }

    // Analisa ataques e defesas de todas as peças
    function analyzeAttacksDefenses(positions) {
        const analysis = {};

        // Para cada casa, calcula quem a ataca
        const attackedBy = {}; // square -> { w: [], b: [] }

        for (const [square, piece] of Object.entries(positions)) {
            const attacks = getAttackedSquares(positions, square, piece);
            for (const targetSq of attacks) {
                if (!attackedBy[targetSq]) {
                    attackedBy[targetSq] = { w: [], b: [] };
                }
                attackedBy[targetSq][piece.color].push({ square, piece });
            }
        }

        // Agora analisa cada peça
        for (const [square, piece] of Object.entries(positions)) {
            const attackers = attackedBy[square] || { w: [], b: [] };
            const enemyColor = piece.color === 'w' ? 'b' : 'w';
            const friendlyColor = piece.color;

            const isUnderAttack = attackers[enemyColor].length > 0;
            const isDefended = attackers[friendlyColor].length > 0;

            analysis[square] = {
                ...piece,
                isUnderAttack,
                isDefended,
                attackers: attackers[enemyColor],
                defenders: attackers[friendlyColor],
                status: isUnderAttack ? (isDefended ? 'defended' : 'hanging') : 'safe'
            };
        }

        return analysis;
    }

    // ============= CONVERSÃO PARA FEN =============
    function positionToFEN(positions) {
        let fen = '';

        for (let rank = 8; rank >= 1; rank--) {
            let emptyCount = 0;
            for (let fileIdx = 0; fileIdx < 8; fileIdx++) {
                const file = FILES[fileIdx];
                const square = file + rank;
                const piece = positions[square];

                if (piece) {
                    if (emptyCount > 0) {
                        fen += emptyCount;
                        emptyCount = 0;
                    }
                    fen += PIECE_TO_FEN[piece.type];
                } else {
                    emptyCount++;
                }
            }
            if (emptyCount > 0) fen += emptyCount;
            if (rank > 1) fen += '/';
        }

        updateCastlingTracking(positions);
        const lastMove = getLastMove(positions);
        const turn = detectTurn(positions, lastMove);
        const castling = detectCastlingRights(positions);
        const enPassant = detectEnPassant(positions, lastMove, turn);
        fen += ` ${turn} ${castling} ${enPassant} 0 1`;

        return fen;
    }

    // Parte das peças do FEN (sem vez/roque/en passant), usada para detectar mudança de posição.
    function placementOnly(fen) {
        return fen.split(' ')[0];
    }

    function detectCastlingRights(positions) {
        let rights = '';
        const at = (sq, t) => positions[sq]?.type === t;
        if (!castlingLost.K && at('e1', 'wk') && at('h1', 'wr')) rights += 'K';
        if (!castlingLost.Q && at('e1', 'wk') && at('a1', 'wr')) rights += 'Q';
        if (!castlingLost.k && at('e8', 'bk') && at('h8', 'br')) rights += 'k';
        if (!castlingLost.q && at('e8', 'bk') && at('a8', 'br')) rights += 'q';
        return rights || '-';
    }

    // Último lance, lido das duas casas destacadas pelo chess.com (origem vazia + destino ocupado).
    // Retorna { from, to, piece } ou null se não for possível identificar com segurança.
    function getLastMove(positions) {
        const squares = [];
        document.querySelectorAll('.highlight').forEach(el => {
            const cls = Array.from(el.classList).find(c => /^square-\d\d$/.test(c));
            if (cls) squares.push(squareToNotation(parseInt(cls.replace('square-', ''))));
        });
        const unique = [...new Set(squares)];
        if (unique.length !== 2) return null;

        const [a, b] = unique;
        let from = null, to = null;
        if (!positions[a] && positions[b]) { from = a; to = b; }
        else if (!positions[b] && positions[a]) { from = b; to = a; }
        // Roque: o rei sai de e1/e8 e as duas casas destacadas podem incluir a torre; ignorar.
        if (!from) return null;

        return { from, to, piece: positions[to] };
    }

    function detectTurn(positions, lastMove) {
        // 1) Relógio (partidas ao vivo)
        const clocks = document.querySelectorAll('.clock-component');
        for (const clock of clocks) {
            if (clock.classList.contains('clock-player-turn')) {
                const isBottom = clock.closest('.clock-bottom') !== null;
                const flipped = isBoardFlipped();
                return flipped ? (isBottom ? 'b' : 'w') : (isBottom ? 'w' : 'b');
            }
        }
        // 2) Sem relógio (fim de partida/análise): quem fez o último lance não joga agora
        if (!lastMove && positions) lastMove = getLastMove(positions);
        if (lastMove?.piece) return lastMove.piece.color === 'w' ? 'b' : 'w';
        return 'w';
    }

    // En passant: só existe logo após um avanço duplo de peão, e só vale se um peão adversário
    // puder realmente capturar. Retorna a casa alvo (ex.: 'e3') ou '-'.
    function detectEnPassant(positions, lastMove, turn) {
        if (!lastMove || !lastMove.piece) return '-';
        const { from, to, piece } = lastMove;
        if (piece.type[1] !== 'p') return '-';
        // Quem jogou o avanço tem que ser o lado que NÃO está com a vez
        if (piece.color === turn) return '-';

        const f = notationToIndex(from);
        const t = notationToIndex(to);
        if (f.file !== t.file || Math.abs(t.rank - f.rank) !== 2) return '-';
        // Peão branco sai da 2ª fileira, preto da 7ª
        if (piece.color === 'w' && f.rank !== 1) return '-';
        if (piece.color === 'b' && f.rank !== 6) return '-';

        const enemyPawn = piece.color === 'w' ? 'bp' : 'wp';
        const left = indexToNotation(t.file - 1, t.rank);
        const right = indexToNotation(t.file + 1, t.rank);
        const capturable = (left && positions[left]?.type === enemyPawn) ||
                           (right && positions[right]?.type === enemyPawn);
        if (!capturable) return '-';

        return indexToNotation(f.file, (f.rank + t.rank) / 2);
    }

    // ============= MOTOR STOCKFISH =============
    // O stockfish.js é um worker completo que fala o protocolo UCI
    let engineLoading = false; // evita criar dois motores se for chamado enquanto ainda carrega

    // Depois de recarregar a extensão, a página aberta continua com o script antigo, que perde a
    // ligação com a extensão e não consegue mais carregar o motor. Detecta isso e avisa.
    let orphaned = false;
    let engineBlobUrl = null;
    function extensionAlive() {
        try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
    }
    function handleOrphan() {
        if (orphaned) return;
        orphaned = true;
        if (autoAnalyzeInterval) { timers.clear(autoAnalyzeInterval); autoAnalyzeInterval = null; }
        if (panelUpdateInterval) { timers.clear(panelUpdateInterval); panelUpdateInterval = null; }
        try { if (stockfishWorker) stockfishWorker.terminate(); } catch (e) { /* ignora */ }
        stockfishWorker = null;
        cancelPendingMove();
        document.querySelectorAll('.cpp-best-move-arrow, .cpp-hanging-overlay').forEach(el => el.remove());
        updateEngineStatus(tr('e.extUpdated'));
        const container = document.querySelector('.cpp-analysis-lines');
        if (container) container.innerHTML = '<div class="cpp-no-analysis">' + tr('e.extUpdatedBox') + '</div>';
    }

    async function initStockfish() {
        if (orphaned || stockfishWorker || engineLoading) return;
        if (!extensionAlive()) { handleOrphan(); return; }
        engineLoading = true;

        try {
            updateEngineStatus(tr('e.loading'));

            // Carrega o stockfish.js e cria o worker a partir dele
            // (o endereço do motor é guardado, para recriá-lo sem baixar o arquivo de novo)
            if (!engineBlobUrl) {
                const engineUrl = chrome.runtime.getURL('stockfish.js');
                const response = await fetch(engineUrl);
                const engineCode = await response.text();
                const blob = new Blob([engineCode], { type: 'application/javascript' });
                engineBlobUrl = URL.createObjectURL(blob);
            }
            stockfishWorker = new Worker(engineBlobUrl);

            // O motor responde em texto (UCI) via postMessage
            stockfishWorker.onmessage = (e) => {
                const msg = e.data;
                if (typeof msg !== 'string') return;
                lastEngineMsgAt = Date.now();

                if (msg === 'uciok') {
                    stockfishWorker.postMessage('setoption name MultiPV value 3');
                    stockfishWorker.postMessage('isready');
                } else if (msg === 'readyok') {
                    isEngineReady = true;
                    updateEngineStatus(tr('e.ready'));
                } else if (msg.includes('info') && msg.includes('depth') && msg.includes('pv')) {
                    // Linhas "info" com a variante principal
                    parseEngineInfo(msg);
                } else if (msg.startsWith('bestmove')) {
                    isAnalyzing = false;

                    // A posição mudou durante a busca: descarta este resultado e recomeça
                    if (pendingRestart) {
                        pendingRestart = false;
                        analyzePosition();
                        return;
                    }

                    updateEngineStatus(tr('e.done'));

                    // Auto Move Logic (com tempo de "pensar" proporcional à dificuldade)
                    const moveMatch = msg.match(/bestmove\s+(\S+)/);
                    // Lance a jogar: o melhor, ou (rating baixo) um lance de erro humano sorteado
                    let engineBest = moveMatch && moveMatch[1] !== '(none)' ? moveMatch[1] : null;
                    const mateMove = findMateInOne(currentAnalysisFEN);
                    if (mateMove) {
                        engineBest = mateMove;
                        const mateLine = currentLines.find(l => l && l.move === mateMove) ||
                            { depth: analysisDepth, score: { type: 'mate', value: 1 }, moves: [mateMove], move: mateMove };
                        lastPlan = { best: mateLine, orange: null, red: null, profile: errorProfile(currentRating()), rating: currentRating(), style: 'mate' };
                        lastBestMove = mateMove;
                    } else {
                        lastPlan = engineBest ? planCandidates(engineBest) : null;
                        lastBestMove = engineBest ? chooseMoveWithErrors(engineBest, currentRating(), Math.random, lastPlan) : null;
                    }
                    // Setas = os mesmos três lances que a jogada automática pode jogar. Só aparecem
                    // aqui, no fim da busca: durante ela nada é redesenhado, para as sugestões não
                    // ficarem trocando na tela a cada profundidade.
                    if (lastPlan) highlightAnalysisMoves(planArrowLines(lastPlan));
                    else if (currentLines.length > 0) highlightAnalysisMoves(currentLines);
                    updateResignStreak();
                    updateDrawStreak();
                    displayAnalysisLines();   // com as contagens novas, mostra a sugestão (modo manual)
                    if (lastBestMove && autoMoveEnabled) {
                        scheduleAutoAction(lastBestMove);
                    }
                }
            };

            stockfishWorker.onerror = (e) => {
                if (e && e.preventDefault) e.preventDefault();
                console.log('Erro no motor Stockfish:', e);
                updateEngineStatus(tr('e.error'));
                // Motor morto: sobe outro em seguida (senão a análise ficaria parada para sempre)
                timers.setTimeout(() => restartEngine('erro no worker'), 500);
            };

            // Start UCI handshake
            stockfishWorker.postMessage('uci');
            // Se o motor não ficar pronto em 10 s, sobe outro
            const startingWorker = stockfishWorker;
            timers.setTimeout(() => {
                if (stockfishWorker === startingWorker && !isEngineReady) restartEngine('motor não ficou pronto');
            }, 10000);

        } catch (error) {
            console.log('Falha ao iniciar o Stockfish:', error);
            stockfishWorker = null;
            if (!extensionAlive()) {
                handleOrphan();
            } else {
                updateEngineStatus(tr('e.loadFail'));
                timers.setTimeout(initStockfish, 3000);   // tenta de novo sozinho
            }
        } finally {
            engineLoading = false;
        }
    }


    function parseEngineInfo(info) {
        // Formato: info depth 15 multipv 1 score cp 45 nodes 234567 pv e2e4 e7e5 ...
        const depthMatch = info.match(/depth (\d+)/);
        const multiPvMatch = info.match(/multipv (\d+)/);
        const scoreMatch = info.match(/score (cp|mate) (-?\d+)/);
        const pvMatch = info.match(/ pv (.+)/);

        // No mínimo precisamos da profundidade e da variante principal
        if (!depthMatch || !pvMatch) return;

        const depth = parseInt(depthMatch[1]);
        const pvIndex = multiPvMatch ? parseInt(multiPvMatch[1]) - 1 : 0;
        const moves = pvMatch[1].trim().split(/\s+/);
        const score = scoreMatch ? {
            type: scoreMatch[1],
            value: parseInt(scoreMatch[2])
        } : { type: 'cp', value: 0 };

        // Guarda esta linha
        if (!currentLines[pvIndex] || currentLines[pvIndex].depth < depth) {
            currentLines[pvIndex] = {
                depth,
                score,
                moves,
                move: moves[0]
            };
        }

        // Mostra o progresso da análise (profundidade atual / profundidade escolhida)
        if (depth > oldDepth) {
            oldDepth = depth;
            updateEngineStatus(tr('e.thinkingDepth', { d: depth, m: analysisDepth }));
        }

        // Nada de redesenhar a cada linha do motor: setas, "Melhor lance" e barra só mudam quando a
        // busca termina (bestmove). Antes eles trocavam a cada profundidade e deixavam tudo piscando.
    }

    let oldDepth = 0;
    let analysisTurn = 'w'; // vez do FEN analisado (o placar do Stockfish é relativo a ela)
    let analysisStartedAt = 0;
    let lastMoveAtAnalysis = null;
    let pieceCountAtAnalysis = 32;
    let pendingMoveTimer = null;
    let lastPlan = null;     // plano de lances da posição (verde/laranja/vermelho)
    let lastBestMove = null; // melhor lance da posição analisada (para reagendar ao trocar o ritmo)

    // ============= DESISTÊNCIA ("Modo humano", vale em qualquer ritmo) =============
    // Quando a posição está perdida de vez (ex.: entregou a dama sem compensação), uma pessoa
    // desiste em vez de continuar jogando. Critérios (todos juntos):
    //  1) o motor aponta desvantagem de uns 5 peões ou mais (limite sorteado por partida);
    //  2) o tabuleiro mostra perda real de material (pelo menos uma peça menor);
    //  3) a situação se confirma em 2 lances seguidos seus, ou é gravíssima (dama de graça).
    // Não depende da profundidade escolhida: a perda de material no tabuleiro (critério 2) já
    // impede desistir por causa de um placar errado do motor em profundidade baixa.
    // Com desvantagem de 5 peões a chance de virar o jogo é de cerca de 14% e, a partir de 9,
    // de cerca de 3% (curva do Lichess, calibrada em partidas reais).
    const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    const RESIGN_MIN_MATERIAL = 3;          // diferença mínima de material (uma peça menor)
    const RESIGN_IMMEDIATE_CP = -900;       // dama de graça: desiste sem esperar a confirmação
    const RESIGN_CONFIRMATIONS = 2;         // lances seguidos com a posição perdida
    const RESIGN_MATE_IN = 3;               // mate contra em até 3 lances
    const RESIGN_BUTTON_RE = /resign|abandon|desist|render-se/;
    const RESIGN_CONFIRM_RE = /^(sim|yes|confirm|confirmar|resign|abandonar|desistir|ok)\b/;
    const RESIGN_CANCEL_RE = /cancel|não|nao|^no\b|voltar|back/;

    let resignedThisGame = false;
    let resignStreak = 0;          // quantos lances seus seguidos já estavam perdidos
    let resignStreakFEN = '';      // posição já contada (para não contar duas vezes)
    // Limite sorteado a cada partida (entre -4,5 e -6,5 peões) para não desistir sempre no mesmo ponto
    function pickResignThreshold() { return -(450 + Math.floor(Math.random() * 200)); }
    let resignThresholdCp = pickResignThreshold();

    function resetResignState() {
        resignedThisGame = false;
        resignStreak = 0;
        resignStreakFEN = '';
        resignThresholdCp = pickResignThreshold();
    }

    // Quanto o usuário está atrás em material (positivo = atrás)
    function materialDeficit(positions) {
        const userColor = isBoardFlipped() ? 'b' : 'w';
        let mine = 0, theirs = 0;
        for (const piece of Object.values(positions)) {
            const v = PIECE_VALUES[piece.type[1]] || 0;
            if (piece.color === userColor) mine += v; else theirs += v;
        }
        return theirs - mine;
    }

    // Valor da avaliação do ponto de vista do usuário (positivo = vantagem dele)
    function userEvalValue() {
        const ev = lastWhiteEval;
        if (!ev) return null;
        return !isBoardFlipped() ? ev.value : -ev.value;
    }

    // A posição atual está perdida? (critérios 1, 2 e 4)
    function isLostPosition() {
        const ev = lastWhiteEval;
        const best = currentLines[0];
        if (!ev || !best) return false;
        const userValue = userEvalValue();
        if (ev.type === 'mate') return userValue < 0 && Math.abs(ev.value) <= RESIGN_MATE_IN;
        return userValue <= resignThresholdCp && materialDeficit(getBoardPosition()) >= RESIGN_MIN_MATERIAL;
    }

    // Atualiza a contagem de lances seguidos perdidos (chamado uma vez por posição analisada)
    function updateResignStreak() {
        if (!isMyTurn() || currentAnalysisFEN === resignStreakFEN) return;
        resignStreakFEN = currentAnalysisFEN;
        resignStreak = isLostPosition() ? resignStreak + 1 : 0;
    }

    function shouldResign() {
        if (!settings.humanMode || resignedThisGame || !isMyTurn()) return false;
        if (!isLostPosition()) return false;
        const userValue = userEvalValue();
        const gravissima = lastWhiteEval.type === 'mate' || userValue <= RESIGN_IMMEDIATE_CP;
        return gravissima || resignStreak >= RESIGN_CONFIRMATIONS;
    }

    // Link só é seguro se não sair da partida: artigos, perfis, notícias etc. nunca são clicados
    function isSafeControl(el) {
        if (el.tagName !== 'A') return true;
        const h = el.getAttribute('href') || '';
        return h === '' || h === '#' || /^(https?:\/\/[^/]*chess\.com)?\/(play|game|analysis)\b/.test(h);
    }

    function textOfControl(el) {
        return [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('data-cy'),
            el.getAttribute('data-test'), el.textContent].filter(Boolean).join(' ').trim().toLowerCase();
    }

    // Procura um botão pelo texto/atributos. Prefere elementos visíveis (com tamanho na tela).
    function findControl(textRe, inside, ignoreDialogs, exclude, onlyVisible) {
        const root = inside || document;
        const candidates = Array.from(root.querySelectorAll('button, [role="button"], a'))
            .filter(isSafeControl)
            .filter(el => !el.closest('#chess-position-panel'))
            .filter(el => el !== exclude && !(exclude && exclude.contains(el)))
            .filter(el => !(ignoreDialogs && el.closest('[role="dialog"]')))
            .filter(el => (el.textContent || '').trim().length <= 40)
            .filter(el => { const t = textOfControl(el); return textRe.test(t) && !RESIGN_CANCEL_RE.test(t); });
        const visible = candidates.filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
        if (onlyVisible) return visible[0] || null;
        return (visible[0] || candidates[0]) || null;
    }

    // Botão "Abandonar" da partida (fora de janelas de confirmação)
    function findResignButton() {
        if (gameIsOver()) return null;   // partida acabou: "Por Desistência" é só o resultado, não um botão
        return findControl(RESIGN_BUTTON_RE, document, true);
    }

    // Confirmação: primeiro numa janela/diálogo; se o site usar outro formato (confirmação na
    // própria página), procura um botão visível de confirmação que não seja o de abandonar.
    const RESIGN_CONFIRM_ANYWHERE_RE = /^(sim|yes|confirmar|confirm|desistir|resign|abandonar)\b/;

    function findConfirmButton(resignBtn) {
        const dialogs = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="dialog"], [class*="confirm"]');
        for (const d of dialogs) {
            const el = findControl(RESIGN_CONFIRM_RE, d, false, resignBtn);
            if (el) return el;
        }
        return findControl(RESIGN_CONFIRM_ANYWHERE_RE, document, false, resignBtn, false);
    }

    function confirmResign(attempt, resignBtn) {
        const btn = findConfirmButton(resignBtn);
        if (btn) { btn.click(); return; }
        // Sem confirmação ainda: tenta de novo algumas vezes (pode nem existir)
        if (attempt < 4) timers.setTimeout(() => confirmResign(attempt + 1, resignBtn), 500);
    }

    function resignGame() {
        const btn = findResignButton();
        if (!btn) {
            console.log('[Jogada automática] Botão de abandonar não encontrado; jogando o melhor lance.');
            updateEngineStatus(tr('e.noResignBtn'));
            if (lastBestMove) scheduleAutoMove(lastBestMove);
            return;
        }
        resignedThisGame = true;
        console.log('[Jogada automática] Desvantagem enorme: abandonando a partida.');
        btn.click();
        timers.setTimeout(() => confirmResign(1, btn), 700);
    }

    // Uma pessoa pensa um pouco antes de desistir
    function scheduleResign() {
        cancelPendingMove();
        const k = timeControlKind();
        let sec = k === 'bullet' ? 0.6 + Math.random() : k === 'blitz' ? 1.2 + Math.random() * 2 : 2.5 + Math.random() * 4.5;
        const remaining = getMyClockSeconds();
        if (remaining !== null) sec = Math.min(sec, Math.max(1, remaining * 0.2));
        const fenAtSchedule = currentAnalysisFEN;
        const wait = Math.max(300, sec * 1000 - (Date.now() - analysisStartedAt));
        updateEngineStatus(tr('e.resigning', { s: trSec(wait) }));

        pendingMoveTimer = timers.setTimeout(() => {
            pendingMoveTimer = null;
            if (!autoMoveEnabled || !shouldResign()) return;   // ainda perdido e ainda ligado?
            if (positionToFEN(getBoardPosition()) !== fenAtSchedule) return;
            resignGame();
        }, wait);
    }

    // ============= EMPATE =============
    // Só em final de jogo equilibrado, com cara de empate de verdade:
    //  - até 14 peças no tabuleiro (reis incluídos) e avaliação dentro de ±0,25 peão;
    //  - a igualdade se repete em 3 a 5 lances seguidos seus (sorteado por partida);
    //  - no máximo 2 ofertas por partida, e nada de oferta em bullet.
    // Oferece o empate, espera 3 a 4 s pela resposta e, se o jogo seguir, joga o lance.
    // Também aceita o empate oferecido pelo adversário quando a posição pede (igual no final,
    // ou posição pior para mim).
    const DRAW_MAX_PIECES = 14;
    const DRAW_EQUAL_CP = 25;
    const DRAW_BUTTON_RE = /\b(draw|empate|oferecer empate|offer draw)\b|½|1\/2/;
    const DRAW_CONFIRM_RE = /^(sim|yes|confirmar|confirm|oferecer|offer|ok)\b/;
    const DRAW_ACCEPT_RE = /\b(aceitar|accept)\b/;
    const DRAW_CONTEXT_RE = /draw|empate/;

    let drawOffers = 0;            // ofertas feitas nesta partida
    let drawStreak = 0;            // lances seguidos meus com a posição igual
    let drawStreakFEN = '';
    let drawNeeded = 3;
    let drawAcceptTimer = null;
    let drawAcceptedAt = 0;        // evita clicar duas vezes no mesmo "Aceitar"
    function pickDrawNeeded() { return 3 + Math.floor(Math.random() * 3); }

    function resetDrawState() {
        seenPositions.clear();
        lastSeenKey = '';
        drawOffers = 0;
        drawStreak = 0;
        drawStreakFEN = '';
        drawNeeded = pickDrawNeeded();
        drawAcceptedAt = 0;
        if (drawAcceptTimer) { timers.clear(drawAcceptTimer); drawAcceptTimer = null; }
    }

    function pieceCountOnBoard() { return Object.keys(getBoardPosition()).length; }

    function isEqualEndgame() {
        const ev = lastWhiteEval;
        if (!ev || ev.type !== 'cp' || !currentLines[0]) return false;
        if (pieceCountOnBoard() > DRAW_MAX_PIECES) return false;
        return Math.abs(userEvalValue()) <= DRAW_EQUAL_CP;
    }

    function updateDrawStreak() {
        if (!isMyTurn() || currentAnalysisFEN === drawStreakFEN) return;
        drawStreakFEN = currentAnalysisFEN;
        if (isEqualEndgame()) drawStreak++;
        else if (drawStreak > 0) drawStreak = 0;
    }

    function shouldOfferDraw() {
        if (!autoMoveEnabled || !isMyTurn() || drawOffers >= 2) return false;
        if (timeControlKind() === 'bullet') return false;
        return drawStreak >= drawNeeded && isEqualEndgame();
    }

    // Prefere elementos visíveis; sem nenhum visível, usa o primeiro que existir
    function pickVisible(list) {
        return list.find(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) || list[0] || null;
    }

    // Botão de oferecer empate (ignora "recusar", "cancelar" e botões já dentro de janelas)
    function findDrawButton() {
        if (findDrawAcceptButton()) return null;   // o adversário é quem ofereceu: não mexe
        const list = Array.from(document.querySelectorAll('button, [role="button"], a'))
            .filter(isSafeControl)
            .filter(el => !el.closest('#chess-position-panel') && !el.closest('[role="dialog"]'))
            .filter(el => (el.textContent || '').trim().length <= 20)
            .filter(el => { const t = textOfControl(el); return DRAW_BUTTON_RE.test(t) && !/recus|decline|reject|cancel|aceit|accept/.test(t); });
        return pickVisible(list);
    }

    function confirmDrawOffer(attempt, drawBtn) {
        const dialogs = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="dialog"], [class*="confirm"], [class*="popover"]');
        for (const d of dialogs) {
            // só janelas que falam de empate (não confundir com outra confirmação aberta na página)
            const about = DRAW_CONTEXT_RE.test((d.textContent || '').toLowerCase());
            const el = findControl(about ? DRAW_CONFIRM_RE : /^(oferecer|offer)/, d, false, drawBtn);
            if (el) { el.click(); return; }
        }
        if (attempt < 3) timers.setTimeout(() => confirmDrawOffer(attempt + 1, drawBtn), 400);
    }

    // Oferece o empate e espera 3 a 4 s; depois joga o lance (se o jogo continuar)
    function offerDrawThenMove(bestMove) {
        cancelPendingMove();
        drawOffers++;
        drawStreak = -5;   // só volta a oferecer depois de vários lances
        const btn = findDrawButton();
        if (!btn) {
            console.log('[Jogada automática] Botão de empate não encontrado; jogando o melhor lance.');
            scheduleAutoMove(bestMove);
            return;
        }
        console.log('[Jogada automática] Posição de empate: oferecendo empate.');
        btn.click();
        timers.setTimeout(() => confirmDrawOffer(1, btn), 500);
        const fenAtOffer = currentAnalysisFEN;
        const wait = 3000 + Math.random() * 1000;
        updateEngineStatus(tr('e.drawOffered', { s: trSec(wait) }));
        pendingMoveTimer = timers.setTimeout(() => {
            pendingMoveTimer = null;
            if (!autoMoveEnabled) return;
            if (positionToFEN(getBoardPosition()) !== fenAtOffer) return;   // o jogo mudou
            scheduleAutoMove(bestMove);
        }, wait);
    }

    // Botão "Aceitar" de um empate oferecido pelo adversário (ou null)
    function findDrawAcceptButton() {
        const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'))
            .filter(isSafeControl)
            .filter(el => !el.closest('#chess-position-panel'))
            .filter(el => DRAW_ACCEPT_RE.test(textOfControl(el)) && (el.textContent || '').trim().length <= 40);
        const shown = candidates.filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
        for (const el of (shown.length ? shown : candidates)) {
            let node = el;
            for (let i = 0; i < 4 && node; i++, node = node.parentElement) {
                if (DRAW_CONTEXT_RE.test((node.textContent || '').toLowerCase()) && (node.textContent || '').length < 200) return el;
            }
        }
        return null;
    }

    function shouldAcceptDraw() {
        const ev = lastWhiteEval;
        if (!ev || !currentLines[0]) return false;
        const v = userEvalValue();
        if (ev.type === 'mate') return v < 0;
        if (v <= -120) return true;                                   // pior: empate é bom negócio
        return Math.abs(v) <= 40 && pieceCountOnBoard() <= DRAW_MAX_PIECES;
    }

    // Chamado a cada 500 ms: se o adversário ofereceu empate e a posição pede, aceita como uma pessoa
    function checkDrawOffer() {
        if (!autoMoveEnabled || drawAcceptTimer || Date.now() - drawAcceptedAt < 15000) return;
        const btn = findDrawAcceptButton();
        if (!btn || !shouldAcceptDraw()) return;
        const wait = 1200 + Math.random() * 2300;
        updateEngineStatus(tr('e.acceptDraw', { s: trSec(wait) }));
        drawAcceptTimer = timers.setTimeout(() => {
            drawAcceptTimer = null;
            if (!autoMoveEnabled) return;
            const b = findDrawAcceptButton();
            if (b && shouldAcceptDraw()) { console.log('[Jogada automática] Aceitando o empate oferecido.'); drawAcceptedAt = Date.now(); b.click(); }
        }, wait);
    }

    // Modo manual (jogada automática desligada): em vez de agir, o painel SUGERE desistir ou oferecer
    // empate, com os mesmos critérios da jogada automática.
    function manualSuggestion() {
        if (autoMoveEnabled || !isMyTurn()) return null;
        const ev = lastWhiteEval;
        if (!ev || !currentLines[0]) return null;
        if (isLostPosition()) {
            const grave = ev.type === 'mate' || userEvalValue() <= RESIGN_IMMEDIATE_CP;
            if (grave || resignStreak >= RESIGN_CONFIRMATIONS) return { kind: 'resign', text: tr('a.sugResign') };
        }
        if (timeControlKind() !== 'bullet' && drawStreak >= drawNeeded && isEqualEndgame()) {
            return { kind: 'draw', text: tr('a.sugDraw') };
        }
        return null;
    }

    // Decide entre desistir, oferecer empate ou jogar o melhor lance
    function scheduleAutoAction(bestMove) {
        if (shouldResign()) scheduleResign();
        else if (shouldOfferDraw()) offerDrawThenMove(bestMove);
        else scheduleAutoMove(bestMove);
    }

    // ============= AUTO-MOVE: TEMPO DE "PENSAR" =============
    function cancelPendingMove() {
        if (pendingMoveTimer) { timers.clear(pendingMoveTimer); pendingMoveTimer = null; }
    }

    function isMyTurn() {
        const amPlayingWhite = !isBoardFlipped();
        return amPlayingWhite ? analysisTurn === 'w' : analysisTurn === 'b';
    }

    // Segundos que restam no meu relógio (parte de baixo), ou null se não achar.
    function getMyClockSeconds() {
        try {
            const el = document.querySelector('.clock-bottom .clock-time-monospace') ||
                       document.querySelector('.clock-bottom');
            if (!el) return null;
            const m = el.textContent.trim().match(/^(?:(\d+):)?(\d+):(\d+)(?:\.(\d+))?$/);
            if (!m) return null;
            const hours = m[1] ? parseInt(m[1]) : 0;
            return hours * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + (m[4] ? parseFloat('0.' + m[4]) : 0);
        } catch (e) {
            return null;
        }
    }

    // Dificuldade 0..1 da decisão: lance óbvio = baixa, várias opções parecidas = alta.
    function computeComplexity(bestMove) {
        const lines = currentLines.filter(Boolean);
        const cp = (s) => !s ? 0 : (s.type === 'mate' ? (s.value > 0 ? 10000 : -10000) : s.value);

        let complexity;
        if (lines.length < 2) {
            complexity = 0.1; // só existe um lance razoável (forçado)
        } else {
            const gap = cp(lines[0].score) - cp(lines[1].score);
            complexity = gap >= 300 ? 0.1 : gap >= 150 ? 0.25 : gap >= 60 ? 0.5 : gap >= 25 ? 0.75 : 1;
        }

        // Recaptura na casa do último lance do adversário: decisão rápida
        if (lastMoveAtAnalysis && lastMoveAtAnalysis.to === bestMove.substring(2, 4)) {
            complexity = Math.max(0.1, complexity - 0.3);
        }
        // Abertura (quase todas as peças no tabuleiro): jogadas conhecidas, mais rápidas
        if (pieceCountAtAnalysis >= 30) complexity *= 0.5;
        // Posição já decidida: não precisa pensar muito
        if (lines[0] && Math.abs(cp(lines[0].score)) >= 600) complexity *= 0.6;

        return Math.min(1, Math.max(0, complexity));
    }

    // ============= TIPO DE PARTIDA =============
    // O maior valor do meu relógio visto na partida é o tempo inicial (o relógio só desce, fora
    // incrementos pequenos). Menos de 3 min = bullet; menos de 10 min = blitz; senão, rápida.
    let gameBaseClock = 0;

    function noteClock() {
        const s = getMyClockSeconds();
        if (s !== null && s > gameBaseClock) gameBaseClock = s;
    }

    function timeControlKind() {
        if (gameBaseClock <= 0) return 'blitz';        // não achou o relógio: assume blitz
        if (gameBaseClock < 180) return 'bullet';
        if (gameBaseClock < 600) return 'blitz';
        return 'rapid';
    }

    // Tempo típico (s) de um lance comum, e teto, por tipo de partida
    const TIME_BY_KIND = {
        bullet: { median: 0.3, cap: 2.5, floor: 0.12 },
        blitz: { median: 0.65, cap: 6, floor: 0.25 },
        rapid: { median: 1.6, cap: 14, floor: 0.4 }
    };

    // Número aleatório com distribuição normal (Box-Muller)
    function gaussian() {
        const u = 1 - Math.random(), v = Math.random();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    // Lance "excelente": o melhor lance do motor, silencioso (sem captura), muito melhor que o
    // segundo colocado, fora da abertura e sem ser uma recaptura. Só esse tipo faz a pessoa pensar.
    function isStandoutMove(move) {
        const lines = currentLines.filter(l => l && l.move);
        if (lines.length < 2 || lines[0].move !== move) return false;
        const cp = (s) => !s ? 0 : (s.type === 'mate' ? (s.value > 0 ? 10000 : -10000) : s.value);
        const best = cp(lines[0].score);
        const gap = best - cp(lines[1].score);
        if (gap < 110) return false;
        if (best >= 900 && lines[0].score.type !== 'mate') return false;   // já ganho: lance simples
        if (pieceCountAtAnalysis >= 30) return false;                      // abertura
        const to = move.substring(2, 4);
        if (lastMoveAtAnalysis && lastMoveAtAnalysis.to === to) return false;
        const positions = getBoardPosition();
        if (positions[to]) return false;                                   // captura
        return true;
    }

    // Tempo total (ms) desde o início da análise até clicar no lance.
    function computeThinkTime(bestMove) {
        noteClock();
        const kind = TIME_BY_KIND[timeControlKind()];
        const engineBest = currentLines.find(l => l && l.move);
        const isError = !!engineBest && engineBest.move !== bestMove && !(lastPlan && lastPlan.best && lastPlan.best.move === bestMove);   // lance de erro simulado

        let mult;
        if (isError) {
            mult = 0.6;                                      // erro sai rápido
        } else if (isStandoutMove(bestMove)) {
            mult = 3 + Math.random() * 1.5;                  // lance excelente: pensa um pouco mais
        } else {
            mult = 0.45 + computeComplexity(bestMove) * 0.75; // simples = bem rápido
        }
        mult *= PACE_FACTOR[settings.pace] || 1;

        // Variação aleatória (log-normal): a maioria perto da mediana, alguns bem mais rápidos
        // ou mais lentos, para os tempos nunca seguirem um padrão fixo
        let noise = Math.exp(0.4 * gaussian());
        noise = Math.min(2.6, Math.max(0.45, noise));
        let sec = kind.median * mult * noise;

        // Pouco tempo no relógio: joga mais rápido
        const remaining = getMyClockSeconds();
        if (remaining !== null) {
            if (remaining < 10) sec *= 0.4;
            else if (remaining < 30) sec *= 0.65;
            sec = Math.min(sec, remaining * 0.1);
        }
        sec = Math.min(sec, kind.cap);
        if (pieceCountOnBoard() >= 30) sec = Math.min(sec, 1.4);   // abertura: joga rápido
        if (lastPlan && lastPlan.style === 'mate') sec = Math.min(sec, 0.9);   // mate óbvio: não fica pensando
        return Math.max(kind.floor, sec) * 1000;
    }

    // ============= ERROS HUMANOS (jogar na força do rating escolhido) =============
    // Mesmo com profundidade baixa o Stockfish joga bem (enxerga capturas e táticas curtas), então
    // a profundidade sozinha não reproduz o rating. Para a jogada automática ficar na força
    // escolhida, quanto menor o rating, mais ela escolhe de propósito um lance pior entre os
    // candidatos do motor (imprecisão) e, mais raramente, um erro grave.
    // Colunas: rating, chance de imprecisão por lance, perda máxima da imprecisão (centipeões),
    // chance de erro grave por lance.
    // Calibrada pela precisão média da partida (fórmula do Lichess; veja ferramentas/teste/calibra.js):
    // rating 800 ≈ 62%, 1200 ≈ 75%, 1600 ≈ 84%, 2100 ≈ 91%, 2600 ≈ 95%. Quanto menor o rating, menor a precisão.
    const ERROR_TABLE = [
        [800, 0.75, 600, 0.12],
        [1000, 0.65, 500, 0.09],
        [1200, 0.55, 420, 0.065],
        [1400, 0.45, 340, 0.045],
        [1600, 0.36, 270, 0.03],
        [1800, 0.29, 215, 0.02],
        [2000, 0.24, 175, 0.015],
        [2200, 0.18, 140, 0.01],
        [2400, 0.13, 110, 0.005],
        [2600, 0.08, 85, 0.002],
        [2800, 0.04, 60, 0],
        [3200, 0, 0, 0]
    ];
    const MIN_INACCURACY_LOSS = 25;   // abaixo disso o lance é equivalente ao melhor
    const BLUNDER_MAX_LOSS = 900;     // o erro grave perde, no máximo, uma dama
    const CANDIDATES_WITH_ERRORS = 8; // lances candidatos pedidos ao motor quando há erros

    function errorProfile(rating) {
        const t = ERROR_TABLE;
        const row = (r) => ({ inaccuracy: r[1], maxLoss: r[2], blunder: r[3] });
        if (rating <= t[0][0]) return row(t[0]);
        if (rating >= t[t.length - 1][0]) return row(t[t.length - 1]);
        for (let i = 0; i < t.length - 1; i++) {
            const a = t[i], b = t[i + 1];
            if (rating >= a[0] && rating <= b[0]) {
                const f = (rating - a[0]) / (b[0] - a[0]);
                const mix = (x, y) => x + (y - x) * f;
                return { inaccuracy: mix(a[1], b[1]), maxLoss: mix(a[2], b[2]), blunder: mix(a[3], b[3]) };
            }
        }
        return row(t[t.length - 1]);
    }

    function currentRating() {
        return DEPTH_RATINGS[analysisDepth] || DEPTH_RATINGS[MAX_DEPTH];
    }

    // Quantos lances candidatos pedir ao motor (mais candidatos = mais opções para errar)
    function engineMultiPV() {
        return CANDIDATES_WITH_ERRORS;   // sempre vários candidatos: erros e agressividade escolhem entre eles
    }

    // ============= ESTILO DE JOGO (vale para qualquer rating e para a jogada automática) =============
    // Agressivo: entre os lances quase tão bons quanto o melhor, prefere xeques e capturas.
    // Defensivo: prefere tirar peça de ataque, rocar e ir para casas seguras.
    // Automático: à frente ataca, atrás defende, igualado joga normal.
    const STYLE_TOLERANCE = { aggressive: 80, aggressiveCapture: 120, defensive: 70 };   // perda máxima aceita (centipeões)

    function resolveStyle() {
        const st = settings.style;
        if (st !== 'auto') return st || 'normal';
        const ev = lastWhiteEval;
        if (!ev) return 'normal';
        const v = userEvalValue();
        if (ev.type === 'mate') return v > 0 ? 'aggressive' : 'defensive';
        return v >= 150 ? 'aggressive' : v <= -150 ? 'defensive' : 'normal';
    }

    // Tabuleiro depois do lance (roque e en passant incluídos; promoção sempre vira dama)
    function applyMoveToPositions(positions, mv) {
        const next = Object.assign({}, positions);
        const from = mv.substring(0, 2), to = mv.substring(2, 4);
        const piece = next[from];
        if (!piece) return next;
        delete next[from];
        if (piece.type[1] === 'p' && from[0] !== to[0] && !next[to]) delete next[to[0] + from[1]];   // en passant
        next[to] = (piece.type[1] === 'p' && (to[1] === '8' || to[1] === '1')) ? { type: piece.color + 'q', color: piece.color } : piece;
        if (piece.type[1] === 'k' && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2) {   // roque
            const rank = from[1], kingSide = to[0] === 'g';
            const rookFrom = (kingSide ? 'h' : 'a') + rank, rookTo = (kingSide ? 'f' : 'd') + rank;
            if (next[rookFrom]) { next[rookTo] = next[rookFrom]; delete next[rookFrom]; }
        }
        return next;
    }

    function squaresAttackedBy(positions, color) {
        const set = new Set();
        for (const [sq, p] of Object.entries(positions)) {
            if (p.color !== color) continue;
            for (const a of getAttackedSquares(positions, sq, p)) set.add(a);
        }
        return set;
    }

    function moveGivesCheck(positions, mv) {
        const after = applyMoveToPositions(positions, mv);
        const mover = positions[mv.substring(0, 2)];
        if (!mover) return false;
        const enemyKing = Object.keys(after).find(sq => after[sq].type === (mover.color === 'w' ? 'bk' : 'wk'));
        return !!enemyKing && squaresAttackedBy(after, mover.color).has(enemyKing);
    }

    // Valores das peças de "color" que atacam a casa (rei vale 99: só captura se a casa não for defendida)
    function attackersOn(positions, sq, color) {
        const out = [];
        for (const [from, p] of Object.entries(positions)) {
            if (p.color !== color || from === sq) continue;
            if (getAttackedSquares(positions, from, p).includes(sq)) out.push(p.type[1] === 'k' ? 99 : (PIECE_VALUES[p.type[1]] || 0));
        }
        return out;
    }

    // Material de "color" em risco: peça atacada e sem defesa vale o valor dela inteiro; peça defendida
    // mas atacada por uma peça mais barata vale a diferença.
    function exposure(positions, color, skipSq) {
        const enemy = color === 'w' ? 'b' : 'w';
        let total = 0;
        for (const [sq, p] of Object.entries(positions)) {
            if (p.color !== color || p.type[1] === 'k' || sq === skipSq) continue;
            const att = attackersOn(positions, sq, enemy);
            if (!att.length) continue;
            const v = PIECE_VALUES[p.type[1]] || 0;
            const defended = attackersOn(positions, sq, color).length > 0;
            total += defended ? Math.max(0, v - Math.min(...att)) : v;
        }
        return total;
    }

    // Valor da peça inimiga capturada pelo lance (0 se não captura; en passant vale 1)
    function capturedValueOf(positions, mv) {
        const mover = positions[mv.substring(0, 2)];
        if (!mover) return 0;
        const to = mv.substring(2, 4), from = mv.substring(0, 2);
        const target = positions[to];
        if (target) return target.color !== mover.color ? (PIECE_VALUES[target.type[1]] || 0) : 0;
        return mover.type[1] === 'p' && from[0] !== to[0] ? 1 : 0;
    }

    // Agressivo: o objetivo é CAPTURAR (troca também vale) e atacar peças; xeque e promoção ajudam.
    // Defensivo: o objetivo é NÃO PERDER PEÇA: protege o que está ameaçado, evita trocas, rocar e casas seguras.
    function styleScore(positions, mv, style) {
        const mover = positions[mv.substring(0, 2)];
        if (!mover) return 0;
        const me = mover.color, enemy = me === 'w' ? 'b' : 'w';
        const from = mv.substring(0, 2), to = mv.substring(2, 4);
        const captured = capturedValueOf(positions, mv);
        const moverValue = PIECE_VALUES[mover.type[1]] || 0;
        const after = applyMoveToPositions(positions, mv);
        const recapture = attackersOn(after, to, enemy).length > 0;   // a casa de destino fica sob ataque
        let score = 0;

        if (style === 'aggressive') {
            if (captured > 0) {
                const losing = recapture && captured < moverValue;     // entrega peça maior por uma menor: só um pouco
                score += losing ? 1 : (recapture ? 6 + captured : 8 + captured);   // troca vale; captura livre vale mais
            }
            if (moveGivesCheck(positions, mv)) score += 2;
            if (mv.length === 5) score += 3;
            // novas ameaças: peças inimigas (cavalo para cima) que passam a ser atacadas
            const mineBefore = squaresAttackedBy(positions, me), mineAfter = squaresAttackedBy(after, me);
            let threats = 0;
            for (const [sq, p] of Object.entries(after)) {
                if (p.color === enemy && p.type[1] !== 'k' && (PIECE_VALUES[p.type[1]] || 0) >= 3 && mineAfter.has(sq) && !mineBefore.has(sq)) threats++;
            }
            return score + Math.min(2, threats);
        }

        // defensivo
        score += (exposure(positions, me) - exposure(after, me)) * 2;   // protege / tira de ataque / não cria alvo
        const castled = mover.type[1] === 'k' && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2;
        if (castled) score += 3;
        if (captured > 0) {
            if (!recapture) score += 3;                                  // ganha material sem risco
            else score += captured > moverValue ? -1 : captured === moverValue ? -3 : -4;   // troca: evita
        }
        score += recapture ? -0.5 : 0.5;                                 // casa segura
        if (mover.type[1] === 'p' && (me === 'w' ? parseInt(to[1]) >= 6 : parseInt(to[1]) <= 3)) score -= 1;   // avanço arriscado
        return score;
    }

    // Perda máxima aceita (centipeões) para trocar o melhor lance por um de estilo
    function styleTolerance(style, positions, mv) {
        if (style === 'aggressive') return capturedValueOf(positions, mv) > 0 ? STYLE_TOLERANCE.aggressiveCapture : STYLE_TOLERANCE.aggressive;
        return STYLE_TOLERANCE[style];
    }

    // Entre os lances quase tão bons quanto o melhor, o de maior pontuação de estilo (ou null)
    function pickStyleLine(lines, refCp, style, positions, cp) {
        if (!STYLE_TOLERANCE[style]) return null;
        const ref = lines[0];
        const pool = lines.filter(l => refCp - cp(l.score) <= styleTolerance(style, positions, l.move) && !(l.move.length === 5 && l.move[4] !== 'q'));
        let best = ref, bestScore = styleScore(positions, ref.move, style);
        for (const l of pool) {
            const sc = styleScore(positions, l.move, style);
            if (sc > bestScore + 0.01 || (Math.abs(sc - bestScore) <= 0.01 && sc > 0 && cp(l.score) > cp(best.score))) { best = l; bestScore = sc; }
        }
        return best === ref ? null : best;
    }

    // Mate em 1: lance que dá xeque-mate agora. É a jogada mais óbvia que existe: nunca pode ser perdida
    // (nem por erro simulado, nem por estilo, nem por profundidade baixa do motor).
    function findMateInOne(fen) {
        try {
            const Ch = (typeof self !== 'undefined' && self.CPPChess) || window.CPPChess;
            if (!Ch || !fen) return null;
            const st = Ch.fenToState(fen);
            for (const m of Ch.legalMoves(st)) {
                if (m.promo && m.promo !== 'q') continue;
                const n = Ch.makeMove(st, m);
                if (Ch.inCheck(n, n.turn) && Ch.legalMoves(n).length === 0) return Ch.moveToUci(m);
            }
        } catch (e) { /* sem o módulo de regras: segue sem esta checagem */ }
        return null;
    }

    // Repetição: quantas vezes cada posição (peças + vez) já apareceu na partida. Quem está ganhando
    // não pode deixar a partida acabar empatada por repetição.
    const seenPositions = new Map();
    let lastSeenKey = '';
    function noteSeenPosition(fen) {
        const key = placementOnly(fen) + ' ' + (fen.split(' ')[1] || 'w');
        if (key === lastSeenKey) return;
        lastSeenKey = key;
        seenPositions.set(key, (seenPositions.get(key) || 0) + 1);
    }
    // Quantas vezes a posição que sai deste lance já apareceu
    function repeatsAfter(positions, mv) {
        const p = positions[mv.substring(0, 2)];
        if (!p) return 0;
        const after = applyMoveToPositions(positions, mv);
        const key = placementOnly(positionToFEN(after)) + ' ' + (p.color === 'w' ? 'b' : 'w');
        return seenPositions.get(key) || 0;
    }

    // Saldo de material de uma captura, contando a recaptura (Infinity se o lance não captura).
    // Dama x torre recapturada = 5 − 9 = −4. Ninguém faz isso por vontade própria.
    function captureNet(positions, mv) {
        const mover = positions[mv.substring(0, 2)];
        const captured = capturedValueOf(positions, mv);
        if (!mover || captured <= 0) return Infinity;
        const to = mv.substring(2, 4), me = mover.color, enemy = me === 'w' ? 'b' : 'w';
        const after = applyMoveToPositions(positions, mv);
        const mine = attackersOn(after, to, me).length > 0;
        const att = attackersOn(after, to, enemy).filter(v => v !== 99 || !mine);   // rei só recaptura casa não defendida
        if (!att.length) return captured;
        return captured - (PIECE_VALUES[mover.type[1]] || 0);
    }

    // Sacrifício: captura que perde material, ou peça (cavalo para cima) levada de graça a casa atacada
    function isSacrifice(positions, mv) {
        const mover = positions[mv.substring(0, 2)];
        if (!mover) return false;
        if (capturedValueOf(positions, mv) > 0) return captureNet(positions, mv) < 0;
        const v = PIECE_VALUES[mover.type[1]] || 0;
        if (v < 3) return false;
        const to = mv.substring(2, 4), me = mover.color, enemy = me === 'w' ? 'b' : 'w';
        const after = applyMoveToPositions(positions, mv);
        const mine = attackersOn(after, to, me).length > 0;
        const att = attackersOn(after, to, enemy).filter(x => x !== 99 || !mine);
        if (!att.length) return false;
        const loss = mine ? Math.max(0, v - Math.min(...att)) : v;
        // já estava atacada antes do lance? (então mexer não é sacrifício novo)
        const before = attackersOn(positions, mv.substring(0, 2), enemy).length > 0;
        return loss >= 2 && !before;
    }

    // Sem lance bom que não repita: um lance de progresso seguro (captura sem prejuízo, xeque, peão, promoção)
    function pickProgressMove(positions, fen) {
        try {
            const Ch = (typeof self !== 'undefined' && self.CPPChess) || window.CPPChess;
            if (!Ch || !fen) return null;
            const st = Ch.fenToState(fen);
            let best = null, bestScore = -Infinity;
            for (const m of Ch.legalMoves(st)) {
                if (m.promo && m.promo !== 'q') continue;
                const uci = Ch.moveToUci(m);
                const from = uci.substring(0, 2), to = uci.substring(2, 4);
                const mover = positions[from];
                if (!mover || repeatsAfter(positions, uci) > 0) continue;
                const me = mover.color, enemy = me === 'w' ? 'b' : 'w';
                const after = applyMoveToPositions(positions, uci);
                if (attackersOn(after, to, enemy).length > 0 && !(attackersOn(after, to, me).length > 0 && capturedValueOf(positions, uci) >= (PIECE_VALUES[mover.type[1]] || 0))) continue;
                if (exposure(after, me, to) > exposure(positions, me, from)) continue;
                let sc = capturedValueOf(positions, uci) * 3 + (moveGivesCheck(positions, uci) ? 2 : 0) + (mover.type[1] === 'p' ? 1 : 0) + (uci.length === 5 ? 5 : 0);
                if (sc > bestScore) { best = uci; bestScore = sc; }
            }
            return best;
        } catch (e) { return null; }
    }

    // Captura óbvia (só abaixo de OBVIOUS_CAPTURE_MAX_RATING): captura que não dá prejuízo de material,
    // mesmo contando a recaptura. Peça livre = ganha o valor dela; se puder ser recapturada, vale
    // (valor capturado − valor de quem captura), e troca igual (saldo 0) também vale. Não olha armadilhas:
    // quem joga assim abaixo de 2000 não as vê. Não deixa outra peça sua pendurada de graça.
    // Devolve o lance (ex.: "d4e5") ou null.
    const OBVIOUS_CAPTURE_MAX_RATING = 2000;
    function findObviousCapture(positions, fen, minNet = 0) {
        try {
            const Ch = (typeof self !== 'undefined' && self.CPPChess) || window.CPPChess;
            if (!Ch || !fen || !positions) return null;
            const st = Ch.fenToState(fen);
            let best = null;
            for (const m of Ch.legalMoves(st)) {
                if (m.promo && m.promo !== 'q') continue;
                const uci = Ch.moveToUci(m);
                const from = uci.substring(0, 2), to = uci.substring(2, 4);
                const mover = positions[from];
                if (!mover) continue;
                const captured = capturedValueOf(positions, uci);
                if (captured <= 0) continue;
                const moverValue = PIECE_VALUES[mover.type[1]] || 0;
                const n = Ch.makeMove(st, m);
                const after = applyMoveToPositions(positions, uci);
                // a menor peça inimiga que pode recapturar na casa de destino (rei também, se for legal)
                let cheapest = Infinity;
                for (const r of Ch.legalMoves(n)) {
                    const ru = Ch.moveToUci(r);
                    if (ru.substring(2, 4) !== to) continue;
                    const rp = after[ru.substring(0, 2)];
                    if (rp) cheapest = Math.min(cheapest, rp.type[1] === 'k' ? 99 : (PIECE_VALUES[rp.type[1]] || 0));
                }
                const recapture = cheapest !== Infinity;
                const net = recapture ? captured - (moverValue || 0) : captured;
                if (net < minNet) continue;
                // não pode deixar outra peça sua em perigo maior do que o ganho
                const me = mover.color;
                const exBefore = exposure(positions, me, from), exAfter = exposure(after, me, to);
                if (exAfter > exBefore || (exAfter > 0 && captured < exAfter)) continue;
                if (!best || net > best.net || (net === best.net && captured > best.captured)) best = { uci, net, captured };
            }
            return best ? best.uci : null;
        } catch (e) { return null; }
    }

    // Plano de lances da posição: verde = melhor lance, laranja = lance intermediário (imprecisão),
    // vermelho = lance ruim (erro). São EXATAMENTE os lances que a jogada automática pode jogar, e as
    // setas do tabuleiro mostram esses mesmos três, para o modo manual e o automático combinarem.
    // Regras de humanidade: nunca deixa de capturar uma peça óbvia para fazer outro lance (o erro
    // humano típico é capturar do jeito errado), nunca leva mate, nunca subpromove.
    function planCandidates(bestMove, rating = currentRating(), rng = Math.random) {
        const profile = errorProfile(rating);
        const lines = currentLines.filter(l => l && l.move);
        if (lines.length < 1) return null;

        // Placar em centipeões; mate vira um valor enorme
        const cp = (s) => !s ? 0 : (s.type === 'mate' ? (s.value > 0 ? 3000 : -3000) : s.value);
        const engineBest = lines.find(l => l.move === bestMove) || lines[0];
        const bestCp = cp(engineBest.score);
        const positions = getBoardPosition();
        // Estilo de jogo: o lance verde pode ser um quase tão bom quanto o melhor, mas mais agressivo/defensivo
        const ordered = [engineBest].concat(lines.filter(l => l !== engineBest));
        const styled = pickStyleLine(ordered, bestCp, resolveStyle(), positions, cp);
        let bestLine = styled || engineBest;
        // Abaixo de 2000: captura óbvia (sem prejuízo de material) é sempre jogada, mesmo se for armadilha.
        // Mate à vista tem prioridade.
        let obviousForced = false;
        const mateAhead = engineBest.score && engineBest.score.type === 'mate' && engineBest.score.value > 0 && engineBest.score.value <= 3;
        // Agressivo: captura sempre que a troca for igual ou vantajosa, em qualquer rating.
        // Defensivo: só captura sozinho o que ganha material (troca igual fica a critério do motor).
        // Automático: segue o rating (abaixo de 2000 captura; acima, o motor decide).
        const styleNow = resolveStyle();
        const lowRating = rating < OBVIOUS_CAPTURE_MAX_RATING;
        const wantCapture = styleNow === 'aggressive' || lowRating;
        if (wantCapture && !mateAhead) {
            const minNet = styleNow === 'defensive' ? 1 : 0;
            let ob = findObviousCapture(positions, currentAnalysisFEN || positionToFEN(positions), minNet);
            if (ob && !lowRating) {   // rating alto: não cai em armadilha que o motor enxerga
                const l = lines.find(x => x.move === ob);
                if (l && bestCp - cp(l.score) > 300) ob = null;
            }
            if (ob) {
                obviousForced = true;
                if (ob !== bestLine.move) {
                    bestLine = lines.find(l => l.move === ob) || { move: ob, score: engineBest.score, depth: engineBest.depth, synthetic: true };
                }
            }
        }
        // Ganhando (≥ +1,0 peão): não repete posição (evita empate por repetição quando está melhor).
        if (!obviousForced && !mateAhead && bestCp >= 100 && repeatsAfter(positions, bestLine.move) > 0) {
            const floor = Math.max(100, bestCp - 300);
            const alt = ordered.filter(l => !(l.move.length === 5 && l.move[4] !== 'q') && cp(l.score) >= floor && repeatsAfter(positions, l.move) === 0)
                .sort((x, y) => cp(y.score) - cp(x.score))[0];
            if (alt) bestLine = alt;
            else {
                const pm = pickProgressMove(positions, currentAnalysisFEN || positionToFEN(positions));
                if (pm) bestLine = lines.find(l => l.move === pm) || { move: pm, score: { type: 'cp', value: Math.max(100, bestCp - 200) }, depth: engineBest.depth, synthetic: true };
            }
        }
        // Captura voluntária que perde material (ex.: dama x torre defendida): só se não houver saída.
        // Havendo lance quase tão bom que não perde material, joga esse.
        // Abaixo de 2000 não há "lance brilhante": sacrifício (captura que perde material ou peça que vai de
        // graça para uma casa atacada) é descartado quando existe lance quase tão bom sem ele.
        // Acima de 2000 o sacrifício do motor é mantido.
        if (!mateAhead && rating < OBVIOUS_CAPTURE_MAX_RATING && isSacrifice(positions, bestLine.move)) {
            const safe = ordered.filter(l => !(l.move.length === 5 && l.move[4] !== 'q') && !isSacrifice(positions, l.move) && bestCp - cp(l.score) <= 300)
                .sort((x, y) => cp(y.score) - cp(x.score))[0];
            if (safe) bestLine = safe;
        }
        const greenLoss = bestCp - cp(bestLine.score);
        let options = lines
            .filter(l => l.move !== bestLine.move)
            .filter(l => !(l.move.length === 5 && l.move[4] !== 'q'))   // não escolhe subpromoção
            .map(l => ({ move: l.move, loss: bestCp - cp(l.score), line: l }))
            .filter(o => o.loss > greenLoss && cp({ type: 'cp', value: bestCp - o.loss }) > -2500) // pior que o verde e nunca leva mate
            .filter(o => captureNet(positions, o.move) >= 0)   // erro humano não entrega peça maior por menor (dama por torre)
            .filter(o => mateAhead || rating >= OBVIOUS_CAPTURE_MAX_RATING || !isSacrifice(positions, o.move));   // nem dama de graça num xeque sem fundamento

        // Captura: o melhor lance é captura, ou há uma captura vantajosa óbvia entre os candidatos
        // (peça maior ou igual à que captura, valendo pelo menos um cavalo) => os lances de erro
        // também são capturas. Sem captura óbvia, capturar ainda é o erro mais provável.
        const capturedValue = (mv) => {
            const from = positions[mv.substring(0, 2)], to = mv.substring(2, 4);
            if (!from) return 0;
            const target = positions[to];
            if (target) return PIECE_VALUES[target.type[1]] || 0;
            if (from.type[1] === 'p' && mv[0] !== mv[2]) return 1;   // en passant
            return 0;
        };
        const moverValue = (mv) => { const p = positions[mv.substring(0, 2)]; return p ? (PIECE_VALUES[p.type[1]] || 0) : 0; };
        const isCapture = (mv) => capturedValue(mv) > 0;
        const obviousCapture = lines.some(l => { const got = capturedValue(l.move); return got >= 3 && got >= moverValue(l.move); });
        if (isCapture(bestLine.move) || obviousCapture) options = options.filter(o => isCapture(o.move));
        else options.forEach(o => { if (isCapture(o.move)) o.boost = 2; });

        const pickWeighted = (list, weightOf) => {
            const total = list.reduce((s, o) => s + weightOf(o), 0);
            let r = rng() * total;
            for (const o of list) { r -= weightOf(o); if (r <= 0) return o; }
            return list[list.length - 1];
        };

        // Laranja: perda pequena (lances levemente piores são mais prováveis). Vermelho: bem pior.
        // Mesmo com rating alto (que quase não erra) as setas mostram os dois, para o modo manual.
        const maxLoss = Math.max(profile.maxLoss, 120);
        const mild = options.filter(o => o.loss >= MIN_INACCURACY_LOSS && o.loss <= maxLoss);
        const bad = options.filter(o => o.loss > maxLoss && o.loss <= BLUNDER_MAX_LOSS);
        let orange = mild.length ? pickWeighted(mild, (x) => (x.boost || 1) / (1 + x.loss / 60)) : null;
        let red = bad.length ? pickWeighted(bad, (x) => x.boost || 1) : null;
        // Sem opção na faixa: usa o que houver (o pior para o vermelho, o seguinte para o laranja)
        const rest = options.slice().sort((x, y) => x.loss - y.loss);
        if (!orange) orange = rest.find(o => o !== red && o.loss < (red ? red.loss : Infinity)) || null;
        if (!red) red = rest.slice().reverse().find(o => o !== orange && (!orange || o.loss > orange.loss)) || null;
        return { best: bestLine, orange, red, profile, rating, style: resolveStyle(), obvious: obviousForced };
    }

    // Os três lances como linhas de seta: [verde, laranja, vermelho] (vazio quando não há)
    function planArrowLines(plan) {
        if (!plan) return [];
        return [plan.best, plan.orange && plan.orange.line, plan.red && plan.red.line]
            .map((l, slot) => l ? Object.assign({}, l, { slot }) : null);
    }

    // Escolhe o lance a jogar entre os do plano: normalmente o verde; no rating baixo, às vezes
    // o laranja (imprecisão) e, mais raramente, o vermelho (erro grave).
    function chooseMoveWithErrors(bestMove, rating = currentRating(), rng = Math.random, plan) {
        const profile = errorProfile(rating);
        plan = plan || planCandidates(bestMove, rating, rng);
        if (!plan) return bestMove;
        const bs = plan.best && plan.best.score;
        if (bs && bs.type === 'mate' && bs.value > 0 && bs.value <= 3) return plan.best.move;   // mate à vista: sempre joga
        if (profile.inaccuracy <= 0) return plan.best.move;
        if (plan.obvious) return plan.best.move;   // captura óbvia (rating < 2000): não troca por erro simulado

        if (plan.red && rng() < profile.blunder) {
            console.log(`[Jogada automática] Erro simulado (grave): ${plan.red.move}, perda de ${plan.red.loss} cp`);
            return plan.red.move;
        }

        // Chance de imprecisão: menor na abertura e em lances óbvios, maior em posições difíceis
        let chance = profile.inaccuracy;
        if (pieceCountAtAnalysis >= 30) chance *= 0.5;
        const complexity = computeComplexity(bestMove);
        chance *= complexity <= 0.25 ? 0.6 : complexity >= 0.75 ? 1.2 : 1;

        if (plan.orange && rng() < chance) {
            console.log(`[Jogada automática] Imprecisão simulada: ${plan.orange.move}, perda de ${plan.orange.loss} cp`);
            return plan.orange.move;
        }
        return plan.best.move;
    }

    // Mesma posição = mesmas peças e mesma vez (direitos de roque / en passant podem oscilar na leitura)
    function samePosition(a, b) {
        if (!a || !b) return false;
        return placementOnly(a) === placementOnly(b) && a.split(' ')[1] === b.split(' ')[1];
    }

    // Recalcula o tempo do lance já analisado (usado quando o ritmo ou a jogada automática
    // são alterados no meio da partida). Se a posição já mudou, o ciclo normal reanalisa.
    function rescheduleAutoMove() {
        cancelPendingMove();
        if (!autoMoveEnabled || isAnalyzing || !lastBestMove) return false;
        if (!samePosition(positionToFEN(getBoardPosition()), currentAnalysisFEN)) return false;
        scheduleAutoAction(lastBestMove);
        return true;
    }

    // Vigia: a análise terminou, é a minha vez, nada agendado e a posição não muda => algo falhou
    // (clique que não pegou, lance descartado...). Tenta jogar de novo; sem lance, analisa outra vez.
    let stuckSince = 0, lastExecAt = 0, lastExecFen = '';
    function autoMoveWatchdog(fen) {
        const now = Date.now();
        const quiet = !autoMoveEnabled || isAnalyzing || pendingMoveTimer || currentLines.length === 0 || !isMyTurn() || resignedThisGame;
        if (quiet) { stuckSince = 0; return; }
        if (!stuckSince) stuckSince = now;
        const afterTry = samePosition(lastExecFen, fen) && now - lastExecAt < 12000;
        if (now - stuckSince < (afterTry ? 1800 : 3500)) return;
        stuckSince = now;
        if (gameIsOver()) return;
        console.log('[Jogada automática] Jogada parada; tentando de novo.');
        if (!rescheduleAutoMove()) {
            lastFEN = '';
            currentAnalysisFEN = '';
            analyzePosition();
        }
    }

    function scheduleAutoMove(bestMove) {
        cancelPendingMove();
        if (!bestMove || bestMove === '(none)' || !isMyTurn()) return;

        const fenAtSchedule = currentAnalysisFEN;
        const elapsed = Date.now() - analysisStartedAt; // o tempo do motor já conta como "pensando"
        const wait = Math.max(150, computeThinkTime(bestMove) - elapsed);
        updateEngineStatus(tr('e.playingIn', { s: trSec(wait) }));

        pendingMoveTimer = timers.setTimeout(() => {
            pendingMoveTimer = null;
            if (!autoMoveEnabled) return;
            const currentFEN = positionToFEN(getBoardPosition());
            if (samePosition(currentFEN, fenAtSchedule)) executeMove(bestMove);
        }, wait);
    }

    // Posição que o motor aguenta: 1 rei de cada lado, sem peões nas fileiras 1/8, sem excesso de peças
    // e o rei de quem NÃO joga não pode estar em xeque. Com o tabuleiro ainda se montando (início de
    // partida) ou em animação, a leitura pode vir incompleta, e o Stockfish trava com isso.
    function unsafeReason(positions, fen) {
        const count = { wk: 0, bk: 0, wp: 0, bp: 0, w: 0, b: 0 };
        for (const [sq, p] of Object.entries(positions)) {
            count[p.color]++;
            if (p.type === 'wk' || p.type === 'bk' || p.type === 'wp' || p.type === 'bp') count[p.type]++;
            if (p.type[1] === 'p' && (sq[1] === '1' || sq[1] === '8')) return tr('e.badPawn', { r: sq[1] });
        }
        if (count.wk !== 1 || count.bk !== 1) return tr('e.badKings', { w: count.wk, b: count.bk });
        if (count.wp > 8 || count.bp > 8 || count.w > 16 || count.b > 16) return tr('e.badMany');

        const turn = fen.split(' ')[1];
        const waiting = turn === 'w' ? 'b' : 'w';
        const kingSq = Object.keys(positions).find(s => positions[s].type === waiting + 'k');
        for (const [sq, p] of Object.entries(positions)) {
            if (p.color !== turn) continue;
            if (getAttackedSquares(positions, sq, p).includes(kingSq)) return tr('e.badCheck');
        }
        return '';
    }

    // Tempo máximo da busca (ms): em bullet/blitz não adianta o motor pensar muito, e uma busca
    // limitada nunca deixa o motor mudo por muito tempo
    function engineMoveTimeMs() {
        let base = { bullet: 1200, blitz: 3000, rapid: 8000 }[timeControlKind()] || 3000;
        if (pieceCountOnBoard() >= 30) base = Math.min(base, 900);   // abertura: lances conhecidos, não precisa buscar tanto
        const remaining = getMyClockSeconds();
        return remaining !== null && remaining < 30 ? Math.min(base, 800) : base;
    }

    // Derruba o motor e sobe outro (usado quando ele morre ou para de responder)
    function restartEngine(reason) {
        console.log('Reiniciando o motor:', reason);
        try { if (stockfishWorker) stockfishWorker.terminate(); } catch (e) { /* ignora */ }
        stockfishWorker = null;
        isEngineReady = false;
        engineLoading = false;
        isAnalyzing = false;
        pendingRestart = false;
        lastFEN = '';
        currentAnalysisFEN = '';
        cancelPendingMove();
        updateEngineStatus(tr('e.restarting'));
        initStockfish();
        timers.setTimeout(analyzePosition, 1500);
    }

    function analyzePosition() {
        if (!isEngineReady) {
            // Tenta iniciar o motor se ainda não estiver pronto
            initStockfish();
            timers.setTimeout(analyzePosition, 1000);
            return;
        }

        const positions = getBoardPosition();
        if (Object.keys(positions).length === 0) {
            updateEngineStatus(tr('e.noBoard'));
            return;
        }

        const fen = positionToFEN(positions);
        const badReason = unsafeReason(positions, fen);
        if (badReason) {
            updateEngineStatus(tr('e.waitBoard', { r: badReason }));
            return;
        }

        if (isAnalyzing) {
            // Já está pensando: se a posição mudou, interrompe e recomeça quando o motor responder
            if (fen !== currentAnalysisFEN) {
                cancelPendingMove();
                pendingRestart = true;
                stockfishWorker.postMessage('stop');
            }
            return;
        }

        cancelPendingMove();
        lastBestMove = null;
        lastPlan = null;
        lastFEN = fen;
        lastPlacement = placementOnly(fen);
        currentAnalysisFEN = fen;
        analysisTurn = fen.split(' ')[1];
        noteSeenPosition(fen);
        analysisStartedAt = Date.now();
        lastMoveAtAnalysis = getLastMove(positions);
        pieceCountAtAnalysis = Object.keys(positions).length;
        isAnalyzing = true;
        currentLines = [];
        oldDepth = 0; // zera o acompanhamento de profundidade
        updateEngineStatus(tr('e.thinking'));

        refreshAutoDepth();   // profundidade automática (histórico + partida)

        // Comandos UCI
        lastEngineMsgAt = Date.now();
        stockfishWorker.postMessage('stop');
        if (newGamePending) {
            newGamePending = false;
            stockfishWorker.postMessage('ucinewgame'); // partida nova: limpa a memória do motor
        }
        stockfishWorker.postMessage('setoption name Threads value 4'); // 4 threads para mais velocidade
        stockfishWorker.postMessage('setoption name Hash value 64');   // memória de hash maior
        stockfishWorker.postMessage('setoption name MultiPV value ' + engineMultiPV());
        stockfishWorker.postMessage('position fen ' + fen);
        stockfishWorker.postMessage('go depth ' + analysisDepth + ' movetime ' + engineMoveTimeMs());
    }

    // ============= BARRA DE AVALIAÇÃO =============
    // Última avaliação na perspectiva das BRANCAS: { type: 'cp' | 'mate', value }.
    let lastWhiteEval = null;

    function setEvaluation(score) {
        if (!score) return;
        // O Stockfish informa o placar do ponto de vista de quem joga; converte para as brancas
        lastWhiteEval = { type: score.type, value: analysisTurn === 'b' ? -score.value : score.value };
        renderEvalBar();
    }

    // Parte da barra ocupada pelas brancas (0 a 100), com a mesma curva usada pelo Lichess
    function whiteShare(ev) {
        if (!ev) return 50;
        if (ev.type === 'mate') return ev.value > 0 ? 100 : 0;
        return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * ev.value)) - 1);
    }

    function formatPawns(cp) {
        return (Math.abs(cp) / 100).toFixed(1);
    }

    // Desenha a barra e o resumo. O lado do usuário fica embaixo, como no chess.com.
    function renderEvalBar() {
        const bar = document.getElementById('cpp-evalbar');
        if (!bar) return;
        const fill = document.getElementById('cpp-evalbar-fill');
        const label = document.getElementById('cpp-evalbar-label');
        const miniScore = document.getElementById('cpp-mini-score');
        const miniText = document.getElementById('cpp-mini-text');

        const WHITE = '#ececec';
        const BLACK = '#3b3b3b';
        const userIsWhite = !isBoardFlipped();
        const ev = lastWhiteEval;

        // Fatia do lado do usuário (embaixo) e do adversário (em cima)
        const userShare = userIsWhite ? whiteShare(ev) : 100 - whiteShare(ev);
        bar.style.background = userIsWhite ? BLACK : WHITE;
        fill.style.background = userIsWhite ? WHITE : BLACK;
        fill.style.height = userShare + '%';

        if (!ev) {
            label.textContent = '';
            bar.title = tr('u.waiting');
            miniScore.textContent = '–';
            miniScore.className = 'cpp-mini-score';
            miniText.textContent = reviewMini() || tr('u.waiting');
            return;
        }

        // Valor do ponto de vista do usuário (positivo = vantagem dele)
        const userValue = userIsWhite ? ev.value : -ev.value;
        const isMate = ev.type === 'mate';
        const userLeads = userValue > 0;
        const equal = !isMate && Math.abs(userValue) < 30;

        // Número na ponta do lado que está na frente (embaixo = usuário, em cima = adversário)
        const text = isMate ? `M${Math.abs(ev.value)}` : formatPawns(ev.value);
        label.textContent = text;
        const atBottom = userLeads || equal;
        label.style.top = atBottom ? 'auto' : '4px';
        label.style.bottom = atBottom ? '4px' : 'auto';
        const zoneColor = atBottom ? (userIsWhite ? WHITE : BLACK) : (userIsWhite ? BLACK : WHITE);
        label.style.color = zoneColor === WHITE ? '#111111' : '#f2f2f2';

        // Resumo (usado principalmente com o painel minimizado)
        let summary, cls;
        if (isMate) {
            summary = userLeads ? tr('a.mateFor', { n: Math.abs(ev.value) }) : tr('a.mateAgainst', { n: Math.abs(ev.value) });
            cls = userLeads ? 'cpp-mini-good' : 'cpp-mini-bad';
            miniScore.textContent = (userLeads ? '' : '-') + `M${Math.abs(ev.value)}`;
        } else {
            const pawns = (userValue / 100).toFixed(1);
            miniScore.textContent = (userValue >= 0 ? '+' : '') + pawns;
            if (equal) { summary = tr('a.equal'); cls = 'cpp-mini-equal'; }
            else if (userLeads) { summary = tr('a.ahead'); cls = 'cpp-mini-good'; }
            else { summary = tr('a.behind'); cls = 'cpp-mini-bad'; }
        }
        const sugMini = manualSuggestion();
        if (sugMini) summary = sugMini.text;
        else if (reviewMini()) summary = reviewMini();
        miniScore.className = `cpp-mini-score ${cls}`;
        miniText.textContent = summary;
        bar.title = `${summary} (${miniScore.textContent})`;
    }

    // ============= EXIBIÇÃO =============
    function formatMove(move) {
        if (!move || move.length < 4) return move || '-';
        const from = move.substring(0, 2);
        const to = move.substring(2, 4);
        const promotion = move.length > 4 ? '=' + move[4].toUpperCase() : '';
        return `${from}→${to}${promotion}`;
    }

    function formatScore(score) {
        if (!score) return '?';

        let value = score.value;
        // Ajusta para a perspectiva das brancas
        if (analysisTurn === 'b') value = -value;

        if (score.type === 'mate') {
            return `#${value}`;
        } else {
            const pawns = (value / 100).toFixed(1);
            return value >= 0 ? `+${pawns}` : pawns;
        }
    }

    function getEvaluationMessage(score) {
        if (!score) return { text: 'Analisando...', icon: '', class: 'neutral' };

        const turn = analysisTurn;
        const amPlayingWhite = !isBoardFlipped();

        let value = score.value;
        // Ajusta para o lado que joga
        if (turn === 'b') value = -value;

        // Agora ajusta para a perspectiva do usuário (positivo = bom para o usuário)
        if (!amPlayingWhite) value = -value;

        if (score.type === 'mate') {
            if (value > 0) {
                return { text: `Mate em ${Math.abs(score.value)}`, icon: '💀', class: 'winning' };
            } else {
                return { text: `Levando mate em ${Math.abs(score.value)}`, icon: '💀', class: 'losing' };
            }
        }

        const pawns = value / 100;

        if (pawns >= 5) return { text: 'Ganhando! Vantagem enorme', icon: '', class: 'winning' };
        if (pawns >= 3) return { text: tr('a.ev.winning'), icon: '', class: 'winning' };
        if (pawns >= 1.5) return { text: tr('a.ev.good'), icon: '', class: 'good' };
        if (pawns >= 0.5) return { text: tr('a.ev.slight'), icon: '', class: 'good' };
        if (pawns > -0.5) return { text: tr('a.ev.equal'), icon: '', class: 'neutral' };
        if (pawns > -1.5) return { text: tr('a.ev.oppSlight'), icon: '', class: 'bad' };
        if (pawns > -3) return { text: tr('a.ev.opp'), icon: '', class: 'bad' };
        if (pawns > -5) return { text: tr('a.ev.hard'), icon: '', class: 'losing' };
        return { text: tr('a.ev.critical'), icon: '', class: 'losing' };
    }

    function updateEngineStatus(status) {
        const el = document.querySelector('.cpp-engine-status');
        if (el) el.textContent = status;
    }

    function displayAnalysisLines() {
        const container = document.querySelector('.cpp-analysis-lines');
        if (!container) return;

        if (currentLines.length === 0) {
            container.innerHTML = '<div class="cpp-no-analysis">' + tr('a.analyzing') + '</div>';
            return;
        }

        const bestLine = currentLines[0];
        if (bestLine) setEvaluation(bestLine.score);
        const sug = manualSuggestion();
        const evalMsg = sug ? { text: sug.text, icon: sug.kind === 'resign' ? '🏳️' : '🤝', class: 'suggest' }
            : getEvaluationMessage(bestLine?.score);

        let html = `
            <div class="cpp-eval-message cpp-eval-${evalMsg.class}">
                <span class="cpp-eval-icon">${evalMsg.icon}</span>
                <span class="cpp-eval-text">${evalMsg.text}</span>
            </div>
        `;

        html += '<div class="cpp-best-move-display">';
        if (bestLine) {
            const scoreStr = formatScore(bestLine.score);
            html += `<span class="cpp-best-label">${tr('a.bestMove')}</span> <span class="cpp-best-move">${formatMove(bestLine.move)}</span> <span class="cpp-best-eval">(${scoreStr})</span>`;
        }
        html += '</div>';

        container.innerHTML = html;
    }

    // Peça na mão (do usuário ou do arrasto automático): enquanto durar, a extensão não mexe no
    // DOM do tabuleiro, senão a peça "treme" ao ser arrastada. O que ficou pendente é feito ao soltar.
    let holdingPiece = false;
    let userHold = false, autoHold = false;
    let arrowsDirty = false;
    function setHolding() {
        const was = holdingPiece;
        holdingPiece = userHold || autoHold;
        if (was && !holdingPiece && arrowsDirty) {
            arrowsDirty = false;
            if (lastPlan) highlightAnalysisMoves(planArrowLines(lastPlan));
            else if (currentLines.length > 0) highlightAnalysisMoves(currentLines);
        }
    }
    // só toques de verdade (isTrusted): os do arrasto automático são marcados à parte
    window.addEventListener('pointerdown', (e) => {
        if (e.isTrusted && e.button === 0 && e.target && e.target.closest && e.target.closest('.board, wc-chess-board')) { userHold = true; setHolding(); setTimeout(() => { userHold = false; setHolding(); }, 10000); }
    }, true);
    ['pointerup', 'pointercancel', 'blur'].forEach(t => window.addEventListener(t, (e) => {
        if (!e || e.isTrusted !== false) { userHold = false; setHolding(); }
    }, true));

    function highlightAnalysisMoves(lines) {
        if (holdingPiece) { arrowsDirty = true; return; }
        document.querySelectorAll('.cpp-best-move-arrow').forEach(el => el.remove());
        if (!lines || lines.length === 0) return;

        const board = mainBoard();
        if (!board) return;

        const boardRect = board.getBoundingClientRect();
        const isFlipped = isBoardFlipped();
        const getSquareCoords = (sq) => squareCenter(sq, boardRect, isFlipped);

        const arrowContainer = document.createElement('div');
        arrowContainer.className = 'cpp-best-move-arrow';
        arrowContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:90;';
        board.style.position = 'relative';

        const colors = ['#22c55e', '#f97316', '#ef4444']; // Green, Orange, Red
        let svgContent = `<defs>`;

        // Cria uma ponta de seta para cada cor
        colors.forEach((color, i) => {
            svgContent += `
                <marker id="cpp-arrow-${i}" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="${color}" />
                </marker>`;
        });
        svgContent += `</defs>`;

        // Desenha as setas (ordem inversa, para a melhor ficar por cima)
        for (let idx = Math.min(lines.length, 3) - 1; idx >= 0; idx--) {
            const line = lines[idx];
            if (!line || !line.move) continue;
            const i = line.slot !== undefined ? line.slot : idx;   // 0 verde, 1 laranja, 2 vermelho

            const from = line.move.substring(0, 2);
            const to = line.move.substring(2, 4);
            const fromCoords = getSquareCoords(from);
            const toCoords = getSquareCoords(to);
            const color = colors[i] || colors[0];
            const scoreStr = formatScore(line.score);

            svgContent += `
                <line x1="${fromCoords.x}" y1="${fromCoords.y}" x2="${toCoords.x}" y2="${toCoords.y}" 
                    stroke="${color}" stroke-width="${6 - i}" stroke-opacity="0.9" 
                    marker-end="url(#cpp-arrow-${i})" stroke-linecap="round"/>
                <circle cx="${fromCoords.x}" cy="${fromCoords.y}" r="${6 - i}" fill="${color}" fill-opacity="0.6"/>
            `;

            // Rótulo do placar em HTML (fora do SVG, para facilitar estilo e camadas)
            const label = document.createElement('div');
            label.className = 'cpp-score-label';
            label.textContent = scoreStr;
            label.style.cssText = `
                position: absolute;
                left: ${toCoords.x}px;
                top: ${toCoords.y}px;
                transform: translate(-50%, -150%);
                background: ${color};
                color: white;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 10px;
                font-weight: bold;
                pointer-events: none;
                z-index: 100;
                box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            `;
            arrowContainer.appendChild(label);
        }

        const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svgEl.setAttribute('width', '100%');
        svgEl.setAttribute('height', '100%');
        svgEl.style.position = 'absolute';
        svgEl.style.top = '0';
        svgEl.style.left = '0';
        svgEl.innerHTML = svgContent;

        arrowContainer.insertBefore(svgEl, arrowContainer.firstChild);
        board.appendChild(arrowContainer);
    }

    // ============= JOGADA AUTOMÁTICA =============
    function executeMove(move) {
        if (!move || move.length < 4) return;

        console.log('[Jogada automática] Tentando jogar:', move);

        // Confere de quem é a vez
        const turn = detectTurn();
        const amPlayingWhite = !isBoardFlipped();

        // Só joga se for a nossa vez
        if ((amPlayingWhite && turn !== 'w') || (!amPlayingWhite && turn !== 'b')) {
            console.log('[Jogada automática] Não é a minha vez, ignorando.');
            return;
        }

        lastExecAt = Date.now();
        lastExecFen = positionToFEN(getBoardPosition());

        const from = move.substring(0, 2);
        const to = move.substring(2, 4);

        const board = mainBoard();
        if (!board) {
            console.log('[Jogada automática] Tabuleiro não encontrado.');
            return;
        }

        const rect = board.getBoundingClientRect();
        const isFlipped = isBoardFlipped();

        const getViewportCoords = (sq) => {
            const c = squareCenter(sq, rect, isFlipped);
            return { x: rect.left + c.x, y: rect.top + c.y };
        };

        const fromPos = getViewportCoords(from);
        const toPos = getViewportCoords(to);

        console.log('[Jogada automática] Arrastando de', from, 'para', to);

        // Arrasta a peça: aperta na origem, leva até o destino e solta
        dragFromTo(fromPos, toPos, () => {
            // Promoção: o lance tem 5 caracteres, como "e7e8q"
            if (move.length === 5) {
                const promotionPiece = move[4].toLowerCase(); // q, r, b, n
                handlePromotion(promotionPiece, amPlayingWhite);
            }
        });
    }

    // Simula o arrastar do mouse: pressiona sobre a peça, move o ponteiro em vários passos
    // (com leve curva e tremor, como a mão) e solta sobre a casa de destino.
    function dragFromTo(fromPos, toPos, onDone) {
        const startEl = document.elementFromPoint(fromPos.x, fromPos.y);
        if (!startEl) {
            console.log('[Jogada automática] Nenhum elemento na casa de origem:', fromPos.x, fromPos.y);
            return;
        }

        const mk = (x, y, buttons) => ({
            bubbles: true, cancelable: true, composed: true, view: window,
            clientX: x, clientY: y, screenX: x, screenY: y,
            button: 0, buttons,
            pointerId: 1, pointerType: 'mouse', isPrimary: true,
            width: 1, height: 1, pressure: buttons ? 0.5 : 0
        });
        const fire = (el, x, y, buttons, pointerType, mouseType) => {
            if (!el) return;
            el.dispatchEvent(new PointerEvent(pointerType, mk(x, y, buttons)));
            el.dispatchEvent(new MouseEvent(mouseType, mk(x, y, buttons)));
        };

        // Aperta o botão sobre a peça
        fire(startEl, fromPos.x, fromPos.y, 0, 'pointerover', 'mouseover');
        autoHold = true; setHolding();
        timers.setTimeout(() => { autoHold = false; setHolding(); }, 4000);   // rede de segurança
        fire(startEl, fromPos.x, fromPos.y, 1, 'pointerdown', 'mousedown');

        const dist = Math.hypot(toPos.x - fromPos.x, toPos.y - fromPos.y);
        const steps = Math.max(8, Math.min(24, Math.round(dist / 18)));
        // Curva leve: desvia o meio do caminho perpendicularmente à reta
        const bend = (Math.random() - 0.5) * Math.min(30, dist * 0.12);
        const nx = dist ? -(toPos.y - fromPos.y) / dist : 0;
        const ny = dist ? (toPos.x - fromPos.x) / dist : 0;

        let i = 0;
        const step = () => {
            i++;
            const t = i / steps;
            const ease = t * t * (3 - 2 * t);   // começa e termina devagar
            const arc = Math.sin(Math.PI * t) * bend;
            const jitter = i < steps ? (Math.random() - 0.5) * 1.5 : 0;
            const x = fromPos.x + (toPos.x - fromPos.x) * ease + nx * arc + jitter;
            const y = fromPos.y + (toPos.y - fromPos.y) * ease + ny * arc + jitter;
            const el = document.elementFromPoint(x, y) || startEl;

            fire(el, x, y, 1, 'pointermove', 'mousemove');

            if (i < steps) {
                timers.setTimeout(step, 12 + Math.random() * 14);
                return;
            }
            // Chegou: solta o botão sobre a casa de destino
            timers.setTimeout(() => {
                const dropEl = document.elementFromPoint(toPos.x, toPos.y) || el;
                fire(dropEl, toPos.x, toPos.y, 0, 'pointerup', 'mouseup');
                autoHold = false; setHolding();
                if (typeof onDone === 'function') onDone();
            }, 40 + Math.random() * 60);
        };
        // Pequena pausa entre apertar e começar a arrastar
        timers.setTimeout(step, 60 + Math.random() * 90);
    }

    function handlePromotion(piece, isWhite) {
        const pieceMap = {
            'q': 'queen',
            'r': 'rook',
            'b': 'bishop',
            'n': 'knight'
        };
        const pieceName = pieceMap[piece] || 'queen';
        const pieceClass = isWhite ? `w${piece}` : `b${piece}`;

        console.log('[Jogada automática] Promovendo para:', pieceName);

        // Tenta várias vezes, esperando a janela de promoção aparecer
        const tryPromotion = (attempt) => {
            if (attempt > 5) {
                console.log('[Jogada automática] Promoção falhou após 5 tentativas');
                return;
            }

            // Seletores de janela de promoção usados pelo Chess.com
            const promotionSelectors = [
                '.promotion-window',
                '.promotion-area',
                '[class*="promotion"]',
                '.board-modal-container'
            ];

            let promotionWindow = null;
            for (const selector of promotionSelectors) {
                promotionWindow = document.querySelector(selector);
                if (promotionWindow) break;
            }

            if (!promotionWindow) {
                console.log(`[Jogada automática] Janela de promoção não encontrada, tentativa ${attempt}`);
                timers.setTimeout(() => tryPromotion(attempt + 1), 150);
                return;
            }

            // Procura a peça a ser clicada
            const pieceSelectors = [
                `.${pieceClass}`,
                `[class*="${pieceClass}"]`,
                `[data-piece="${pieceClass}"]`,
                `.promotion-piece.${pieceName}`,
                `[class*="${pieceName}"]`
            ];

            let pieceElement = null;
            for (const selector of pieceSelectors) {
                pieceElement = promotionWindow.querySelector(selector);
                if (pieceElement) break;
            }

            // Alternativa: clica na primeira peça (normalmente a dama)
            if (!pieceElement) {
                const allPieces = promotionWindow.querySelectorAll('.piece, [class*="piece"]');
                if (allPieces.length > 0) {
                    pieceElement = allPieces[0]; // a primeira opção costuma ser a dama
                    console.log('[Jogada automática] Usando a primeira peça de promoção');
                }
            }

            if (pieceElement) {
                pieceElement.click();

                // Também dispara os eventos de clique nas coordenadas da peça
                const rect = pieceElement.getBoundingClientRect();
                const x = rect.left + rect.width / 2;
                const y = rect.top + rect.height / 2;
                clickAt(x, y);
            } else {
                console.log(`[Jogada automática] Peça de promoção não encontrada, tentativa ${attempt}`);
                timers.setTimeout(() => tryPromotion(attempt + 1), 150);
            }
        };

        // Começa a tentar após uma pequena pausa, para a janela de promoção aparecer
        timers.setTimeout(() => tryPromotion(1), 200);
    }

    function clickAt(x, y) {
        const element = document.elementFromPoint(x, y);
        if (!element) {
            console.log('[Jogada automática] Nenhum elemento nas coordenadas:', x, y);
            return;
        }

        const pointerOpts = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            pointerId: 1,
            width: 1,
            height: 1,
            pressure: 0.5,
            isPrimary: true
        };

        const mouseOpts = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            buttons: 1
        };

        element.dispatchEvent(new PointerEvent('pointerover', pointerOpts));
        element.dispatchEvent(new PointerEvent('pointerenter', pointerOpts));
        element.dispatchEvent(new MouseEvent('mouseover', mouseOpts));

        element.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
        element.dispatchEvent(new MouseEvent('mousedown', mouseOpts));

        // Uma pequena pausa entre apertar e soltar costuma ajudar
        timers.setTimeout(() => {
            element.dispatchEvent(new PointerEvent('pointerup', pointerOpts));
            element.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
            element.dispatchEvent(new MouseEvent('click', mouseOpts));
        }, 50);
    }

    // Trocou o idioma (popup ou painel): refaz o painel já traduzido
    if (window.I18N) {
        window.I18N.onChange(() => {
            const old = document.getElementById('chess-position-panel');
            if (!old || !extEnabled) return;
            const wasExpanded = !old.classList.contains('cpp-minimized');
            const p = createPanel();
            if (p && wasExpanded) { const b = p.querySelector('.cpp-minimize'); if (b) b.click(); }
            applySettings();
            syncSettingsUI();
            syncMarathonUI();
            renderEvalBar();
            displayAnalysisLines();
        });
    }

    // ============= CRIAR O PAINEL =============
    function createPanel() {
        if (!extEnabled) return null;
        const existingPanel = document.getElementById('chess-position-panel');
        if (existingPanel) existingPanel.remove();

        const panel = document.createElement('div');
        panel.id = 'chess-position-panel';
        panel.innerHTML = `
            <div class="cpp-header">
                <div class="cpp-title-wrapper">
                    <img src="${chrome.runtime.getURL('icons/crown.png')}" class="cpp-logo" alt="Logo">
                    <span class="cpp-title">${tr('p.title')}</span>
                    <span class="cpp-version">v${chrome.runtime.getManifest ? chrome.runtime.getManifest().version : ''}</span>
                </div>
                <div class="cpp-controls">
                    <button class="cpp-btn cpp-pin" title="${tr(settings.pinned ? 'u.unpin' : 'u.pin')}"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M16 9V4h1V2H7v2h1v5l-2 3v2h5.2v7h1.6v-7H18v-2z"/></svg></button>
                    <button class="cpp-btn cpp-minimize" title="${tr('u.minimize')}">−</button>
                    <button class="cpp-btn cpp-close" title="${tr('u.close')}">×</button>
                </div>
            </div>
            <div class="cpp-body">
            <!-- Barra de avaliação (fica visível mesmo com o painel minimizado) -->
            <div class="cpp-evalbar" id="cpp-evalbar">
                <div class="cpp-evalbar-fill" id="cpp-evalbar-fill"></div>
                <span class="cpp-evalbar-label" id="cpp-evalbar-label"></span>
            </div>
            <div class="cpp-main">
            <!-- Resumo mostrado só quando o painel está minimizado -->
            <div class="cpp-mini">
                <span class="cpp-mini-score" id="cpp-mini-score">–</span>
                <span class="cpp-mini-text" id="cpp-mini-text">${tr('u.waiting')}</span>
                <button class="cpp-mini-btn" id="cpp-mini-auto" title="${tr('u.miniAutoTitle')}">${tr('u.manual')}</button>
                <div class="cpp-mini-mar">
                    <input type="number" id="cpp-mini-mar-n" class="cpp-marathon-n" min="1" max="99" value="15" title="${tr('u.gamesCount')}">
                    <button class="cpp-mini-btn cpp-mini-play" id="cpp-mini-mar-btn" title="${tr('u.marStartTitle')}">▶</button>
                    <button class="cpp-mini-btn cpp-mini-stop" id="cpp-mini-mar-stop" title="${tr('u.marStopTitle')}" disabled>■</button>
                </div>
                <span class="cpp-mini-hint" id="cpp-mini-mar-hint"></span>
            </div>
            <div class="cpp-content">
                <!-- Análise do motor -->
                <div class="cpp-analysis-section">
                    <div class="cpp-status-row">
                        <span class="cpp-engine-status">${tr('u.starting')}</span>
                    </div>
                    <div class="cpp-analysis-lines">
                        <div class="cpp-no-analysis">${tr('u.startingEngine')}</div>
                    </div>
                    <div class="cpp-settings">
                        <div class="cpp-setting-row">
                            <label for="cpp-depth-select">${tr('u.depth')}</label>
                            <select id="cpp-depth-select" class="cpp-select"></select>
                        </div>
                        <div class="cpp-setting-hint" id="cpp-depth-hint"></div>
                        <div class="cpp-setting-row">
                            <label for="cpp-style-select">${tr('u.style')}</label>
                            <select id="cpp-style-select" class="cpp-select"></select>
                        </div>
                        <div class="cpp-setting-hint" id="cpp-style-hint"></div>
                        <div class="cpp-setting-row">
                            <label for="cpp-pace-select">${tr('u.pace')}</label>
                            <select id="cpp-pace-select" class="cpp-select"></select>
                        </div>
                        <div class="cpp-setting-hint" id="cpp-pace-hint"></div>
                        <div class="cpp-setting-row">
                            <label for="cpp-lang-select">${tr('u.language')}</label>
                            <select id="cpp-lang-select" class="cpp-select"></select>
                        </div>
                    </div>
                    <div class="cpp-auto-analyze">
                        <div class="cpp-check-row">
                            <label><input type="checkbox" id="auto-move-cb"> ${tr('u.autoMove')}</label>
                            <label><input type="checkbox" id="cpp-human-cb"> ${tr('u.human')}</label>
                        </div>
                        <div class="cpp-setting-hint" id="cpp-human-hint">${tr('u.humanHint')}</div>
                    </div>
                </div>

                <!-- Maratona de partidas -->
                <div class="cpp-review-section cpp-marathon-section">
                    <div class="cpp-legend-title">${tr('u.marTitle')}</div>
                    <div class="cpp-marathon-row">
                        <label for="cpp-marathon-n">${tr('u.marQty')}</label>
                        <input type="number" id="cpp-marathon-n" class="cpp-marathon-n" min="1" max="99" value="15">
                    </div>
                    <button class="cpp-review-btn" id="cpp-marathon-btn">${tr('u.marStart')}</button>
                    <div class="cpp-setting-hint" id="cpp-marathon-hint"></div>
                </div>

                <!-- Precisão da partida -->
                <div class="cpp-review-section">
                    <div class="cpp-legend-title">${tr('u.accTitle')}</div>
                    <button class="cpp-review-btn" id="cpp-review-btn">${tr('u.accBtn')}</button>
                    <div class="cpp-setting-hint" id="cpp-review-status">${tr('u.accHint')}</div>
                    <div id="cpp-review-result"></div>
                </div>

                <!-- Legenda -->
                <div class="cpp-legend-section">
                    <div class="cpp-legend-title">${tr('u.legend')}</div>
                    <div class="cpp-legend-items">
                        <div class="cpp-legend-item">
                            <span class="cpp-legend-icon cpp-legend-arrow"></span>
                            <span>${tr('u.legArrows')}</span>
                        </div>
                        <div class="cpp-legend-item">
                            <span class="cpp-legend-icon cpp-legend-hanging"></span>
                            <span>${tr('u.legHanging')}</span>
                        </div>
                        <div class="cpp-legend-item">
                            <span class="cpp-legend-icon cpp-legend-defended"></span>
                            <span>${tr('u.legDefended')}</span>
                        </div>
                        <div class="cpp-legend-item">
                            <span class="cpp-legend-icon cpp-legend-bar"></span>
                            <span>${tr('u.legBar')}</span>
                        </div>
                    </div>
                </div>
            </div>
            </div>
            </div>
        `;
        document.body.appendChild(panel);

        makeDraggable(panel);
        applyPinned(panel);

        // Eventos
        panelClosedByUser = false;
        panel.querySelector('.cpp-close').addEventListener('click', () => { panelClosedByUser = true; destroyPanel(); });

        panel.querySelector('#cpp-review-btn').addEventListener('click', () => runReview());

        // O painel sempre abre minimizado; o usuário expande se quiser
        panel.classList.add('cpp-minimized');
        panel.querySelector('.cpp-minimize').textContent = '+';
        panel.querySelector('.cpp-pin').addEventListener('click', () => {
            settings.pinned = !settings.pinned;
            saveSettings();
            applyPinMode(panel);
        });
        applyPinMode(panel);

        panel.querySelector('.cpp-minimize').addEventListener('click', () => {
            panel.classList.toggle('cpp-minimized');
            panel.querySelector('.cpp-minimize').textContent =
                panel.classList.contains('cpp-minimized') ? '+' : '−';
            dockPanel(panel, panel.classList.contains('cpp-minimized'));
        });


        // A análise automática já começa ligada
        if (!autoAnalyzeEnabled) {
            autoAnalyzeEnabled = true;
            analyzePosition();
            autoAnalyzeInterval = timers.setInterval(boardWatchTick, 500);
        }

        // Opções de profundidade com o rating aproximado ao lado
        const depthSelect = panel.querySelector('#cpp-depth-select');
        const langSelect = panel.querySelector('#cpp-lang-select');
        if (langSelect && window.I18N) {
            window.I18N.LANGS.forEach(l => {
                const o = document.createElement('option');
                o.value = l.code;
                o.textContent = l.name;
                langSelect.appendChild(o);
            });
            langSelect.value = window.I18N.getLang();
            langSelect.addEventListener('change', () => window.I18N.setLang(langSelect.value));
            window.I18N.enhanceSelect(langSelect);   // lista com bandeira
        }
        const autoOpt = document.createElement('option');
        autoOpt.value = '0';
        autoOpt.textContent = tr('u.depthAuto');
        depthSelect.appendChild(autoOpt);
        for (let d = MIN_DEPTH; d <= MAX_DEPTH; d++) {
            const opt = document.createElement('option');
            opt.value = String(d);
            opt.textContent = tr('u.depthOpt', { d, r: DEPTH_RATINGS[d] });
            depthSelect.appendChild(opt);
        }
        const styleSelect = panel.querySelector('#cpp-style-select');
        STYLE_OPTIONS.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.value;
            opt.textContent = p.label;
            styleSelect.appendChild(opt);
        });
        styleSelect.addEventListener('change', (e) => {
            settings.style = sanitizeSettings({ ...settings, style: e.target.value }).style;
            saveSettings();
            syncSettingsUI();
            // Vale já para a posição atual
            cancelPendingMove();
            currentAnalysisFEN = '';
            lastFEN = '';
            analyzePosition();
        });
        // Opções de ritmo
        const paceSelect = panel.querySelector('#cpp-pace-select');
        PACE_OPTIONS.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.value;
            opt.textContent = p.label;
            paceSelect.appendChild(opt);
        });
        syncSettingsUI();

        depthSelect.addEventListener('change', (e) => {
            settings.depth = sanitizeSettings({ ...settings, depth: e.target.value }).depth;
            applySettings();
            saveSettings();
            syncSettingsUI();
            // Reanalisa a posição atual com a nova profundidade
            cancelPendingMove();
            currentAnalysisFEN = '';
            lastFEN = '';
            analyzePosition();
        });

        panel.querySelector('#cpp-pace-select').addEventListener('change', (e) => {
            settings.pace = sanitizeSettings({ ...settings, pace: e.target.value }).pace;
            saveSettings();
            syncSettingsUI();
            // Vale já para o lance que está esperando para ser jogado
            rescheduleAutoMove();
        });

        panel.querySelector('#cpp-human-cb').addEventListener('change', (e) => {
            settings.humanMode = e.target.checked;
            saveSettings();
            rescheduleAutoMove();   // vale já para o lance que está esperando
        });

        panel.querySelector('#cpp-marathon-btn').addEventListener('click', () => {
            if (settings.marathonOn) stopMarathon(tr('m.stopped'));
            else startMarathon(panel.querySelector('#cpp-marathon-n').value);
        });

        panel.querySelector('#auto-move-cb').addEventListener('change', (e) => setAutoMove(e.target.checked));
        panel.querySelector('#cpp-mini-auto').addEventListener('click', () => setAutoMove(!settings.autoMove));
        panel.querySelector('#cpp-mini-mar-btn').addEventListener('click', () => {
            if (!settings.marathonOn) startMarathon(panel.querySelector('#cpp-mini-mar-n').value);
        });
        panel.querySelector('#cpp-mini-mar-stop').addEventListener('click', () => {
            if (settings.marathonOn) stopMarathon(tr('m.stopped'));
        });

        // A quantidade escolhida também fica guardada (sem iniciar a maratona)
        ['#cpp-marathon-n', '#cpp-mini-mar-n'].forEach(sel => {
            const inp = panel.querySelector(sel);
            if (!inp) return;
            inp.addEventListener('change', () => {
                if (settings.marathonOn) return;
                const n = parseInt(inp.value);
                if (!n) { syncSettingsUI(); return; }
                settings.marathonTotal = Math.min(99, Math.max(1, n));
                saveSettings();
                syncSettingsUI();
            });
        });

        // Inicialização
        renderEvalBar();
        initStockfish();
        updatePanel();
        if (panelUpdateInterval) timers.clear(panelUpdateInterval);
        panelUpdateInterval = timers.setInterval(updatePanel, 2000);
        if (!rateTimer) rateTimer = timers.setInterval(rateTick, 2000);

        return panel;
    }

    // Liga/desliga a jogada automática (checkbox do painel e botão do painel recolhido)
    function setAutoMove(on) {
        settings.autoMove = !!on;
        applySettings();
        saveSettings();
        if (!autoMoveEnabled) {
            cancelPendingMove();
            if (settings.marathonOn) { stopMarathon(tr('m.stoppedManual')); return; }
        } else if (!isAnalyzing) {
            // Se a posição atual já foi analisada, só agenda o lance; senão analisa
            if (!rescheduleAutoMove()) analyzePosition();
        }
        syncSettingsUI();
    }

    // Reflete as configurações atuais nos controles do painel (se ele existir).
    function syncSettingsUI() {
        const panel = document.getElementById('chess-position-panel');
        if (!panel) return;
        const depthSelect = panel.querySelector('#cpp-depth-select');
        const paceSelect = panel.querySelector('#cpp-pace-select');
        const autoCb = panel.querySelector('#auto-move-cb');
        const hint = panel.querySelector('#cpp-depth-hint');

        if (depthSelect) depthSelect.value = String(settings.depth);
        if (paceSelect) paceSelect.value = settings.pace;
        if (autoCb) autoCb.checked = settings.autoMove;
        const miniAuto = panel.querySelector('#cpp-mini-auto');
        if (miniAuto) {
            miniAuto.textContent = settings.autoMove ? tr('u.automatic') : tr('u.manual');
            miniAuto.classList.toggle('on', settings.autoMove);
        }
        if (hint) {
            const r = DEPTH_RATINGS[settings.depth === 0 ? analysisDepth : settings.depth] || DEPTH_RATINGS[MAX_DEPTH];
            const prof = errorProfile(r);
            const erro = prof.inaccuracy <= 0 ? tr('dep.noErr')
                : prof.inaccuracy < 0.1 ? tr('dep.rarely')
                : tr('dep.likeLevel');
            hint.textContent = settings.depth === 0 ? `${autoDepthSummary()} ${erro}` : tr('dep.hint', { r, l: ratingLabel(r), e: erro });
        }
        const styleSel = panel.querySelector('#cpp-style-select');
        if (styleSel) styleSel.value = settings.style;
        const styleHint = panel.querySelector('#cpp-style-hint');
        if (styleHint) styleHint.textContent = STYLE_HINTS[settings.style];
        const humanCb = panel.querySelector('#cpp-human-cb');
        if (humanCb) humanCb.checked = settings.humanMode;
        const paceHint = panel.querySelector('#cpp-pace-hint');
        if (paceHint) paceHint.textContent = PACE_HINTS[settings.pace] + tr('pace.suffix');
        syncMarathonUI();
    }

    // Remove o painel e tudo que ele deixou rodando (intervalos, listeners, setas, estado).
    function destroyPanel() {
        if (autoAnalyzeInterval) { timers.clear(autoAnalyzeInterval); autoAnalyzeInterval = null; }
        if (panelUpdateInterval) { timers.clear(panelUpdateInterval); panelUpdateInterval = null; }
        if (dragCleanup) { dragCleanup(); dragCleanup = null; }
        autoAnalyzeEnabled = false; // permite religar a análise automática ao reabrir
        pendingRestart = false;
        cancelPendingMove();

        const panel = document.getElementById('chess-position-panel');
        if (panel) panel.remove();
        document.querySelectorAll('.cpp-best-move-arrow, .cpp-hanging-overlay').forEach(el => el.remove());
    }

    // Recolhido: o painel fica FIXO no espaço vazio da barra lateral esquerda do site, sem passar da
    // largura dela, sem cobrir tabuleiro nem relógios e sem poder ser arrastado.

    // Tabuleiro principal: o maior da página (na tela "Jogar" há mais de um)
    function mainBoard() {
        const boards = Array.from(document.querySelectorAll('.board'));
        if (boards.length < 2) return boards[0] || null;
        return boards.reduce((a, b) => (b.getBoundingClientRect().width > a.getBoundingClientRect().width ? b : a));
    }

    // A barra lateral do site (a faixa à esquerda, de uns 80 a 320 px, com metade da altura da janela ou mais)
    function findSidebar() {
        const vh = window.innerHeight || 800;
        const cands = document.querySelectorAll('nav, aside, [class*="sidebar"], [id*="sidebar"], [id="sb"], [class*="nav-menu"]');
        for (const el of cands) {
            if (el.closest('#chess-position-panel')) continue;
            const r = el.getBoundingClientRect();
            if (r.left <= 3 && r.width >= 80 && r.width <= 320 && r.height >= vh * 0.5) return el;
        }
        return null;
    }

    // Borda direita da barra lateral do site (em px da página)
    function sidebarRight() {
        const sb = findSidebar();
        if (sb) return sb.getBoundingClientRect().right;
        const board = mainBoard();
        const boardLeft = board ? board.getBoundingClientRect().left : 0;
        return Math.min(218, boardLeft - 40);
    }

    // Onde começa o maior vão vazio entre os itens da barra lateral (entre o menu de cima e o de baixo,
    // como "Pesquisar" e o perfil). O painel entra ali, sem tapar nenhum botão do site.
    // shortcut: acha o vão pela posição dos links/botões, não pelo nome deles; vão menor que 120 px = não usa
    function sidebarGapTop() {
        const sb = findSidebar();
        if (!sb) return null;
        const sbr = sb.getBoundingClientRect();
        const right = sbr.right;
        // Só conta o que aparece de verdade: o menu "Mais" fechado mantém os itens com posição (invisíveis) e o
        // link "pular para o conteúdo" fica fora da tela; ambos fariam o vão começar mais embaixo.
        const itens = Array.from(sb.querySelectorAll('a, button, [role="button"]'))
            .filter(el => !el.closest('#chess-position-panel'))
            .filter(el => !el.checkVisibility || el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
            .map(el => el.getBoundingClientRect())
            .filter(r => r.width > 0 && r.height > 0 && r.left >= sbr.left - 4 && r.right <= right + 4)
            .sort((a, b) => a.top - b.top);
        let melhor = 0, topo = null, ate = -Infinity;
        for (const r of itens) {
            if (ate > -Infinity && r.top - ate > melhor) { melhor = r.top - ate; topo = ate; }
            ate = Math.max(ate, r.bottom);
        }
        return melhor >= 120 ? topo : null;
    }

    // Posição e largura do painel recolhido: dentro da lateral, logo abaixo do menu
    function layoutDock(panel) {
        const right = sidebarRight();
        const width = Math.max(130, Math.round(right - 16));
        const vh = window.innerHeight || 800;
        const gap = sidebarGapTop();
        const top = gap !== null ? Math.round(gap + 8) : Math.max(360, Math.min(Math.round(vh * 0.45), vh - 190));
        panel.style.left = '8px';
        panel.style.top = top + 'px';
        panel.style.right = 'auto';
        panel.style.width = width + 'px';
    }

    function dockPanel(panel, minimized) {
        if (!settings.pinned) return;   // solto: fica onde o usuário deixou
        if (minimized) {
            panel.classList.remove('cpp-pinned');
            panel.classList.add('cpp-docked');
            layoutDock(panel);
        } else if (panel.classList.contains('cpp-docked')) {
            panel.classList.remove('cpp-docked');
            panel.style.left = panel.style.top = panel.style.right = panel.style.width = '';
            applyPinned(panel);
        }
    }

    // Expandido: fixo na lateral esquerda, do topo até o rodapé da janela (com o mínimo de rolagem),
    // podendo ficar na frente da barra lateral do site. Sem espaço à esquerda do tabuleiro, fica
    // flutuando como antes (e pode ser arrastado).
    function applyPinned(panel) {
        if (panel.classList.contains('cpp-docked') || panel.classList.contains('cpp-minimized')) return;
        panel.classList.toggle('cpp-pinned', settings.pinned);
    }

    // Botão da tachinha: fixo na lateral esquerda <-> solto e arrastável. A escolha fica salva.
    function applyPinMode(panel) {
        const btn = panel.querySelector('.cpp-pin');
        if (btn) { btn.classList.toggle('on', settings.pinned); btn.title = tr(settings.pinned ? 'u.unpin' : 'u.pin'); }
        if (settings.pinned) {
            if (panel.classList.contains('cpp-minimized')) dockPanel(panel, true); else applyPinned(panel);
        } else {
            panel.classList.remove('cpp-docked', 'cpp-pinned');
            panel.style.left = panel.style.top = panel.style.right = panel.style.width = '';
        }
    }

    function makeDraggable(element) {
        const header = element.querySelector('.cpp-header');
        let isDragging = false;
        let startX, startY, initialX, initialY;

        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('.cpp-btn')) return;
            if (element.classList.contains('cpp-docked') || element.classList.contains('cpp-pinned')) return;   // fixo na lateral
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = element.getBoundingClientRect();
            initialX = rect.left;
            initialY = rect.top;
        });

        const onMove = (e) => {
            if (!isDragging) return;
            element.style.left = (initialX + e.clientX - startX) + 'px';
            element.style.top = (initialY + e.clientY - startY) + 'px';
            element.style.right = 'auto';
        };
        const onUp = () => { isDragging = false; };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);

        // Chamado por destroyPanel para não acumular listeners
        dragCleanup = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
    }

    let hangingSig = '';
    function highlightHangingPieces(attackAnalysis) {
        if (holdingPiece) return;
        const board = mainBoard();
        if (!board) return;
        // nada mudou e a marcação continua lá: não refaz (menos mexida no tabuleiro)
        const sig = JSON.stringify(Object.entries(attackAnalysis).filter(([, p]) => p.status === 'hanging' || p.status === 'defended').map(([s, p]) => s + p.status)) + isBoardFlipped() + board.getBoundingClientRect().width;
        if (sig === hangingSig && board.querySelector('.cpp-hanging-overlay')) return;
        hangingSig = sig;
        document.querySelectorAll('.cpp-hanging-overlay').forEach(el => el.remove());

        const boardRect = board.getBoundingClientRect();
        const squareSize = boardRect.width / 8;
        const isFlipped = isBoardFlipped();

        const overlay = document.createElement('div');
        overlay.className = 'cpp-hanging-overlay';
        overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:95;';

        for (const [square, piece] of Object.entries(attackAnalysis)) {
            if (piece.status === 'hanging' || piece.status === 'defended') {
                const file = square.charCodeAt(0) - 97;
                const rank = parseInt(square[1]) - 1;

                let x, y;

                // Calculate top-left of square
                if (isFlipped) {
                    x = (7 - file) * squareSize;
                    y = rank * squareSize;
                } else {
                    x = file * squareSize;
                    y = (7 - rank) * squareSize;
                }

                const color = piece.status === 'hanging' ? '#ef4444' : '#f97316';

                const marker = document.createElement('div');
                marker.className = 'cpp-status-marker';
                marker.style.cssText = `
                     position: absolute;
                     left: ${x + squareSize * 0.7}px; 
                     top: ${y}px;
                     width: ${squareSize * 0.3}px;
                     height: ${squareSize * 0.3}px;
                     background: ${color};
                     clip-path: polygon(100% 0, 0 0, 100% 100%);
                     pointer-events: none;
                 `;

                overlay.appendChild(marker);
            }
        }
        board.appendChild(overlay);
    }

    // ============= ATUALIZAR O PAINEL =============
    function updatePanel() {
        const panel = document.getElementById('chess-position-panel');
        if (!panel || holdingPiece) return;

        const positions = getBoardPosition();
        highlightHangingPieces(analyzeAttacksDefenses(positions));
        renderEvalBar(); // acompanha se o tabuleiro foi virado
    }

    // ============= MENSAGENS DO POPUP =============
    function togglePanel() {
        const panel = document.getElementById('chess-position-panel');
        if (panel) {
            panelClosedByUser = true;
            destroyPanel();
        } else {
            createPanel();
        }
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'togglePanel') {
            togglePanel();
            sendResponse({ success: true });
        } else if (request.action === 'showPanel') {
            if (extEnabled && !document.getElementById('chess-position-panel')) createPanel();
            sendResponse({ success: true, enabled: extEnabled });
        }
        return true;
    });

    // ============= INTERRUPTOR GERAL =============
    // Desligada: tira o painel, para o motor, a maratona e a jogada automática; nada mais é clicado
    // nem navegado até ligar de novo.
    function disableExtension() {
        extEnabled = false;
        if (settings.marathonOn || settings.marathonPending || settings.autoMove) {
            settings.marathonOn = false;
            settings.marathonPending = false;
            settings.autoMove = false;
            saveSettings();
        }
        applySettings();
        marathonStartAt = 0;
        marathonPendingSince = 0;
        destroyPanel();
        try { if (stockfishWorker) stockfishWorker.terminate(); } catch (e) { /* ignora */ }
        stockfishWorker = null;
        isAnalyzing = false;
        engineLoading = false;
        resetDrawState();
    }

    function enableExtension() {
        extEnabled = true;
        panelClosedByUser = false;
        checkAndShowPanel();
    }

    function applyEnabled(value) {
        if (value === false && extEnabled) disableExtension();
        else if (value !== false && !extEnabled) enableExtension();
    }

    try {
        chrome.storage.local.get('cppEnabled', (res) => {
            if (chrome.runtime.lastError) return;
            applyEnabled(res && res.cppEnabled);
        });
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.cppEnabled) applyEnabled(changes.cppEnabled.newValue);
        });
    } catch (e) { /* sem armazenamento: fica ligada */ }

    // ============= PRECISÃO DA PARTIDA =============
    // Em uma partida terminada, reproduz os lances (buscados na API pública do chess.com), avalia
    // cada posição com o Stockfish (num motor separado) e calcula a precisão de cada lado, com as
    // fórmulas abertas do Lichess. Não é o número exato do site (esse cálculo é proprietário), mas
    // segue a mesma lógica. Se o site já tiver o número, ele também é mostrado.
    const REVIEW_DEPTH = 12;
    const REVIEW_MOVETIME = 350;     // ms por posição
    let reviewRunning = false;
    let reviewTriedFor = '';         // partida em que o cálculo automático já foi tentado
    let reviewSummary = '';          // resumo curto para o painel recolhido
    let reviewSummaryGame = '';
    let reviewTick = 0;

    function reviewStatus(text) {
        const el = document.getElementById('cpp-review-status');
        if (el) el.textContent = text;
    }

    function fmtPct(x) { return x === null || x === undefined || isNaN(x) ? '–' : x.toFixed(1).replace('.', ','); }

    function reviewMini() {
        return reviewSummary && reviewSummaryGame === getCurrentGameId() ? reviewSummary : '';
    }

    // Busca nas últimas mensagens do histórico a partida com este id
    async function findFinishedGame(id, user) {
        const base = 'https://api.chess.com/pub/player/' + encodeURIComponent(user.toLowerCase()) + '/games';
        const arch = await (await fetch(base + '/archives')).json();
        const urls = ((arch && arch.archives) || []).slice(-3).reverse();
        for (const u of urls) {
            const data = await (await fetch(u)).json();
            const g = ((data && data.games) || []).find(x => { const m = /(\d+)\s*$/.exec((x && x.url) || ''); return m && m[1] === id; });
            if (g) return g;
        }
        return null;
    }

    // Partida pelo endereço interno do próprio site (mesma origem: sem espera, sem login extra).
    // Devolve { rep, white, black, accuracies } ou null.
    async function fetchGameFromSite(id) {
        const Ch = window.CPPChess;
        for (const kind of ['live', 'daily']) {
            try {
                const r = await fetch(location.origin + '/callback/' + kind + '/game/' + id);
                if (!r.ok) continue;
                const j = await r.json();
                const g = j && j.game;
                if (!g || !g.moveList) continue;
                if (g.type && g.type !== 'chess') return { error: tr('v.onlyStd') };
                if (g.isFinished === false) return { error: tr('v.inProgress') };
                const coords = Ch.decodeMoveList(g.moveList);
                if (!coords) continue;
                const start = g.initialSetup || g.pgnHeaders && g.pgnHeaders.SetUp === '1' && g.pgnHeaders.FEN || '';
                const rep = Ch.replayCoords(coords, start || null);
                if (rep.error) { console.log('[Precisão da partida] lista de lances do site não bateu:', rep.error); continue; }
                const h = g.pgnHeaders || {};
                const pl = j.players || {};
                const white = h.White || (pl.top && pl.top.color === 'white' ? pl.top.username : pl.bottom && pl.bottom.username) || '';
                const black = h.Black || (pl.top && pl.top.color === 'black' ? pl.top.username : pl.bottom && pl.bottom.username) || '';
                return { rep, white, black, accuracies: null };
            } catch (e) {
                console.log('[Precisão da partida] endereço do site indisponível:', e && e.message);
            }
        }
        return null;
    }

    // Nomes de usuário que aparecem na página, do mais provável de ser o seu ao menos provável:
    // parâmetro ?username= da URL, nome da barra lateral do site, jogador de baixo do tabuleiro e os demais.
    function collectUsernames() {
        const out = [];
        const add = (n) => {
            n = (n || '').trim().split(/\s+/)[0].toLowerCase();
            if (n && /^[a-z0-9_-]{2,}$/.test(n) && !out.includes(n)) out.push(n);
        };
        try { add(new URLSearchParams(location.search).get('username')); } catch (e) { /* ignora */ }
        const links = Array.from(document.querySelectorAll('a[href*="/member/"]'))
            .filter(a => !a.closest('#chess-position-panel'))
            .map(a => { const m = /\/member\/([^/?#]+)/.exec(a.getAttribute('href') || ''); return { n: m && m[1], r: a.getBoundingClientRect() }; })
            .filter(x => x.n);
        links.filter(x => x.r.left < 240).forEach(x => add(x.n));            // barra lateral do site (você)
        add(detectMyUsername());
        add(myUsername);
        links.filter(x => x.r.left >= 240).sort((a, b) => b.r.top - a.r.top).forEach(x => add(x.n));   // de baixo para cima
        document.querySelectorAll('.user-username-component, .user-tagline-username, [data-cy="user-tagline-username"]').forEach(el => add(el.textContent));
        return out;
    }

    // Motor separado para a revisão (não atrapalha a análise da partida)
    async function createReviewEngine() {
        if (!engineBlobUrl) {
            const response = await fetch(chrome.runtime.getURL('stockfish.js'));
            const code = await response.text();
            engineBlobUrl = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
        }
        const w = new Worker(engineBlobUrl);
        let waiter = null;
        let last = null;
        w.onmessage = (e) => {
            const msg = e.data;
            if (typeof msg !== 'string') return;
            const sc = msg.match(/score (cp|mate) (-?\d+)/);
            if (sc && (!/multipv/.test(msg) || /multipv 1 /.test(msg))) last = { type: sc[1], value: parseInt(sc[2]) };
            if (waiter && waiter.test(msg)) { const f = waiter.done; waiter = null; f(msg); }
        };
        w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); };
        const waitFor = (re, ms) => new Promise((resolve) => {
            const t = timers.setTimeout(() => { waiter = null; resolve(null); }, ms);
            waiter = { test: (m) => re.test(m), done: (m) => { timers.clear(t); resolve(m); } };
        });
        w.postMessage('uci');
        if (!(await waitFor(/uciok/, 15000))) { w.terminate(); throw new Error('motor da revisão não respondeu'); }
        w.postMessage('setoption name Threads value 2');
        w.postMessage('setoption name Hash value 32');
        w.postMessage('setoption name MultiPV value 1');
        w.postMessage('isready');
        await waitFor(/readyok/, 15000);
        return {
            // avaliação (do ponto de vista de quem joga) de uma posição
            async evalFen(fen) {
                last = null;
                w.postMessage('position fen ' + fen);
                const p = waitFor(/^bestmove/, REVIEW_MOVETIME + 12000);
                w.postMessage('go depth ' + REVIEW_DEPTH + ' movetime ' + REVIEW_MOVETIME);
                await p;
                return last;
            },
            close() { try { w.terminate(); } catch (e) { /* ignora */ } }
        };
    }

    // Avaliação em centipeões do ponto de vista das BRANCAS
    function whiteCp(score, turn) {
        if (!score) return 0;
        const v = score.type === 'mate' ? (score.value > 0 ? 10000 : -10000) : score.value;
        return turn === 'w' ? v : -v;
    }

    function renderReview(game, user, acc) {
        const white = (game.white && game.white.username) || tr('v.white');
        const black = (game.black && game.black.username) || tr('v.black');
        const meWhite = white.toLowerCase() === user.toLowerCase();
        const mine = meWhite ? acc.w : acc.b, theirs = meWhite ? acc.b : acc.w;
        const myC = meWhite ? acc.counts.w : acc.counts.b, thC = meWhite ? acc.counts.b : acc.counts.w;
        const cnt = (c) => tr('v.counts', { b: c.blunder, m: c.mistake, i: c.inaccuracy });
        const box = document.getElementById('cpp-review-result');
        if (box) {
            box.textContent = '';
            const add = (cls, text) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; box.appendChild(d); };
            add('cpp-review-line', tr('v.line', { a: fmtPct(mine), b: fmtPct(theirs) }));
            add('cpp-review-sub', tr('v.mine', { c: cnt(myC) }));
            add('cpp-review-sub', tr('v.theirs', { c: cnt(thC) }));
            const off = game.accuracies;
            if (off && typeof off.white === 'number') {
                add('cpp-review-sub', tr('v.site', { a: fmtPct(meWhite ? off.white : off.black), b: fmtPct(meWhite ? off.black : off.white) }));
            }
        }
        reviewSummary = tr('v.summary', { a: fmtPct(mine), b: fmtPct(theirs) });
        reviewSummaryGame = getCurrentGameId();
        reviewStatus(tr('v.done', { d: REVIEW_DEPTH }));
        renderEvalBar();
    }

    async function runReview() {
        if (reviewRunning) return;
        const Ch = window.CPPChess;
        const btn = document.getElementById('cpp-review-btn');
        const id = getCurrentGameId();
        if (!Ch) { reviewStatus(tr('v.noRules')); return; }
        if (!/^\d+$/.test(id)) { reviewStatus(tr('v.openFinished')); return; }
        const names = collectUsernames();
        if (!names.length) { reviewStatus(tr('v.noNames')); return; }
        let user = names[0];

        reviewRunning = true;
        if (btn) btn.disabled = true;
        let engine = null;
        try {
            reviewStatus(tr('v.searching'));
            let game = null;
            let fromSite = await fetchGameFromSite(id);
            if (fromSite && fromSite.error) { reviewStatus(fromSite.error); return; }
            for (let i = 0; i < (fromSite ? 0 : 5) && !game; i++) {
                for (const n of names.slice(0, 4)) {
                    try { game = await findFinishedGame(id, n); } catch (e) { game = null; }
                    if (game) break;
                }
                if (!game) {
                    reviewStatus(tr('v.waitSite'));
                    await new Promise(r => timers.setTimeout(r, 4000));
                    if (!extensionAlive() || getCurrentGameId() !== id) return;
                }
            }
            if (fromSite) {
                game = { white: { username: fromSite.white }, black: { username: fromSite.black }, accuracies: null };
            } else {
                if (!game) { reviewStatus(tr('v.notFound')); return; }
                if (game.rules && game.rules !== 'chess') { reviewStatus(tr('v.onlyStd')); return; }
            }
            const players = [(game.white && game.white.username || '').toLowerCase(), (game.black && game.black.username || '').toLowerCase()];
            user = names.find(n => players.includes(n)) || players[0];

            const rep = fromSite ? fromSite.rep : Ch.replay(Ch.parsePgn(game.pgn || '').sans);
            if (rep.error || rep.states.length < 3) { reviewStatus(tr('v.cantRead', { r: rep.error || tr('v.short') })); return; }

            engine = await createReviewEngine();
            const cps = [];
            for (let i = 0; i < rep.states.length; i++) {
                if (!extensionAlive() || getCurrentGameId() !== id) return;   // saiu da partida
                reviewStatus(tr('v.analyzingMove', { i, n: rep.states.length - 1 }));
                const st = rep.states[i];
                if (Ch.legalMoves(st).length === 0) {
                    cps.push(Ch.inCheck(st, st.turn) ? (st.turn === 'w' ? -10000 : 10000) : 0);   // mate ou afogamento
                } else {
                    cps.push(whiteCp(await engine.evalFen(Ch.stateToFen(st)), st.turn));
                }
            }
            renderReview(game, user, Ch.gameAccuracy(cps));
        } catch (e) {
            console.log('[Precisão da partida] falha:', e && e.message);
            reviewStatus(tr('v.cantCalc'));
        } finally {
            if (engine) engine.close();
            reviewRunning = false;
            if (btn) btn.disabled = false;
        }
    }

    // Ao fim de uma partida (aparece o botão "Revisão da Partida" do site), calcula sozinho uma vez
    function maybeAutoReview() {
        if (reviewRunning || ++reviewTick % 4 !== 0) return;
        const id = getCurrentGameId();
        if (!/^\d+$/.test(id) || reviewTriedFor === id) return;
        if (!findControl(/revis[ãa]o da partida|game review/, document, false, null, true)) return;
        reviewTriedFor = id;
        runReview();
    }

    // ============= MARATONA DE PARTIDAS =============
    // Você escolhe quantas partidas. Ao fim de cada uma, a extensão começa a próxima sozinha
    // (pausa curta e variável, como uma pessoa) e nunca aceita nem pede revanche.
    // O estado fica salvo nas configurações, porque o site pode recarregar a página entre as partidas.
    const REMATCH_RE = /revanche|rematch/;
    let marathonOverTicks = 0;      // vezes seguidas em que o fim de partida foi visto
    let marathonStartAt = 0;        // quando tentar começar a próxima
    let marathonLastTry = 0;
    let marathonPendingSince = 0;
    let marathonLiveTicks = 0;      // vezes seguidas em que uma partida em andamento foi vista (sem id na URL)

    function marathonLeft() { return Math.max(0, settings.marathonTotal - settings.marathonDone); }

    function syncMarathonUI() {
        const panel = document.getElementById('chess-position-panel');
        if (!panel) return;
        const btn = panel.querySelector('#cpp-marathon-btn');
        const input = panel.querySelector('#cpp-marathon-n');
        const hint = panel.querySelector('#cpp-marathon-hint');
        if (btn) btn.textContent = settings.marathonOn ? tr('u.marStop') : tr('u.marStart');
        const mBtn = panel.querySelector('#cpp-mini-mar-btn');
        const mIn = panel.querySelector('#cpp-mini-mar-n');
        const mHint = panel.querySelector('#cpp-mini-mar-hint');
        const mStop = panel.querySelector('#cpp-mini-mar-stop');
        if (mBtn) mBtn.disabled = settings.marathonOn;
        if (mStop) mStop.disabled = !settings.marathonOn;
        // Rodando: o campo mostra quantas partidas faltam; parada: volta ao número escolhido
        const shownN = String(settings.marathonOn ? marathonLeft() : settings.marathonTotal);
        if (mIn) { mIn.disabled = settings.marathonOn; if (settings.marathonOn || document.activeElement !== mIn) mIn.value = shownN; }
        if (mHint) mHint.textContent = settings.marathonOn
            ? (settings.marathonPending ? tr('m.miniPending', { l: marathonLeft() }) : tr('m.miniRunning', { l: marathonLeft(), c: Math.min(settings.marathonDone + 1, settings.marathonTotal), n: settings.marathonTotal }))
            : (marathonMessage || '');
        if (input) {
            input.disabled = settings.marathonOn;
            if (settings.marathonOn || document.activeElement !== input) input.value = shownN;
        }
        if (hint) {
            if (settings.marathonOn) {
                const n = settings.marathonDone + 1;
                hint.textContent = settings.marathonPending
                    ? tr('m.pending', { d: settings.marathonDone, n: settings.marathonTotal })
                    : tr('m.playing', { c: Math.min(n, settings.marathonTotal), n: settings.marathonTotal, l: marathonLeft() });
            } else {
                hint.textContent = (marathonMessage ? marathonMessage + ' ' : '') +
                    tr('m.intro');
            }
        }
    }
    let marathonMessage = '';

    function startMarathon(raw) {
        const n = Math.min(99, Math.max(1, parseInt(raw) || 0));
        if (!n) return;
        settings.marathonOn = true;
        settings.marathonTotal = n;
        settings.marathonDone = 0;
        settings.marathonPending = false;
        settings.marathonLastId = '';
        settings.autoMove = true;   // sem jogada automática a maratona não anda
        marathonMessage = '';
        marathonOverTicks = 0;
        marathonLiveTicks = 0;
        marathonStartAt = 0;
        marathonPendingSince = 0;
        applySettings();
        const id = getCurrentGameId();
        if (gameIsOver()) {
            // já está numa partida terminada: não conta, só parte para a próxima
            settings.marathonLastId = id;
            settings.marathonPending = true;
            marathonStartAt = Date.now() + 2000;
        }
        saveSettings();
        syncSettingsUI();
        if (!gameIsOver() && !isAnalyzing) { if (!rescheduleAutoMove()) analyzePosition(); }
    }

    function stopMarathon(msg) {
        settings.marathonOn = false;
        settings.marathonPending = false;
        settings.marathonDone = 0;   // parada (ou concluída): o contador volta ao número escolhido
        settings.marathonLastId = '';
        marathonMessage = msg || '';
        marathonLiveTicks = 0;
        marathonStartAt = 0;
        marathonPendingSince = 0;
        saveSettings();
        syncSettingsUI();
    }

    // Fim da partida: aparece o botão de revisão do site ou a janela de resultado
    function gameIsOver() {
        const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const ctl = Array.from(document.querySelectorAll('button, [role="button"], a'))
            .filter(el => !el.closest('#chess-position-panel') && vis(el))
            .map(el => (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' '));
        const rematch = ctl.some(t => /^(revanche|rematch)$/.test(t));
        const newGame = ctl.some(t => /^(novo|nova|new)\b.*\d+\s*(min|\||\+)/.test(t));
        const review = ctl.some(t => /revis[ãa]o da partida|game review/.test(t));
        return rematch && (newGame || review);
    }

    // ============= PEDIDO DE AVALIAÇÃO NA LOJA =============
    // Ao fim de uma partida, a partir da 3ª, um cartão pede avaliação. "Mais tarde" volta depois de 3
    // partidas; "Avaliar" ou a caixa "não exibir novamente" encerram os pedidos. Estado em cppRate.
    const STORE_REVIEW_URL = 'https://chromewebstore.google.com/detail/lpjkldkdhjbpilhgdbjhckkmacpneacd/reviews';
    const RATE_EVERY_GAMES = 3;
    let rateWasOver = null, rateTimer = null;

    function rateLoad(cb) {
        try { chrome.storage.local.get('cppRate', (r) => { if (!chrome.runtime.lastError) cb((r && r.cppRate) || {}); }); } catch (e) { /* sem storage: não pede */ }
    }
    function rateSave(s) { try { chrome.storage.local.set({ cppRate: s }); } catch (e) { /* idem */ } }

    function showRateCard() {
        if (document.getElementById('cpp-rate')) return;
        const d = document.createElement('div');
        d.id = 'cpp-rate';
        d.innerHTML = `<div class="cpp-rate-t">${tr('r.title')}</div><div class="cpp-rate-x">${tr('r.text')}</div>
            <label class="cpp-rate-n"><input type="checkbox"> ${tr('r.never')}</label>
            <div class="cpp-rate-b"><button class="cpp-rate-go">${tr('r.rate')}</button><button class="cpp-rate-later">${tr('r.later')}</button></div>`;
        const finish = (rated) => {
            const never = rated || d.querySelector('input').checked;
            d.remove();
            rateLoad((s) => { if (never) s.never = true; else s.nextAt = (s.games || 0) + RATE_EVERY_GAMES; rateSave(s); });
        };
        d.querySelector('.cpp-rate-go').addEventListener('click', () => { window.open(STORE_REVIEW_URL, '_blank', 'noopener'); finish(true); });
        d.querySelector('.cpp-rate-later').addEventListener('click', () => finish(false));
        document.body.appendChild(d);
    }

    // Conta a partida na transição "em andamento" -> "acabou" (carregar a página já com partida acabada não conta)
    function rateTick() {
        const over = gameIsOver();
        const ended = rateWasOver === false && over;
        rateWasOver = over;
        if (!ended) return;
        rateLoad((s) => {
            if (s.never) return;
            s.games = (s.games || 0) + 1;
            rateSave(s);
            if (s.games >= (s.nextAt || RATE_EVERY_GAMES)) showRateCard();
        });
    }
    document.addEventListener('cpp-rate-test', showRateCard);   // teste manual: document.dispatchEvent(new Event('cpp-rate-test'))

    // Pergunta ao próprio site se a partida acabou (true/false), ou null se não conseguir responder
    async function siteGameFinished(id) {
        for (const kind of ['live', 'daily']) {
            try {
                const r = await fetch(location.origin + '/callback/' + kind + '/game/' + id);
                if (!r.ok) continue;
                const j = await r.json();
                if (j && j.game && typeof j.game.isFinished === 'boolean') return j.game.isFinished;
            } catch (e) { /* tenta o próximo */ }
        }
        return null;
    }
    let marathonApiAt = 0, marathonApiBusy = false, marathonApi = { id: '', v: null };

    // Botão visível pelo texto próprio (nunca "revanche"); prefere <button> a links
    function findByOwnText(re) {
        const list = Array.from(document.querySelectorAll('button, [role="button"], a'))
            .filter(isSafeControl)
            .filter(el => !el.closest('#chess-position-panel'))
            .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
            .filter(el => !REMATCH_RE.test(textOfControl(el)))
            .filter(el => {   // links só se levarem a jogar; nunca artigos, perfis, notícias etc.
                if (el.tagName !== 'A') return true;
                const h = el.getAttribute('href') || '';
                return h === '' || h === '#' || /^(https?:\/\/[^/]*chess\.com)?\/(play|game)\b/.test(h);
            })
            .filter(el => re.test((el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ')));
        return list.find(el => el.tagName === 'BUTTON') || list[0] || null;
    }

    function findPlayButton() {
        const byAttr = Array.from(document.querySelectorAll('[data-cy*="new-game-index-play"], [data-cy*="play-button"]'))
            .find(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
        return byAttr || findByOwnText(/^(jogar|play)( agora| now)?$/);
    }

    function tryStartNewGame() {
        // Numa página de partida, só mexe se a janela de resultado estiver na tela (nunca no meio do jogo)
        if (/\/game\//.test(location.href) && !gameIsOver()) return false;
        const btn = findByOwnText(/^(novo|nova|new)\b.*\d+\s*(min|\||\+)/)     // "Novo 10 min" na janela de resultado
            || findPlayButton()                                                // botão "Jogar" do lobby
            || findByOwnText(/^(novo jogo|nova partida|new game)$/);           // aba "Novo jogo"
        if (btn) { btn.click(); return true; }
        // Passou muito tempo sem achar nada na partida terminada: vai para o lobby
        if (marathonPendingSince && Date.now() - marathonPendingSince > 40000 && /\/game\//.test(location.href) && marathonApi.v === true) {
            marathonPendingSince = Date.now();
            location.assign(location.origin + '/play/online');
        }
        return false;
    }

    function marathonStep() {
        if (!settings.marathonOn) return;
        const now = Date.now();
        const id = getCurrentGameId();

        if (settings.marathonPending) {
            // Partida nova aberta (outro número na endereço): segue o jogo
            if (/\/game\/(?:live|daily)\/\d+/.test(location.href) && id !== settings.marathonLastId) {
                settings.marathonPending = false;
                marathonStartAt = 0;
                marathonPendingSince = 0;
                saveSettings();
                syncMarathonUI();
                return;
            }
            // Sem número da partida na URL (ex.: /play/online): a partida nova é a que aparece em andamento,
            // com tabuleiro cheio, sem janela de resultado e sem botão de jogar (no lobby há tabuleiro de enfeite).
            // Sem isto o estado "próxima partida" nunca saía e o contador não andava.
            if (!/\/game\/(?:live|daily)\/\d+/.test(location.href)) {
                if (!gameIsOver() && !findPlayButton() && Object.keys(getBoardPosition()).length >= 2) {
                    if (++marathonLiveTicks >= 6) {   // ~3 s vendo a partida rodar
                        marathonLiveTicks = 0;
                        settings.marathonPending = false;
                        marathonStartAt = 0;
                        marathonPendingSince = 0;
                        saveSettings();
                        syncMarathonUI();
                        return;
                    }
                } else marathonLiveTicks = 0;
            }
            // Numa partida já contada: só clica se o site confirmar que ela acabou (senão, o estado é velho)
            if (/\/game\/(?:live|daily)\/\d+/.test(location.href)) {
                if (now - marathonApiAt > 3000 && !marathonApiBusy) {
                    marathonApiAt = now;
                    marathonApiBusy = true;
                    siteGameFinished(id).then(v => { marathonApiBusy = false; marathonApi = { id, v }; })
                        .catch(() => { marathonApiBusy = false; });
                }
                if (marathonApi.id !== id) return;
                if (marathonApi.v === false) {
                    settings.marathonPending = false;
                    marathonStartAt = 0;
                    saveSettings();
                    syncMarathonUI();
                    return;
                }
            }
            if (!marathonStartAt) marathonStartAt = now + 3000;
            if (now < marathonStartAt || now - marathonLastTry < 2500) return;
            marathonLastTry = now;
            if (!marathonPendingSince) marathonPendingSince = now;
            // clicou: espera o site abrir a partida antes de tentar de novo (evita clique duplo)
            if (tryStartNewGame()) marathonStartAt = Date.now() + 12000;
            return;
        }

        // Partida em andamento: vigia o fim (uma vez por partida)
        // Com número na URL, cada partida é contada uma vez (id diferente do último contado). Sem número
        // (/play/online), vale a janela de resultado: depois de contar, o estado "próxima partida" segura
        // a contagem até a partida nova aparecer.
        const numericId = /^\d+$/.test(id);
        if (numericId && id === settings.marathonLastId) return;
        // Quem manda é o site (isFinished); só sem resposta dele vale o botão de revisão
        if (numericId && now - marathonApiAt > 3000 && !marathonApiBusy) {
            marathonApiAt = now;
            marathonApiBusy = true;
            siteGameFinished(id).then(v => { marathonApiBusy = false; marathonApi = { id, v }; })
                .catch(() => { marathonApiBusy = false; });
        }
        const answered = !numericId || marathonApi.id === id;   // sem resposta do site ainda: não decide
        const over = answered && (!numericId || marathonApi.v !== false) && gameIsOver();   // a janela de resultado é obrigatória
        if (!over) { marathonOverTicks = 0; return; }
        if (++marathonOverTicks < 3) return;   // ~1,5 s vendo o fim, para não contar por engano
        marathonOverTicks = 0;
        settings.marathonLastId = id;
        settings.marathonDone++;
        if (marathonLeft() <= 0) {
            stopMarathon(tr('m.finished', { n: settings.marathonTotal }));
            return;
        }
        settings.marathonPending = true;
        marathonStartAt = now + 5000 + Math.random() * 15000;   // pausa de 5 a 20 s, sem pressa
        marathonPendingSince = 0;
        saveSettings();
        syncMarathonUI();
    }

    // ============= EXIBIÇÃO AUTOMÁTICA =============
    function checkAndShowPanel() {
        if (!extEnabled) return;
        const isGamePage = window.location.href.includes('/game/') ||
            window.location.href.includes('/play/') ||
            document.querySelector('.board');

        if (isGamePage && !document.getElementById('chess-position-panel')) {
            timers.setTimeout(() => {
                if (document.querySelector('.piece')) createPanel();
            }, 1500);
        }
    }

    // ============= DETECÇÃO DE PARTIDA =============
    function getCurrentGameId() {
        // Tenta extrair o id da partida da URL
        // Aceita /game/live/123, /game/daily/123 e /game/123
        const urlMatch = location.href.match(/\/game\/(?:(?:live|daily)\/)?(\d+)/);
        if (urlMatch) return urlMatch[1];

        const playMatch = location.href.match(/\/play\/[^/]+/);
        if (playMatch) return playMatch[0];

        // Sem id na URL: mantém um id fixo. (Antes usava a contagem de peças, o que tratava
        // cada captura como "partida nova". Partida nova na mesma URL é detectada pela
        // posição inicial no intervalo de análise.)
        return 'no-id';
    }

    // Vigia o tabuleiro a cada 500 ms: detecta partida nova, lance feito e análise travada.
    let watchBoardEl = null;
    let watchFlipped = null;
    let watchPieceCount = 0;
    let lastRecoverAt = 0;

    let recoverTries = 0;

    function boardWatchTick() {
        if (!extensionAlive()) { handleOrphan(); return; }
        try {
            boardWatchTickInner();
        } catch (err) {
            console.log('Erro ao vigiar o tabuleiro:', err);
            updateEngineStatus(tr('e.errorMsg', { m: err && err.message ? err.message : err }));
        }
    }

    function boardWatchTickInner() {
        const positions = getBoardPosition();
        const count = Object.keys(positions).length;
        if (count === 0) return;
        noteClock();

        const fen = positionToFEN(positions);
        const placement = placementOnly(fen);
        const boardEl = document.querySelector('.board');
        const flipped = !!isBoardFlipped();

        // Sinais de partida nova: posição inicial de novo, mais peças que antes (peça nunca volta),
        // tabuleiro recriado pela página ou lado do usuário trocado
        const backToStart = placement === START_PLACEMENT && lastPlacement !== START_PLACEMENT && lastPlacement !== '';
        const moreMaterial = watchPieceCount > 0 && count > watchPieceCount;
        const boardReplaced = watchBoardEl && boardEl && boardEl !== watchBoardEl;
        const sideChanged = watchFlipped !== null && flipped !== watchFlipped;
        watchBoardEl = boardEl;
        watchFlipped = flipped;
        watchPieceCount = count;

        if (backToStart || moreMaterial || boardReplaced || sideChanged) {
            resetCastlingTracking();
            resetAnalysisState();
            lastPlacement = '';
        }

        checkDrawOffer();
        maybeAutoReview();
        marathonStep();
        autoMoveWatchdog(fen);
        const dockedPanel = document.querySelector('#chess-position-panel.cpp-docked');
        if (holdingPiece) { /* peça na mão: não mexe na tela */ }
        else if (dockedPanel) layoutDock(dockedPanel);
        else {
            const pn = document.getElementById('chess-position-panel');
            if (pn && pn.classList.contains('cpp-minimized')) dockPanel(pn, true);   // recolhido: encaixa assim que houver a lateral
            else if (pn) applyPinned(pn);
        }

        // Motor mudo por 15 s no meio de uma busca (ou busca de mais de 2 min): travou, sobe outro
        const now = Date.now();
        if (isAnalyzing && now - analysisStartedAt > 12000 && now - lastEngineMsgAt > 12000) {
            restartEngine('motor sem resposta');
            return;
        }
        if (isAnalyzing && now - analysisStartedAt > 40000) {
            restartEngine('busca longa demais');
            return;
        }

        if (!samePosition(fen, lastFEN) && !samePosition(fen, currentAnalysisFEN)) {
            // Lance feito: a seta antiga não vale mais, some na hora
            if (placement !== lastPlacement) {
                currentLines = [];
                document.querySelectorAll('.cpp-best-move-arrow').forEach(el => el.remove());
                const container = document.querySelector('.cpp-analysis-lines');
                if (container) container.innerHTML = '<div class="cpp-no-analysis">' + tr('a.analyzing') + '</div>';
            }
            analyzePosition();
        } else if (currentLines.length > 0) {
            recoverTries = 0;
        } else if (!isAnalyzing && Date.now() - lastRecoverAt > 3000) {
            // Nada em andamento e nada na tela: tenta de novo (ex.: análise cancelada na troca de partida)
            lastRecoverAt = Date.now();
            // Posição válida e 3 tentativas sem resultado: o motor está ruim, sobe outro
            if (!unsafeReason(positions, fen) && ++recoverTries >= 3) {
                recoverTries = 0;
                restartEngine('sem análise depois de 3 tentativas');
                return;
            }
            lastFEN = '';
            currentAnalysisFEN = '';
            analyzePosition();
        }
    }

    function resetAnalysisState() {
        newGamePending = true;
        gameBaseClock = 0;
        currentLines = [];
        lastFEN = '';
        lastPlacement = '';
        currentAnalysisFEN = '';
        lastBestMove = null;
        lastWhiteEval = null;
        resetResignState();
        resetDrawState();
        marathonOverTicks = 0;
        if (settings.depth === 0) {
            // a partida anterior pode demorar a aparecer no histórico: busca de novo logo e mais uma vez depois
            timers.setTimeout(() => refreshHistory(true), 1500);
            timers.setTimeout(() => refreshHistory(true), 25000);
        }
        renderEvalBar();
        oldDepth = 0;
        cancelPendingMove();
        // Se o motor ainda está pensando, manda parar e recomeça quando ele responder
        if (isAnalyzing && stockfishWorker) {
            pendingRestart = true;
            stockfishWorker.postMessage('stop');
        } else {
            isAnalyzing = false;
        }

        // Apaga as setas e as marcações
        document.querySelectorAll('.cpp-best-move-arrow').forEach(el => el.remove());
        document.querySelectorAll('.cpp-hanging-overlay').forEach(el => el.remove());

        // Atualiza a tela
        const container = document.querySelector('.cpp-analysis-lines');
        if (container) {
            container.innerHTML = '<div class="cpp-no-analysis">' + tr('a.newGame') + '</div>';
        }
    }

    // Sobra de uma versão anterior da extensão (script antigo ainda na página): tira antes de criar o novo
    document.querySelectorAll('#chess-position-panel, .cpp-best-move-arrow, .cpp-hanging-overlay').forEach(el => el.remove());

    loadSettings();
    checkAndShowPanel();

    let lastUrl = location.href;
    let domChangeTimer = null;

    // O chess.com muda o DOM o tempo todo (relógios, animações). Em vez de rodar a cada mutação,
    // agrupa tudo e processa no máximo uma vez a cada 300 ms.
    new MutationObserver(() => {
        if (domChangeTimer) return;
        domChangeTimer = timers.setTimeout(() => {
            domChangeTimer = null;
            onDomChange();
        }, 300);
    }).observe(document, { subtree: true, childList: true });

    function onDomChange() {
        if (!extEnabled) return;
        if (!extensionAlive()) { handleOrphan(); return; }
        try {
            onDomChangeInner();
        } catch (err) {
            console.log('Erro ao detectar a partida:', err);
            updateEngineStatus(tr('e.errorMsg', { m: err && err.message ? err.message : err }));
        }
    }

    function onDomChangeInner() {
        // A página trocou o conteúdo e levou o painel junto (sem o usuário fechar): recria
        if (!panelClosedByUser && !document.getElementById('chess-position-panel') && document.querySelector('.piece')) {
            destroyPanel();
            createPanel();
        }

        const currentGameId = getCurrentGameId();

        // Verifica se a partida mudou
        if (currentGameId !== lastGameId) {
            lastGameId = currentGameId;
            resetCastlingTracking();
            resetAnalysisState();

            // Reanalisa a nova posição
            timers.setTimeout(() => {
                if (isEngineReady) analyzePosition();
            }, 500);
        }

        if (location.href !== lastUrl) {
            lastUrl = location.href;
            timers.setTimeout(checkAndShowPanel, 1500);
        }
    }

    console.log('Analisador de Xadrez Pro carregado!');
})();
