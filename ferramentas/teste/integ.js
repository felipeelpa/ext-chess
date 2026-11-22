const fs = require('fs');
const { JSDOM } = require('jsdom');

const SRC = process.argv[2];
const code = fs.readFileSync(SRC + '\\content.js', 'utf8');

const errors = [];
const results = [];
let fail = 0;
const check = (name, ok, extra) => {
  if (!ok) fail++;
  results.push((ok ? 'OK   ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + extra));
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const MAP = { P: 'wp', N: 'wn', B: 'wb', R: 'wr', Q: 'wq', K: 'wk', p: 'bp', n: 'bn', b: 'bb', r: 'br', q: 'bq', k: 'bk' };
function piecesHtml(fen) {
  let h = '';
  fen.split('/').forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      h += `<div class="piece ${MAP[ch]} square-${f + 1}${8 - i}"></div>`;
      f++;
    }
  });
  return h;
}

const dom = new JSDOM(`<body><div class="board" id="b">${piecesHtml('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')}</div>
<div class="clock-component clock-bottom"><span class="clock-time-monospace">5:00</span></div>
<div class="board-layout-bottom"><div class="user-username-component">felipe</div></div>
<button id="resign" aria-label="Abandonar partida">Abandonar</button></body>`,
  { url: 'https://www.chess.com/game/live/123', runScripts: 'outside-only', pretendToBeVisual: true });
const win = dom.window;
const doc = win.document;

win.addEventListener('error', e => errors.push('window.error: ' + e.message));
const origConsoleError = console.error;
win.console.error = (...a) => errors.push('console.error: ' + a.join(' '));

// ---- stubs do ambiente da extensão ----
let saved = null;
let listener = null;
let storageListener = null;
let savedLang = null;
win.chrome = {
  runtime: { id: 'teste', getURL: x => x, lastError: null, onMessage: { addListener: fn => { listener = fn; } } },
  storage: { local: {
    get: (k, cb) => cb({ cppSettings: { depth: 5, autoMove: true, pace: 'fast' } }),
    set: (o) => { if (o.cppSettings) saved = o.cppSettings; if (o.cppLang) savedLang = o.cppLang; },
  }, onChanged: { addListener: fn => { storageListener = fn; } } },
};
let engineScore = { type: 'cp', value: 80 };   // placar que o motor simulado devolve (vez de quem joga)
let engineMute = false;
const workers = [];
let reviewEngines = 0;
const blobTexts = new Map();
let blobN = 0;
win.Blob = class { constructor(parts) { this.text = parts.join(''); } };
win.URL.createObjectURL = (b) => { const u = 'blob:fake' + (++blobN); blobTexts.set(u, b.text); return u; };

// Simula uma aba em SEGUNDO PLANO: os temporizadores nativos da página ficam 1000x mais lentos
// (o navegador faz algo parecido). Só os temporizadores de Web Worker continuam no ritmo normal.
const realST = win.setTimeout.bind(win), realSI = win.setInterval.bind(win);
win.setTimeout = (fn, ms, ...a) => realST(fn, (ms || 0) * 1000, ...a);
win.setInterval = (fn, ms, ...a) => realSI(fn, (ms || 0) * 1000, ...a);

win.Worker = class {
  constructor(url) {
    this.isTimer = (blobTexts.get(url) || '').includes('/*cpp-timer*/');
    if (this.isTimer) { this.t = new Map(); return; }
    this.posted = []; workers.push(this);
  }
  terminate() {}
  postMessage(m) {
    if (this.isTimer) {   // emula o worker de temporizador (roda no ritmo normal)
      const { cmd, id, ms } = m;
      if (cmd === 'timeout') this.t.set(id, setTimeout(() => { this.t.delete(id); this.onmessage && this.onmessage({ data: id }); }, ms));
      else if (cmd === 'interval') this.t.set(id, setInterval(() => this.onmessage && this.onmessage({ data: id }), ms));
      else if (cmd === 'clear') { clearTimeout(this.t.get(id)); clearInterval(this.t.get(id)); this.t.delete(id); }
      return;
    }
    this.posted.push(m);
    if (m === 'setoption name Threads value 2') {   // motor separado da revisão de partida
      reviewEngines++;
      const idx = workers.indexOf(this);
      if (idx >= 0) workers.splice(idx, 1);
    }
    const say = (s) => setTimeout(() => this.onmessage && this.onmessage({ data: s }), 5);
    if (m === 'uci') say('uciok');
    if (m === 'isready') say('readyok');
    if (typeof m === 'string' && m.startsWith('go depth') && !engineMute) {
      const d = m.split(' ')[2];
      this.lastGo = m;
      say(`info depth ${d} multipv 1 score ${engineScore.type} ${engineScore.value} nodes 1 pv e2e4 e7e5`);
      say(`info depth ${d} multipv 2 score cp ${engineScore.type === 'cp' && engineScore.value !== 80 ? engineScore.value - 60 : 20} nodes 1 pv d2d4 d7d5`);
      say(`info depth ${d} multipv 3 score cp ${engineScore.type === 'cp' && engineScore.value !== 80 ? engineScore.value - 90 : 10} nodes 1 pv g1f3 g8f6`);
      setTimeout(() => this.stopped || (this.onmessage && this.onmessage({ data: 'bestmove e2e4' })), 40);
    }
    if (m === 'stop') { this.stopped = false; }
  }
};
let apiResults = ['win', 'win', 'win', 'win', 'checkmated'];   // resultados do histórico (mais novo primeiro)
let apiCalls = 0;
let marathonApiFinished;   // undefined = site sem resposta; true/false = isFinished devolvido
let siteGameOk = false;  // o endereço interno do site devolve a partida?
win.fetch = async (u) => {
  if (marathonApiFinished !== undefined && /\/callback\/live\/game\/2\d\d/.test(String(u))) {
    return { ok: true, json: async () => ({ game: { isFinished: marathonApiFinished } }) };
  }
  if (String(u).includes('/callback/')) {
    if (!siteGameOk || !String(u).includes('/callback/live/game/123')) return { ok: false, json: async () => ({}) };
    const Ch = win.CPPChess;
    const moves = Ch.replay(Ch.parsePgn('1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8#').sans).moves;
    return { ok: true, json: async () => ({ game: { moveList: Ch.encodeMoveList(moves), isFinished: true, type: 'chess', pgnHeaders: { White: 'Felipe', Black: 'outro' } }, players: {} }) };
  }
  if (String(u).includes('api.chess.com')) {
    apiCalls++;
    if (String(u).endsWith('/archives')) return { json: async () => ({ archives: ['https://api.chess.com/pub/player/felipe/games/2026/10', 'https://api.chess.com/pub/player/felipe/games/2026/11'] }) };
    const month = String(u).endsWith('/11');
    const list = month ? apiResults : ['checkmated', 'checkmated'];
    const MORPHY = '[White "Felipe"]\n[Black "outro"]\n\n1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0';
    const extra = month ? [{ url: 'https://www.chess.com/game/live/123', end_time: 1, rules: 'chess', pgn: MORPHY, accuracies: { white: 92.7, black: 70.1 }, white: { username: 'Felipe', result: 'win' }, black: { username: 'outro', result: 'checkmated' } }] : [];
    return { json: async () => ({ games: extra.concat(list.map((r, i) => ({ end_time: (month ? 2000 : 1000) - i, rules: 'chess',
      white: { username: i % 2 ? 'outro' : 'Felipe', result: i % 2 ? 'lose' : r }, black: { username: i % 2 ? 'Felipe' : 'outro', result: i % 2 ? r : 'lose' } }))) }) };
  }
  return { text: async () => '// fake engine' };
};
doc.elementFromPoint = () => doc.getElementById('b');
if (!win.PointerEvent) win.PointerEvent = win.MouseEvent;

win.eval(fs.readFileSync(SRC + '\\chess-lite.js', 'utf8'));   // regras do xadrez (carregadas antes, como no manifesto)
win.eval(fs.readFileSync(SRC + '\\i18n.js', 'utf8'));   // idiomas (antes do content.js, como no manifesto)
win.eval(code);

(async () => {
  // Painel aparece sozinho (~1,5 s) e carrega as configurações salvas
  await sleep(2600);
  let panel = doc.getElementById('chess-position-panel');
  check('painel criado', !!panel);
  check('painel abre minimizado', panel.classList.contains('cpp-minimized') && panel.querySelector('.cpp-minimize').textContent === '+');
  panel.querySelector('.cpp-minimize').click();   // os testes seguintes usam o painel expandido
  const sel = doc.getElementById('cpp-depth-select');
  check('select tem automática + 20 profundidades', sel && sel.options.length === 21, sel && sel.options.length);
  check('opção mostra rating', sel && /Prof\. 8\s+≈ 2100/.test(sel.options[8].textContent), sel && sel.options[8].textContent);
  check('configuração salva carregada: profundidade 5', sel && sel.value === '5', sel && sel.value);
  const paceSel = doc.getElementById('cpp-pace-select');
  check('ritmo tem 4 opções: Inteligente, Rápido, Normal, Calmo',
    Array.from(paceSel.options).map(o => o.textContent).join(',') === 'Inteligente,Rápido,Normal,Calmo',
    Array.from(paceSel.options).map(o => o.textContent).join(','));
  check('ritmo carregado: fast', paceSel.value === 'fast');
  check('painel tem linha de status', !!doc.querySelector('.cpp-engine-status'));
  const englishWords = /\b(Best move|Analyzing|Thinking|Ready|Guide|Minimize|Close|Auto-move|Loading|Starting|Green|Orange|Depth|Playing|Done)\b/;
  const panelText = doc.getElementById('chess-position-panel').textContent + doc.getElementById('chess-position-panel').innerHTML;
  check('nenhum texto em inglês no painel', !englishWords.test(panelText), (panelText.match(englishWords) || [])[0]);
  check('textos em português no painel', /Legenda/.test(panelText) && /Jogada automática/.test(panelText) && /Melhor lance|Analisando/.test(panelText));
  check('botões em português', /title="Minimizar"/.test(doc.getElementById('chess-position-panel').innerHTML) && /title="Fechar"/.test(doc.getElementById('chess-position-panel').innerHTML));
  check('auto-move carregado: ligado', doc.getElementById('auto-move-cb').checked === true);
  check('dica de rating exibida', /1600/.test(doc.getElementById('cpp-depth-hint').textContent), doc.getElementById('cpp-depth-hint').textContent);

  const w = workers[0];
  check('motor iniciado', !!w);
  check('usa profundidade 5 no go', w.posted.some(m => m.startsWith('go depth 5 ')), w.posted.filter(m => /go/.test(m)).join('|'));
  check('manda FEN inicial', w.posted.some(m => m === 'position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'));
  check('setas desenhadas', doc.querySelectorAll('.cpp-best-move-arrow').length === 1);
  const status = doc.querySelector('.cpp-engine-status');

  // Barra de avaliação (o motor simulado responde +0,8 para as brancas)
  const fillH = parseFloat(doc.getElementById('cpp-evalbar-fill').style.height);
  check('barra de avaliação criada', !!doc.getElementById('cpp-evalbar'));
  check('barra: brancas ≈ 57% com +0,8', fillH > 56 && fillH < 58.5, fillH);
  check('barra: número 0.8', doc.getElementById('cpp-evalbar-label').textContent === '0.8', doc.getElementById('cpp-evalbar-label').textContent);
  check('resumo: +0.8 e "Você está na frente"', doc.getElementById('cpp-mini-score').textContent === '+0.8' && /Você está na frente/.test(doc.getElementById('cpp-mini-text').textContent),
    doc.getElementById('cpp-mini-score').textContent + ' / ' + doc.getElementById('cpp-mini-text').textContent);
  doc.querySelector('.cpp-minimize').click();
  check('minimizar mantém a barra no painel', doc.getElementById('chess-position-panel').classList.contains('cpp-minimized') && !!doc.getElementById('cpp-evalbar') && !!doc.getElementById('cpp-mini-score'));
  doc.querySelector('.cpp-minimize').click();
  check('texto da legenda da barra', /Barra lateral/.test(doc.getElementById('chess-position-panel').textContent));

  // Auto-move deve jogar depois de um tempo (ritmo rápido, lance de abertura = rápido)
  let ev = { down: 0, move: 0, up: 0, click: 0 };
  const bEl = doc.getElementById('b');
  bEl.addEventListener('mousedown', () => ev.down++);
  bEl.addEventListener('mousemove', () => ev.move++);
  bEl.addEventListener('mouseup', () => ev.up++);
  bEl.addEventListener('click', () => ev.click++);
  await sleep(2500);
  check('auto-move arrastou (aperta, move, solta; sem clique)', ev.down >= 1 && ev.move >= 2 && ev.up >= 1 && ev.click === 0, JSON.stringify(ev));

  // Lance feito no tabuleiro: seta antiga some, nova análise com vez das pretas
  w.posted.length = 0;
  doc.getElementById('b').innerHTML = piecesHtml('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR') +
    '<div class="highlight square-52"></div><div class="highlight square-54"></div>';
  await sleep(650);
  check('seta some ao mudar a posição',
    doc.querySelectorAll('.cpp-best-move-arrow').length === 0 ||
    w.posted.some(m => m.startsWith('position fen')));
  await sleep(900);
  check('reanalisa posição nova (vez das pretas)', w.posted.some(m => m === 'position fen rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'), w.posted.filter(m => /position/.test(m)).join('|'));

  // Trocar profundidade no select: salva e reanalisa
  w.posted.length = 0;
  sel.value = '8';
  sel.dispatchEvent(new win.Event('change'));
  await sleep(600);
  check('profundidade salva = 8', saved && saved.depth === 8, JSON.stringify(saved));
  check('reanalisa com go depth 8', w.posted.some(m => m.startsWith('go depth 8 ')), w.posted.join('|'));
  check('dica atualizada p/ prof. 8', /2100/.test(doc.getElementById('cpp-depth-hint').textContent));

  // Ritmo e auto-move persistem
  const pace = doc.getElementById('cpp-pace-select');
  pace.value = 'calm'; pace.dispatchEvent(new win.Event('change'));
  check('ritmo salvo = calm', saved && saved.pace === 'calm');
  check('dica do calmo exibida', /Mais calmo/.test(doc.getElementById('cpp-pace-hint').textContent), doc.getElementById('cpp-pace-hint').textContent);
  pace.value = 'smart'; pace.dispatchEvent(new win.Event('change'));
  check('ritmo salvo = smart', saved && saved.pace === 'smart');
  check('dica do inteligente exibida', /simples/.test(doc.getElementById('cpp-pace-hint').textContent) && /excelente/.test(doc.getElementById('cpp-pace-hint').textContent), doc.getElementById('cpp-pace-hint').textContent);
  const cb = doc.getElementById('auto-move-cb');
  cb.checked = false; cb.dispatchEvent(new win.Event('change'));
  check('auto-move desligado salvo', saved && saved.autoMove === false);

  // Fechar e reabrir: limpa tudo e a análise automática volta
  listener({ action: 'togglePanel' }, null, () => {});
  check('painel fechado remove painel', !doc.getElementById('chess-position-panel'));
  check('painel fechado remove setas', doc.querySelectorAll('.cpp-best-move-arrow').length === 0);
  w.posted.length = 0;
  listener({ action: 'togglePanel' }, null, () => {});
  await sleep(1200);
  check('reaberto cria painel', !!doc.getElementById('chess-position-panel'));
  check('reaberto analisa de novo', w.posted.some(m => m.startsWith('go depth')), w.posted.join('|'));
  check('reaberto mantém config (prof. 8)', doc.getElementById('cpp-depth-select').value === '8');

  // ======== Mudanças no MEIO da partida (com a aba "em segundo plano") ========
  const statusText = () => doc.querySelector('.cpp-engine-status').textContent;
  const waitOf = (s) => { const m = s.match(/Jogando em ([\d,]+) s/); return m ? parseFloat(m[1].replace(',', '.')) : null; };
  const setPace = (v) => { const s = doc.getElementById('cpp-pace-select'); s.value = v; s.dispatchEvent(new win.Event('change')); };
  const setAuto = (on) => { const c = doc.getElementById('auto-move-cb'); c.checked = on; c.dispatchEvent(new win.Event('change')); };
  const setDepth = (v) => { const s = doc.getElementById('cpp-depth-select'); s.value = String(v); s.dispatchEvent(new win.Event('change')); };
  const w2 = workers[0];

  // Brancas a jogar depois de 1.e4 e5 (vez nossa)
  setAuto(false);
  doc.getElementById('b').innerHTML = piecesHtml('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR') +
    '<div class="highlight square-57"></div><div class="highlight square-55"></div>';
  await sleep(1500);
  check('análise concluída com a jogada automática desligada', /Concluído/.test(statusText()), statusText());

  // Liga a jogada automática no meio da partida: posição já analisada, só agenda (sem reanalisar)
  w2.posted.length = 0;
  setPace('calm');
  setAuto(true);
  await sleep(150);
  const calmWait = waitOf(statusText());
  check('ligar jogada automática no meio da partida agenda o lance', calmWait !== null, statusText());
  check('ligar não reanalisou a posição', !w2.posted.some(m => m.startsWith('go depth')), w2.posted.join('|'));
  // O tempo conta desde o início da análise (já passaram ~1,5 s): sobram ~3,5 s dos ~5 s do modo calmo
  check('ritmo calmo: espera curta (blitz)', calmWait >= 0 && calmWait < 6, calmWait);

  // Troca para rápido com o lance já esperando: vale na hora
  setPace('fast');
  await sleep(150);
  const fastWait = waitOf(statusText());
  check('trocar o ritmo reagenda o lance pendente', fastWait !== null && fastWait < 1.5, statusText());
  check('rápido espera menos que calmo', fastWait <= calmWait, `${fastWait} vs ${calmWait}`);

  // Modo inteligente também reagenda
  setPace('smart');
  await sleep(150);
  check('modo inteligente reagenda o lance pendente', waitOf(statusText()) !== null, statusText());

  // Troca a profundidade com o lance pendente: reanalisa com a nova e agenda de novo
  w2.posted.length = 0;
  setDepth(3);
  await sleep(700);
  check('trocar profundidade no meio do jogo reanalisa com a nova', w2.posted.some(m => m.startsWith('go depth 3 ')), w2.posted.join('|'));
  check('depois da troca de profundidade o lance volta a ser agendado', waitOf(statusText()) !== null || /Concluído|Pensando/.test(statusText()), statusText());

  // O lance agendado é jogado mesmo com a aba "em segundo plano"
  setPace('fast');
  let drags2 = 0;
  doc.getElementById('b').addEventListener('mouseup', () => drags2++);
  await sleep(2500);
  check('jogou sozinho com os temporizadores da página estrangulados', drags2 >= 1, drags2);

  // Trocar a profundidade DURANTE a busca (motor ainda pensando)
  w2.posted.length = 0;
  doc.getElementById('b').innerHTML = piecesHtml('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R') +
    '<div class="highlight square-76"></div><div class="highlight square-63"></div>';
  await sleep(700);   // o intervalo de 500 ms já viu a nova posição e a busca começou
  w2.posted.length = 0;
  setDepth(10);
  await sleep(900);
  check('troca de profundidade durante a busca reinicia com a nova', w2.posted.some(m => m.startsWith('go depth 10 ')), w2.posted.join('|'));

  // ======== Desistência (modo inteligente) ========
  let resignClicks = 0, confirmClicks = 0, boardClicks = 0, inlineConfirm = false;
  doc.getElementById('resign').addEventListener('click', () => {
    resignClicks++;
    doc.querySelectorAll('[role="dialog"], .inline-sim').forEach(d => d.remove());   // a confirmação anterior já fechou
    if (inlineConfirm) {   // confirmação direto na página, sem janela modal
      doc.body.insertAdjacentHTML('beforeend', '<button class="inline-sim">Sim</button>');
      return;
    }
    doc.body.insertAdjacentHTML('beforeend', '<div role="dialog"><button>Não</button><button class="confirm-btn">Sim</button></div>');
    doc.querySelector('.confirm-btn').addEventListener('click', () => confirmClicks++);
  });
  doc.getElementById('b').addEventListener('mouseup', () => boardClicks++);

  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
  const newGame = async () => {   // volta à posição inicial = partida nova (zera o estado de desistência)
    setAuto(false);               // evita um lance agendado da partida anterior invadir o próximo cenário
    doc.getElementById('b').innerHTML = piecesHtml(START);
    await sleep(1600);
  };
  const setBoard = (fen, hl) => {
    doc.getElementById('b').innerHTML = piecesHtml(fen) + hl.map(s => `<div class="highlight square-${s}"></div>`).join('');
  };
  const resetCounters = () => { resignClicks = 0; confirmClicks = 0; boardClicks = 0; };

  const humanCb = doc.getElementById('cpp-human-cb');
  const setHuman = (on) => { humanCb.checked = on; humanCb.dispatchEvent(new win.Event('change')); };
  check('caixa "Modo humano" existe, ao lado de "Jogada automática", e começa desmarcada',
    !!humanCb && humanCb.checked === false && humanCb.closest('.cpp-check-row') === doc.getElementById('auto-move-cb').closest('.cpp-check-row'));
  setPace('fast');
  check('"Modo humano" fica habilitado em qualquer ritmo (rápido)', humanCb.disabled === false);
  setPace('calm');
  check('"Modo humano" fica habilitado em qualquer ritmo (calmo)', humanCb.disabled === false);
  setPace('smart');
  setHuman(true);
  check('"Modo humano" salvo ligado', saved && saved.humanMode === true, JSON.stringify(saved));
  setAuto(true);
  setDepth(8);
  await sleep(300);

  // A) Material igual, mesmo com placar ruim do motor: NÃO desiste, joga
  await newGame();
  resetCounters();
  engineScore = { type: 'cp', value: -1500 };
  setBoard('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR', [57, 55]);   // pretas jogaram e7-e5; vez das brancas (nossa)
  setAuto(true);
  await sleep(7500);
  check('material igual: não desiste', resignClicks === 0, resignClicks);
  check('material igual: joga o lance normalmente', boardClicks >= 1, boardClicks);

  // B) Dama de graça (placar -18 e 6 pontos a menos): desiste na hora (com a pausa humana)
  await newGame();
  resetCounters();
  engineScore = { type: 'cp', value: -1800 };
  setBoard('3qk3/8/8/3q4/8/8/PPPP1PPP/R3K3', [46, 45]);                    // brancas (nós) sem dama, contra duas damas
  setAuto(true);
  await sleep(1500);
  check('mostra "Desistindo em"', /Desistindo em/.test(statusText()), statusText());
  await sleep(7500);
  check('desistiu: clicou em Abandonar', resignClicks === 1, resignClicks);
  check('desistiu: confirmou na janela (Sim)', confirmClicks === 1, confirmClicks);
  check('desistiu: não jogou nenhum lance', boardClicks === 0, boardClicks);
  const afterResign = resignClicks;
  await sleep(1500);
  check('não clica em Abandonar de novo', resignClicks === afterResign, resignClicks);

  // C) Mesma posição perdida com o ritmo RÁPIDO: o Modo humano também desiste (vale em todos os ritmos)
  await newGame();
  resetCounters();
  setPace('fast');
  setBoard('3qk3/8/8/3q4/8/8/PPPP1PPP/R3K3', [46, 45]);
  setAuto(true);
  await sleep(1500);
  check('ritmo rápido + Modo humano: mostra "Desistindo em"', /Desistindo em/.test(statusText()), statusText());
  await sleep(7500);
  check('ritmo rápido + Modo humano: desistiu', resignClicks === 1 && confirmClicks === 1 && boardClicks === 0, `${resignClicks}/${confirmClicks}/${boardClicks}`);

  // C2) Mesma coisa no ritmo calmo
  await newGame();
  resetCounters();
  setPace('calm');
  setBoard('3qk3/8/8/3q4/8/8/PPPP1PPP/R3K3', [46, 45]);
  setAuto(true);
  await sleep(9500);
  check('ritmo calmo + Modo humano: desistiu', resignClicks === 1 && confirmClicks === 1 && boardClicks === 0, `${resignClicks}/${confirmClicks}/${boardClicks}`);

  // C3) PROFUNDIDADE 1 (≈800): o Modo humano também tem que desistir (era o seu caso real)
  await newGame();
  resetCounters();
  setDepth(1);
  setPace('fast');
  engineScore = { type: 'cp', value: -1540 };
  setBoard('2k1r2r/pp1p2pp/2p2p2/P1bb4/7P/2P1R1P1/1PP2K1R/8', [46, 45]);   // posição parecida com a do seu print (sem a dama a mais)
  setAuto(true);
  await sleep(9500);
  check('profundidade 1 + Modo humano: desistiu (clicou em Abandonar e confirmou)', resignClicks === 1 && confirmClicks === 1 && boardClicks === 0, `${resignClicks}/${confirmClicks}/${boardClicks}`);

  // C4) Confirmação "na própria página" (sem janela modal): clica no "Sim" e não no Abandonar de novo
  await newGame();
  resetCounters();
  inlineConfirm = true;
  let inlineClicks = 0;
  setDepth(1);
  setBoard('3qk3/8/8/3q4/8/8/PPPP1PPP/R3K3', [46, 45]);
  engineScore = { type: 'cp', value: -1800 };
  setAuto(true);
  doc.body.addEventListener('click', (e) => { if (e.target.classList && e.target.classList.contains('inline-sim')) inlineClicks++; });
  await sleep(9500);
  check('confirmação sem janela modal: clicou no "Sim"', inlineClicks === 1, inlineClicks);
  check('confirmação sem janela modal: Abandonar clicado só 1 vez', resignClicks === 1, resignClicks);
  inlineConfirm = false;
  setDepth(8);

  // D) Desvantagem grande mas não gravíssima (-7,0; dama + torre contra 7 peões): exige 2 lances seguidos
  await newGame();
  resetCounters();
  setPace('smart');
  engineScore = { type: 'cp', value: -700 };
  setBoard('3qk3/8/8/3r4/8/8/PPPP1PPP/4K3', [46, 45]);                      // 1º lance seu nessa situação
  setAuto(true);
  await sleep(7000);
  check('1º lance perdido: ainda não desiste, joga', resignClicks === 0 && boardClicks >= 1, `${resignClicks}/${boardClicks}`);
  setBoard('3qk3/8/8/4r3/8/8/PPPP1PPP/4K3', [56, 55]);                     // 2º lance seguido nessa situação
  await sleep(1500);
  check('2º lance perdido seguido: agenda desistência', /Desistindo em/.test(statusText()), statusText());
  await sleep(7500);
  check('2º lance perdido seguido: desistiu', resignClicks === 1 && confirmClicks === 1, `${resignClicks}/${confirmClicks}`);

  // E) Modo humano DESLIGADO: nunca desiste, mesmo perdendo feio (só joga)
  await newGame();
  resetCounters();
  setHuman(false);
  check('Modo humano desligado é salvo', saved && saved.humanMode === false, JSON.stringify(saved));
  setPace('smart');
  engineScore = { type: 'cp', value: -1800 };
  setBoard('3qk3/8/8/3q4/8/8/PPPP1PPP/R3K3', [46, 45]);
  setAuto(true);
  await sleep(7500);
  check('Modo humano desligado: não desiste', resignClicks === 0, resignClicks);
  check('Modo humano desligado: joga o lance', boardClicks >= 1, boardClicks);
  engineScore = { type: 'cp', value: 80 };

  // M) Empate: final igual repetido -> oferece, espera 3-4 s e só então joga
  setAuto(false);
  setHuman(false);
  setPace('smart');
  setDepth(8);
  let drawClicks = 0, drawConfirms = 0, acceptClicks = 0;
  const boardTimes = []; let drawT = 0;
  doc.getElementById('b').addEventListener('mouseup', () => boardTimes.push(Date.now()));
  doc.body.insertAdjacentHTML('beforeend', '<button id="drawbtn" aria-label="Empate">½</button>');
  doc.getElementById('drawbtn').addEventListener('click', () => {
    drawClicks++; drawT = Date.now();
    doc.body.insertAdjacentHTML('beforeend', '<div role="dialog"><button>Cancelar</button><button class="draw-ok">Oferecer empate</button></div>');
    doc.querySelector('.draw-ok').addEventListener('click', () => { drawConfirms++; doc.querySelectorAll('[role="dialog"]').forEach(d => d.remove()); });
  });
  const rookFen = (i) => `k7/8/8/${i > 0 ? i : ''}r${7 - i > 0 ? 7 - i : ''}/8/8/PPP5/4K3`;
  const rookStep = (i) => setBoard(rookFen(i), [(i === 0 ? 7 : i) * 10 + 5, (i + 1) * 10 + 5]);

  await newGame();
  engineScore = { type: 'cp', value: 150 };   // vantagem: não é empate
  setAuto(true);
  for (let i = 0; i < 6; i++) { rookStep(i); await sleep(1400); }
  check('M: com vantagem não oferece empate', drawClicks === 0, drawClicks);

  await newGame();
  engineScore = { type: 'cp', value: 10 };
  setAuto(true);
  let stepsM = 0;
  for (let i = 0; i < 7 && drawClicks === 0; i++) { rookStep(i); stepsM++; await sleep(1400); }
  check('M: final igual repetido: ofereceu empate (clicou 1 vez)', drawClicks === 1, drawClicks);
  check('M: ofereceu depois de 3 a 5 lances iguais', stepsM >= 3 && stepsM <= 5, stepsM);
  check('M: mostra "Empate oferecido"', /Empate oferecido/.test(statusText()), statusText());
  const boardsBefore = boardTimes.filter(t => t > drawT).length;
  await sleep(5500);
  const after = boardTimes.filter(t => t > drawT);
  check('M: confirmou a oferta na janela', drawConfirms === 1, drawConfirms);
  check('M: não jogou durante a espera do empate', boardsBefore === 0, boardsBefore);
  check('M: depois da espera joga o lance (3 a 4,5 s)', after.length >= 1 && after[0] - drawT >= 2900 && after[0] - drawT <= 4800, after.length + ' / ' + (after[0] - drawT));
  for (let i = 0; i < 3; i++) { rookStep(i + 1); await sleep(1400); }
  check('M: não oferece de novo logo em seguida', drawClicks === 1, drawClicks);

  // N) Adversário oferece empate: aceita se for final igual; ignora se estou melhor
  const offerHtml = '<div class="draw-offer-component">O adversário ofereceu empate <button class="acc">Aceitar</button><button>Recusar</button></div>';
  doc.body.addEventListener('click', (e) => { if (e.target.classList && e.target.classList.contains('acc')) acceptClicks++; });
  await newGame();
  engineScore = { type: 'cp', value: 150 };
  setBoard(rookFen(2), [25, 35]);
  setAuto(true);
  await sleep(1200);
  doc.body.insertAdjacentHTML('beforeend', offerHtml);
  await sleep(4800);
  check('N: estou melhor: não aceita o empate', acceptClicks === 0, acceptClicks);
  doc.querySelectorAll('.draw-offer-component').forEach(d => d.remove());

  await newGame();
  engineScore = { type: 'cp', value: 10 };
  setBoard(rookFen(2), [25, 35]);
  setAuto(true);
  await sleep(1200);
  doc.body.insertAdjacentHTML('beforeend', offerHtml);
  await sleep(1000);
  check('N: final igual: agenda aceitar', /Aceitando empate/.test(statusText()), statusText());
  await sleep(4000);
  check('N: final igual: aceitou o empate (1 clique)', acceptClicks === 1, acceptClicks);
  doc.querySelectorAll('.draw-offer-component').forEach(d => d.remove());

  await newGame();
  engineScore = { type: 'cp', value: -300 };   // pior: empate é bom
  setBoard(rookFen(3), [35, 45]);
  setAuto(true);
  await sleep(1200);
  doc.body.insertAdjacentHTML('beforeend', offerHtml);
  await sleep(5000);
  check('N: posição pior: aceita o empate', acceptClicks === 2, acceptClicks);
  doc.querySelectorAll('.draw-offer-component').forEach(d => d.remove());
  setAuto(false);
  engineScore = { type: 'cp', value: 80 };

  // S) Modo manual: sugere desistir / oferecer empate no lugar do status da posição
  const evalText = () => doc.querySelector('.cpp-eval-text') ? doc.querySelector('.cpp-eval-text').textContent : '';
  setAuto(false);
  setHuman(false);
  await newGame();
  resetCounters();
  engineScore = { type: 'cp', value: -1800 };
  setBoard('3qk3/8/8/3q4/8/8/PPPP1PPP/R3K3', [46, 45]);
  await sleep(1800);
  check('S: manual + posição perdida: mostra "Sugestão: desistir"', /Sugestão: desistir/.test(evalText()), evalText());
  check('S: manual não desiste sozinho', resignClicks === 0 && boardClicks === 0, resignClicks + '/' + boardClicks);
  check('S: resumo recolhido também sugere', /Sugestão: desistir/.test(doc.getElementById('cpp-mini-text').textContent), doc.getElementById('cpp-mini-text').textContent);
  engineScore = { type: 'cp', value: 10 };
  await newGame();
  const drawBefore = drawClicks;
  for (let i = 0; i < 6; i++) { rookStep(i); await sleep(1400); }
  check('S: manual + final igual repetido: mostra "Sugestão: oferecer empate"', /Sugestão: oferecer empate/.test(evalText()), evalText());
  check('S: manual não oferece empate sozinho', drawClicks === drawBefore, drawClicks + ' vs ' + drawBefore);
  engineScore = { type: 'cp', value: 150 };
  await newGame();
  setBoard(rookFen(2), [25, 35]);
  await sleep(1500);
  check('S: sem motivo para empate/desistência, mostra o status normal', !/Sugestão/.test(evalText()), evalText());
  engineScore = { type: 'cp', value: 80 };

  // T) Precisão da partida: reproduz a partida pela API, avalia com o motor e mostra as precisões
  setAuto(false);
  const revBtn = doc.getElementById('cpp-review-btn');
  check('T: botão "Calcular precisão desta partida" existe', !!revBtn && /Calcular precisão/.test(revBtn.textContent));
  reviewEngines = 0;
  revBtn.click();
  await sleep(600);
  check('T: mostra andamento (Buscando/Analisando)', /Buscando|Analisando|Aguardando/.test(doc.getElementById('cpp-review-status').textContent), doc.getElementById('cpp-review-status').textContent);
  await sleep(9000);
  const revText = doc.getElementById('cpp-review-result').textContent;
  check('T: criou um motor separado para a revisão', reviewEngines > 0, reviewEngines);
  check('T: mostra a precisão dos dois lados', /Você: \d+,\d%\s+·\s+Adversário: \d+,\d%/.test(revText), revText);
  check('T: mostra as contagens de gafes, erros e imprecisões', /gafes/.test(revText) && /erros/.test(revText) && /imprecisões/.test(revText), revText);
  check('T: mostra o número do site quando existe (92,7)', /Número do site: você 92,7\s+·\s+adversário 70,1/.test(revText), revText);
  check('T: status final "Pronto"', /Pronto/.test(doc.getElementById('cpp-review-status').textContent), doc.getElementById('cpp-review-status').textContent);
  check('T: resumo também vai para o painel recolhido', /Precisão: você/.test(doc.getElementById('cpp-mini-text').textContent), doc.getElementById('cpp-mini-text').textContent);
  check('T: botão volta a ficar disponível', revBtn.disabled === false);

  // T1) Pelo endereço interno do site: não espera o histórico e funciona logo ao fim da partida
  siteGameOk = true;
  apiCalls = 0;
  doc.getElementById('cpp-review-result').textContent = '';
  revBtn.click();
  await sleep(9000);
  check('T1: calcula direto da lista de lances do site, sem consultar o histórico', /Você: \d+,\d%/.test(doc.getElementById('cpp-review-result').textContent) && apiCalls === 0, apiCalls + ' / ' + doc.getElementById('cpp-review-status').textContent);
  siteGameOk = false;   // se o site não responder, usa o histórico como reserva (testes seguintes)

  // T2) Sem nome no jogador de baixo: acha o seu nome pelo link da barra lateral do site
  doc.querySelector('.board-layout-bottom').remove();
  const sideLink = doc.createElement('a');
  sideLink.setAttribute('href', 'https://www.chess.com/member/felipe');
  sideLink.textContent = 'felipe';
  sideLink.getBoundingClientRect = () => ({ left: 40, top: 800, width: 100, height: 20, right: 140, bottom: 820 });
  doc.body.appendChild(sideLink);
  doc.getElementById('cpp-review-result').textContent = '';
  doc.getElementById('cpp-review-btn').click();
  await sleep(9500);
  check('T2: acha o nome pelo link do site e calcula', /Você: \d+,\d%/.test(doc.getElementById('cpp-review-result').textContent), doc.getElementById('cpp-review-status').textContent);
  // só o adversário aparece na página: a partida é achada pelo histórico dele
  sideLink.setAttribute('href', 'https://www.chess.com/member/outro');
  doc.getElementById('cpp-review-result').textContent = '';
  doc.getElementById('cpp-review-btn').click();
  await sleep(9500);
  check('T2: com o nome do adversário também acha a partida', /Você: \d+,\d%/.test(doc.getElementById('cpp-review-result').textContent), doc.getElementById('cpp-review-status').textContent);
  sideLink.remove();
  doc.body.insertAdjacentHTML('afterbegin', '<div class="board-layout-bottom"><div class="user-username-component">felipe</div></div>');

  // R) Recolhido: encaixa no espaço vazio da lateral esquerda (e volta ao expandir)
  const boardEl = doc.getElementById('b');
  const pnl = doc.getElementById('chess-position-panel');
  const minBtn = pnl.querySelector('.cpp-minimize');
  if (pnl.classList.contains('cpp-minimized')) minBtn.click();   // o painel recriado abre minimizado
  pnl.style.top = '80px';
  boardEl.getBoundingClientRect = () => ({ left: 420, top: 95, width: 700, height: 700, right: 1120, bottom: 795 });
  minBtn.click();
  check('R: recolhido vai para a lateral esquerda (sem cobrir o tabuleiro)', pnl.classList.contains('cpp-docked') && pnl.style.left === '8px' && parseInt(pnl.style.top) >= 360, pnl.style.left + ' / ' + pnl.style.top);
  check('R: largura cabe dentro da barra lateral (até 218 px, com margem)', parseInt(pnl.style.left) + parseInt(pnl.style.width) <= 218, pnl.style.left + ' + ' + pnl.style.width);
  const hdr = pnl.querySelector('.cpp-header');
  hdr.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, clientX: 50, clientY: 400 }));
  doc.dispatchEvent(new win.MouseEvent('mousemove', { bubbles: true, clientX: 500, clientY: 100 }));
  doc.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true }));
  check('R: recolhido é fixo (não arrasta)', pnl.style.left === '8px' && parseInt(pnl.style.top) >= 360, pnl.style.left + ' / ' + pnl.style.top);
  await sleep(1200);
  check('R: continua dentro da lateral depois de um tempo', pnl.classList.contains('cpp-docked') && parseInt(pnl.style.left) + parseInt(pnl.style.width) <= 218);
  minBtn.click();
  check('R: expandir tira o encaixe e fixa o painel na lateral (de cima a baixo)', !pnl.classList.contains('cpp-docked') && pnl.classList.contains('cpp-pinned') && pnl.style.left === '' && pnl.style.width === '', pnl.className + ' / ' + pnl.style.left);
  const cssText = require('fs').readFileSync(SRC + '\\content.css', 'utf8');
  check('R: CSS do expandido fixa topo e rodapé (top/bottom)', /cpp-pinned\s*\{[^}]*top:\s*8px !important;[^}]*bottom:\s*8px !important/.test(cssText));
  hdr.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, clientX: 50, clientY: 40 }));
  doc.dispatchEvent(new win.MouseEvent('mousemove', { bubbles: true, clientX: 700, clientY: 300 }));
  doc.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true }));
  check('R: expandido também é fixo (não arrasta)', pnl.style.left === '' && pnl.style.top === '', pnl.style.left + ' / ' + pnl.style.top);
  boardEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 });
  minBtn.click();
  check('R: fixado (padrão) encaixa na lateral mesmo sem espaço medido', pnl.classList.contains('cpp-docked'));
  minBtn.click();
  await sleep(700);
  check('R: fixado (padrão): o expandido fica fixo na lateral', pnl.classList.contains('cpp-pinned') && !pnl.classList.contains('cpp-docked'), pnl.className);

  // R2) Tela "Jogar": há outro .board pequeno no começo da página; o encaixe usa o tabuleiro principal (o maior)
  doc.body.insertAdjacentHTML('afterbegin', '<div class="board" id="decoy"></div>');
  doc.getElementById('decoy').getBoundingClientRect = () => ({ left: 0, top: 0, width: 60, height: 60, right: 60, bottom: 60 });
  boardEl.getBoundingClientRect = () => ({ left: 420, top: 95, width: 700, height: 700, right: 1120, bottom: 795 });
  if (!pnl.classList.contains('cpp-minimized')) minBtn.click();
  await sleep(1200);
  check('R2: com outro .board pequeno na página, o recolhido continua encaixado na lateral', pnl.classList.contains('cpp-docked') && pnl.style.left === '8px', pnl.className + ' / ' + pnl.style.left);
  doc.getElementById('decoy').remove();
  const blk = (sel) => { const a = cssText.indexOf(sel + ' {'); return a < 0 ? '' : cssText.slice(a, cssText.indexOf('}', a)); };
  check('R2: texto do painel recolhido tem altura fixa (3 linhas) e a dica da maratona 2 linhas', blk('.cpp-mini-text').includes('height: 48px') && blk('.cpp-mini-hint').includes('height: 26px') && !cssText.includes('cpp-mini-hint:empty'));
  boardEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 });

  // PIN) Tachinha: fixo na lateral <-> solto e arrastável (a escolha fica salva)
  const pinBtn = pnl.querySelector('.cpp-pin');
  boardEl.getBoundingClientRect = () => ({ left: 420, top: 95, width: 700, height: 700, right: 1120, bottom: 795 });
  if (!pnl.classList.contains('cpp-minimized')) minBtn.click();
  await sleep(700);
  check('PIN: padrão é fixo: tachinha acesa e painel encaixado na lateral', !!pinBtn && pinBtn.classList.contains('on') && pnl.classList.contains('cpp-docked'), pnl.className);
  pinBtn.click();
  await sleep(300);
  check('PIN: solto: sai da lateral, tachinha apagada e escolha salva', !pnl.classList.contains('cpp-docked') && !pnl.classList.contains('cpp-pinned') && pnl.style.left === '' && !pinBtn.classList.contains('on') && saved && saved.pinned === false, pnl.className + ' / ' + (saved && saved.pinned));
  hdr.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, clientX: 50, clientY: 40 }));
  doc.dispatchEvent(new win.MouseEvent('mousemove', { bubbles: true, clientX: 500, clientY: 300 }));
  doc.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true }));
  check('PIN: solto pode ser arrastado para qualquer lugar', parseInt(pnl.style.left) >= 400 && parseInt(pnl.style.top) >= 200, pnl.style.left + ' / ' + pnl.style.top);
  const leftSolto = pnl.style.left;
  await sleep(1300);
  check('PIN: solto não volta sozinho para a lateral', !pnl.classList.contains('cpp-docked') && pnl.style.left === leftSolto, pnl.className + ' / ' + pnl.style.left);
  minBtn.click();
  await sleep(700);
  check('PIN: solto e expandido continua solto', !pnl.classList.contains('cpp-pinned') && !pnl.classList.contains('cpp-docked'), pnl.className);
  pinBtn.click();
  await sleep(300);
  check('PIN: fixar de novo leva o painel (expandido) para a lateral e salva', pnl.classList.contains('cpp-pinned') && pinBtn.classList.contains('on') && saved && saved.pinned === true, pnl.className + ' / ' + (saved && saved.pinned));
  minBtn.click();
  await sleep(300);
  check('PIN: fixo e recolhido volta ao encaixe da lateral', pnl.classList.contains('cpp-docked'), pnl.className);
  // PIN2) Recolhido entra no vão da barra lateral, logo abaixo do menu e acima de "Pesquisar" (não tapa nada)
  doc.body.insertAdjacentHTML('afterbegin', '<aside id="sbx"><a id="m1">Jogar</a><a id="m2">Avaliação</a><a id="m3">Pesquisar</a><a id="m4">Treinar</a><a id="m5">Pular</a></aside>');
  const rc = (l, t2, w, h) => () => ({ left: l, top: t2, width: w, height: h, right: l + w, bottom: t2 + h });
  doc.getElementById('sbx').getBoundingClientRect = rc(0, 0, 200, 700);
  doc.getElementById('m1').getBoundingClientRect = rc(10, 100, 180, 40);
  doc.getElementById('m2').getBoundingClientRect = rc(10, 150, 180, 40);
  doc.getElementById('m3').getBoundingClientRect = rc(10, 600, 180, 40);
  // como no Chess.com: item do "Mais" fechado (tem posição, mas é invisível) e link "pular" fora da tela
  doc.getElementById('m4').getBoundingClientRect = rc(10, 220, 180, 160);
  doc.getElementById('m4').checkVisibility = () => false;
  doc.getElementById('m5').getBoundingClientRect = rc(-999, 1, 32, 500);
  await sleep(1200);
  check('PIN2: no vão da barra lateral, logo abaixo do último item do menu (190 + 8)', pnl.classList.contains('cpp-docked') && pnl.style.top === '198px', pnl.className + ' / ' + pnl.style.top);
  doc.getElementById('sbx').remove();
  boardEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 });

  // W) Maratona: N partidas seguidas; ao fim de cada uma começa a próxima e ignora a revanche
  const vis = (el) => { el.getBoundingClientRect = () => ({ left: 10, top: 10, width: 100, height: 30, right: 110, bottom: 40 }); return el; };
  const clicks = { nb: 0, rm: 0, art: 0 };
  let gameNo = 200;
  const newGameUrl = () => win.history.pushState({}, '', '/game/live/' + (++gameNo));
  const showGameOver = () => {
    doc.body.insertAdjacentHTML('beforeend', '<div class="game-over-modal" id="gom"><a id="art" href="/article/view/how-chess-games-can-end-8-ways-explained#resignation">Por Desistência</a><button id="gr">Game Review</button><button id="nb">Novo 10 min</button><button id="rm">Revanche</button></div>');
    ['gom', 'art', 'gr', 'nb', 'rm'].forEach(i => vis(doc.getElementById(i)));
    doc.getElementById('nb').addEventListener('click', () => clicks.nb++);
    doc.getElementById('rm').addEventListener('click', () => clicks.rm++);
    doc.getElementById('art').addEventListener('click', (e) => { e.preventDefault(); clicks.art++; });
  };
  const realRandom = win.Math.random;
  newGameUrl();
  setAuto(false);
  marathonApiFinished = false;
  const marBtn = doc.getElementById('cpp-marathon-btn');
  const marN = doc.getElementById('cpp-marathon-n');
  check('W: campo e botão da maratona existem', !!marBtn && !!marN && /Iniciar/.test(marBtn.textContent));
  marN.value = '3';
  marBtn.click();
  await sleep(300);
  check('W: iniciar liga a maratona com 3 partidas e a jogada automática', saved && saved.marathonOn === true && saved.marathonTotal === 3 && saved.marathonDone === 0 && saved.autoMove === true, JSON.stringify(saved));
  check('W: botão vira "Parar maratona" e mostra a partida 1 de 3', /Parar/.test(marBtn.textContent) && /partida 1 de 3/.test(doc.getElementById('cpp-marathon-hint').textContent), doc.getElementById('cpp-marathon-hint').textContent);
  // Partida em andamento: o site diz isFinished=false, mesmo com elementos de fim de partida na tela => não conta
  marathonApiFinished = false;
  showGameOver();
  await sleep(5500);
  check('W: site diz que a partida segue: NÃO conta nem clica em nova partida', saved && saved.marathonDone === 0 && clicks.nb === 0, JSON.stringify(saved) + ' / ' + clicks.nb);
  doc.getElementById('gom').remove();
  // Só o botão "Game Review" na tela (sem a janela de resultado) e o site sem resposta: NÃO conta
  marathonApiFinished = undefined;
  doc.body.insertAdjacentHTML('beforeend', '<button id="lone">Game Review</button>');
  vis(doc.getElementById('lone'));
  await sleep(5500);
  check('W: botão de revisão sozinho (sem Revanche) não conta como fim de partida', saved && saved.marathonDone === 0 && clicks.nb === 0, JSON.stringify(saved));
  // Site diz "terminou", mas a janela de resultado não está na tela: também não conta
  marathonApiFinished = true;
  await sleep(5500);
  check('W: site diz terminou mas sem a janela de resultado: não conta', saved && saved.marathonDone === 0 && clicks.nb === 0, JSON.stringify(saved));
  doc.getElementById('lone').remove();
  for (let g = 1; g <= 3; g++) {
    win.Math.random = () => 0;          // pausa mínima (5 s) só para o teste
    marathonApiFinished = true;
    showGameOver();
    await sleep(4500);
    win.Math.random = realRandom;
    check(`W: fim da partida ${g} conta 1 concluída`, saved && (g < 3 ? saved.marathonDone === g && doc.getElementById('cpp-marathon-n').value === String(3 - g) : saved.marathonDone === 0 && saved.marathonOn === false && doc.getElementById('cpp-marathon-n').value === '3'), JSON.stringify(saved) + ' campo=' + doc.getElementById('cpp-marathon-n').value);
    if (g < 3) {
      await sleep(7000);
      check(`W: depois da pausa clica em "Novo 10 min" (${g}x)`, clicks.nb === g, clicks.nb);
      check(`W: nunca clica em "Revanche"`, clicks.rm === 0, clicks.rm);
      doc.getElementById('gom').remove();
      newGameUrl();                     // o site abre a partida nova
      await sleep(1500);
      check(`W: partida nova aberta: sai da espera`, saved && saved.marathonPending === false && saved.marathonOn === true, JSON.stringify(saved));
    }
  }
  check('W: nunca clica no link "Por Desistência" (artigo do site)', clicks.art === 0, clicks.art);
  check('W: terminou as 3: maratona desliga e avisa', saved && saved.marathonOn === false && /concluída: 3 partidas/.test(doc.getElementById('cpp-marathon-hint').textContent), doc.getElementById('cpp-marathon-hint').textContent);
  await sleep(6500);
  check('W: depois da última não começa outra partida', clicks.nb === 2 && clicks.rm === 0, clicks.nb + ' / ' + clicks.rm);
  doc.getElementById('gom').remove();
  // Parar no meio
  marN.value = '5';
  marBtn.click();
  await sleep(300);
  marBtn.click();
  await sleep(300);
  check('W: "Parar maratona" desliga na hora', saved && saved.marathonOn === false && /Iniciar/.test(marBtn.textContent), JSON.stringify(saved));
  setAuto(false);

  // W2) Maratona numa página sem número da partida (/play/online): o contador tem de andar do mesmo jeito
  win.history.pushState({}, '', '/play/online');
  marathonApiFinished = undefined;
  const nbBase = clicks.nb;
  marN.value = '2';
  marBtn.click();
  await sleep(300);
  check('W2: sem id na URL: maratona liga com 2 partidas', saved && saved.marathonOn === true && saved.marathonTotal === 2 && saved.marathonDone === 0, JSON.stringify(saved));
  win.Math.random = () => 0;
  showGameOver();
  await sleep(8500);
  win.Math.random = realRandom;
  check('W2: sem id na URL: fim da partida 1 conta e o contador mostra 1', saved && saved.marathonDone === 1 && doc.getElementById('cpp-marathon-n').value === '1', JSON.stringify(saved) + ' campo=' + doc.getElementById('cpp-marathon-n').value);
  check('W2: sem id na URL: clica em "Novo 10 min" uma vez e nunca em "Revanche"', clicks.nb === nbBase + 1 && clicks.rm === 0, clicks.nb + ' / ' + clicks.rm);
  doc.getElementById('gom').remove();      // o site abre a partida nova na mesma URL
  await sleep(4500);
  check('W2: sem id na URL: partida nova em andamento tira da espera', saved && saved.marathonPending === false && saved.marathonOn === true, JSON.stringify(saved));
  check('W2: sem id na URL: não conta de novo enquanto a partida segue', saved && saved.marathonDone === 1, JSON.stringify(saved));
  win.Math.random = () => 0;
  showGameOver();
  await sleep(3500);
  win.Math.random = realRandom;
  check('W2: sem id na URL: fim da partida 2 conclui a maratona', saved && saved.marathonOn === false && saved.marathonDone === 0 && /concluída: 2 partidas/.test(doc.getElementById('cpp-marathon-hint').textContent), JSON.stringify(saved));
  doc.getElementById('gom').remove();
  setAuto(false);

  // Q) Lista "Agressividade": Agressivo, Defensivo, Automático
  const styleSel = doc.getElementById('cpp-style-select');
  check('Q: lista "Agressividade" com 3 itens (Agressivo, Defensivo, Automático)', !!styleSel && Array.from(styleSel.options).map(o => o.textContent).join(',') === 'Agressivo,Defensivo,Automático' && /Agressividade/.test(doc.querySelector('label[for="cpp-style-select"]').textContent), styleSel && Array.from(styleSel.options).map(o => o.textContent).join(','));
  check('Q: padrão é Automático', styleSel.value === 'auto', styleSel.value);
  styleSel.value = 'aggressive'; styleSel.dispatchEvent(new win.Event('change'));
  await sleep(300);
  check('Q: escolha é salva', saved && saved.style === 'aggressive', JSON.stringify(saved));
  check('Q: dica do estilo aparece', /capturar/.test(doc.getElementById('cpp-style-hint').textContent), doc.getElementById('cpp-style-hint').textContent);
  styleSel.value = 'auto'; styleSel.dispatchEvent(new win.Event('change'));
  await sleep(300);

  // P) Profundidade automática: usa o histórico (4 vitórias seguidas => profundidade 2; derrota => 11)
  setAuto(false);
  setPace('smart');
  await newGame();
  const depthSelP = doc.getElementById('cpp-depth-select');
  check('P: opção "Automática" é a primeira da lista', /Automática/.test(depthSelP.options[0].textContent) && depthSelP.options[0].value === '0', depthSelP.options[0].textContent);
  const wP = workers[workers.length - 1];
  wP.posted.length = 0;
  engineScore = { type: 'cp', value: 0 };
  depthSelP.value = '0'; depthSelP.dispatchEvent(new win.Event('change'));
  await sleep(2500);
  check('P: salvou profundidade automática (0)', saved && saved.depth === 0, JSON.stringify(saved));
  check('P: buscou o histórico na API', apiCalls >= 3, apiCalls);
  check('P: 4 vitórias seguidas => profundidade 2', wP.posted.some(m => m.startsWith('go depth 2 ')), wP.posted.filter(m => /^go/.test(m)).join('|'));
  check('P: painel mostra o histórico (VVVV) e a profundidade', /Prof\. 2/.test(doc.getElementById('cpp-depth-hint').textContent) && /VVVV/.test(doc.getElementById('cpp-depth-hint').textContent), doc.getElementById('cpp-depth-hint').textContent);
  apiResults = ['checkmated', 'win', 'win'];
  setBoard('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR', [53, 54]);
  await sleep(800);
  await newGame();             // partida nova: busca o histórico de novo
  wP.posted.length = 0;
  await sleep(3000);
  const wP2 = workers[workers.length - 1];
  check('P: depois de uma derrota sobe a profundidade (11)', workers.some(w => w.posted.some(m => m.startsWith('go depth 11 '))), workers.map(w => w.posted.filter(m => /^go/.test(m)).slice(-1)[0]).join('|'));
  depthSelP.value = '8'; depthSelP.dispatchEvent(new win.Event('change'));
  await sleep(300);
  check('P: voltar para profundidade fixa funciona', saved && saved.depth === 8, JSON.stringify(saved));
  setDepth(8);

  // M1) Mate em 1 na tela, motor (simulado) indicando outro lance e rating baixo: o robô dá o mate (Dh8#)
  await newGame();
  resetCounters();
  setDepth(1);
  const logsM = []; const logOrig = win.console.log;
  win.console.log = (...a) => { logsM.push(a.join(' ')); logOrig.apply(win.console, a); };
  engineScore = { type: 'cp', value: 30 };
  setBoard('k7/8/1K6/8/8/8/8/6Q1', [28, 18]);
  setAuto(true);
  await sleep(4000);
  win.console.log = logOrig;
  check('M1: mate em 1: joga Dg1-g8 mesmo com o motor indicando outro lance', logsM.some(l => /Tentando jogar: g1g8/.test(l)), logsM.slice(-6).join(' | ') + ' // ' + statusText());
  check('M1: não faz erro simulado em vez do mate', !logsM.some(l => /Erro simulado/.test(l)));
  setAuto(false);
  setDepth(8);

  // Z) Jogada que não pegou (o tabuleiro não mudou depois dos cliques): tenta de novo sozinho
  await newGame();
  resetCounters();
  engineScore = { type: 'cp', value: 30 };
  setBoard('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR', [57, 55]);
  setAuto(true);
  await sleep(11000);
  check('Z: lance que não pegou: tenta jogar de novo (mais de 1 tentativa)', boardClicks >= 2, boardClicks);
  setAuto(false);

  // F) Partida nova com o tabuleiro recriado pela página (mesma posição inicial, agora de pretas):
  //    precisa reanalisar e voltar a desenhar as setas
  setAuto(false);
  await newGame();
  await sleep(1500);
  const w3 = workers[workers.length - 1];
  check('F: antes da troca há setas', doc.querySelectorAll('.cpp-best-move-arrow').length >= 1);
  w3.posted.length = 0;
  const oldB = doc.getElementById('b');
  const newB = doc.createElement('div');
  newB.className = 'board flipped'; newB.id = 'b';
  newB.innerHTML = piecesHtml(START);
  oldB.replaceWith(newB);
  newB.addEventListener('mouseup', () => boardClicks++);
  await sleep(1800);
  check('F: tabuleiro recriado reanalisa', w3.posted.some(m => m.startsWith('go depth')), w3.posted.join('|'));
  check('F: setas voltam depois da troca', doc.querySelectorAll('.cpp-best-move-arrow').length >= 1);

  // G) Painel removido pela página (sem o usuário fechar) volta sozinho
  doc.getElementById('chess-position-panel').remove();
  await sleep(1500);
  check('G: painel removido pela página é recriado', !!doc.getElementById('chess-position-panel'));

  // H) Tabuleiro incompleto (início de partida montando, sem o rei preto): NÃO manda ao motor; completo: manda
  setAuto(false);
  await newGame();
  await sleep(1200);
  let wH = workers[workers.length - 1];
  wH.posted.length = 0;
  doc.getElementById('b').innerHTML = piecesHtml('rnbq1bnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
  await sleep(1500);
  check('H: sem rei preto não manda posição ao motor', !wH.posted.some(m => m.startsWith('position fen')), wH.posted.join('|'));
  doc.getElementById('b').innerHTML = piecesHtml(START);
  await sleep(1500);
  check('H: tabuleiro completo volta a analisar', wH.posted.some(m => m.startsWith('go depth')), wH.posted.join('|'));

  // I) Motor morre (erro no worker): sobe outro e volta a analisar
  const nBefore = workers.length;
  wH.onerror && wH.onerror(new win.Event('error'));
  await sleep(3500);
  for (let i = errors.length - 1; i >= 0; i--) if (/Erro no motor Stockfish/.test(errors[i])) errors.splice(i, 1);  // erro provocado de propósito
  check('I: motor com erro é recriado', workers.length > nBefore, `${nBefore} -> ${workers.length}`);
  const wI = workers[workers.length - 1];
  setBoard('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR', [36, 52]);
  await sleep(2500);
  check('I: depois de recriar, analisa a posição nova', wI.posted.some(m => m.startsWith('go depth')), wI.posted.join('|'));

  // J) Motor mudo (aceita o comando e não responde mais): em ~15 s é recriado
  const nJ = workers.length;
  engineMute = true;
  setBoard('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR', [53, 54]);
  await sleep(17000);
  engineMute = false;
  check('J: motor mudo é recriado', workers.length > nJ, `${nJ} -> ${workers.length}`);
  await sleep(3500);
  const wJ = workers[workers.length - 1];
  check('J: depois disso volta a analisar', wJ.posted.some(m => m.startsWith('go depth')), wJ.posted.join('|'));

  // K) Falha ao carregar o motor (fetch com erro): tenta de novo sozinho e volta a analisar
  setAuto(false);
  await newGame();
  await sleep(1200);
  const RealWorker = win.Worker;
  win.Worker = function () { throw new Error('não foi possível criar o worker (simulado)'); };
  const nK = workers.length;
  workers[workers.length - 1].onerror(new win.Event('error'));   // derruba o motor
  await sleep(2500);
  check('K: com falha ao carregar, mostra aviso e tenta de novo', /Falha ao carregar|Reiniciando|Carregando/.test(statusText()), statusText());
  win.Worker = RealWorker;
  await sleep(4500);
  check('K: motor volta sozinho depois da falha', workers.length > nK, nK + ' -> ' + workers.length);
  check('K: motor volta a ficar pronto', /Pronto|Pensando|Conclu/.test(statusText()), statusText());
  for (let i = errors.length - 1; i >= 0; i--) if (/Erro no motor Stockfish/.test(errors[i])) errors.splice(i, 1);

  // X) Painel recolhido mostra Automático/Manual e a maratona
  const pnX = doc.getElementById('chess-position-panel');
  const miniAuto = doc.getElementById('cpp-mini-auto');
  check('X: painel recolhido tem botão Automático/Manual e controles da maratona', !!miniAuto && !!doc.getElementById('cpp-mini-mar-btn') && !!doc.getElementById('cpp-mini-mar-n'));
  setAuto(true); await sleep(300);
  check('X: botão mostra "Automático" quando ligado', miniAuto.textContent === 'Automático', miniAuto.textContent);
  miniAuto.click(); await sleep(300);
  check('X: clicar desliga a jogada automática (vira Manual)', saved && saved.autoMove === false && miniAuto.textContent === 'Manual', JSON.stringify(saved) + miniAuto.textContent);
  miniAuto.click(); await sleep(300);
  check('X: clicar de novo liga', saved && saved.autoMove === true && miniAuto.textContent === 'Automático');
  doc.getElementById('cpp-mini-mar-n').value = '4';
  doc.getElementById('cpp-mini-mar-btn').click(); await sleep(300);
  check('X: maratona pelo painel recolhido', saved && saved.marathonOn === true && saved.marathonTotal === 4 && doc.getElementById('cpp-mini-mar-btn').disabled === true && doc.getElementById('cpp-mini-mar-stop').disabled === false && /Faltam 4 \(partida 1 de 4\)/.test(doc.getElementById('cpp-mini-mar-hint').textContent), JSON.stringify(saved));
  check('X: modo manual para a maratona (antes: ■ parar existe)', !!doc.getElementById('cpp-mini-mar-stop'));
  miniAuto.click(); await sleep(300);
  check('X: modo manual para a maratona', saved && saved.marathonOn === false && saved.autoMove === false, JSON.stringify(saved));

  // Y) Interruptor geral (ícone da extensão): desliga tudo e volta ao ligar
  doc.getElementById('cpp-mini-mar-btn').click(); await sleep(200);   // maratona ligada
  const clicksAntes = clicks.nb;
  storageListener({ cppEnabled: { newValue: false } }, 'local');
  await sleep(500);
  check('Y: desligada: painel some', !doc.getElementById('chess-position-panel'));
  check('Y: desligada: maratona e jogada automática desligadas e salvas', saved && saved.marathonOn === false && saved.marathonPending === false && saved.autoMove === false, JSON.stringify(saved));
  win.Math.random = () => 0;
  win.history.pushState({}, '', '/game/live/' + (++gameNo));
  showGameOver();
  await sleep(7000);
  win.Math.random = realRandom;
  check('Y: desligada: não clica em nada e o painel não volta', clicks.nb === clicksAntes && clicks.art === 0 && !doc.getElementById('chess-position-panel'), clicks.nb + '/' + clicksAntes);
  doc.getElementById('gom').remove();
  storageListener({ cppEnabled: { newValue: true } }, 'local');
  await sleep(2500);
  check('Y: ligada de novo: o painel volta', !!doc.getElementById('chess-position-panel'));
  const pnY = doc.getElementById('chess-position-panel');
  if (pnY && !pnY.classList.contains('cpp-minimized')) pnY.querySelector('.cpp-minimize').click();

  // I) Idiomas: trocar no painel traduz tudo na hora; voltar ao português restaura
  const langOf = () => doc.getElementById('cpp-lang-select');
  const panelTxt = () => doc.getElementById('chess-position-panel').textContent;
  check('I: seletor de idioma no painel com 7 idiomas', !!langOf() && langOf().options.length === 7 && langOf().value === 'pt', langOf() && langOf().options.length + '/' + langOf().value);
  const setLangUI = async (code) => { langOf().value = code; langOf().dispatchEvent(new win.Event('change')); await sleep(500); };
  await setLangUI('en');
  check('I: inglês: título, rótulos e maratona traduzidos', doc.querySelector('.cpp-title').textContent === 'Chess Analyzer Pro' && /Depth/.test(panelTxt()) && /Game marathon/.test(panelTxt()) && !/Profundidade|Maratona/.test(panelTxt()), doc.querySelector('.cpp-title').textContent);
  check('I: inglês: seletor continua em inglês e salvou a escolha', langOf().value === 'en' && savedLang === 'en', langOf().value + '/' + savedLang);
  await setLangUI('ru');
  check('I: russo: painel traduzido', doc.querySelector('.cpp-title').textContent === 'Шахматный анализатор Pro' && /Глубина/.test(panelTxt()), doc.querySelector('.cpp-title').textContent);
  await setLangUI('zh');
  check('I: chinês: painel traduzido', doc.querySelector('.cpp-title').textContent === '国际象棋分析器 Pro' && /搜索深度/.test(panelTxt()), doc.querySelector('.cpp-title').textContent);
  for (const [c, re] of [['es', /Profundidad/], ['fr', /Profondeur/], ['it', /Profondità/]]) {
    await setLangUI(c);
    check(`I: ${c}: painel traduzido`, re.test(panelTxt()) && !/Maratona de partidas/.test(panelTxt()), c);
  }
  await setLangUI('pt');
  check('I: de volta ao português: tudo restaurado', doc.querySelector('.cpp-title').textContent === 'Analisador de Xadrez Pro' && /Profundidade/.test(panelTxt()) && /Maratona de partidas/.test(panelTxt()), doc.querySelector('.cpp-title').textContent);
  { const pnI = doc.getElementById('chess-position-panel'); if (pnI && !pnI.classList.contains('cpp-minimized')) pnI.querySelector('.cpp-minimize').click(); }

  // L) Extensão recarregada com a página aberta (contexto invalidado): avisa para apertar F5 e para tudo
  win.chrome.runtime.id = undefined;
  await sleep(1500);
  check('L: extensão recarregada: pede F5', /F5/.test(statusText()), statusText() + ' | painéis=' + doc.querySelectorAll('#chess-position-panel').length + ' | status=' + Array.from(doc.querySelectorAll('.cpp-engine-status')).map(e => e.textContent).join('/'));
  check('L: sem setas depois de invalidar', doc.querySelectorAll('.cpp-best-move-arrow').length === 0);
  win.chrome.runtime.id = 'teste';

  console.log(results.join('\n'));
  console.log('\nErros capturados na página: ' + errors.length);
  errors.forEach(e => console.log('  ' + e));
  console.log(fail || errors.length ? `\n${fail} falha(s), ${errors.length} erro(s)` : '\nTudo OK');
  process.exit(fail || errors.length ? 1 : 0);
})();
