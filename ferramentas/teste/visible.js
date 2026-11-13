// visible.js: com a aba "escondida" os temporizadores e o rAF continuam andando (via worker simulado).
const fs = require('fs');
const { JSDOM } = require('jsdom');
const SRC = process.argv[2];
const code = fs.readFileSync(SRC + '\\visible.js', 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fail = 0;
const check = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'OK   ' : 'FAIL ') + n + (ok || x === undefined ? '' : '  -> ' + x)); };

(async () => {
  const dom = new JSDOM('<body></body>', { url: 'https://www.chess.com/', runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  let hidden = true;
  Object.defineProperty(win.Document.prototype, 'hidden', { get: () => hidden, configurable: true });
  Object.defineProperty(win.Document.prototype, 'visibilityState', { get: () => hidden ? 'hidden' : 'visible', configurable: true });
  // "worker" simulado com temporizadores reais do Node
  const blobs = new Map(); let bn = 0;
  win.Blob = class { constructor(p) { this.t = p.join(''); } };
  win.URL.createObjectURL = b => { const u = 'blob:' + (++bn); blobs.set(u, b.t); return u; };
  win.Worker = class {
    constructor() { this.t = new Map(); }
    postMessage(d) {
      if (d.c === 'to') this.t.set(d.id, setTimeout(() => { this.t.delete(d.id); this.onmessage && this.onmessage({ data: d.id }); }, d.ms));
      else if (d.c === 'iv') this.t.set(d.id, setInterval(() => this.onmessage && this.onmessage({ data: d.id }), d.ms));
      else { clearTimeout(this.t.get(d.id)); clearInterval(this.t.get(d.id)); }
    }
  };
  win.eval(code);
  check('document.hidden parece falso', win.document.hidden === false);
  check('visibilityState parece visible', win.document.visibilityState === 'visible');
  let a = 0, b = 0, c = 0, d = 0;
  win.setTimeout(() => a++, 20);
  const iv = win.setInterval(() => b++, 20);
  win.requestAnimationFrame(() => c++);
  const t2 = win.setTimeout(() => d++, 20); win.clearTimeout(t2);
  await sleep(250);
  win.clearInterval(iv);
  const b1 = b; await sleep(100);
  check('setTimeout dispara', a === 1, a);
  check('setInterval repete e para', b >= 3 && b === b1, b + '/' + b1);
  check('clearTimeout cancela', d === 0, d);
  check('requestAnimationFrame roda com a aba escondida', c === 1, c);
  hidden = false;
  let e = 0; win.setTimeout(() => e++, 20); await sleep(120);
  check('aba visível: setTimeout normal', e === 1, e);
  console.log(fail ? fail + ' falha(s)' : 'Tudo OK');
  process.exit(fail ? 1 : 0);
})();
