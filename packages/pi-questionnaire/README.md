# pi-questionnaire

Extensão de perguntas para o Pi. Registra a tool `questionnaire`, que
pergunta ao usuário uma ou várias questões com opções.

## Tools

### questionnaire

- `questions` — lista de questões. Para uma pergunta, mostra uma lista de
  opções simples; para várias, mostra uma interface com abas e página final
  de revisão/submissão.

Cada questão tem:

- `id` (obrigatório) — identificador único.
- `prompt` (obrigatório) — texto completo da pergunta.
- `options` (obrigatório) — opções com `value` e `label`.
- `label` (opcional) — rótulo curto da aba (padrão: `Q1`, `Q2`, …).
- `allowOther` (opcional, padrão `true`) — oferece a opção de digitar
  uma resposta livre.

Se você recomenda uma opção específica, coloque-a em primeiro lugar e
acrescente `(Recommended)` ao rótulo.

### Navegação

- Lista simples: `↑↓` navega, `Enter` confirma, `Esc` cancela.
- Com abas: `Tab`/`←`/`→` (ou `h`/`l`) navega entre abas, `↑↓` (ou `j`/`k`)
  escolhe a opção, `Enter` confirma e `Esc` cancela.

## Comportamento

- Requer modo TUI (`ctx.mode === "tui"`); em modo não-interativo retorna erro.
- O resultado vem nos `details` (`answers` e `cancelled`). Ao cancelar,
  o conteúdo informa "User cancelled the questionnaire".

## Mapa de módulos

| Arquivo | Responsabilidade |
| --- | --- |
| `index.ts` | Ponto de carregamento da extensão |
| `questionnaire.ts` | Tool de perguntas, editor de opções e interface com abas |

## Como testar

Execute os comandos a partir da raiz do monorepo:

```bash
npm test
npm run typecheck
```

## Convenções

- Comentários e docstrings em PT-BR.
- Tabs para indentação em código TS.
- Imports relativos com extensão `.ts`.
- Cores da interface via tokens do tema.
