// Analisador de Xadrez Pro - regras do xadrez (geração de lances legais, SAN, PGN) e cálculo de precisão.
// Usado pela "Precisão da partida": reproduz uma partida lance a lance e compara com o Stockfish.
// Fica exposto em self.CPPChess; não depende da página.
(function (root) {
    'use strict';

    const FILES = 'abcdefgh';
    const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
    const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    // Casas: índice 0..63, a1 = 0, h1 = 7, a8 = 56
    const sq = (f, r) => r * 8 + f;
    const fileOf = (s) => s & 7;
    const rankOf = (s) => s >> 3;
    const name = (s) => FILES[fileOf(s)] + (rankOf(s) + 1);
    const parseSq = (str) => sq(FILES.indexOf(str[0]), parseInt(str[1]) - 1);
    const colorOf = (p) => (p === p.toUpperCase() ? 'w' : 'b');

    function fenToState(fen) {
        const parts = fen.trim().split(/\s+/);
        const board = new Array(64).fill(null);
        parts[0].split('/').forEach((row, i) => {
            let f = 0;
            for (const ch of row) {
                if (/\d/.test(ch)) { f += parseInt(ch); continue; }
                board[sq(f, 7 - i)] = ch;
                f++;
            }
        });
        const c = parts[2] || '-';
        return {
            board,
            turn: parts[1] || 'w',
            castling: { K: c.includes('K'), Q: c.includes('Q'), k: c.includes('k'), q: c.includes('q') },
            ep: parts[3] && parts[3] !== '-' ? parseSq(parts[3]) : -1,
            half: parseInt(parts[4]) || 0,
            full: parseInt(parts[5]) || 1
        };
    }

    function stateToFen(st) {
        let out = '';
        for (let r = 7; r >= 0; r--) {
            let empty = 0;
            for (let f = 0; f < 8; f++) {
                const p = st.board[sq(f, r)];
                if (!p) { empty++; continue; }
                if (empty) { out += empty; empty = 0; }
                out += p;
            }
            if (empty) out += empty;
            if (r > 0) out += '/';
        }
        const c = (st.castling.K ? 'K' : '') + (st.castling.Q ? 'Q' : '') + (st.castling.k ? 'k' : '') + (st.castling.q ? 'q' : '');
        return `${out} ${st.turn} ${c || '-'} ${st.ep >= 0 ? name(st.ep) : '-'} ${st.half} ${st.full}`;
    }

    function startState() { return fenToState(START_FEN); }

    // A casa s é atacada por alguma peça da cor by?
    function isAttacked(board, s, by) {
        const f = fileOf(s), r = rankOf(s);
        const has = (ff, rr, types) => {
            if (ff < 0 || ff > 7 || rr < 0 || rr > 7) return false;
            const p = board[sq(ff, rr)];
            return !!p && colorOf(p) === by && types.includes(p.toUpperCase());
        };
        const pr = by === 'w' ? r - 1 : r + 1;
        if (has(f - 1, pr, 'P') || has(f + 1, pr, 'P')) return true;
        for (const [df, dr] of KNIGHT) if (has(f + df, r + dr, 'N')) return true;
        for (const [df, dr] of KING) if (has(f + df, r + dr, 'K')) return true;
        for (const [df, dr] of BISHOP) {
            for (let ff = f + df, rr = r + dr; ff >= 0 && ff < 8 && rr >= 0 && rr < 8; ff += df, rr += dr) {
                const p = board[sq(ff, rr)];
                if (p) { if (colorOf(p) === by && (p.toUpperCase() === 'B' || p.toUpperCase() === 'Q')) return true; break; }
            }
        }
        for (const [df, dr] of ROOK) {
            for (let ff = f + df, rr = r + dr; ff >= 0 && ff < 8 && rr >= 0 && rr < 8; ff += df, rr += dr) {
                const p = board[sq(ff, rr)];
                if (p) { if (colorOf(p) === by && (p.toUpperCase() === 'R' || p.toUpperCase() === 'Q')) return true; break; }
            }
        }
        return false;
    }

    function kingSquare(board, color) {
        const k = color === 'w' ? 'K' : 'k';
        return board.indexOf(k);
    }

    function inCheck(st, color) {
        const k = kingSquare(st.board, color);
        return k >= 0 && isAttacked(st.board, k, color === 'w' ? 'b' : 'w');
    }

    // Aplica o lance e devolve um estado novo (não valida)
    function makeMove(st, m) {
        const board = st.board.slice();
        const piece = board[m.from];
        const us = st.turn, them = us === 'w' ? 'b' : 'w';
        const castling = Object.assign({}, st.castling);
        let ep = -1;
        board[m.from] = null;
        if (m.ep) board[sq(fileOf(m.to), rankOf(m.from))] = null;
        board[m.to] = m.promo ? (us === 'w' ? m.promo.toUpperCase() : m.promo.toLowerCase()) : piece;
        if (m.castle) {
            const r = rankOf(m.from);
            if (m.castle === 'K') { board[sq(5, r)] = board[sq(7, r)]; board[sq(7, r)] = null; }
            else { board[sq(3, r)] = board[sq(0, r)]; board[sq(0, r)] = null; }
        }
        if (piece.toUpperCase() === 'P' && Math.abs(rankOf(m.to) - rankOf(m.from)) === 2) ep = sq(fileOf(m.from), (rankOf(m.from) + rankOf(m.to)) / 2);
        if (piece === 'K') { castling.K = false; castling.Q = false; }
        if (piece === 'k') { castling.k = false; castling.q = false; }
        for (const s of [m.from, m.to]) {
            if (s === 0) castling.Q = false;
            if (s === 7) castling.K = false;
            if (s === 56) castling.q = false;
            if (s === 63) castling.k = false;
        }
        return {
            board, turn: them, castling, ep,
            half: (piece.toUpperCase() === 'P' || m.capture) ? 0 : st.half + 1,
            full: st.full + (us === 'b' ? 1 : 0)
        };
    }

    function pseudoMoves(st) {
        const moves = [];
        const us = st.turn, them = us === 'w' ? 'b' : 'w';
        const b = st.board;
        for (let s = 0; s < 64; s++) {
            const p = b[s];
            if (!p || colorOf(p) !== us) continue;
            const t = p.toUpperCase(), f = fileOf(s), r = rankOf(s);
            const add = (to, extra) => moves.push(Object.assign({ from: s, to, piece: t, capture: !!b[to] }, extra || {}));
            if (t === 'P') {
                const dir = us === 'w' ? 1 : -1, startRank = us === 'w' ? 1 : 6, lastRank = us === 'w' ? 7 : 0;
                const pushTo = (to, extra) => {
                    if (rankOf(to) === lastRank) for (const pr of ['q', 'r', 'b', 'n']) add(to, Object.assign({ promo: pr }, extra || {}));
                    else add(to, extra);
                };
                const one = sq(f, r + dir);
                if (r + dir >= 0 && r + dir < 8 && !b[one]) {
                    pushTo(one);
                    if (r === startRank && !b[sq(f, r + 2 * dir)]) add(sq(f, r + 2 * dir));
                }
                for (const df of [-1, 1]) {
                    const ff = f + df, rr = r + dir;
                    if (ff < 0 || ff > 7 || rr < 0 || rr > 7) continue;
                    const to = sq(ff, rr);
                    if (b[to] && colorOf(b[to]) === them) pushTo(to, { capture: true });
                    else if (to === st.ep) add(to, { ep: true, capture: true });
                }
            } else if (t === 'N' || t === 'K') {
                for (const [df, dr] of (t === 'N' ? KNIGHT : KING)) {
                    const ff = f + df, rr = r + dr;
                    if (ff < 0 || ff > 7 || rr < 0 || rr > 7) continue;
                    const to = sq(ff, rr);
                    if (!b[to] || colorOf(b[to]) === them) add(to);
                }
            } else {
                const dirs = t === 'B' ? BISHOP : t === 'R' ? ROOK : BISHOP.concat(ROOK);
                for (const [df, dr] of dirs) {
                    for (let ff = f + df, rr = r + dr; ff >= 0 && ff < 8 && rr >= 0 && rr < 8; ff += df, rr += dr) {
                        const to = sq(ff, rr);
                        if (b[to]) { if (colorOf(b[to]) === them) add(to); break; }
                        add(to);
                    }
                }
            }
        }
        // Roque
        const home = us === 'w' ? 0 : 7, kingCh = us === 'w' ? 'K' : 'k', rookCh = us === 'w' ? 'R' : 'r';
        const kSq = sq(4, home);
        if (b[kSq] === kingCh && !isAttacked(b, kSq, them)) {
            if (st.castling[us === 'w' ? 'K' : 'k'] && b[sq(7, home)] === rookCh && !b[sq(5, home)] && !b[sq(6, home)]
                && !isAttacked(b, sq(5, home), them) && !isAttacked(b, sq(6, home), them)) {
                moves.push({ from: kSq, to: sq(6, home), piece: 'K', capture: false, castle: 'K' });
            }
            if (st.castling[us === 'w' ? 'Q' : 'q'] && b[sq(0, home)] === rookCh && !b[sq(1, home)] && !b[sq(2, home)] && !b[sq(3, home)]
                && !isAttacked(b, sq(3, home), them) && !isAttacked(b, sq(2, home), them)) {
                moves.push({ from: kSq, to: sq(2, home), piece: 'K', capture: false, castle: 'Q' });
            }
        }
        return moves;
    }

    function legalMoves(st) {
        return pseudoMoves(st).filter(m => !inCheck(makeMove(st, m), st.turn));
    }

    function perft(st, depth) {
        if (depth === 0) return 1;
        let n = 0;
        for (const m of legalMoves(st)) n += depth === 1 ? 1 : perft(makeMove(st, m), depth - 1);
        return n;
    }

    function moveToUci(m) { return name(m.from) + name(m.to) + (m.promo || ''); }

    // Notação algébrica (SAN) -> lance legal da posição (ou null)
    function sanToMove(st, san) {
        let s = san.replace(/[+#!?]+$/g, '').replace(/e\.p\./, '').trim();
        const legal = legalMoves(st);
        if (/^(O-O-O|0-0-0)$/.test(s)) return legal.find(m => m.castle === 'Q') || null;
        if (/^(O-O|0-0)$/.test(s)) return legal.find(m => m.castle === 'K') || null;
        let promo = null;
        const pm = s.match(/=?([QRBNqrbn])$/);
        if (pm && /[a-h][18]=?[QRBNqrbn]$/.test(s)) { promo = pm[1].toLowerCase(); s = s.replace(/=?[QRBNqrbn]$/, ''); }
        const m = s.match(/^([KQRBN])?([a-h])?([1-8])?x?([a-h][1-8])$/);
        if (!m) return null;
        const piece = m[1] || 'P', to = parseSq(m[4]);
        const cands = legal.filter(x => x.piece === piece && x.to === to && (x.promo || null) === promo
            && (!m[2] || FILES[fileOf(x.from)] === m[2]) && (!m[3] || rankOf(x.from) === parseInt(m[3]) - 1));
        return cands.length === 1 ? cands[0] : (cands[0] || null);
    }

    // PGN -> { headers, sans }
    function parsePgn(pgn) {
        const headers = {};
        pgn.replace(/\[(\w+)\s+"([^"]*)"\]/g, (_, k, v) => { headers[k] = v; return ''; });
        let body = pgn.replace(/\[[^\]]*\]/g, ' ');
        let prev;
        do { prev = body; body = body.replace(/\([^()]*\)/g, ' '); } while (body !== prev);   // variantes
        body = body.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ').replace(/\$\d+/g, ' ');
        const sans = [];
        for (const tok of body.split(/\s+/)) {
            if (!tok) continue;
            if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) continue;
            const t = tok.replace(/^\d+\.(\.\.)?/, '');
            if (t) sans.push(t);
        }
        return { headers, sans };
    }

    // Reproduz a partida: devolve as posições (estados) e os lances
    function replay(sans, startFen) {
        let st = startFen ? fenToState(startFen) : startState();
        const states = [st], moves = [];
        for (const san of sans) {
            const m = sanToMove(st, san);
            if (!m) return { states, moves, error: 'lance ilegal ou ambíguo: ' + san };
            moves.push(m);
            st = makeMove(st, m);
            states.push(st);
        }
        return { states, moves, error: null };
    }

    // Lista de lances do chess.com ("moveList" do endereço /callback/live/game/ID): 2 caracteres por
    // lance (casa de origem e de destino, 0..63 = a1..h8). Destino 64 ou mais = promoção.
    const MOVELIST_CODE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?{~}(^)[_]@#$,./&-*+=';
    const PROMO_ORDER = 'qnrbkp';

    function decodeMoveList(str) {
        const out = [];
        for (let i = 0; i + 1 < str.length; i += 2) {
            const from = MOVELIST_CODE.indexOf(str[i]);
            let to = MOVELIST_CODE.indexOf(str[i + 1]);
            if (from < 0 || from > 63 || to < 0) return null;
            let promo = null;
            if (to > 63) {
                const k = to - 64;
                promo = PROMO_ORDER[Math.floor(k / 3)];
                const dir = (k % 3) - 1;
                to = sq(fileOf(from) + dir, rankOf(from) === 6 ? 7 : 0);
                if (!promo || fileOf(from) + dir < 0 || fileOf(from) + dir > 7) return null;
            }
            out.push({ from, to, promo });
        }
        return out;
    }

    function encodeMoveList(moves) {
        let s = '';
        for (const m of moves) {
            s += MOVELIST_CODE[m.from];
            if (m.promo) s += MOVELIST_CODE[64 + PROMO_ORDER.indexOf(m.promo) * 3 + (fileOf(m.to) - fileOf(m.from) + 1)];
            else s += MOVELIST_CODE[m.to];
        }
        return s;
    }

    // Reproduz a partida a partir dos lances (origem/destino) em vez de SAN
    function replayCoords(coords, startFen) {
        let st = startFen ? fenToState(startFen) : startState();
        const states = [st], moves = [];
        for (const c of coords) {
            const legal = legalMoves(st);
            let m = legal.find(x => x.from === c.from && x.to === c.to && (x.promo || null) === (c.promo || null));
            if (!m && !c.promo) {   // roque escrito como "rei captura a torre"
                const king = st.board[c.from];
                if (king && king.toUpperCase() === 'K') {
                    const kingSide = fileOf(c.to) > fileOf(c.from);
                    m = legal.find(x => x.castle === (kingSide ? 'K' : 'Q') && x.from === c.from);
                }
            }
            if (!m) return { states, moves, error: 'lance ilegal: ' + name(c.from) + name(c.to) };
            moves.push(m);
            st = makeMove(st, m);
            states.push(st);
        }
        return { states, moves, error: null };
    }

    // ----- precisão (fórmulas do Lichess, que são abertas) -----
    function winPercent(cp) { return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1); }
    function moveAccuracy(before, after) {
        const loss = Math.max(0, before - after);
        return Math.min(100, Math.max(0, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
    }

    // cps[i] = avaliação (em centipeões, do ponto de vista das BRANCAS) da posição i; i = 0..n
    // Devolve { w, b, wMoves, bMoves, counts } com precisão 0..100 de cada lado e contagem de erros
    function gameAccuracy(cps) {
        const n = cps.length - 1;
        const wins = cps.map(winPercent);
        const accs = { w: [], b: [] }, weights = { w: [], b: [] };
        const counts = { w: { blunder: 0, mistake: 0, inaccuracy: 0 }, b: { blunder: 0, mistake: 0, inaccuracy: 0 } };
        const win = Math.min(8, Math.max(2, Math.floor((n + 1) / 10)));
        const perMove = [];
        for (let i = 0; i < n; i++) {
            const mover = i % 2 === 0 ? 'w' : 'b';   // partida padrão: brancas jogam primeiro
            const before = mover === 'w' ? wins[i] : 100 - wins[i];
            const after = mover === 'w' ? wins[i + 1] : 100 - wins[i + 1];
            const acc = moveAccuracy(before, after);
            const loss = Math.max(0, before - after);
            const lo = Math.max(0, i - win), hi = Math.min(wins.length, i + win + 1);
            const slice = wins.slice(lo, hi);
            const mean = slice.reduce((a, x) => a + x, 0) / slice.length;
            const sd = Math.sqrt(slice.reduce((a, x) => a + (x - mean) ** 2, 0) / slice.length);
            accs[mover].push(acc);
            weights[mover].push(Math.min(12, Math.max(0.5, sd)));
            if (loss >= 30) counts[mover].blunder++;
            else if (loss >= 20) counts[mover].mistake++;
            else if (loss >= 10) counts[mover].inaccuracy++;
            perMove.push({ mover, acc, loss });
        }
        const side = (c) => {
            const a = accs[c], w = weights[c];
            if (!a.length) return null;
            const weighted = a.reduce((s, x, i) => s + x * w[i], 0) / w.reduce((s, x) => s + x, 0);
            const harmonic = a.length / a.reduce((s, x) => s + 1 / Math.max(x, 1), 0);
            return Math.min(100, Math.max(0, (weighted + harmonic) / 2));
        };
        return { w: side('w'), b: side('b'), counts, perMove };
    }

    root.CPPChess = {
        START_FEN, fenToState, stateToFen, startState, legalMoves, makeMove, inCheck, perft,
        moveToUci, sanToMove, parsePgn, replay, decodeMoveList, encodeMoveList, replayCoords, winPercent, moveAccuracy, gameAccuracy
    };
})(typeof self !== 'undefined' ? self : this);
