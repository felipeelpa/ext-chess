// Persistência: o que o usuário muda no painel tem que voltar igual depois de recarregar a página.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const SRC = process.argv[2];
const code = fs.readFileSync(SRC + '\\content.js', 'utf8');
const lite = fs.readFileSync(SRC + '\\chess-lite.js', 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const live = new Set();
const killAll = () => { for (const t of live) { clearTimeout(t); clearInterval(t); } live.clear(); };
const store = {};   // o "disco" do navegador: sobrevive às recargas
let fail = 0;
const check = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'OK   ' : 'FAIL ') + n + (ok || x === undefined ? '' : '  -> ' + x)); };

const MAP={P:'wp',N:'wn',B:'wb',R:'wr',Q:'wq',K:'wk',p:'bp',n:'bn',b:'bb',r:'br',q:'bq',k:'bk'};
function pieces(){let h='';'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'.split('/').forEach((row,i)=>{let f=0;for(const ch of row){if(ch>='1'&&ch<='8'){f+=+ch;continue;}h+='<div class="piece '+MAP[ch]+' square-'+(f+1)+(8-i)+'"></div>';f++;}});return h;}
async function load() {
  const dom = new JSDOM('<body><div class="board" id="b">'+pieces()+'</div><div class="clock-component clock-bottom"><span class="clock-time-monospace">5:00</span></div></body>',
    { url: 'https://www.chess.com/game/live/123', runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  win.chrome = {
    runtime: { id: 't', getURL: x => x, lastError: null, onMessage: { addListener() {} } },
    storage: { local: {
      get: (k, cb) => setTimeout(() => cb(JSON.parse(JSON.stringify(store))), 5),
      set: (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); },
    }, onChanged: { addListener() {} } },
  };
  const blobs = new Map(); let bn = 0;
  win.Blob = class { constructor(p) { this.t = p.join(''); } };
  win.URL.createObjectURL = (b) => { const u = 'blob:f' + (++bn); blobs.set(u, b.t); return u; };
  win.Worker = class {
    constructor(url) { this.timer = (blobs.get(url) || '').includes('/*cpp-timer*/'); this.t = new Map(); }
    terminate() {}
    postMessage(m) {
      if (!this.timer) { const say = s => setTimeout(() => this.onmessage && this.onmessage({ data: s }), 5);
        if (m === 'uci') say('uciok'); if (m === 'isready') say('readyok'); return; }
      const { cmd, id, ms } = m;
      if (cmd === 'timeout') { const h = setTimeout(() => { this.t.delete(id); this.onmessage && this.onmessage({ data: id }); }, ms); this.t.set(id, h); live.add(h); }
      else if (cmd === 'interval') { const h = setInterval(() => this.onmessage && this.onmessage({ data: id }), ms); this.t.set(id, h); live.add(h); }
      else if (cmd === 'clear') { clearTimeout(this.t.get(id)); clearInterval(this.t.get(id)); }
    }
  };
  win.eval(lite);
  win.eval(code);
  await sleep(1500);
  return win;
}
const st = win => {
  const d = win.document;
  return {
    auto: d.querySelector('#auto-move-cb').checked,
    mini: d.querySelector('#cpp-mini-auto').textContent,
    human: d.querySelector('#cpp-human-cb').checked,
    style: d.querySelector('#cpp-style-select').value,
    pace: d.querySelector('#cpp-pace-select').value,
    depth: d.querySelector('#cpp-depth-select').value,
    n: d.querySelector('#cpp-marathon-n').value,
    nmini: d.querySelector('#cpp-mini-mar-n').value,
  };
};
const setv = (win, sel, v) => { const e = win.document.querySelector(sel); e.value = v; e.dispatchEvent(new win.Event('change', { bubbles: true })); };

(async () => {
  let w = await load();
  console.log('1ª carga', JSON.stringify(st(w)));
  w.document.querySelector('#cpp-mini-auto').click();           // liga automático
  w.document.querySelector('#cpp-human-cb').checked = true;
  w.document.querySelector('#cpp-human-cb').dispatchEvent(new w.Event('change', { bubbles: true }));
  setv(w, '#cpp-style-select', 'defensive');
  setv(w, '#cpp-pace-select', 'fast');
  setv(w, '#cpp-depth-select', '7');
  setv(w, '#cpp-marathon-n', '22');
  await sleep(100);
  killAll(); w.close();
  w = await load();
  let s = st(w);
  console.log('2ª carga', JSON.stringify(s));
  check('automático volta automático', s.auto && s.mini === 'Automático', JSON.stringify(s));
  check('modo humano volta', s.human);
  check('estilo volta', s.style === 'defensive', s.style);
  check('ritmo volta', s.pace === 'fast', s.pace);
  check('profundidade volta', s.depth === '7', s.depth);
  check('quantidade da maratona volta', s.n === '22' && s.nmini === '22', s.n + '/' + s.nmini);

  w.document.querySelector('#cpp-mini-auto').click();           // volta para manual
  await sleep(100);
  killAll(); w.close();
  w = await load();
  s = st(w);
  check('manual volta manual', !s.auto && s.mini === 'Manual', JSON.stringify(s));
  killAll(); w.close();
  // maratona rodando em 3 de 7: depois de recarregar continua e mostra quantas faltam
  store.cppSettings = Object.assign({}, store.cppSettings, { marathonOn: true, marathonTotal: 7, marathonDone: 3, marathonPending: false, autoMove: true });
  w = await load(); s = st(w);
  check('maratona rodando: mostra 4 restantes', s.n === '4' && s.nmini === '4', s.n + '/' + s.nmini);
  check('maratona rodando: continua em play', store.cppSettings.marathonOn === true);
  w.document.querySelector('#cpp-mini-mar-stop').click(); await sleep(100);
  s = st(w);
  check('parada: contador volta a 7', s.n === '7' && s.nmini === '7', s.n + '/' + s.nmini);
  killAll(); w.close();
  w = await load(); s = st(w);
  check('depois de parar e recarregar: continua parada com 7', store.cppSettings.marathonOn === false && s.n === '7', JSON.stringify(store.cppSettings));
  killAll(); w.close();
  console.log(fail ? fail + ' falha(s)' : 'Tudo OK');
  process.exit(fail ? 1 : 0);
})();
