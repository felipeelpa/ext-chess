# Como publicar e atualizar na Chrome Web Store

## Como a atualização automática funciona (e o que não funciona)

O Chrome **só atualiza sozinho extensões instaladas pela loja**. Um endereço de atualização no GitHub
(`update_url`) não funciona para usuários comuns: no Windows e no Mac o Chrome não instala nem atualiza
extensões de fora da loja (só em máquinas de empresa, com política de administrador).

O caminho é:

```
você muda o código  →  sobe a versão em src/manifest.json  →  git push
        →  o GitHub gera o pacote e envia para a loja (workflow .github/workflows/publicar.yml)
        →  o Google revisa (de horas a alguns dias)  →  o Chrome de cada usuário atualiza sozinho
```

Ninguém precisa fazer nada, mas **não é instantâneo**: depende da aprovação do Google.
O Edge também aceita o mesmo pacote (Microsoft Edge Add-ons, sem taxa de registro), com envio separado.

## Antes da primeira vez (uma vez só)

1. **Conta de desenvolvedor** na Chrome Web Store: taxa única de US$ 5. Use um e-mail só para isso
   (não dá para trocá-lo depois).
2. **Primeiro envio é manual.** O automático só funciona para uma extensão que já existe na loja.
   - Gere o pacote: `node ferramentas/empacotar.mjs` → `dist/chess-analyzer-pro-<versão>.zip`
   - No painel da loja, "Novo item", envie o .zip.
3. **Aba "Listagem":** nome, descrição curta e completa por idioma (copie de `loja/descricao.md`),
   ícone de 128 px (já está no pacote), **pelo menos 1 captura de tela** (1280×800 ou 640×400),
   imagem promocional pequena (440×280) e categoria.
4. **Aba "Práticas de privacidade":**
   - *Propósito único:* "Analisar partidas do Chess.com com o Stockfish e mostrar os melhores lances."
   - *Permissões:* `storage` — guardar as configurações; acesso a `*.chess.com` — ler o tabuleiro e
     exibir as setas e o painel nas páginas do Chess.com.
   - *Código remoto:* não (o motor vem dentro do pacote).
   - *Dados do usuário:* declare que não coleta nem transmite; informe o link da política de privacidade.
5. **Política de privacidade com link público.** Ative o GitHub Pages do repositório (Settings → Pages,
   branch `main`, pasta `/loja`) ou use qualquer página sua. O texto está em `loja/privacidade.md`.
6. **Guarde o ID da extensão** (aparece no painel depois do primeiro envio).

## Ligar o envio automático

O envio usa a API da loja, que exige 4 dados. Guie-se pela documentação oficial
(https://developer.chrome.com/docs/webstore/using-api) e pelo `chrome-webstore-upload-cli`:

| Segredo no GitHub (Settings → Secrets → Actions) | O que é |
|---|---|
| `CWS_EXTENSION_ID` | o ID da extensão na loja |
| `CWS_CLIENT_ID` | ID do cliente OAuth criado no Google Cloud |
| `CWS_CLIENT_SECRET` | segredo desse cliente |
| `CWS_REFRESH_TOKEN` | token de atualização, obtido autorizando a conta que é dona da extensão |

Sem esses segredos o workflow só gera o pacote (não dá erro). **Nunca coloque esses valores no código.**

## Rotina a cada correção

1. Mude o código e teste (`node ferramentas/teste/i18n.js "<pasta src>"` e a suíte `integ.js`).
2. **Suba o número da versão** em `src/manifest.json` (a loja recusa a mesma versão duas vezes).
3. `git commit` e `git push`.
4. O workflow envia; acompanhe em GitHub → Actions e no painel da loja. Se o Google reprovar, o e-mail
   da conta de desenvolvedor recebe o motivo.

Se você fizer um push sem subir a versão, o workflow avisa e não publica nada.

## Cuidados que valem antes de publicar

- **Origem do código.** A pasta `original/` e o popup antigo ("Desenvolvido por Shakar Mustafa") indicam
  que a extensão nasceu de outra. Confirme que você tem direito de publicar e de pedir doações; se houver
  licença, siga o que ela exige (normalmente manter o aviso de autoria).
- **Stockfish é GPLv3.** Mantenha o aviso do motor, deixe o código-fonte público (o link está na
  descrição) e cite o Stockfish.
- **Chess.com.** O uso do motor e da jogada automática contra pessoas viola as regras deles; o aviso de
  uso está no texto da loja. A empresa pode denunciar a extensão, e a loja pode removê-la.
- **Marca.** Não use o nome nem o logo do Chess.com no nome da extensão, no ícone ou nas imagens.
