// Confere as traduções: todas as frases existem nos 7 idiomas, os {campos} batem com o português,
// e toda chave usada no código (tr('...') e data-i18n) existe no dicionário.
// uso: node i18n.js "<pasta src>"
const fs = require('fs');
const path = require('path');
const SRC = process.argv[2];
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

global.window = { document: { documentElement: {} } };
global.chrome = undefined;
const code = read('i18n.js');
eval(code);
const I = window.I18N;
const CODES = ['pt', 'en', 'ru', 'zh', 'es', 'fr', 'it'];   // posição de cada idioma nas frases
let bad = 0;
const fail = (m) => { bad++; console.log('FAIL ' + m); };

// o dicionário não é exportado: extrai o objeto T do próprio arquivo
const T = new Function(code.replace(/^[\s\S]*?const T = /, 'return ').replace(/\n    \};[\s\S]*$/, '\n    };'))();
const keys = Object.keys(T);
console.log('frases:', keys.length, 'idiomas:', I.LANGS.map(l => l.code).join(','));

const fields = (s) => (s.match(/\{(\w+)\}/g) || []).sort().join(',');
for (const k of keys) {
  const e = T[k];
  if (e.length !== 7) { fail(k + ': ' + e.length + ' idiomas em vez de 7'); continue; }
  e.forEach((s, i) => {
    if (typeof s !== 'string' || !s.trim()) fail(k + ': vazio em ' + CODES[i]);
    else if (fields(s) !== fields(e[0])) fail(k + ': campos diferentes em ' + CODES[i] + ' (' + fields(s) + ' vs ' + fields(e[0]) + ')');
  });
  // ru e zh nunca podem ficar iguais ao português (esquecimento de tradução), salvo frases curtas
  if (e[0].length > 12) [2, 3].forEach(i => { if (e[i] === e[0]) fail(k + ': ' + CODES[i] + ' igual ao português'); });
}

const used = new Set();
for (const f of ['content.js', 'popup.js', 'donate.js']) {
  const s = read(f);
  for (const m of s.matchAll(/\btr\('([^']+)'/g)) used.add(m[1]);
  for (const m of s.matchAll(/I\.t\('([^']+)'/g)) used.add(m[1]);
}
for (const f of ['popup.html', 'donate.html']) {
  for (const m of read(f).matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]);
}
// chaves montadas por prefixo no código (pace.<x>, style.<x> etc.) contam como usadas
const dyn = /^(pace\.|style\.|a\.ev\.|u\.leg)/;
for (const k of used) if (!T[k]) fail('chave usada e inexistente: ' + k);
const unused = keys.filter(k => !used.has(k) && !dyn.test(k));
console.log('usadas:', used.size, '| sem uso:', unused.join(', ') || '-');

// ordem da lista suspensa: inglês, chinês, russo, português (Brasil), depois os outros
if (I.LANGS.map(l => l.code).join(',') !== 'en,zh,ru,pt,es,fr,it') fail('ordem da lista: ' + I.LANGS.map(l => l.code).join(','));
if (!/Brasil/.test(I.LANGS.find(l => l.code === 'pt').name)) fail('português deve ser Português (Brasil)');
for (const l of I.LANGS) if (!/<svg/.test(I.flagSvg(l.code)) || /#555/.test(I.flagSvg(l.code))) fail('sem bandeira: ' + l.code);

// troca de idioma na prática
I.setLang('en'); if (I.t('p.coffee') !== 'Buy me a coffee') fail('en: p.coffee');
I.setLang('zh'); if (I.t('p.coffee') !== '请我喝杯咖啡') fail('zh: p.coffee');
I.setLang('ru'); if (I.num(1.5, 1) !== '1,5') fail('ru: vírgula decimal');
I.setLang('en'); if (I.num(1.5, 1) !== '1.5') fail('en: ponto decimal');
I.setLang('xx'); if (I.getLang() !== 'pt' && I.getLang() !== 'en') fail('idioma inválido não voltou ao padrão');
console.log(bad ? bad + ' falha(s)' : 'Tudo OK');
process.exit(bad ? 1 : 0);
