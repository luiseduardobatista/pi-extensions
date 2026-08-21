# Verificação da extensão lsp (checklist de sessão real)

Checklist adaptado do issue #5 + spec `docs/lsp-spec.md` (§7). Rode numa sessão
real do Pi com a extensão carregada (auto-descoberta em `extensions/`), usando
um projeto Go (gopls já instalado) e o próprio pi-setup (TypeScript — instala
`typescript-language-server` com confirmação na primeira chamada).

## Pré-requisito

- [ ] `cd ~/.pi/agent && git pull` (extensão presente) e `/reload` na sessão
- [ ] `npm run typecheck:lsp` e `npm run test:lsp` passam (41 testes)

## 1. Ausência total quando não usado

- [ ] Iniciar uma sessão e trabalhar normalmente **sem chamar `lsp(...)`**:
      `pgrep -f "gopls|rust-analyzer|typescript-language-server|pyright"` não retorna
      nada iniciado pela extensão; nada de LSP no transcript.
- [ ] `read`, `write`, `edit`, saves, mudança de cwd e exploração textual:
      nenhuma atividade LSP (pgrep continua vazio; nenhum arquivo em
      `~/.cache/pi-lsp/debug/` é criado para a sessão).

## 2. Startup sob demanda e resposta compacta

- [ ] Chamar `lsp(action="capabilities")` sem file → lista estática (PATH +
      manifest), sem processo iniciado.
- [ ] `lsp(action="capabilities", file="<arquivo>.go")` → inicia gopls sob
      demanda e retorna capabilities compactas (encoding, sync, operações).
- [ ] Primeira chamada em TS → confirmação na UI ("instalar
      typescript-language-server...") → instala em `~/.cache/pi-lsp/servers/ts/`
      (nunca global) e prossegue; manifest registra versão + sha256.
- [ ] Chamada seguinte em TS não pede confirmação de novo.

## 3. Operações de leitura (Go, gopls)

- [ ] `definition` num símbolo importado/cross-file → `arquivo:linha:col` +
      trecho (1-based).
- [ ] `references` → lista com cap; `hover` → tipo/doc; `symbols` (+`query`) →
      nome/kind/linha.
- [ ] Operação não anunciada pelo servidor → erro acionável ("consulte
      capabilities") antes do request.

## 4. Fronteira do tool

- [ ] Durante chamadas e no idle, provocar diagnostics/progress (editar um
      arquivo Go com erro): **nenhum** diagnostic/progress/log aparece no
      retorno do tool nem no transcript.
- [ ] `definition` não traz diagnostics, code actions nem dados não solicitados.
- [ ] stderr do servidor vai só para `~/.cache/pi-lsp/debug/`.

## 5. Reuso, idle e shutdown

- [ ] Chamadas consecutivas dentro do idle (3 min) reutilizam o mesmo processo
      (pgrep mostra um único PID estável).
- [ ] Sem chamadas → após o idle, processo some (shutdown/exit; pgrep vazio).
- [ ] Nova chamada após shutdown reinicia transparente.

## 6. Code actions (fluxo obrigatório)

- [ ] `code_actions` num local com quickfix (ex.: import não usado em Go) →
      lista com id, título, kind, preview de arquivos/ranges; **nenhum arquivo
      alterado, nenhum command executado**.
- [ ] Ação marcada como preferida **não** é aplicada automaticamente.
- [ ] Ação tipo Command aparece com "efeito não totalmente previsível".
- [ ] `apply_code_action` com o id → aplica exatamente a ação escolhida; resumo
      do que mudou; conteúdo do disco conferido.
- [ ] Reaplicar a mesma ação (ou aplicar após editar o arquivo) → falha clara
      ("stale"), sem recalcular nem substituir.
- [ ] Edits de servidor para fora do root (testável com fixture) → erro, zero
      escrita.

## 7. Rename

- [ ] `rename` sem `apply` → preview (arquivos/ranges), **nada alterado**.
- [ ] `rename` com `apply=true` → aplica (multi-arquivo quando for o caso) e
      retorna resumo real.
- [ ] `rename` com símbolo inexistente → erro propagado, nada escrito.

## 8. Robustez

- [ ] Matar o servidor (kill) no meio → próxima chamada reinicia; sessão intacta.
- [ ] Cancelar uma chamada longa (Esc) → cleanup sem órfãos.
- [ ] `/reload` da sessão → processos encerrados (pgrep vazio) — hook
      `session_shutdown`.
- [ ] Resultados grandes (ex.: `references` com muitos hits) → truncados com
      aviso, nunca dump ilimitado.

## 9. Não-regressão

- [ ] `npm run typecheck:better-ui` e os checks normais do repo continuam
      passando; typecheck/lint/build/test seguem sendo a validação final.
- [ ] Posições com texto não-ASCII/emoji (fixture) → colunas corretas
      (1-based, encoding negociado).
