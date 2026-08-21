# Renderers de ferramentas (`tools.ts`)

A extensão re-registra somente as cinco ferramentas internas de exploração/execução do Pi e altera apenas a apresentação dos resultados. `write` e `edit` vivem no pacote `pi-diff`.

## Registro e execução

Cada ferramenta é criada pela factory oficial e re-registrada com o mesmo nome:

| Ferramenta | Factory oficial |
| --- | --- |
| `bash` | `createBashTool(cwd)` |
| `read` | `createReadTool(cwd)` |
| `grep` | `createGrepTool(cwd)` |
| `find` | `createFindTool(cwd)` |
| `ls` | `createLsTool(cwd)` |

O registro preserva `label`, `description`, `parameters`, `promptSnippet` e `promptGuidelines` oficiais, usa `renderShell: "self"` e delega `execute(toolCallId, params, signal, onUpdate)` sem alterar parâmetros, atualizações parciais, cancelamento ou detalhes estruturados. O tool `mcp` não é re-registrado.

## Calls

As calls de exploração são compactas e usam os verbos `Read`, `Search`, `Find` e `List`. A call Bash usa `Ran`. (No pi-diff, `write` e `edit` usam `Added` e `Edited`.)

- Paths são encurtados somente na apresentação: cwd vira `.`, caminhos sob cwd ficam relativos, caminhos sob home usam `~/` e caminhos absolutos longos usam os últimos segmentos.
- O Bash pode omitir um prefixo `cd <cwd>` e encurtar um `cd` longo apenas na exibição.
- A call Bash multilinha é a exceção deliberada à regra de uma linha: o comando completo permanece visível, incluindo heredocs e scripts inline.
- O comando e os paths reais continuam intactos na execução e na sessão.

## Resultados

O conteúdo recolhido segue uma política fixa:

- Bash vazio não mostra corpo nem marcador. Uma a três linhas aparecem na ordem original; acima disso aparece somente `N lines`. Atualizações parciais não mostram corpo.
- Em erro Bash, o status aparece imediatamente. O corpo detalhado só aparece na expansão.
- Calls recolhidas de `read`, `grep`, `find` e `ls` mostram somente a call. Erros continuam visíveis junto dela.
- A expansão de `read` mostra o conteúdo numerado visualmente; imagens mostram `Image loaded`.
- A expansão de `grep`, `find` e `ls` mostra apenas as linhas do resultado, sem resumo.
- Resultados de exploração e `read` usam no máximo 4000 linhas na apresentação. Hints adicionais não são fabricados.

A expansão Bash usa diretamente o texto entregue pela factory oficial: o renderer não aplica uma segunda truncagem, não remove footers oficiais e não substitui o resultado por resumo. Metadata e footers oficiais permanecem disponíveis conforme o contrato da factory.

## O que preservar ao alterar um renderer

1. Conteúdo e `details` oficiais não devem ser fabricados nem alterados.
2. `onUpdate` e `signal` devem continuar chegando à factory oficial.
3. Erros importantes devem permanecer visíveis.
4. A expansão deve revelar o resultado oficial dentro dos limites fixos previstos para aquela ferramenta.
5. `renderShell: "self"` e os metadados de prompt oficiais devem permanecer.
6. Nenhuma ferramenta externa ou superfície do Pi deve ser substituída.
