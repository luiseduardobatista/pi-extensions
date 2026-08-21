# pi-diff

## O que é

Extensão Pi que re-registra as tools `write` e `edit` com `renderShell: "self"`, preservando metadados oficiais e delegando a execução à factory original do Pi. A diferença está na apresentação: `write` transforma o conteúdo em linhas adicionadas e `edit` usa o diff oficial para contar alterações e gerar as linhas exibidas, renderizadas pelo pipeline visual de diff.

## Pipeline do diff

Parsing do diff oficial, contagens `(+N -M)`, gutter com barra/número/sinal, fundos da paleta fechada, syntax highlighting por blocos e ênfase word-level — a implementação compartilhada vive no `pi-ui-shared`. O fluxo completo está em [docs/diff.md](docs/diff.md).

## Mapa de módulos

- `index.ts` — ponto de entrada da extensão.
- `write-edit.ts` — `DiffBody`, `registerWriteTool` e `registerEditTool`.
- `docs/diff.md` — pipeline visual usado por `write` e `edit`.
- `pi-ui-shared` — helpers, parsing e implementação compartilhada do diff.

## Convenções

- Código TypeScript cru, sem build e sem testes próprios neste pacote.
- Imports relativos usam extensão `.ts`; imports entre pacotes usam o nome do pacote, como `pi-ui-shared`.
- Comentários e documentação ficam em PT-BR, com tabs para indentação.
- A execução, os parâmetros, as atualizações parciais, o cancelamento e os detalhes estruturados das factories oficiais não são alterados.