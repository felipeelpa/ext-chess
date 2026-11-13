// Calibra o modelo de erros: simula partidas com os erros de cada rating e mede a precisão média
// (fórmula do Lichess). Alvos pedidos: rating 800 abaixo de 80% (60-70%), rating máximo acima de 90%.
const fs = require('fs');
const vm = require('vm');
const SRC = process.argv[2];
let code = fs.readFileSync(SRC + '\\content.js', 'utf8');
code = code.replace("console.log('Analisador de Xadrez Pro carregado!');", "globalThis.__t={errorProfile,DEPTH_RATINGS};");
const document = { querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, querySelector: () => null };
const sb = { document, console, setTimeout, setInterval, clearInterval, Math, Date, Array, Object, Set, parseInt, parseFloat, self: {},
  location: { href: 'https://www.chess.com/game/live/1' },
  chrome: { runtime: { getURL: x => x, onMessage: { addListener() {} } } },
  MutationObserver: class { observe() {} } };
sb.window = { location: sb.location };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(SRC + '\\chess-lite.js', 'utf8'), sb);
vm.runInContext(code, sb);
const T = sb.__t;
const C = sb.self.CPPChess;

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rng = mulberry32(12345);
const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

// perda (cp) de um lance jogado com o perfil de erros do rating
function sampleLoss(profile, ply) {
  let loss = -Math.log(1 - rng()) * 5;                      // o melhor lance também não é perfeito
  if (rng() < profile.blunder) {
    loss += profile.maxLoss * (1 + rng() * 1.2);           // erro grave
    return Math.min(loss, 900);
  }
  let chance = profile.inaccuracy * (ply < 20 ? 0.5 : 1);   // abertura: metade da chance
  if (rng() < chance) {
    const grid = []; for (let l = 25; l <= profile.maxLoss; l += 5) grid.push(l);
    if (grid.length) {
      const w = grid.map(l => 1 / (1 + l / 60)), tot = w.reduce((a, b) => a + b, 0);
      let r = rng() * tot; for (let i = 0; i < grid.length; i++) { r -= w[i]; if (r <= 0) { loss += grid[i]; break; } }
    }
  }
  return loss;
}

function simulate(rating, games = 400, plies = 70) {
  const profile = T.errorProfile(rating);
  let sum = 0;
  for (let g = 0; g < games; g++) {
    const cps = [0];
    for (let i = 0; i < plies; i++) {
      const L = sampleLoss(profile, i);
      let v = cps[i] + (i % 2 === 0 ? -L : L) + gauss() * 15;
      cps.push(Math.max(-1500, Math.min(1500, v)));
    }
    const a = C.gameAccuracy(cps);
    sum += (a.w + a.b) / 2;
  }
  return sum / games;
}

const rows = [[1, 800], [2, 1000], [3, 1200], [4, 1400], [5, 1600], [6, 1800], [8, 2100], [10, 2400], [12, 2600], [20, 3200]];
const alvo = { 800: [58, 72], 1000: [65, 76], 1200: [70, 80], 1400: [74, 83], 1600: [78, 86], 1800: [82, 88], 2100: [86, 91], 2400: [89, 94], 2600: [91, 95], 3200: [92, 99] };
let fail = 0;
for (const [d, r] of rows) {
  const acc = simulate(r);
  const [lo, hi] = alvo[r];
  const ok = acc >= lo && acc <= hi;
  if (!ok) fail++;
  console.log((ok ? 'OK   ' : 'FAIL ') + `prof ${d} (rating ${r}): precisão média ${acc.toFixed(1)}%  (alvo ${lo}-${hi}%)`);
}
const a800 = simulate(800), a3200 = simulate(3200);
const mono = rows.map(([d, r]) => simulate(r));
let crescente = true; for (let i = 1; i < mono.length; i++) if (mono[i] < mono[i - 1] - 0.5) crescente = false;
console.log((a800 < 80 ? 'OK   ' : 'FAIL ') + 'rating 800 abaixo de 80%'); if (!(a800 < 80)) fail++;
console.log((a3200 > 90 ? 'OK   ' : 'FAIL ') + 'rating máximo acima de 90%'); if (!(a3200 > 90)) fail++;
console.log((crescente ? 'OK   ' : 'FAIL ') + 'precisão cresce com o rating'); if (!crescente) fail++;
console.log(fail ? `${fail} falha(s)` : 'Tudo OK');
process.exit(fail ? 1 : 0);
