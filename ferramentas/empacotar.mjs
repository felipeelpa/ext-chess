// GERA O .ZIP PARA ENVIAR À CHROME WEB STORE (e à Edge Add-ons).
//
//   node ferramentas/empacotar.mjs            -> dist/chess-analyzer-pro-<versao>.zip
//
// A loja quer o manifest.json na RAIZ do zip, então o conteúdo de src/ vai direto, sem a
// pasta "src". Nada de node_modules, testes ou a pasta original/ entra no pacote.
// Sem dependências: o zip é escrito aqui mesmo (deflate do próprio Node).
//
// Confere antes de empacotar: versão no formato da loja, ícones e arquivos citados no manifesto,
// e que o endereço de doação não está vazio.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(RAIZ, 'src');
const DIST = join(RAIZ, 'dist');

const erros = [];
const aviso = [];

// ---------- confere o manifesto
const manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
const versao = manifest.version;
if (!/^\d+(\.\d+){0,3}$/.test(versao || '')) erros.push('versão inválida no manifesto: ' + versao);
if (manifest.manifest_version !== 3) erros.push('a loja só aceita Manifest V3');
if (manifest.update_url) erros.push('remova "update_url" do manifesto: a Chrome Web Store atualiza por conta própria e recusa endereço de atualização próprio');
if (manifest.key) erros.push('remova "key" do manifesto: a loja gera a chave');

const citados = new Set();
const icones = Object.values(manifest.icons || {});
icones.forEach(i => citados.add(i));
Object.values((manifest.action && manifest.action.default_icon) || {}).forEach(i => citados.add(i));
if (manifest.action && manifest.action.default_popup) citados.add(manifest.action.default_popup);
if (manifest.background && manifest.background.service_worker) citados.add(manifest.background.service_worker);
for (const cs of manifest.content_scripts || []) [...(cs.js || []), ...(cs.css || [])].forEach(f => citados.add(f));
for (const w of manifest.web_accessible_resources || []) (w.resources || []).forEach(f => citados.add(f));
for (const f of citados) if (!existsSync(join(SRC, f))) erros.push('o manifesto cita um arquivo que não existe: ' + f);
if (!icones.includes('icons/icon128.png')) erros.push('falta o ícone de 128 px (icons/icon128.png)');

// nomes e descrições por idioma (_locales): cada __MSG_x__ do manifesto precisa existir em todos os idiomas
if (manifest.default_locale) {
  const pastas = existsSync(join(SRC, '_locales')) ? readdirSync(join(SRC, '_locales')) : [];
  if (!pastas.includes(manifest.default_locale)) erros.push('falta a pasta _locales/' + manifest.default_locale);
  const chaves = [...JSON.stringify(manifest).matchAll(/__MSG_(w+)__/g)].map(m => m[1]);
  for (const p of pastas) {
    const msgs = JSON.parse(readFileSync(join(SRC, '_locales', p, 'messages.json'), 'utf8'));
    for (const c of chaves) if (!msgs[c]) erros.push('_locales/' + p + ' sem a chave ' + c);
  }
  console.log('Idiomas da loja: ' + pastas.join(', '));
}

const cfg = readFileSync(join(SRC, 'donate-config.js'), 'utf8');
if (/CPP_BTC_ADDRESS\s*=\s*''/.test(cfg)) aviso.push('o endereço de doação está vazio (src/donate-config.js)');

if (erros.length) {
  console.log('NÃO EMPACOTEI:\n  - ' + erros.join('\n  - '));
  process.exit(1);
}

// ---------- junta os arquivos
const arquivos = [];
(function varrer(dir) {
  for (const nome of readdirSync(dir).sort()) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) varrer(p);
    else arquivos.push(p);
  }
})(SRC);

// ---------- zip
const tabelaCrc = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = tabelaCrc[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};

const DATA = 0x5A21;   // 2025-01-01 (data fixa: o mesmo conteúdo gera sempre o mesmo zip)
const HORA = 0x0000;
const locais = [];
const centrais = [];
let deslocamento = 0;
for (const arq of arquivos) {
  const nome = Buffer.from(relative(SRC, arq).split('\\').join('/'), 'utf8');
  const dados = readFileSync(arq);
  const comp = deflateRawSync(dados, { level: 9 });
  const usaDeflate = comp.length < dados.length;
  const corpo = usaDeflate ? comp : dados;
  const crc = crc32(dados);

  const loc = Buffer.alloc(30);
  loc.writeUInt32LE(0x04034b50, 0);
  loc.writeUInt16LE(20, 4);
  loc.writeUInt16LE(0x0800, 6);                 // nome em UTF-8
  loc.writeUInt16LE(usaDeflate ? 8 : 0, 8);
  loc.writeUInt16LE(HORA, 10);
  loc.writeUInt16LE(DATA, 12);
  loc.writeUInt32LE(crc, 14);
  loc.writeUInt32LE(corpo.length, 18);
  loc.writeUInt32LE(dados.length, 22);
  loc.writeUInt16LE(nome.length, 26);
  loc.writeUInt16LE(0, 28);
  locais.push(loc, nome, corpo);

  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(20, 4);
  cen.writeUInt16LE(20, 6);
  cen.writeUInt16LE(0x0800, 8);
  cen.writeUInt16LE(usaDeflate ? 8 : 0, 10);
  cen.writeUInt16LE(HORA, 12);
  cen.writeUInt16LE(DATA, 14);
  cen.writeUInt32LE(crc, 16);
  cen.writeUInt32LE(corpo.length, 20);
  cen.writeUInt32LE(dados.length, 24);
  cen.writeUInt16LE(nome.length, 28);
  cen.writeUInt32LE(deslocamento, 42);
  centrais.push(cen, nome);

  deslocamento += loc.length + nome.length + corpo.length;
}
const tamCentral = centrais.reduce((s, b) => s + b.length, 0);
const fim = Buffer.alloc(22);
fim.writeUInt32LE(0x06054b50, 0);
fim.writeUInt16LE(arquivos.length, 8);
fim.writeUInt16LE(arquivos.length, 10);
fim.writeUInt32LE(tamCentral, 12);
fim.writeUInt32LE(deslocamento, 16);

mkdirSync(DIST, { recursive: true });
const saida = join(DIST, `chess-analyzer-pro-${versao}.zip`);
writeFileSync(saida, Buffer.concat([...locais, ...centrais, fim]));

const kb = (statSync(saida).size / 1024).toFixed(0);
console.log(`Pacote: ${relative(RAIZ, saida)}  (${arquivos.length} arquivos, ${kb} KB, versão ${versao})`);
aviso.forEach(a => console.log('AVISO: ' + a));
