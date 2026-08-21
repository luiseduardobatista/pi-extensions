# btw

Extensão `/btw` para o Pi: pergunta lateral sem poluir a conversa principal.

`/btw <pergunta>` abre um painel na parte de baixo do terminal com a resposta
do **mesmo modelo da sessão**, que tem acesso a **ferramentas somente-leitura**
(`read`, `grep`, `find`, `ls`) para verificar código e arquivos. A resposta
nunca entra no transcript e nunca toca em disco — roda numa sessão de agente em
memória (`SessionManager.inMemory`).

## Instalação

Este pacote registra a extensão declarada em `index.ts`. No Pi, instale o pacote
no ambiente de extensões e use:

```
/reload
```

## Uso

```
/btw por que trocamos sockets por SSE na semana passada?
/btw            # reabre o painel na última troca
```

O comando executa mesmo enquanto o agente principal está trabalhando; o `Esc`
cancela apenas a pergunta lateral, sem interromper a sessão principal.

### Teclas do painel

| Tecla | Ação |
| --- | --- |
| `Esc` | Cancela a chamada em voo e dispensa o painel |
| `Space` / `Enter` | Dispensa (depois que a resposta chega) |
| `↑` / `↓` · `k` / `j` | Rola o conteúdo — `↓`/`j` desce para ver o restante, `↑`/`k` volta ao topo |
| `←` / `→` · `h` / `l` | Navega entre respostas anteriores (`h`/`l` = vim) |
| `c` | Copia a resposta exibida (markdown raw) |
| `x` | Limpa o histórico de `/btw` da sessão |

## Comportamento

- **Contexto:** o modelo lateral recebe a conversa principal (snapshot do
  branch, atualizado a cada `message_end`) e as **20 trocas `/btw` mais
  recentes** (pergunta + resposta) — follow-ups têm contexto.
- **Orçamento:** se o branch não couber com folga na janela do modelo (75%), a
  pergunta vai sem o branch — o histórico `/btw` e a pergunta sempre entram.
- **Painel:** altura fixa (50% do terminal), ancorado embaixo; conteúdo
  ancorado no topo (perguntas sempre visíveis), footer de teclas pinado no
  fim; se o conteúdo passar da altura, `↓` desce para ver o restante e `↑`
  volta — a lista de perguntas não some ao navegar com `←/→`.
- **Histórico:** as 5 perguntas mais recentes aparecem em `muted` acima da
  resposta (a atual em destaque), com `…e N mais antigas`; `←/→` navegam pelas
  respostas antigas e a janela expande para manter o destaque visível. O
  footer de teclas fica fixo no fim do painel. Perguntas e respostas ficam em
  memória (`globalThis`), sobrevivem a `/new`, `/fork`, `/resume` e `/reload`,
  e somem quando o Pi fecha — nada é persistido em disco.
- **Streaming:** a resposta aparece no painel enquanto é gerada, com linha de
  status da ferramenta em uso (`lendo lib.ts…`), renderizada em markdown.

## Estrutura

```
index.ts              — entry: registra o comando + hooks
btw.ts                — estado, contexto, sessão lateral, execução
btw-ui.ts             — overlay bottom-anchored e teclas
prompts/btw-system.txt — system prompt do modelo lateral
```

## Validação

Na raiz do monorepo:

```
npm test
npm run typecheck
```

Ou apenas este pacote:

```
node --test "packages/pi-btw/*.test.ts"
```
