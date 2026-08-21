# Ciclo de vida dos servidores

Como a extensão inicia, reutiliza e encerra language servers. Esta página
descreve o comportamento REAL do código (`server-manager.ts`, `client.ts`,
`sync.ts`); a especificação de referência é `docs/lsp-spec.md` (§3.3).

## Princípio

Nenhuma atividade LSP acontece sem chamada explícita do agente. O único hook
de sessão é o passivo `session_shutdown` (cleanup de processos próprios) — ele
nunca inicia servidor.

## Resolução e startup (primeira chamada)

1. Linguagem por extensão do arquivo (`servers.ts`).
2. Root: marcador da linguagem mais próximo (`tsconfig.json`, `go.mod`,
   `Cargo.toml`, ...), fallback git root, fallback diretório do arquivo.
3. Binário: PATH → diretório isolado (manifest) → instalação com confirmação
   (ver [installer.md](installer.md)).
4. `spawn` (gate: só cria a conexão após o evento `'spawn'` — spawn falho
   nunca deixa write em stream morto) → `initialize` (anuncia
   `workspace.applyEdit`, `positionEncodings: ["utf-16"]`) → `initialized` →
   `didOpen` do arquivo-alvo → executa **somente** a operação pedida.

## Regras de concorrência

- **Um processo por chave (família, root)** — `ts` + `/proj/a` e `ts` +
  `/proj/b` são servidores distintos; JS e TS compartilham família.
- **Dedupe de startup** — duas chamadas paralelas na mesma chave aguardam a
  mesma promise; nunca dois processos.
- **Requests serializados por processo** (fila interna); cancelamento
  (`signal` do tool) cancela **somente a request afetada** via `$/cancelRequest`.
- **Leases** — cada chamada segura uma lease; o idle timer só é armado com zero
  leases e é cancelado por qualquer chamada nova.

## Idle e shutdown

- Idle default: **3 min** (configurável, `idleTimeoutMs`).
- Escada de término com prazos: `shutdown` request → `exit` notification →
  `SIGTERM` (2 s) → `SIGKILL`. Conexão e disposers encerrados no fim.
- Chamada que chega durante o shutdown aguarda o término e reinicia.
- Nova chamada após shutdown reinicia transparente (cold start).

## Fim de sessão

O hook `session_shutdown` (reasons `quit`/`reload`/`new`/`resume`/`fork`)
aguarda startups em andamento e encerra todos os servidores gerenciados pela
escada acima. Consequências:

- servidores **não sobrevivem** entre sessões — cada sessão começa com zero processos;
- o cache de code actions morre junto (ids antigos falham com erro claro);
- requests em voo são rejeitados pelo fechamento da conexão (erro acionável, sessão intacta).

**Limitação documentada**: se o processo do Pi morrer sem disparar o evento
(`kill -9`, crash), o hook não roda e o idle timer morre junto — os filhos
podem ficar órfãos (não-detached não garante morte no Unix). Aceito na v1.

## Crash do servidor

`exit` inesperado marca o processo como `dead` e o remove do registro; a
próxima chamada reinicia. Requests pendentes são rejeitados pelo fechamento da
conexão. Erros de escrita (EPIPE) e falhas de spawn são consumidos — nunca
derrubam o processo do Pi.

## Sync de documento (`sync.ts`)

Antes de cada request, o arquivo é relido do disco e comparado com o registro
por URI (texto + versão monotônica):

- primeira vez: `didOpen` (uma única vez por URI);
- mudou: `didChange` respeitando o `TextDocumentSyncKind` negociado — `Full`
  envia o texto completo sem range; `Incremental` envia substituição do range
  integral anterior; `None`/sem `openClose` → erro acionável (o servidor não
  acompanha edições);
- após mutações próprias (`apply_code_action`/`rename`), o servidor é notificado
  (`markDocumentText`) — o estado nunca fica stale entre chamadas.

## Fronteira (`client.ts`)

- Notificações espontâneas (diagnostics, progress, log, telemetria): consumidas
  internamente e descartadas — **nunca** no retorno do tool nem no contexto.
  Diagnostics ficam apenas como estado interno para enriquecer
  `context.diagnostics` do `codeAction` (quickfixes).
- Server→client requests com respostas exatas: `workspace/configuration`
  (seções conhecidas respondem — ex.: `typescript-language-server` →
  `tsserver.path` do TS isolado), `workspace/workspaceFolders`,
  `client/registerCapability` (rejeitado — `dynamicRegistration: false`
  anunciado), `window/workDoneProgress/create` (ack),
  `workspace/applyEdit` (aplicado **somente** no fluxo de execução de Command do
  `apply_code_action`; fora dele → `applied: false` + failureReason);
  desconhecidos → `MethodNotFound` (nunca pendentes).
- Timeout de request (default 60 s) e abort por signal: rejeição client-side
  garantida + `$/cancelRequest` de cortesia.
