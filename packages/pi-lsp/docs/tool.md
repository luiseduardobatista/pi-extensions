# Tool `lsp(...)` — contrato

Referência do tool registrado pela extensão. Esta página descreve o
comportamento REAL do código (`ops.ts`, `actions.ts`); a especificação de
referência é `docs/lsp-spec.md`.

## Assinatura

```text
lsp(action, file?, line?, column?, new_name?, query?, apply?, id?)
```

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `action` | enum | sim | `definition` · `references` · `implementation` · `type_definition` · `hover` · `symbols` · `code_actions` · `apply_code_action` · `rename` · `capabilities` |
| `file` | string | operações posicionais e `symbols`; opcional em `capabilities` | Arquivo-alvo |
| `line` | inteiro ≥ 1 | operações posicionais | Linha 1-based do alvo |
| `column` | inteiro ≥ 1 | operações posicionais | Coluna 1-based do alvo |
| `new_name` | string | `rename` | Novo nome do símbolo |
| `query` | string | opcional | Filtro de exibição de `symbols` |
| `apply` | booleano | opcional | `rename`: `true` aplica; ausente/false retorna preview sem efeito |
| `id` | string | `apply_code_action` | Identificador opaco retornado por `code_actions` |

Posições de entrada e saída são **1-based** (humano). Internamente a extensão
converte para o LSP (0-based) nas unidades do encoding negociado (`utf-16` por
default; `utf-8` quando o servidor anuncia `positionEncoding: utf-8`).

## Operações

| Operação | Comportamento |
| --- | --- |
| `definition`, `implementation`, `type_definition` | `arquivo:linha:col` (1-based) + trecho da linha no disco; cap 5 resultados |
| `references` | arquivo + linha + trecho; cap 30 com aviso `… (N a mais)` |
| `hover` | tipo/documentação como texto puro (sem envelope JSON-RPC); cap 50 linhas |
| `symbols` | `nome (Kind, linha N)` por símbolo do arquivo (aninhados com indentação); `query` filtra por nome; cap 100 |
| `code_actions` | **read-only**: `[id] Título (preferida)?` + preview do efeito; edits mostram arquivos/ranges; commands declaram "efeito não totalmente previsível"; cap 20 |
| `apply_code_action` | Aplica **somente** a ação identificada; retorna resumo do que mudou |
| `rename` | Sem `apply`: preview **advisory** de arquivos + contagem de edits, zero efeito. Com `apply=true`: re-consulta o estado atual, aplica e resume |
| `capabilities` | Com `file`: capabilities negociadas do servidor (encoding, sync, operações) + caminho do binário. Sem `file`: lista estática de servidores instalados (PATH + manifest), **sem iniciar processo** |

### Exemplos de resposta

```text
lsp(action="definition", file="src/main.go", line=6, column=10)
→ /tmp/proj/math.go:4:6
  func Add(a, b int) int {

lsp(action="symbols", file="src/main.go", query="add")
→ Add (Function, linha 4)

lsp(action="code_actions", file="src/main.go", line=3, column=1)
→ [go-14-0-h7vgwaeg] Organize Imports
  edita:
  /tmp/proj/main.go: 1 edit(s)
  [go-14-1-...] Browse documentation for package main
  command — efeito não totalmente previsível; aplicável somente via apply_code_action explícito
```

## Erros

Todos os erros são **acionáveis** e nunca quebram a sessão:

- Posição inválida: `lsp: linha 99 fora do documento (6 linhas)` / `coluna 5 fora da linha 1 (3 colunas)` / `line deve ser inteiro 1-based`.
- Argumento ausente: `lsp: rename exige new_name` / `lsp: apply_code_action exige id (retornado por code_actions)`.
- Capacidade não anunciada: `lsp: servidor gopls não anuncia renameProvider — consulte capabilities`.
- Servidor ausente: erro com o comando de instalação manual (ou fluxo de instalação com confirmação na UI).
- **Stale** (code actions): `lsp: documento mudou desde a consulta — ação stale; reconsulte code_actions` ou `lsp: code action não resolvida com match exato na re-consulta — stale; reconsulte code_actions`.
- Stale de versão (WorkspaceEdit): `lsp: version do documento divergente (servidor=2, sincronizada=1) — ação stale`.
- Fora do root autorizado: `lsp: WorkspaceEdit tenta alterar arquivo fora do root autorizado: <path>` — nada é escrito.
- Formas não suportadas: `lsp: resource operation (create) no WorkspaceEdit — não suportado na v1` / `lsp: WorkspaceEdit mistura changes e documentChanges — não suportado na v1`.

## Truncamento

Nenhuma operação despeja resultados ilimitados. Toda lista é truncada com aviso
explícito `… (N a mais)`; os caps estão na tabela acima.

## Notas de uso para o agente

- `lsp()` é a última opção para **localizar** coisas; `grep`/`find`/`read` continuam preferidos para exploração textual.
- A primeira chamada para uma linguagem pode **instalar e iniciar** o servidor (segundos a minutos) — com confirmação na UI quando o servidor não está no PATH.
- `code_actions` **nunca** modifica nada; a aplicação exige `apply_code_action` com o id retornado.
- `rename` só altera arquivos com `apply=true`; o preview é informativo (o apply re-consulta o estado atual).
- Validação continua sendo typecheck/lint/build/test — `lsp()` não os substitui.
