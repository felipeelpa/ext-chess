// Gera visual.html: roda o content.js REAL numa página com tabuleiro falso e motor simulado,
// para conferir o visual no navegador. Uso: node build_visual.js <pasta src>
const fs = require('fs');
const path = require('path');
const src = process.argv[2];
const js = fs.readFileSync(path.join(src, 'content.js'), 'utf8');
const css = fs.readFileSync(path.join(src, 'content.css'), 'utf8');

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

const stubs = `
window.__score = { type: 'cp', value: 30 };
window.__goCount = 0;
window.chrome = { runtime: { getURL: x => x, onMessage: { addListener() {} } },
  storage: { local: { get: (k, cb) => cb({}), set() {} } } };
window.fetch = async () => ({ text: async () => '// fake' });
window.Worker = class {
  constructor() { this.isTimer = false; this.t = new Map(); }
  terminate() {}
  postMessage(m) {
    if (m && typeof m === 'object') {           // worker de temporizador
      const { cmd, id, ms } = m;
      if (cmd === 'timeout') this.t.set(id, setTimeout(() => { this.t.delete(id); this.onmessage && this.onmessage({ data: id }); }, ms));
      else if (cmd === 'interval') this.t.set(id, setInterval(() => this.onmessage && this.onmessage({ data: id }), ms));
      else if (cmd === 'clear') { clearTimeout(this.t.get(id)); clearInterval(this.t.get(id)); }
      return;
    }
    const say = (s) => setTimeout(() => this.onmessage && this.onmessage({ data: s }), 5);
    if (m === 'uci') say('uciok');
    if (m === 'isready') say('readyok');
    if (typeof m === 'string' && m.startsWith('go depth')) {
      window.__goCount++;
      const s = window.__score, d = m.split(' ')[2];
      say('info depth ' + d + ' multipv 1 score ' + s.type + ' ' + s.value + ' nodes 1 pv e2e4 e7e5');
      say('info depth ' + d + ' multipv 2 score cp ' + (s.type === 'cp' ? s.value - 60 : 0) + ' nodes 1 pv d2d4 d7d5');
      say('info depth ' + d + ' multipv 3 score cp ' + (s.type === 'cp' ? s.value - 90 : 0) + ' nodes 1 pv g1f3 g8f6');
      setTimeout(() => this.onmessage && this.onmessage({ data: 'bestmove e2e4' }), 40);
    }
  }
};
`;

const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Teste visual</title>
<style>body{margin:0;background:#262421;font-family:sans-serif}
.board{position:relative;width:360px;height:360px;margin:20px;background:#769656}
.piece{display:none}${css}</style></head><body>
<div class="board" id="b">${piecesHtml('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')}</div>
<script>${stubs}</script>
<script>${js}</script>
</body></html>`;
fs.writeFileSync(path.join(__dirname, 'visual.html'), html);
console.log('visual.html gerado (' + html.length + ' bytes)');
