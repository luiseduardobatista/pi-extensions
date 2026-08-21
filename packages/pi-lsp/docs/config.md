# Configuração (`config.json`)

Referência da configuração da extensão lsp. Esta página descreve o
comportamento REAL do código (`config.ts`).

## Localização e resolução

O config é carregado **uma única vez** no ponto de carregamento da extensão
(`index.ts`, `loadConfig()`), de:

```text
<agentDir>/extensions/lsp/config.json
```

O `config.json` é versionado no repositório e mantém os defaults explícitos —
deve permanecer em sincronia com `DEFAULT_CONFIG` em `config.ts`.

O config é lido apenas no carregamento: mudanças no arquivo exigem recarregar
a extensão (`/reload`).

## Chaves

| Chave | Tipo | Default | Comportamento |
| --- | --- | --- | --- |
| `idleTimeoutMs` | inteiro ≥ 1 | `600000` | Inatividade sem chamadas `lsp()` após a qual o servidor é encerrado (`shutdown → exit → SIGTERM → SIGKILL`). Maior = menos cold start; menor = menos memória ocupada |
| `requestTimeoutMs` | inteiro ≥ 1 | `60000` | Prazo de cada request LSP (rejeição client-side garantida + `$/cancelRequest` de cortesia). Não cobre `initialize` (prazo próprio de 15 s) nem instalação (prazo de 120 s) |
| `cacheDir` | string (path) | `~/.cache/pi-lsp` | Diretório isolado de instalação dos servidores, manifest, locks e logs de debug. `~` é expandido; nunca instala globalmente |

## Semântica

- `idleTimeoutMs` afeta o trade-off latência × memória: o cold start real
  (spawn + initialize + indexação) leva de segundos a dezenas de segundos;
  manter o processo idle custa memória (centenas de MB para gopls/rust-analyzer).
- `cacheDir` não é limpo pela extensão; remover `servers/<family>` força
  reinstalação (ver [installer.md](installer.md)).
- O arquivo de debug por servidor fica em `<cacheDir>/debug/<comando>-<root>.log`
  (stderr do servidor — nunca chega ao agente).
