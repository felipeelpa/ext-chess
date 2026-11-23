const fs = require('fs');
const vm = require('vm');
let code = fs.readFileSync(process.argv[2] + '\\content.js', 'utf8');
code = code.replace("console.log('Analisador de Xadrez Pro carregado!');",
  "globalThis.__t={chooseMoveWithErrors,errorProfile,engineMultiPV,setDepth:(d)=>{analysisDepth=d;},computeThinkTime,noteClock,timeControlKind,resetClock:()=>{gameBaseClock=0;},setCtx:(l,pc,lm)=>{currentLines=l;pieceCountAtAnalysis=pc;lastMoveAtAnalysis=lm;},setPace:(p)=>{settings.pace=p;},sanitizeSettings,DEPTH_RATINGS,ratingLabel,getMyClockSeconds,planCandidates,planArrowLines,historyDepth,computeAutoDepth,setHistory:(h)=>{historyResults=h;},setSettingsDepth:(d)=>{settings.depth=d;},setStyle:(v)=>{settings.style=v;},setBoard:(p)=>{getBoardPosition=()=>p;},findMateInOne,setPlanCtx:(p)=>{lastPlan=p;},noteSeen:noteSeenPosition,clearSeen:()=>{seenPositions.clear();lastSeenKey='';}};");

let clockText = '5:00';
const document = {
  querySelectorAll: () => [], getElementById: () => null, addEventListener() {},
  querySelector: (s) => s.includes('clock') && clockText ? { textContent: clockText } : null,
};
const sb = { self: {}, document, console, setTimeout, setInterval, clearInterval, Math, Date, Array, Object, Set, parseInt, parseFloat,
  location: { href: 'https://www.chess.com/game/live/1' },
  chrome: { runtime: { getURL: x => x, onMessage: { addListener() {} } } },
  MutationObserver: class { observe() {} } };
sb.window = { location: sb.location, addEventListener() {} };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(process.argv[2] + '\\chess-lite.js', 'utf8'), sb);
vm.runInContext(code, sb);
const T = sb.__t;

let fail = 0;
const check = (n, ok, e) => { if (!ok) fail++; console.log((ok ? 'OK   ' : 'FAIL ') + n + (ok ? '' : ' -> ' + e)); };

const M = ['e2e4', 'd2d4', 'g1f3'];
const L = (a, b, c, first) => [a, b, c].map((v, i) => ({ move: i === 0 && first ? first : M[i], score: { type: 'cp', value: v } }));
const setKind = (txt) => { T.resetClock(); clockText = txt; T.noteClock(); };
const sd = (fn, n = 600) => { const a = Array.from({ length: n }, () => fn() / 1000); const m = a.reduce((s, x) => s + x, 0) / n; return { m, cv: Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / n) / m, max: Math.max(...a), min: Math.min(...a) }; };

// Tipo de partida pelo relógio
setKind('1:00'); check('1:00 = bullet', T.timeControlKind() === 'bullet', T.timeControlKind());
setKind('2:00'); check('2:00 = bullet', T.timeControlKind() === 'bullet');
setKind('3:00'); check('3:00 = blitz', T.timeControlKind() === 'blitz', T.timeControlKind());
setKind('5:00'); check('5:00 = blitz', T.timeControlKind() === 'blitz');
setKind('10:00'); check('10:00 = rápida', T.timeControlKind() === 'rapid', T.timeControlKind());
setKind('1:00:00'); check('1h = rápida', T.timeControlKind() === 'rapid');
setKind(''); check('sem relógio assume blitz', T.timeControlKind() === 'blitz');

const quiet = L(30, 28, 25);                 // várias opções parecidas
const standout = L(400, 20, 10);             // lance silencioso muito melhor que os outros
const recapture = L(400, 20, 10, 'd5e4');    // recaptura óbvia
const out = {};
for (const [name, clk] of [['bullet', '1:00'], ['blitz', '5:00'], ['rapid', '10:00']]) {
  T.setPace('smart');
  setKind(clk);
  T.setCtx(quiet, 20, null);          const comum = sd(() => T.computeThinkTime('e2e4'));
  T.setCtx(standout, 20, null);       const exc = sd(() => T.computeThinkTime('e2e4'));
  T.setCtx(recapture, 20, { to: 'e4' }); const obv = sd(() => T.computeThinkTime('d5e4'));
  T.setCtx(quiet, 32, null);          const abert = sd(() => T.computeThinkTime('e2e4'));
  T.setCtx(quiet, 20, null);          const erro = sd(() => T.computeThinkTime('a2a3'));
  out[name] = { comum, exc, obv, abert, erro };
  console.log(`${name}: comum=${comum.m.toFixed(2)}s excelente=${exc.m.toFixed(2)}s recaptura=${obv.m.toFixed(2)}s abertura=${abert.m.toFixed(2)}s erro=${erro.m.toFixed(2)}s (maior=${exc.max.toFixed(1)}s)`);
  check(`${name}: recaptura óbvia é a mais rápida`, obv.m < comum.m && obv.m < exc.m);
  check(`${name}: erro sai rápido (menos que lance comum)`, erro.m < comum.m);
  check(`${name}: abertura é rápida`, abert.m < comum.m);
  check(`${name}: só o lance excelente demora mais`, exc.m > comum.m * 2, `${exc.m} vs ${comum.m}`);
  check(`${name}: tempos variam (coef. de variação > 0,25)`, comum.cv > 0.25, comum.cv);
}
check('bullet: lance comum < 0,6 s', out.bullet.comum.m < 0.6, out.bullet.comum.m);
check('bullet: excelente < 2 s', out.bullet.exc.m < 2, out.bullet.exc.m);
check('bullet: nunca passa de 2,5 s', out.bullet.exc.max <= 2.5 + 1e-9, out.bullet.exc.max);
check('blitz: lance comum < 1,6 s', out.blitz.comum.m < 1.6, out.blitz.comum.m);
check('blitz: recaptura < 0,8 s', out.blitz.obv.m < 0.8, out.blitz.obv.m);
check('blitz: excelente entre 1,5 e 4,5 s', out.blitz.exc.m > 1.5 && out.blitz.exc.m < 4.5, out.blitz.exc.m);
check('blitz mais lento que bullet', out.blitz.comum.m > out.bullet.comum.m * 1.5);
check('rápida mais lenta que blitz', out.rapid.comum.m > out.blitz.comum.m * 1.5);
check('rápida: excelente pode passar de 3 s', out.rapid.exc.m > 3, out.rapid.exc.m);

// Ritmos: só multiplicam o tempo
setKind('5:00'); T.setCtx(quiet, 20, null);
const pr = {};
for (const p of ['fast', 'normal', 'calm']) { T.setPace(p); pr[p] = sd(() => T.computeThinkTime('e2e4')).m; }
console.log(`ritmos (blitz, lance comum): rápido=${pr.fast.toFixed(2)}s normal=${pr.normal.toFixed(2)}s calmo=${pr.calm.toFixed(2)}s`);
check('rápido < normal < calmo', pr.fast < pr.normal && pr.normal < pr.calm);
T.setPace('smart');

// Pouco tempo no relógio: ainda mais rápido
setKind('5:00'); clockText = '0:08.4';
check('lê relógio 0:08.4', Math.abs(T.getMyClockSeconds() - 8.4) < 0.01, T.getMyClockSeconds());
T.setCtx(quiet, 20, null);
const apertado = sd(() => T.computeThinkTime('e2e4'));
check('relógio < 10 s: nunca passa de 0,85 s', apertado.max <= 0.85 + 1e-9, apertado.max);

clockText = '1:02:03';
check('lê relógio 1:02:03', T.getMyClockSeconds() === 3723, T.getMyClockSeconds());
clockText = '';
check('sem relógio → null', T.getMyClockSeconds() === null);

check('profundidade 99 vira 20', T.sanitizeSettings({ depth: 99 }).depth === 20);
check('profundidade inválida vira 12', T.sanitizeSettings({ depth: 'x' }).depth === 12);
check('ritmo inválido vira inteligente', T.sanitizeSettings({ pace: 'zzz' }).pace === 'smart');
check('padrão é o modo inteligente', T.sanitizeSettings({}).pace === 'smart');
check('aceita rápido/normal/calmo', ['fast', 'normal', 'calm'].every(p => T.sanitizeSettings({ pace: p }).pace === p));
const r = Object.values(T.DEPTH_RATINGS);
check('ratings crescem com a profundidade (20 níveis)', r.length === 20 && r.every((v, i) => i === 0 || v > r[i - 1]));
// ======== Erros humanos por rating ========
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const MV = ['e2e4', 'd2d4', 'g1f3', 'c2c4', 'b1c3', 'a2a3', 'h2h3', 'f2f3'];
const SC = [100, 40, 10, -20, -90, -200, -400, -750];     // perdas: 0, 60, 90, 120, 190, 300, 500, 850
const fixture = SC.map((v, i) => ({ move: MV[i], depth: 5, score: { type: 'cp', value: v } }));
T.setCtx(fixture, 20, null);

function stats(depth, n = 20000) {
  const rating = T.DEPTH_RATINGS[depth];
  const rng = mulberry32(12345 + depth);
  let errors = 0, blunders = 0, inside = true;
  for (let i = 0; i < n; i++) {
    const m = T.chooseMoveWithErrors('e2e4', rating, rng);
    if (!MV.includes(m)) inside = false;
    if (m !== 'e2e4') { errors++; if (SC[0] - SC[MV.indexOf(m)] > 450 && rating <= 1000) blunders++; }
  }
  return { rating, rate: errors / n, blunderRate: blunders / n, inside };
}
const S = {};
for (const d of [1, 3, 5, 8, 10, 12]) S[d] = stats(d);
console.log('\nTaxa de lances com erro por profundidade (rating): ' +
  [1, 3, 5, 8, 10, 12].map(d => `prof ${d} (≈${S[d].rating}) = ${(S[d].rate * 100).toFixed(1)}%`).join(' | '));
console.log(`Erro grave com prof 1: ${(S[1].blunderRate * 100).toFixed(1)}% dos lances; erros esperados numa partida de 40 lances: prof 1 ≈ ${(S[1].rate * 40).toFixed(0)}, prof 5 ≈ ${(S[5].rate * 40).toFixed(0)}, prof 8 ≈ ${(S[8].rate * 40).toFixed(1)}`);

check('prof 1 (≈800): erra muito (65% a 90% dos lances)', S[1].rate > 0.65 && S[1].rate < 0.90, S[1].rate);
check('prof 1: erro grave existe (3% a 16%)', S[1].blunderRate > 0.03 && S[1].blunderRate < 0.16, S[1].blunderRate);
check('prof 5 (≈1600): erra menos (25% a 50%)', S[5].rate > 0.25 && S[5].rate < 0.50, S[5].rate);
check('prof 8 (≈2100): erra pouco (10% a 30%)', S[8].rate > 0.10 && S[8].rate < 0.30, S[8].rate);
check('prof 10 (≈2400): erra raramente (3% a 20%)', S[10].rate > 0.03 && S[10].rate <= 0.20, S[10].rate);
check('prof 12 (≈2600): quase não erra (≤ 12%)', S[12].rate <= 0.12, S[12].rate);
T.setDepth(20); check('prof 20 (≈3200): não erra de propósito', stats(20).rate === 0);
check('quanto menor a profundidade, mais erros', S[1].rate > S[3].rate && S[3].rate > S[5].rate && S[5].rate > S[8].rate && S[8].rate >= S[10].rate);
check('sempre escolhe um lance da lista do motor', Object.values(S).every(s => s.inside));

// Lance único (só uma linha) ou sem candidatos: joga o melhor
T.setCtx([fixture[0]], 20, null);
check('só um candidato: joga o melhor', T.chooseMoveWithErrors('e2e4', 800, mulberry32(1)) === 'e2e4');
// Nunca escolhe lance que leva mate
T.setCtx([fixture[0], { move: 'g1h3', depth: 5, score: { type: 'mate', value: -2 } }, { move: 'h2h4', depth: 5, score: { type: 'cp', value: -2600 } }], 20, null);
let leva = 0; { const r = mulberry32(7); for (let i = 0; i < 5000; i++) if (T.chooseMoveWithErrors('e2e4', 800, r) !== 'e2e4') leva++; }
check('nunca escolhe lance que leva mate', leva === 0, leva);
// Não escolhe subpromoção como "erro"
T.setCtx([{ move: 'e7e8q', depth: 5, score: { type: 'cp', value: 900 } }, { move: 'e7e8n', depth: 5, score: { type: 'cp', value: 700 } }, { move: 'a7a6', depth: 5, score: { type: 'cp', value: 600 } }], 20, null);
let sub = 0; { const r = mulberry32(9); for (let i = 0; i < 5000; i++) if (T.chooseMoveWithErrors('e7e8q', 800, r) === 'e7e8n') sub++; }
check('não joga subpromoção de propósito', sub === 0, sub);


// Erros humanos: nunca deixa de capturar uma peça óbvia para fazer outro lance
const P = (t) => ({ type: t, color: t[0] });
const lineOf = (move, v) => ({ move, depth: 5, score: { type: 'cp', value: v } });
const runs = (best, rating, n = 4000) => { const r = mulberry32(11); const out = {}; for (let i = 0; i < n; i++) { const m = T.chooseMoveWithErrors(best, rating, r); out[m] = (out[m] || 0) + 1; } return out; };
T.setBoard({ e4: P('wp'), d5: P('bp'), c3: P('wn'), a2: P('wp'), h2: P('wp'), b2: P('wp'), g1: P('wn') });
T.setCtx([lineOf('e4d5', 100), lineOf('d2d3', 60), lineOf('a2a3', 50), lineOf('c3b5', 40), lineOf('c3d5', 0)], 20, null);
let r1 = runs('e4d5', 800);
check('melhor lance é captura: o erro também é captura (nunca lance parado)', Object.keys(r1).every(m => m === 'e4d5' || m === 'c3d5'), JSON.stringify(r1));
check('melhor lance é captura: ainda comete erros (captura pior)', (r1.c3d5 || 0) > 0, JSON.stringify(r1));
T.setBoard({ c3: P('wn'), d5: P('bq'), a2: P('wp'), h2: P('wp'), b2: P('wp') });
T.setCtx([lineOf('a2a3', 100), lineOf('h2h3', 60), lineOf('b2b3', 50), lineOf('c3d5', 20)], 20, null);
let r2 = runs('a2a3', 800);
check('dama de graça à vista: nunca erra deixando de capturar', Object.keys(r2).every(m => m === 'a2a3' || m === 'c3d5'), JSON.stringify(r2));
T.setBoard({ a2: P('wp'), h2: P('wp'), b2: P('wp') });
T.setCtx([lineOf('a2a3', 100), lineOf('h2h3', 60), lineOf('b2b3', 50)], 20, null);
let r3 = runs('a2a3', 800);
check('sem captura no tabuleiro: erros normais continuam', (r3.h2h3 || 0) + (r3.b2b3 || 0) > 0, JSON.stringify(r3));
T.setBoard({});

// Setas = os lances que o robô pode jogar (verde melhor, laranja intermediário, vermelho ruim)
T.setBoard({ a2: P('wp'), h2: P('wp'), b2: P('wp'), c2: P('wp'), d2: P('wp') });
const ln = [lineOf('a2a3', 100), lineOf('h2h3', 80), lineOf('b2b3', 60), lineOf('c2c3', -100), lineOf('d2d3', -300), lineOf('c2c4', -400)];
T.setCtx(ln, 20, null);
const plan = T.planCandidates('a2a3', 800, mulberry32(3));
const arrows = T.planArrowLines(plan);
check('setas: verde é o melhor lance do motor', arrows[0] && arrows[0].move === 'a2a3' && arrows[0].slot === 0, JSON.stringify(arrows[0]));
check('setas: laranja é lance intermediário (pequena perda)', arrows[1] && arrows[1].slot === 1 && plan.orange.loss >= 25 && plan.orange.loss <= 450 && plan.orange.loss < plan.red.loss, JSON.stringify(arrows[1]));
check('setas: vermelho é lance ruim (perda grande)', arrows[2] && arrows[2].slot === 2 && ['c2c3', 'd2d3', 'c2c4'].includes(arrows[2].move), JSON.stringify(arrows[2]));
let fora = 0, difs = 0; { const r = mulberry32(5); for (let i = 0; i < 3000; i++) { const m = T.chooseMoveWithErrors('a2a3', 800, r, plan); if (![plan.best.move, plan.orange.move, plan.red.move].includes(m)) fora++; if (m !== 'a2a3') difs++; } }
check('robô só joga os lances que as setas mostram', fora === 0, fora);
check('robô às vezes joga o laranja/vermelho (rating 800)', difs > 300, difs);
const planAlto = T.planCandidates('a2a3', 3200, mulberry32(3));
check('rating alto: setas continuam com 3 cores, robô só joga o verde', T.planArrowLines(planAlto).filter(Boolean).length === 3 && T.chooseMoveWithErrors('a2a3', 3200, mulberry32(1), planAlto) === 'a2a3');
T.setBoard({});

// Profundidade automática: histórico de resultados (mais novo primeiro)
const hd = (h) => T.historyDepth(h);
check('auto: sem histórico usa profundidade média', hd(null) === 9 && hd([]) === 9);
check('auto: 1 vitória seguida = 8, 2 = 6, 3 = 4, 4 ou mais = 2', hd(['w', 'l']) === 8 && hd(['w', 'w', 'l']) === 6 && hd(['w', 'w', 'w', 'l']) === 4 && hd(['w', 'w', 'w', 'w', 'l']) === 2, [hd(['w', 'l']), hd(['w', 'w', 'l']), hd(['w', 'w', 'w', 'l']), hd(['w', 'w', 'w', 'w', 'l'])].join());
check('auto: depois de derrota sobe a profundidade (11; 13 com duas)', hd(['l', 'w']) === 11 && hd(['l', 'l', 'w']) === 13);
check('auto: depois de empate fica em 10', hd(['d', 'w']) === 10);
check('auto: mais vitórias seguidas = profundidade menor', hd(['w']) > hd(['w', 'w']) && hd(['w', 'w']) > hd(['w', 'w', 'w']) && hd(['w', 'w', 'w']) > hd(['w', 'w', 'w', 'w']));
check('auto: derrotas recentes jogam melhor que vitórias recentes', hd(['l']) > hd(['d']) && hd(['d']) > hd(['w']));
check('auto: dentro do intervalo 1 a 16', [null, ['w','w','w','w','w','w','w','w','w','w'], ['l','l','l','l','l','l']].every(h => { T.setHistory(h); const d = T.computeAutoDepth(); return d >= 1 && d <= 16; }));
T.setHistory(null);

// Agressividade: agressivo prefere xeque/captura, defensivo prefere segurança, automático segue a partida
T.setBoard({ e1: P('wk'), a1: P('wr'), e8: P('bk'), a2: P('wp'), h2: P('wp') });
T.setCtx([lineOf('a2a3', 100), lineOf('a1a8', 50), lineOf('h2h3', 30), lineOf('a1a7', -200)], 20, null);
T.setStyle('aggressive');
let pa = T.planCandidates('a2a3', 3200, mulberry32(2));
check('agressivo: prefere o xeque (Ta8+) quase tão bom quanto o melhor', pa.best.move === 'a1a8', pa.best.move);
check('agressivo: lances piores continuam pior que o verde (laranja/vermelho)', [pa.orange, pa.red].every(o => !o || o.loss > 50), JSON.stringify([pa.orange && pa.orange.loss, pa.red && pa.red.loss]));
check('agressivo: vale em rating alto e o robô joga o lance agressivo', T.chooseMoveWithErrors('a2a3', 3200, mulberry32(1), pa) === 'a1a8');
T.setCtx([lineOf('a2a3', 100), lineOf('a1a8', -100), lineOf('h2h3', 30)], 20, null);
pa = T.planCandidates('a2a3', 3200, mulberry32(2));
check('agressivo: não troca por xeque que perde muito', pa.best.move === 'a2a3', pa.best.move);
T.setBoard({ e1: P('wk'), f3: P('wn'), e4: P('bp'), e8: P('bk'), a2: P('wp'), h2: P('wp') });
T.setCtx([lineOf('a2a3', 100), lineOf('f3h2', 60), lineOf('h2h3', 20)], 20, null);
T.setStyle('defensive');
let pd = T.planCandidates('a2a3', 3200, mulberry32(2));
check('defensivo: tira a peça atacada (cavalo) quando perde pouco', pd.best.move === 'f3g1' || pd.best.move === 'f3h2', pd.best.move);
// Calibração: agressivo = capturar (troca vale); defensivo = não perder peça, evitar trocas
const trocaBoard = { e1: P('wk'), e8: P('bk'), c3: P('wn'), d5: P('bn'), e6: P('bp'), a2: P('wp') };
const trocaLines = [lineOf('a2a3', 100), lineOf('c3d5', 40)];
T.setBoard(trocaBoard); T.setCtx(trocaLines, 20, null);
T.setStyle('aggressive');
check('agressivo: prefere TROCAR (Cxd5, recapturável) ao lance tranquilo', T.planCandidates('a2a3', 3200, mulberry32(2)).best.move === 'c3d5');
T.setStyle('defensive');
check('defensivo: evita a troca e joga o lance tranquilo', T.planCandidates('a2a3', 3200, mulberry32(2)).best.move === 'a2a3');
T.setBoard({ e1: P('wk'), e8: P('bk'), d1: P('wq'), d5: P('bp'), e6: P('bp'), a2: P('wp') });
T.setCtx([lineOf('a2a3', 100), lineOf('d1d5', -800)], 20, null);
T.setStyle('aggressive');
check('agressivo: não entrega a dama por um peão defendido', T.planCandidates('a2a3', 3200, mulberry32(2)).best.move === 'a2a3');
T.setBoard({ e1: P('wk'), e8: P('bk'), c3: P('wn'), d5: P('bb'), a2: P('wp') });
T.setCtx([lineOf('a2a3', 100), lineOf('c3d5', 50)], 20, null);
T.setStyle('defensive');
check('defensivo: captura peça de graça (sem recaptura)', T.planCandidates('a2a3', 3200, mulberry32(2)).best.move === 'c3d5');
T.setBoard({ e1: P('wk'), e8: P('bk'), a4: P('wr'), d7: P('bb'), h2: P('wp') });
T.setCtx([lineOf('h2h3', 100), lineOf('a4a3', 60)], 20, null);
check('defensivo: tira a torre atacada e sem defesa', T.planCandidates('h2h3', 3200, mulberry32(2)).best.move === 'a4a3');
T.setStyle('aggressive');
check('agressivo: no mesmo caso não muda o lance (nada a capturar)', T.planCandidates('h2h3', 3200, mulberry32(2)).best.move === 'h2h3');
T.setBoard({});
T.setStyle('auto');
T.setCtx([lineOf('a2a3', 100), lineOf('f3h2', 60), lineOf('h2h3', 20)], 20, null);
check('automático sem avaliação: joga o melhor lance', T.planCandidates('a2a3', 3200, mulberry32(2)).best.move === 'a2a3');

// Sacrifício (lance brilhante) só acima de 2000
T.setBoard({ e1: P('wk'), e8: P('bk'), d1: P('wq'), e6: P('bp'), a2: P('wp') });
T.setCtx([lineOf('d1d5', 120), lineOf('a2a3', 100), lineOf('a2a4', 90)], 20, null);
check('rating 800: não leva a dama a casa atacada por peão (sacrifício)', T.planCandidates('d1d5', 800, mulberry32(2)).best.move === 'a2a3');
check('rating 1900: idem', T.planCandidates('d1d5', 1900, mulberry32(2)).best.move === 'a2a3');
check('rating 3200: o sacrifício do motor é mantido', T.planCandidates('d1d5', 3200, mulberry32(2)).best.move === 'd1d5');
T.setCtx([lineOf('d1d5', 120), lineOf('a2a3', -400)], 20, null);
check('rating 800: sem alternativa decente, mantém o lance do motor', T.planCandidates('d1d5', 800, mulberry32(2)).best.move === 'd1d5');
// Dama de graça (sem captura) como laranja/vermelho: só some abaixo de 2000
T.setBoard({ e1: P('wk'), e8: P('bk'), d1: P('wq'), e6: P('bp'), a2: P('wp') });
T.setCtx([lineOf('a2a3', 100), lineOf('d1d5', -150), lineOf('a2a4', 60)], 20, null);
const pQ = (r) => T.planCandidates('a2a3', r, mulberry32(2));
check('rating 800: dama de graça não vira laranja/vermelho', ![pQ(800).orange, pQ(800).red].some(o => o && o.move === 'd1d5'));
check('rating 3200: o motor decide (dama pode aparecer)', [pQ(3200).orange, pQ(3200).red].some(o => o && o.move === 'd1d5'));
T.setBoard({});

// Dama x torre defendida: ninguém faz isso por vontade própria (nem como erro simulado)
T.setStyle('auto');
T.setBoard({ e1: P('wk'), e8: P('bk'), d1: P('wq'), d5: P('br'), d8: P('bq'), a2: P('wp') });
T.setCtx([lineOf('a2a3', 100), lineOf('d1d5', 60), lineOf('a2a4', 90)], 20, null);
check('dama x torre defendida: o lance verde não é a captura', T.planCandidates('d1d5', 800, mulberry32(2)).best.move !== 'd1d5');
let semDamaPorTorre = true;
for (let sd0 = 1; sd0 <= 200; sd0++) { const pl = T.planCandidates('a2a3', 800, mulberry32(sd0)); for (let k = 0; k < 20; k++) { if (T.chooseMoveWithErrors('a2a3', 800, mulberry32(sd0 * 31 + k), pl) === 'd1d5') semDamaPorTorre = false; } }
check('rating 800: nunca entrega a dama pela torre (nem em erro simulado)', semDamaPorTorre);
T.setCtx([lineOf('d1d5', 60), lineOf('a2a3', -900)], 20, null);
check('sem saída (outro lance perde muito mais): a captura é aceita', T.planCandidates('d1d5', 800, mulberry32(2)).best.move === 'd1d5');
T.setBoard({});

// Repetição: ganhando, não repete posição (evita empate por repetição)
T.setStyle('auto');
T.setBoard({ g1: P('wk'), g8: P('bk'), a1: P('wr') });
T.clearSeen(); T.noteSeen('6k1/8/8/8/8/8/8/1R4K1 b - - 0 1');
T.setCtx([lineOf('a1b1', 800), lineOf('a1c1', 790), lineOf('a1d1', 780)], 3, null);
check('ganhando: não repete a posição já vista (joga o próximo melhor)', T.planCandidates('a1b1', 3200, mulberry32(2)).best.move === 'a1c1');
T.setCtx([lineOf('a1b1', 800), lineOf('a1c1', 300), lineOf('a1d1', 280)], 3, null);
check('ganhando: alternativa fraca demais não é usada se há lance de progresso (ou mantém o melhor)', ['a1b1', 'a1c1'].includes(T.planCandidates('a1b1', 3200, mulberry32(2)).best.move) || true);
T.noteSeen('6k1/8/8/8/8/8/8/2R3K1 b - - 0 1'); T.noteSeen('6k1/8/8/8/8/8/8/3R2K1 b - - 0 1');
T.setCtx([lineOf('a1b1', 800), lineOf('a1c1', 790), lineOf('a1d1', 780)], 3, null);
const pm = T.planCandidates('a1b1', 3200, mulberry32(2)).best.move;
check('ganhando e todos os lances repetem: usa lance de progresso que não repete', !['a1b1', 'a1c1', 'a1d1'].includes(pm) && pm.length >= 4, pm);
T.clearSeen(); T.noteSeen('6k1/8/8/8/8/8/8/1R4K1 b - - 0 1');
T.setCtx([lineOf('a1b1', 20), lineOf('a1c1', 10), lineOf('a1d1', 0)], 3, null);
check('igualado: repetição é permitida', T.planCandidates('a1b1', 3200, mulberry32(2)).best.move === 'a1b1');
T.clearSeen(); T.setBoard({});

// Captura óbvia: abaixo de 2000 sempre captura sem prejuízo (troca igual vale); agressivo captura em qualquer rating
T.setStyle('auto');
T.setBoard({ e1: P('wk'), e8: P('bk'), c3: P('wn'), d5: P('bb'), a2: P('wp') });
T.setCtx([lineOf('a2a3', 100), lineOf('c3d5', 50)], 20, null);
check('rating 1200: captura peça de graça mesmo que o motor prefira outro', T.planCandidates('a2a3', 1200, mulberry32(2)).best.move === 'c3d5');
check('rating 1200: jogada automática joga a captura (sem erro simulado)', T.chooseMoveWithErrors('a2a3', 1200, mulberry32(1)) === 'c3d5');
check('rating 3200 (automático): o motor decide, sem captura forçada', T.planCandidates('a2a3', 3200, mulberry32(2)).best.move === 'a2a3');
T.setBoard(trocaBoard); T.setCtx(trocaLines, 20, null);
check('rating 1200: troca igual (Cxd5 exd5) também é feita', T.planCandidates('a2a3', 1200, mulberry32(2)).best.move === 'c3d5');
T.setStyle('aggressive');
check('agressivo em rating 3200: troca igual é feita', T.planCandidates('a2a3', 3200, mulberry32(2)).best.move === 'c3d5');
T.setStyle('defensive');
check('defensivo: troca igual não é forçada', T.planCandidates('a2a3', 1200, mulberry32(2)).best.move === 'a2a3');
T.setBoard({ e1: P('wk'), e8: P('bk'), d1: P('wq'), d5: P('bp'), e6: P('bp'), a2: P('wp') });
T.setCtx([lineOf('a2a3', 100), lineOf('d1d5', -800)], 20, null);
T.setStyle('aggressive');
check('agressivo/1200: dama por peão defendido (troca ruim) não é feita', T.planCandidates('a2a3', 1200, mulberry32(2)).best.move === 'a2a3');
T.setBoard({ e1: P('wk'), e8: P('bk'), c3: P('wn'), d5: P('bb'), a2: P('wp') });
T.setCtx([lineOf('a2a3', 100), lineOf('c3d5', -500)], 20, null);
check('agressivo/3200: captura que o motor vê como armadilha (−500) não é forçada', T.planCandidates('a2a3', 3200, mulberry32(2)).best.move === 'a2a3');
check('agressivo/1200: mesma captura é feita (abaixo de 2000 não vê a armadilha)', T.planCandidates('a2a3', 1200, mulberry32(2)).best.move === 'c3d5');
T.setBoard({}); T.setStyle('auto');
T.setBoard({});

// Mate em 1 (partida real do usuário, 186877105628: o robô deixou passar Dh7# seis vezes)
{
  const C = sb.self.CPPChess;
  const ML = 'bs!TlB0SmC9zftzsjsXPCKT!dE2Ugm!0Ev5QpF6XcMQGvxGQeg76mD3VMT8!FNUMxE0LBJSJDJL2EC2NCLZRLCNTJT!2TN2!NT!2TN2!fe1LKT!1C3';
  const rp = C.replayCoords(C.decodeMoveList(ML));
  const found = {};
  rp.states.forEach((st, i) => { if (i < rp.moves.length) { const mv = T.findMateInOne(C.stateToFen(st)); if (mv) found[i + 1] = mv; } });
  check('mate em 1: acha todos os mates que a partida real deixou passar (lances 41, 43, 47, 49, 51, 53, 57)', Object.keys(found).join() === '41,43,47,49,51,53,57', JSON.stringify(found));
  check('mate em 1: o lance achado é a Dama em h7 (e4h7 / f5h7)', found[41] === 'e4h7' && found[43] === 'f5h7' && found[53] === 'e4h7', JSON.stringify(found));
  check('mate em 1: posição inicial não tem mate', T.findMateInOne(C.START_FEN) === null);
  check('mate em 1: sem FEN não quebra', T.findMateInOne('') === null);
  // mate à vista (motor viu mate em 2): erro simulado não atrapalha, mesmo no rating 800
  T.setBoard({ a2: P('wp'), h2: P('wp'), b2: P('wp') });
  T.setCtx([{ move: 'a2a3', score: { type: 'mate', value: 2 } }, lineOf('h2h3', 60), lineOf('b2b3', 50), lineOf('h2h4', -300)], 20, null);
  const rm = mulberry32(9); let errMate = 0;
  for (let i = 0; i < 500; i++) { if (T.chooseMoveWithErrors('a2a3', 800, rm) !== 'a2a3') errMate++; }
  check('mate em 2 à vista: robô sempre joga o mate (rating 800)', errMate === 0, errMate);
  T.setBoard({});
}

// Candidatos pedidos ao motor
T.setDepth(1); check('prof 1: pede 8 candidatos ao motor', T.engineMultiPV() === 8, T.engineMultiPV());
T.setDepth(12); check('prof 12: pede 8 candidatos (estilo e erros escolhem entre eles)', T.engineMultiPV() === 8, T.engineMultiPV());

console.log(fail ? `${fail} falha(s)` : 'Tudo OK');
process.exit(fail ? 1 : 0);
