# pi-tool-renderers

## O que é

Extensão Pi que re-registra as cinco ferramentas internas de exploração e execução (`bash`, `read`, `grep`, `find` e `ls`) com `renderShell: "self"`. Cada ferramenta é criada pela factory oficial do Pi, preservando seus metadados, e a execução continua delegada à factory original.

As tools `write` e `edit` (com o pipeline visual de diff) vivem na extensão **pi-diff**.

## Mapa de módulos

- `index.ts` — ponto de entrada da extensão.
- `tools.ts` — registro e renderização das cinco ferramentas.
- `docs/tool-renderers.md` — contrato e comportamento dos renderers.
- `pi-ui-shared` — helpers de apresentação compartilhados (e o pipeline de diff, usado pelo pi-diff).

## Convenções

- Código TypeScript cru, sem build e sem testes próprios neste pacote.
- Imports relativos usam extensão `.ts`; imports entre pacotes usam o nome do pacote, como `pi-ui-shared`.
- Comentários e documentação ficam em PT-BR, com tabs para indentação.
- A execução, os parâmetros, as atualizações parciais, o cancelamento e os detalhes estruturados das factories oficiais não são alterados.