# pi-todo

Extensão Pi de lista de tarefas. Registra a ferramenta `todo` e um widget
persistente acima do editor com o andamento (`Todos (N/M)`).

## Ferramentas

### todo

Gerencia uma lista de tarefas. Ações: `list`, `add`, `toggle`, `delete`, `clear`.
Status: `pending` → `in_progress` → `completed`.

- `list` — lista as tarefas atuais.
- `add` (text) — adiciona uma tarefa como `pending`.
- `toggle` (id, status?) — alterna o status (`pending` → `in_progress` →
  `completed` → `pending`) ou aplica um status explícito.
- `delete` (id) — remove uma tarefa.
- `clear` — limpa a lista.

### Orientações para o agente

- Use `todo` para trabalho com várias etapas (≥3 passos). Mantenha ≤5 itens.
- Marque `in_progress` ANTES de começar a trabalhar no item.
- Marque `completed` IMEDIATAMENTE quando terminar.

## Widget

O widget `todos` aparece acima do editor quando há tarefas ativas:

```text
● Todos (2/3)
├─ ✓ Done
├─ ◐ Working
└─ ○ Pending
```

Quando a lista fica vazia, o widget é removido. O estado é reconstruído a
partir do transcript (mensagens `todo` da sessão), inclusive após `/tree`,
`/compact` e `/reload`.

## Mapa de módulos

| Arquivo | Responsabilidade |
| --- | --- |
| `index.ts` | Ponto de carregamento da extensão |
| `todo.ts` | Ferramenta `todo` e widget persistente de tarefas |

## Como testar

Este pacote não possui testes próprios. Na raiz do monorepo, execute:

```bash
npm run typecheck
npm test
```

O typecheck cobre todos os pacotes, e os testes usam o `node:test` configurado
na raiz.

## Convenções

- Comentários e docstrings em PT-BR.
- Tabs para indentação em código TypeScript.
- Imports relativos com extensão `.ts`.
- Dependências declaradas no `package.json` do pacote.
- Cores da interface via tokens do tema.
