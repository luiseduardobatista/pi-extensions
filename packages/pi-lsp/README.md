# pi-lsp

Extensão lazy e agent-driven de LSP semântico para o Pi. Expõe um único tool
`lsp(...)` que o agente chama explicitamente quando precisa de informação
semântica que `grep`/`find`/`read` não resolvem: definição real de símbolos
(aliases/re-exports), referências semânticas, implementações de interface,
tipos inferidos, hover, símbolos, code actions ou rename com conhecimento do
projeto.

Não é uma IDE dentro do Pi: **nenhuma atividade LSP acontece sem chamada
explícita do agente**. Nenhum hook de evento, nenhum auto-start, nenhum daemon,
nenhum diagnostics automático. Quando o tool não é chamado, o custo é
praticamente zero.

## Invariantes centrais

1. **Ativação exclusivamente explícita** — toda atividade LSP é consequência
   direta de uma chamada do agente ao tool `lsp(...)`. A única exceção é um
   hook passivo de `session_shutdown` usado somente para encerrar os processos
   já iniciados por chamadas explícitas.
2. **Fronteira do tool** — notificações espontâneas do servidor (diagnostics,
   progress, logs, telemetria) nunca chegam ao agente; cada chamada retorna
   somente a informação da operação solicitada, normalizada e truncada.
3. **Servidores sob demanda** — detectados no PATH; se ausentes, instalados no
   diretório isolado da extensão (`~/.cache/pi-lsp/`, configurável), com
   confirmação na UI na primeira instalação de cada servidor. Nunca instalado
   globalmente. Reutilizados entre chamadas próximas; encerrados após idle
   (default 3 min) ou no fim da sessão.
4. **Mutações com política restrita** — `WorkspaceEdit` só é aplicado para
   arquivos dentro do root autorizado; resource operations e mistura de formas
   são rejeitadas; ranges são validados antes de qualquer escrita.
5. **Validação intacta** — typecheck, lint, build e testes continuam sendo a
   fonte de verdade; `lsp()` nunca os substitui.

## Como funciona

```text
agente trabalha normalmente (grep/find/read)
        ↓
identifica uma dúvida que depende de semântica
        ↓
chama lsp(...)
        ↓
extensão resolve linguagem + root + servidor (PATH → instalação confirmada)
        ↓
inicia o servidor sob demanda → initialize → didOpen → executa a operação
        ↓
resposta normalizada e truncada (só o que foi pedido)
        ↓
chamadas próximas reutilizam o processo; sem chamadas → idle 3 min → shutdown
```

## Mapa de módulos

| Arquivo | Responsabilidade |
| --- | --- |
| `index.ts` | Ponto único de carregamento: registra o tool `lsp(...)` (schema completo + guidelines) e o hook passivo `session_shutdown` (cleanup) |
| `config.ts` | `LspConfig` (tipos), `DEFAULT_CONFIG` e `loadConfig` (lê o `config.json` do pacote; nunca lança), `expandHome` |
| `config.json` | Defaults versionados (espelham `DEFAULT_CONFIG` em `config.ts`) |
| `servers.ts` | Mapa de servidores v1 (família, languageId por extensão, marcadores de root, hint de instalação), `specForFile`, `nearestMarkerRoot`/`gitRootFor`/`resolveRoot` (algoritmo fechado), `findInPath` |
| `installer.ts` | Instalação sob demanda isolada: canais npm (`--ignore-scripts` obrigatório), GitHub release e `go install` (GOBIN privado); confirmação por servidor registrada no manifest (atômico); lock cross-process; SHA256 verificado no reuso; `tsserverLibPath`/`sectionResponder` (config do TLS via `workspace/configuration`) |
| `client.ts` | Conexão JSON-RPC (vscode-jsonrpc) sobre stdio; fronteira §3.4 (notificações consumidas internamente, server→client requests com respostas exatas, `MethodNotFound` para desconhecidos); timeout/abort client-side com `$/cancelRequest`; `applyEditFlow` (interceptação de `workspace/applyEdit` no fluxo de Command) |
| `server-manager.ts` | Ciclo de vida: um processo por (família, root); dedupe de startup; leases + idle timer; escada `shutdown → exit → SIGTERM → SIGKILL`; cleanup em falha de initialize/spawn; restart pós-crash; `shutdownAll` (session_shutdown) |
| `sync.ts` | Sync de documento (spec §3.3.6): `didOpen` uma vez por URI, resync por hash/versão respeitando o `TextDocumentSyncKind` (Full/Incremental), `markDocumentText` (notifica o servidor após mutações próprias) |
| `positions.ts` | Posições 1-based (humano) → LSP 0-based; unidades do encoding negociado (utf-16 default, utf-8 quando anunciado); validação de linha/coluna |
| `ops.ts` | Dispatch das operações + normalização/truncamento; helpers puros exportados (caps, `toLocs`, `hoverText`, `flattenSymbols`, `symbolKindName`) |
| `actions.ts` | Code actions: consulta read-only com id opaco e preview; `apply_code_action` com re-consulta no local original e match exato por fingerprint; `runCommandFlow` (executa Command com `workspace/applyEdit` interceptado) |
| `apply.ts` | Política de `WorkspaceEdit`: somente URIs `file:` canônicas dentro do root autorizado; rejeição de resource ops e mistura `changes`/`documentChanges`; validação de ranges/versões; aplicação por arquivo via `withFileMutationQueue` em ordem canônica |
| `*.test.ts` | Suites `node --test` (servers, installer, ops, apply, mutation, lifecycle com fake LSP server) |
| `test/fake-server.mjs` | Fake LSP server determinístico (initialize/shutdown/exit/slow) para testes de lifecycle |
| `VERIFICATION.md` | Checklist de verificação em sessão real (adaptado do issue #5) |
| `tsconfig.base.json` (raiz) | Typecheck estrito compartilhado pelo monorepo |

## Documentação

| Página | Conteúdo |
| --- | --- |
| [docs/tool.md](docs/tool.md) | Contrato completo do tool: parâmetros, operações, formatos de resposta, posições, erros |
| [docs/agent-guide.md](docs/agent-guide.md) | Guia de bolso para agentes de IA: quando usar, receitas, armadilhas |
| [docs/lifecycle.md](docs/lifecycle.md) | Ciclo de vida dos servidores: regras de concorrência, idle/shutdown, sync de documento, fronteira |
| [docs/installer.md](docs/installer.md) | Instalação de servidores: canais, isolamento, confirmação, manifest, atualização |
| [docs/config.md](docs/config.md) | Referência do `config.json` |
| [VERIFICATION.md](VERIFICATION.md) | Checklist de verificação em sessão real |

Os contratos e invariantes originais estão refletidos na documentação deste pacote.

## Como testar

Na raiz do monorepo (`/home/luisb/projects/pi-extensions`):

```bash
npm run typecheck        # tsc compartilhado do monorepo
npm test                 # testes de todos os pacotes
```

Para o checklist de sessão real (Go + TS), ver `VERIFICATION.md`.
