const fs = require('fs');
const vm = require('vm');
const file = process.argv[2];
let code = fs.readFileSync(file, 'utf8');
code = code.replace("console.log('Analisador de Xadrez Pro carregado!');",
  "globalThis.__t={positionToFEN,getBoardPosition,resetCastlingTracking,getCurrentGameId};");

let pieces = [], highlights = [];
const mk = (cls) => ({ className: cls, classList: { contains: c => cls.split(' ').includes(c), [Symbol.iterator]: null }, closest: () => null });
const hl = (sq) => { const cls = 'highlight square-' + sq; const arr = cls.split(' '); return { className: cls, classList: Object.assign(arr.slice(), { contains: c => arr.includes(c) }) }; };

const document = {
  querySelectorAll(sel) {
    if (sel === '.piece') return pieces.map(p => mk(p));
    if (sel === '.highlight') return highlights.map(hl);
    return [];
  },
  querySelector() { return null; },
  getElementById() { return null; },
  addEventListener() {},
};
const sandbox = {
  document, console, setTimeout, setInterval, clearInterval,
  location: { href: 'https://www.chess.com/game/live/123' },
  chrome: { runtime: { getURL: x => x, onMessage: { addListener() {} } } },
  MutationObserver: class { observe() {} },
  window: { get location() { return sandbox.location; } }, Array, Object, Set, Math, parseInt,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const T = sandbox.__t;

const files = 'abcdefgh';
function setBoard(fen, hls) {
  pieces = [];
  const map = { P: 'wp', N: 'wn', B: 'wb', R: 'wr', Q: 'wq', K: 'wk', p: 'bp', n: 'bn', b: 'bb', r: 'br', q: 'bq', k: 'bk' };
  fen.split('/').forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      pieces.push(`piece ${map[ch]} square-${f + 1}${8 - i}`);
      f++;
    }
  });
  highlights = hls || [];
}

let fail = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) fail++;
  console.log((ok ? 'OK   ' : 'FAIL ') + name + (ok ? '' : `\n  got:  ${got}\n  want: ${want}`));
}

// 1. Posição inicial
setBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
check('inicial', T.positionToFEN(T.getBoardPosition()), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

// 2. 1.e4 sem peão adversário ao lado -> sem en passant; vez das pretas
setBoard('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR', [52, 54]);
check('1.e4 sem captura possivel', T.positionToFEN(T.getBoardPosition()), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');

// 3. Peão preto em d4 + brancas jogam e2-e4 -> en passant em e3
setBoard('rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR', [52, 54]);
check('en passant e3', T.positionToFEN(T.getBoardPosition()), 'rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');

// 4. Pretas jogam d7-d5 com peão branco em e5 -> en passant em d6
setBoard('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR', [74, 75].map(x => x - 20)); // d7 (47?) ajustado abaixo
setBoard('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR', [47, 45]);
check('en passant d6', T.positionToFEN(T.getBoardPosition()), 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 1');

// 5. Avanço simples não gera en passant
setBoard('rnbqkbnr/pppppppp/8/8/8/4P3/PPPP1PPP/RNBQKBNR', [52, 53]);
check('avanço simples', T.positionToFEN(T.getBoardPosition()), 'rnbqkbnr/pppppppp/8/8/8/4P3/PPPP1PPP/RNBQKBNR b KQkq - 0 1');

// 6. Roque: torre h1 saiu -> perde K; voltando a h1 continua sem K
T.resetCastlingTracking();
setBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN1');
let f = T.positionToFEN(T.getBoardPosition());
check('torre h1 fora', f, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN1 w Qkq - 0 1');
setBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
check('torre voltou: continua sem K', T.positionToFEN(T.getBoardPosition()), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w Qkq - 0 1');

// 7. Rei andou e voltou -> sem direitos brancos
T.resetCastlingTracking();
setBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPKPPP/RNBQ1BNR');
T.positionToFEN(T.getBoardPosition());
setBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
check('rei voltou: sem KQ', T.positionToFEN(T.getBoardPosition()), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w kq - 0 1');

// 8. Game id: sem id na URL não depende de peças
check('game id estavel', T.getCurrentGameId(), '123');
sandbox.location.href = 'https://www.chess.com/game/186674346210';
check('game id sem live/ (formato /game/ID)', T.getCurrentGameId(), '186674346210');
sandbox.location.href = 'https://www.chess.com/game/daily/555?x=1';
check('game id daily', T.getCurrentGameId(), '555');
sandbox.location.href = 'https://www.chess.com/game/live/123';
sandbox.location.href = 'https://www.chess.com/play/computer';
const a = T.getCurrentGameId();
setBoard('4k3/8/8/8/8/8/8/4K3');
check('game id nao muda com capturas', T.getCurrentGameId(), a);

console.log(fail ? `\n${fail} FALHA(S)` : '\nTodos os testes passaram');
process.exit(fail ? 1 : 0);
