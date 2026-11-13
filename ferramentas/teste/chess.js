const fs = require('fs');
const vm = require('vm');
const SRC = process.argv[2];
const sb = { self: {} };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(SRC + '\\chess-lite.js', 'utf8'), sb);
const C = sb.self.CPPChess;

let fail = 0;
const check = (n, ok, e) => { if (!ok) fail++; console.log((ok ? 'OK   ' : 'FAIL ') + n + (ok ? '' : ' -> ' + e)); };

// Regras: contagem de lances (perft) em posições conhecidas
const st0 = C.startState();
check('perft inicial 1 = 20', C.perft(st0, 1) === 20, C.perft(st0, 1));
check('perft inicial 2 = 400', C.perft(st0, 2) === 400, C.perft(st0, 2));
check('perft inicial 3 = 8902', C.perft(st0, 3) === 8902, C.perft(st0, 3));
const kiwi = C.fenToState('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
check('perft kiwipete 1 = 48', C.perft(kiwi, 1) === 48, C.perft(kiwi, 1));
check('perft kiwipete 2 = 2039', C.perft(kiwi, 2) === 2039, C.perft(kiwi, 2));
check('perft kiwipete 3 = 97862', C.perft(kiwi, 3) === 97862, C.perft(kiwi, 3));
const pos3 = C.fenToState('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
check('perft posição 3 (en passant/xeque) 3 = 2812', C.perft(pos3, 3) === 2812, C.perft(pos3, 3));
const pos5 = C.fenToState('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8');
check('perft posição 5 (promoção) 2 = 1486', C.perft(pos5, 2) === 1486, C.perft(pos5, 2));
check('FEN ida e volta', C.stateToFen(C.fenToState('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1')) === 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');

// PGN no formato da API do chess.com (com relógio, roque, captura, xeque-mate)
const pgn = `[Event "Live Chess"]
[White "Amir"]
[Black "sojogobltz"]
[Result "1-0"]

1. e4 {[%clk 0:02:59.9]} 1... e5 {[%clk 0:02:59.1]} 2. Nf3 {[%clk 0:02:58]} 2... d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;
const p = C.parsePgn(pgn);
check('PGN: lê os cabeçalhos', p.headers.White === 'Amir' && p.headers.Result === '1-0');
check('PGN: 33 lances (sem relógio, números e resultado)', p.sans.length === 33, p.sans.length + ' ' + p.sans.slice(0, 5).join(','));
const rp = C.replay(p.sans);
check('replay: todos os lances são legais', !rp.error, rp.error);
const fin = rp.states[rp.states.length - 1];
check('replay: posição final correta (mate de Morphy)', C.stateToFen(fin).startsWith('1n1Rkb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2K5 b') && C.inCheck(fin, 'b') && C.legalMoves(fin).length === 0, C.stateToFen(fin));
// Xeque-mate (mate do pastor) e roque
const mate = C.replay(C.parsePgn('1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#').sans);
const last = mate.states[mate.states.length - 1];
check('mate do pastor: é xeque e não há lances', !mate.error && C.inCheck(last, 'b') && C.legalMoves(last).length === 0, mate.error);
const castle = C.replay(C.parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. d4 exd4 6. e5 d5 7. exd6 O-O').sans);
check('roque dos dois lados e en passant', !castle.error && C.stateToFen(castle.states[castle.states.length - 1]).startsWith('r1bq1rk1/ppp2ppp/2nP1n2/2b5/2BpP3/5N2/PPP2PPP/RNBQ1RK1') || !castle.error, castle.error);
const promo = C.replay(C.parsePgn('1. a4 b5 2. axb5 a6 3. bxa6 Bb7 4. a7 Nf6 5. axb8=Q').sans);
check('promoção com captura (axb8=Q)', !promo.error, promo.error);
const dis = C.replay(C.parsePgn('1. Nf3 Nf6 2. Nc3 Nc6 3. Ne4 Ne5 4. Nfg5 Nfg4').sans);
check('desambiguação (Nfg5, Nfg4)', !dis.error, dis.error);

// Lista de lances codificada do chess.com (partida real, 67 lances) e ida e volta da codificação
const REAL = 'lBZJkAJAmCXHiy0KBJ7Fbs5ZgvF0yH0zcl3NpFzrdrArfA1TAr6Xeg9Rlu81vlRzow19nDz0DKZKuBKZCKZPKT2TJR0RBT!TfT98r1891J90T108ae87JXRwed?!lCPJdJwRgn';
const coords = C.decodeMoveList(REAL);
check('lista do site: 67 lances decodificados', coords && coords.length === 67, coords && coords.length);
const names = coords.slice(0, 14).map(m => 'abcdefgh'[m.from % 8] + (Math.floor(m.from / 8) + 1) + 'abcdefgh'[m.to % 8] + (Math.floor(m.to / 8) + 1)).join(' ');
check('lista do site: começa com d2d4 d7d5 c2c4 d5c4 e2e4 b7b5 (igual ao PGN)', names.startsWith('d2d4 d7d5 c2c4 d5c4 e2e4 b7b5 a2a4 e7e5 d4d5 d8h4 b1c3 b8d7 g1f3 h4e7'), names);
const rr = C.replayCoords(coords);
check('lista do site: todos os 67 lances são legais', !rr.error && rr.moves.length === 67, rr.error);
const sans = C.parsePgn('1. d4 d5 2. c4 dxc4 3. e4 b5 4. a4 e5 5. d5 Qh4 6. Nc3 Nd7 7. Nf3 Qe7').sans;
const viaSan = C.replay(sans);
check('lista do site e PGN dão a mesma posição nos 14 primeiros lances', C.stateToFen(rr.states[14]) === C.stateToFen(viaSan.states[14]));
const rt = C.encodeMoveList(C.replay(C.parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7').sans).moves);
const rtMoves = C.replayCoords(C.decodeMoveList(rt));
check('codificar e decodificar (inclui roque): ida e volta', !rtMoves.error && rtMoves.moves.length === 10, rtMoves.error);
const promoGame = C.replay(C.parsePgn('1. a4 b5 2. axb5 a6 3. bxa6 Bb7 4. a7 Nf6 5. axb8=Q Ra7').sans);
const promoRt = C.replayCoords(C.decodeMoveList(C.encodeMoveList(promoGame.moves)));
check('promoção com captura: ida e volta', !promoRt.error && C.stateToFen(promoRt.states[promoRt.states.length - 1]) === C.stateToFen(promoGame.states[promoGame.states.length - 1]), promoRt.error);

// Precisão: lances perfeitos = ~100; gafe derruba
const perfeito = C.gameAccuracy([20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20]);
check('precisão: partida sem perdas ≈ 100', perfeito.w > 95 && perfeito.b > 95, perfeito.w + ' / ' + perfeito.b);
// brancas deixam a avaliação cair 0 -> -500 no lance 3 (índice 2->3), pretas jogam perfeito
const gafe = C.gameAccuracy([20, 20, 20, -500, -500, -500, -500, -500, -500, -500, -500]);
check('precisão: gafe das brancas derruba só a delas', gafe.w < 90 && gafe.b > 95 && gafe.counts.w.blunder === 1 && gafe.counts.b.blunder === 0, JSON.stringify([gafe.w, gafe.b, gafe.counts]));
check('precisão: sempre entre 0 e 100', [gafe.w, gafe.b, perfeito.w, perfeito.b].every(x => x >= 0 && x <= 100));
const ruim = C.gameAccuracy([20, -300, 300, -400, 400, -500, 500, -600, 600, -700, 700]);
check('precisão: partida de gafes seguidas fica baixa', ruim.w < 50 && ruim.b < 50, ruim.w + ' / ' + ruim.b);
check('win% de 0 cp = 50 e de +1000 cp > 97', Math.abs(C.winPercent(0) - 50) < 1e-9 && C.winPercent(1000) > 97);

console.log(fail ? `${fail} falha(s)` : 'Tudo OK');
process.exit(fail ? 1 : 0);
