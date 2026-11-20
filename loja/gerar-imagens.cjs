// GERA AS IMAGENS DA LOJA a partir da interface REAL da extensão (HTML e CSS de src/),
// em loja/imagens/:
//   icone-128.png           ícone da loja
//   captura-1-painel.png    1280x800  o painel de análise
//   captura-2-idiomas.png   1280x800  o popup com a lista de idiomas e o botão do café
//   bloco-440x280.png       bloco promocional pequeno
//
// uso: node loja/gerar-imagens.cjs        (precisa do Edge instalado; usa o modo sem janela)
//
// As imagens são montagens da interface verdadeira com dados de exemplo (o painel roda o content.js
// de verdade num DOM simulado). Para uma captura de uma partida de verdade, tire-a no Chess.com
// com a janela em 1280x800 e troque por ela na loja.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const SRC = path.join(RAIZ, 'src');
const OUT = path.join(__dirname, 'imagens');
const TMP = path.join(OUT, '_html');
fs.mkdirSync(TMP, { recursive: true });

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
if (!EDGE) { console.log('Edge não encontrado.'); process.exit(1); }

// ---------- 1) roda a extensão num DOM simulado e guarda o painel pronto
const integ = fs.readFileSync(path.join(RAIZ, 'ferramentas/teste/integ.js'), 'utf8').replace(/\r\n/g, '\n');
const head = integ.slice(0, integ.indexOf('\n(async () => {'));
const main = `
(async () => {
  await sleep(2600);
  win.chrome.runtime.getManifest = () => ({ version: '1.10.3' });
  win.I18N.setLang('en');
  await sleep(800);
  const p = doc.getElementById('chess-position-panel');
  p.querySelector('.cpp-minimize').click();
  await sleep(3500);
  const pn = doc.getElementById('chess-position-panel');
  const st = doc.getElementById('cpp-lp-style');
  fs.writeFileSync(process.env.PAINEL_OUT, (st ? '<style>' + st.textContent + '</style>' : '') + pn.outerHTML);
  process.exit(0);
})();
`;
const tmpTeste = path.join(RAIZ, 'ferramentas/teste/_tmp-captura.js');
fs.writeFileSync(tmpTeste, head + main);
const painelOut = path.join(TMP, 'painel.html.txt');
const r = spawnSync(process.execPath, [tmpTeste, SRC], { env: { ...process.env, PAINEL_OUT: painelOut }, encoding: 'utf8', timeout: 60000 });
fs.rmSync(tmpTeste, { force: true });
if (!fs.existsSync(painelOut)) { console.log('Falhou ao montar o painel:\n' + (r.stderr || r.stdout)); process.exit(1); }
const painel = fs.readFileSync(painelOut, 'utf8').replace(/src="[^"]*crown\.png"/g, 'src="' + pathToFileURL(path.join(SRC, 'icons/crown.png')) + '"');

function pathToFileURL(p) { return 'file:///' + p.replace(/\\/g, '/'); }
const css = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

// ---------- 2) o popup real, já com a lista de idiomas aberta
const { JSDOM } = require(path.join(RAIZ, 'ferramentas/teste/node_modules/jsdom'));
async function popupHtml(lang, abrirLista) {
  const html = fs.readFileSync(path.join(SRC, 'popup.html'), 'utf8').replace(/<script src="[^"]+"><\/script>/g, '').replace(/<link[^>]+stylesheet[^>]*>/, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'chrome-extension://x/popup.html' });
  const w = dom.window;
  w.chrome = {
    runtime: { lastError: null, getManifest: () => ({ version: JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8')).version }) },
    storage: { local: { get: (k, cb) => setTimeout(() => cb({ cppLang: lang, cppEnabled: true }), 10), set() {} }, onChanged: { addListener() {} } },
    tabs: { query: async () => [{ id: 1, url: 'https://www.chess.com/play/online' }], sendMessage: async () => ({ success: true }) },
  };
  for (const s of ['i18n.js', 'popup.js']) w.eval(fs.readFileSync(path.join(SRC, s), 'utf8'));
  await new Promise(r => setTimeout(r, 300));
  if (abrirLista) w.document.querySelector('.cpp-lp-btn').click();
  w.document.querySelectorAll('img').forEach(i => i.setAttribute('src', pathToFileURL(path.join(SRC, i.getAttribute('src')))));
  const style = w.document.createElement('style');
  style.textContent = css('popup.css');
  w.document.head.appendChild(style);
  const lp = w.document.getElementById('cpp-lp-style');
  return { body: w.document.body.innerHTML, lp: lp ? lp.textContent : '' };
}

// ---------- 3) páginas de montagem
const BASE = `*{margin:0;box-sizing:border-box}html,body{background:#121212}body{font-family:'Segoe UI',system-ui,sans-serif;color:#fff;overflow:hidden}
.bg{position:absolute;inset:0;background:radial-gradient(1200px 700px at 15% 10%,#24352a 0%,#151515 60%)}
h1{font-size:54px;line-height:1.08;font-weight:700;letter-spacing:-.5px}h1 em{font-style:normal;color:#4cd07d}
p.sub{font-size:24px;color:#c9c9c9;line-height:1.4;margin-top:18px}
ul.f{list-style:none;margin-top:26px;font-size:22px;color:#e8e8e8;line-height:1.9}ul.f li:before{content:'\\2713';color:#4cd07d;font-weight:700;margin-right:12px}
.note{position:absolute;left:70px;bottom:40px;font-size:15px;color:#8a8a8a;max-width:560px}`;

(async () => {
  const pop = await popupHtml('en', true);

  // captura 1: o painel
  fs.writeFileSync(path.join(TMP, 'c1.html'), `<!doctype html><meta charset="utf-8"><style>${BASE}${css('content.css')}
#chess-position-panel{position:absolute !important;left:auto !important;top:40px !important;right:70px !important;bottom:auto !important;transform:scale(1.0);transform-origin:top right;width:380px !important;max-height:720px !important;height:auto !important;overflow:hidden !important;border-radius:14px}
</style><div class="bg"></div>
<div style="position:absolute;left:70px;top:150px;width:600px"><h1>Best moves on the board, <em>in real time</em></h1>
<p class="sub">Stockfish runs inside your browser and draws arrows for the 3 best moves on Chess.com.</p>
<ul class="f"><li>Evaluation bar and clear verdicts</li><li>Optional auto-play, adjustable pace</li><li>7 languages</li></ul></div>
<div class="note">Meant for practice against bots. Using an engine against people violates Chess.com's rules. Use at your own risk.</div>
${painel}`);

  // captura 2: o popup com idiomas
  fs.writeFileSync(path.join(TMP, 'c2.html'), `<!doctype html><meta charset="utf-8"><style>${BASE}${css('popup.css')}
${pop.lp}
body.pop{width:280px}
.cap{position:absolute;left:70px;top:150px;width:540px}
.stage{position:absolute;right:120px;top:70px;width:320px;transform:scale(1.6);transform-origin:top right}
.stage .wrap{width:280px;background:#1a1a1a;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.cpp-lp{font-size:13px}
</style><div class="bg"></div>
<div class="cap"><h1>Speaks <em>your language</em></h1><p class="sub">English, 中文, Русский, Português, Español, Français and Italiano. Switch anytime, in the popup or in the panel.</p></div>
<div class="stage"><div class="wrap">${pop.body}</div></div>`);

  // bloco promocional 440x280
  fs.writeFileSync(path.join(TMP, 'b.html'), `<!doctype html><meta charset="utf-8"><style>${BASE}
.bg{background:radial-gradient(500px 300px at 20% 20%,#2c4a36 0%,#141414 70%)}
.c{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 34px}
.c img{width:64px;height:64px;margin-bottom:14px}.c h1{font-size:34px}.c p{font-size:16px;color:#cfcfcf;margin-top:10px;line-height:1.35}
</style><div class="bg"></div><div class="c"><img src="${pathToFileURL(path.join(SRC, 'icons/crown.png'))}"><h1>Chess Analyzer <em>Pro</em></h1><p>Stockfish arrows for the best moves, right on the board.</p></div>`);

  // ---------- 4) tira as fotos (Edge sem janela) e deixa em 24 bits, sem transparência
  const fotos = [['c1.html', 'captura-1-painel.png', 1280, 800], ['c2.html', 'captura-2-idiomas.png', 1280, 800], ['b.html', 'bloco-440x280.png', 440, 280]];
  for (const [h, saida, w, hh] of fotos) {
    const bruto = path.join(TMP, saida);
    spawnSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${w},${hh}`, `--screenshot=${bruto}`, pathToFileURL(path.join(TMP, h))], { timeout: 60000 });
    if (!fs.existsSync(bruto)) { console.log('Edge não gerou ' + saida); continue; }
    const ps = `Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Image]::FromFile('${bruto}'); $b=New-Object System.Drawing.Bitmap(${w},${hh},[System.Drawing.Imaging.PixelFormat]::Format24bppRgb); $g=[System.Drawing.Graphics]::FromImage($b); $g.Clear([System.Drawing.Color]::FromArgb(18,18,18)); $g.DrawImage($i,0,0,${w},${hh}); $b.Save('${path.join(OUT, saida)}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose(); $i.Dispose()`;
    spawnSync('powershell', ['-NoProfile', '-Command', ps], { timeout: 60000 });
    console.log('ok ' + saida + ' ' + w + 'x' + hh);
  }
  fs.copyFileSync(path.join(SRC, 'icons/icon128.png'), path.join(OUT, 'icone-128.png'));
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('Imagens em loja/imagens/');
})();
