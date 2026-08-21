# Guia de bolso para agentes de IA

Como usar o tool `lsp(...)` sem ler a extensão inteira. Leia primeiro o
[README](../README.md) e o [contrato do tool](tool.md); esta página cobre
quando usar, receitas e armadilhas.

## Quando usar (e quando não)

**Use `lsp()` quando a informação é semântica e o texto não resolve:**

- a definição real de um símbolo sob aliases, re-exports ou resolução de módulos que `grep` não desambigua;
- referências **semânticas** (não matching textual) de um símbolo;
- implementações de interface ou método;
- o tipo inferido pelo compilador em vez de ler vários arquivos;
- hover com documentação no ponto exato;
- listar símbolos de um arquivo com filtro;
- code actions oferecidas pelo servidor num trecho;
- rename com conhecimento do projeto (preview antes de aplicar).

**Não use `lsp()` para:**

- localizar arquivos, buscar strings/configurações ou ler código conhecido — `grep`/`find`/`read`;
- validar correção — typecheck, lint, build e testes continuam sendo a fonte de verdade;
- consultas triviais em que o texto já responde (o custo de iniciar/manter um servidor não compensa).

## Custo real (leia antes de chamar)

- A primeira chamada para uma linguagem resolve o servidor: PATH primeiro; se ausente, **instala com confirmação na UI** (rede + software de terceiros, em `~/.cache/pi-lsp/`, nunca global).
- Startup + indexação levam de segundos a minutos em projetos grandes.
- Chamadas próximas reutilizam o processo; após o `idleTimeoutMs` do config (default 10 min, ajustável em `config.json`) sem chamadas o servidor é encerrado (cold start na próxima).
- Quando `lsp()` não é chamado, custo zero.

## Receitas

### Definir um símbolo ambíguo

```text
lsp(action="definition", file="src/foo.ts", line=12, column=18)
```

A cadeia call site → import → implementação exige duas chamadas quando o
primeiro resultado é uma re-exportação: repita no local retornado.

### Referências semânticas

```text
lsp(action="references", file="src/foo.ts", line=12, column=18)
```

Retorna declaração + usos reais (cap 30). Para muitos resultados, combine com
`grep` para o contexto textual completo.

### Code actions (fluxo obrigatório em 2 passos)

```text
lsp(action="code_actions", file="src/foo.ts", line=3, column=1)
→ [ts-14-0-abc123] Organize Imports
  edita: /proj/src/foo.ts: 1 edit(s)
```

1. `code_actions` é **read-only** — lista/preview, nunca modifica nada, nunca executa command.
2. Escolha **explicitamente** uma ação pelo id e aplique:

```text
lsp(action="apply_code_action", id="ts-14-0-abc123", file="src/foo.ts", line=3, column=1)
```

- Uma ação marcada como **preferida** não é aplicada automaticamente — a escolha é sua.
- Ações do tipo Command (sem edit) aparecem com "efeito não totalmente previsível"; se aplicadas, o servidor pode reportar mudanças via `workspace/applyEdit` (aplicadas com a mesma política de root).
- Se o arquivo mudou desde a consulta, o apply **falha** com erro stale — reconsulte `code_actions`.

### Rename (preview antes de aplicar)

```text
lsp(action="rename", file="src/foo.ts", line=12, column=18, new_name="bar")
→ preview (nada aplicado — chame com apply=true para aplicar):
  /proj/src/foo.ts: 3 edit(s)
  /proj/src/other.ts: 1 edit(s)
```

Revise o preview e aplique com `apply=true` (o apply re-consulta o estado atual;
o preview é informativo). O retorno resume o que mudou.

### Posição do símbolo

Posições são **1-based** (linha e coluna). A coluna precisa apontar para o
símbolo (não para o início da linha). Em dúvida, use `symbols` ou `grep -n`
para achar a linha exata e conte a coluna no conteúdo.

### Inspetar o que está instalado / as capacidades

```text
lsp(action="capabilities")                          # lista estática, sem iniciar processo
lsp(action="capabilities", file="src/foo.go")       # capabilities negociadas do servidor
```

## Armadilhas conhecidas

1. **Posições 1-based** — errar a coluna consulta o símbolo errado silenciosamente (ex.: `func main` em vez de `Add` na mesma linha). Confira com `symbols` ou leia a linha antes.
2. **Id de code action expira** — o cache é por processo do servidor; `/reload`, restart ou idle encerram o servidor → `apply_code_action` falha com erro claro → reconsulte.
3. **`symbols` é por arquivo** — `documentSymbol` retorna os símbolos do arquivo consultado, não do projeto todo.
4. **Primeira chamada pode demorar** — instalação + startup + indexação; avisar o usuário quando for a primeira na linguagem.
5. **Mudanças em disco são suas** — edições feitas por `apply_code_action`/`rename` são reais no disco; o servidor é notificado automaticamente (`didChange`), mas a validação final é typecheck/lint/build/test.
6. **Não confie no preview do rename como contrato** — o apply re-consulta o estado atual; se o arquivo mudou entre preview e apply, o resultado pode diferir (e o resumo mostra o que foi realmente aplicado).
7. **Diagnostics nunca aparecem** — o tool não expõe diagnostics/progress do servidor; para erros, rode o typecheck/compilador.
