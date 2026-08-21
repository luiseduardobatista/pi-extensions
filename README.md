# pi-extensions

Minhas extensões do PI

## Extensões

| Extensão | O que faz |
| --- | --- |
| `pi-header` | Header no topo da sessão: nome/versão do Pi, modelo em uso, nível de thinking e diretório atual. Re-renderiza quando o modelo ou o thinking mudam. |
| `pi-footer` | Rodapé compacto (até 2 linhas): identidade na primeira (provider/model, thinking, cwd/branch) e consumo na segunda (uso de contexto, tokens, t/s). |
| `pi-tool-renderers` | Re-registra as 5 ferramentas de execução/exploração (`bash`, `read`, `grep`, `find`, `ls`) com apresentação própria: resultados indentados, resumo de saída longa e erros visíveis. A execução continua sendo a oficial do Pi. |
| `pi-diff` | Renderização de `write` e `edit` com o pipeline visual de diff: gutter com números/sinais/cores, syntax highlighting e ênfase word-level. A execução continua sendo a oficial do Pi. |
| `pi-todo` | Tool `todo` (list/add/toggle/delete/clear) + widget persistente acima do editor com o andamento (`Todos (N/M)`). Sobrevive a `/reload` e compactação; o estado é reconstruído do transcript. |
| `pi-questionnaire` | Tool `questionnaire`: faz 1+ perguntas ao usuário com opções. Uma pergunta vira uma lista simples; várias viram interface com abas + página de revisão/submissão. Permite resposta livre digitada. |
| `pi-btw` | Comando `/btw`: pergunta lateral para o mesmo modelo sem poluir a conversa principal. O histórico fica no lado, num overlay. |
| `pi-lsp` | Tool `lsp()`: consultas semânticas (definição, referências, hover, símbolos, code actions, rename) via language server iniciado sob demanda, com instalação isolada por servidor. |
| `pi-worktree` | Comando `/worktree <branch>`: cria ou reusa um git worktree da branch informada (em `.worktrees/<branch>`) e troca a sessão do Pi para ele. |
| `pi-effort` | Comando `/effort`: muda o nível de thinking do modelo atual. |

## Código compartilhado

| Módulo | O que é |
| --- | --- |
| `pi-ui-shared` | Código compartilhado entre as extensões de UI: formatação/apresentação (largura visível, paths, uso de contexto, política do Bash, títulos e erros) e o pipeline de diff word-level (parsing, paleta de cores, gutter, realce). **Não é uma extensão** — não registra tool, comando ou widget; `pi-header`, `pi-footer`, `pi-tool-renderers` e `pi-diff` importam dela por nome. |

## Como usar

```bash
npm install          # uma vez (workspaces + symlinks)
npm run typecheck    # typecheck de tudo
npm test             # suíte node:test de tudo
```
