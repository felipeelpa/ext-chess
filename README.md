# Ext Chess — Analisador de Xadrez Pro

Extensão de navegador (MV3) para o **Chess.com**: lê o tabuleiro da página,
roda o Stockfish ali mesmo e mostra as setas dos melhores lances. Também joga
sozinha, arrastando a peça como um jogador faria.

A parte interessante não é achar o melhor lance — o Stockfish faz isso — e sim
**não parecer um motor**: a extensão tem um perfil de erro por rating, tempo
de pensamento variável e ritmo configurável.

> Uso pessoal. Assistência de motor em partida valendo rating é proibida pelos
> termos do Chess.com.

---

## Instalar no navegador

1. Abra `edge://extensions` (ou `chrome://extensions`)
2. Ligue **Modo de desenvolvedor**
3. **Carregar descompactada** → selecione a pasta `src`

Não há build: o que está em `src/` é a extensão.

## Ferramentas necessárias

**Nenhuma ferramenta portátil.** O que a extensão precisa já vem dentro dela:
o motor é o `src/stockfish.js` (WASM, 1,5 MB, versionado aqui), e o resto é
HTML, CSS e JS puros.

| Ferramenta | Para quê | Onde |
|---|---|---|
| **Node.js** (18+) | rodar os testes em `ferramentas/teste` | <https://nodejs.org> — instalado na máquina, não portátil |
| **jsdom** | única dependência npm, usada pelos testes | `cd ferramentas/teste && npm install` |
| **Python 3 + TensorFlow** | *opcional*, só para o `chessboard-recognizer` em `original/` | não é usado pela extensão |

## Como está organizado

```
Ext Chess/
├── src/                      # A EXTENSÃO
│   ├── manifest.json          # MV3, versão 1.9.16
│   ├── content.js             # o cérebro: lê o tabuleiro, fala com o motor,
│   │                          # desenha as setas, escolhe e executa o lance
│   ├── chess-lite.js          # regras do xadrez (lances legais, xeque, FEN)
│   ├── stockfish.js           # o motor, em WASM
│   ├── visible.js             # roda no mundo MAIN: mantém temporizadores e
│   │                          # rAF andando com a aba em segundo plano
│   ├── content.css            # o painel e as setas
│   └── popup.html/.js/.css    # o popup da barra
├── ferramentas/teste/        # testes, todos em Node puro (jsdom/vm)
│   ├── integ.js               # integração: carrega o content.js de verdade
│   ├── fen.js                 # leitura do tabuleiro → FEN, inclusive roque
│   ├── chess.js               # as regras do chess-lite
│   ├── timing.js              # tempo de pensamento, ritmo e profundidade
│   ├── calibra.js             # calibra o perfil de erro por rating
│   ├── persist.js             # o painel lembra o que foi configurado
│   ├── visible.js             # a aba escondida continua analisando
│   └── build_visual.js        # gera visual.html com tabuleiro falso, para
│                              # conferir a aparência no navegador
└── original/                 # de onde isto saiu
    ├── (extensão base, antes das mudanças)
    └── chessboard-recognizer/ # reconhecimento de tabuleiro por imagem (CNN),
                               # de Linmiao Xu, MIT — referência, não é usado
```

## Rodar os testes

```bash
cd ferramentas/teste
npm install
node integ.js ../../src
node fen.js ../../src/content.js
node timing.js ../../src
node persist.js ../../src
node visible.js ../../src
node chess.js ../../src
```

Cada um imprime `OK`/`FAIL` por caso e não precisa de navegador: o `content.js`
é carregado de verdade dentro de um DOM simulado (jsdom) ou de um contexto
`vm` com um tabuleiro falso.

Para olhar o painel sem abrir o Chess.com:

```bash
node build_visual.js ../../src    # gera visual.html
```

## Como funciona

1. **Ler o tabuleiro** — `content.js` observa os elementos de peça da página e
   monta a posição. `positionToFEN` cuida do que o DOM não diz: de quem é a
   vez, direitos de roque, se o tabuleiro está invertido.
2. **Perguntar ao motor** — o Stockfish roda em WASM com MultiPV, para haver
   mais de um candidato e não só o lance perfeito.
3. **Escolher como um humano** — `errorProfile` e `chooseMoveWithErrors`
   sorteiam o lance dentro do que um jogador daquele rating escolheria, e
   `computeThinkTime` decide quanto demorar, olhando o relógio da partida e o
   controle de tempo.
4. **Executar** — arrastando a peça, não por clique programático.

O `calibra.js` existe para manter isso honesto com a régua: simula partidas de
cada rating e mede a precisão média pela fórmula do Lichess — rating 800 fica
na faixa de 60-70%, e o rating máximo acima de 90%.
