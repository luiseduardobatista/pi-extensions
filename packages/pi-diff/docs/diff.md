# Diff de `write`/`edit` (estilo pi-diff)

O pipeline visual atual é preservado. A extensão apenas escolhe quantas linhas apresentar em cada estado; parsing, syntax highlighting, backgrounds, wrapping, word-level emphasis e caches continuam no mesmo fluxo.

## Fluxo

**`edit`**:

```text
EditToolDetails.diff
  → parseDiffLines(diff)
  → countDiffChanges(lines)
  → slice(0, DIFF_COLLAPSED_LINES ou EXPANDED_MAX_LINES)
  → DiffBody(lines, theme, true, lang)
```

**`write`**:

```text
args.content
  → previewLines(content, PREVIEW_LINES ou EXPANDED_MAX_LINES)
  → DiffLine kind "add"
  → DiffBody(...)
```

Os limites fixos são:

- `PREVIEW_LINES = 8` para o conteúdo recolhido de `write`;
- `DIFF_COLLAPSED_LINES = 24` para o diff recolhido de `edit`;
- `EXPANDED_MAX_LINES = 4000` para expansões aplicáveis;
- wrapping sempre ligado;
- nenhum hint adicional de truncamento.

## Parsing

O diff oficial do Pi é convertido em `DiffLine[]`:

- `+<num> <conteúdo>` → `add`;
- `-<num> <conteúdo>` → `del`;
- ` <num> <conteúdo>` → `ctx`;
- linha de espaços seguida de `...` → `gap`.

Números com padding são normalizados, conteúdos preservam espaços e gaps derivam a quantidade de linhas omitidas dos vizinhos numerados.

## Renderização

- O gutter mantém barra `▌`, número e sinal textual.
- Linhas adicionadas e removidas mantêm backgrounds e os tokens de tema `toolDiffAdded` e `toolDiffRemoved`.
- O contexto permanece com o tratamento visual `dim`.
- O fundo do gutter é mais escuro; a ênfase word-level usa a variante mais clara.
- Tabs viram três espaços antes do realce, ênfase e renderização final.
- Em terminal estreito, wrapping preserva a coluna do gutter nas continuações.

A paleta de backgrounds é fechada em `diff-palette.ts`; nenhuma cor literal é introduzida no renderer.

## Ênfase word-level e syntax highlighting

Pares imediatos de linhas removida/adicionada são comparados por palavras quando passam pelo filtro de similaridade. As faixas dos dois lados ficam em cache LRU. O realce de sintaxe ocorre por blocos contíguos e reinjeta o background depois dos resets ANSI.

`DiffBody` implementa `Component`, invalida caches por largura e mantém o cache LRU de realce. Essas propriedades são parte da identidade visual e não devem ser substituídas por um diff simplificado.
