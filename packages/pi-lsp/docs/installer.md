# Instalação de servidores

Como a extensão resolve e instala language servers. Esta página descreve o
comportamento REAL do código (`installer.ts`, `servers.ts`); a especificação de
referência é `docs/lsp-spec.md` (§5.5).

## Resolução (em ordem)

Para cada chamada `lsp()` com arquivo, o binário do servidor é resolvido por:

1. **PATH** — servidores já instalados na máquina são usados como estão
   (ex.: `gopls`, `rust-analyzer`). Zero instalação.
2. **Diretório isolado** — se o manifest registra uma instalação anterior e o
   binário existe, reutiliza. O SHA256 registrado é **verificado no reuso**:
   binário corrompido → removido e reinstalado.
3. **Instalação sob demanda** — canal da família, com confirmação (abaixo).

## Isolamento

Tudo mora em `~/.cache/pi-lsp/` (configurável, `cacheDir`):

```text
~/.cache/pi-lsp/
├── manifest.json            # versão, canal, origem, sha256, confirmação (atômico)
├── servers/<family>/        # instalação por família
│   └── node_modules/.bin/   # canal npm (ou binário direto p/ github/go-install)
├── locks/                   # lock cross-process por instalação
└── debug/                   # stderr dos servidores (nunca vai ao agente)
```

Nada é instalado globalmente; o `PATH` do processo do servidor é prependido com
os diretórios privados da família. Nenhum outro aplicativo vê esses binários.

## Canais

| Família | Canal | O que instala |
| --- | --- | --- |
| `ts` | npm | `typescript-language-server` + `typescript@5` (pinado — TS7 não tem `tsserver.js`) |
| `py` | npm | `pyright` |
| `bash` | npm | `bash-language-server` |
| `yaml` | npm | `yaml-language-server` |
| `json`/`css`/`html` | npm | `vscode-langservers-extracted` (3 comandos do mesmo pacote, processo por linguagem) |
| `go` | `go install` | `gopls` (fallback quando não está no PATH; `GOBIN` privado) |
| `rs` | GitHub release | `rust-analyzer` (fallback; asset `latest` por plataforma, `.gz` descompactado) |

Regras do canal npm: **`--ignore-scripts` é obrigatório** — pacote que dependa
de lifecycle scripts falha com erro acionável, nunca fallback silencioso.

## Confirmação

A primeira instalação de cada servidor pede confirmação na UI
(`ctx.ui.confirm`): rede + software de terceiros, diretório destino, canal. A
decisão fica registrada no manifest (gravado atomicamente) — reinstalações
posteriores (binário corrompido/removido) **não** pedem de novo.

Sem UI (modos print/json): instalação não ocorre; o erro indica o comando de
instalação manual.

## Atualização

- Instala `latest` na primeira vez (com o pin de compatibilidade do `ts`).
- **Sem auto-update** — nunca verifica versões novas por conta própria.
- Para atualizar manualmente: apague o diretório da família
  (`rm -rf ~/.cache/pi-lsp/servers/<family>`) — a próxima chamada reinstala.

## Tipos e integração

- `typescript-language-server` (v5.x) resolve o TypeScript **via
  `workspace/configuration`** (seção `typescript-language-server`), não por
  flag CLI. A extensão responde essa seção com `{ tsserver: { path } }`
  apontando para o `typescript@5` isolado — o servidor TS funciona sem
  `node_modules` no projeto.

## Troubleshooting

| Sintoma | Causa provável | Ação |
| --- | --- | --- |
| `servidor X não encontrado no PATH ... Instale manualmente: ...` | Sem UI ou canal indisponível | Instale com o comando sugerido, ou rode numa sessão com UI para o fluxo de confirmação |
| `lsp: falha ao iniciar <bin>: ENOENT` | Binário sumiu entre resolução e spawn (raro) | Próxima chamada reinstala (manifest) |
| Servidor TS falha com "Could not find a valid TypeScript installation" | `typescript@7` instalado (instalação antiga) | `rm -rf ~/.cache/pi-lsp/servers/ts` — reinstala com `typescript@5` |
| Instalação npm falha | Pacote exige lifecycle scripts (`--ignore-scripts` obrigatório) | Instale manualmente o servidor; a extensão o encontrará no PATH |
| Download GitHub release falha | Rede/proxy/asset ausente para a plataforma | Instale o binário manualmente no PATH |
| `lock de instalação não adquirido` | Outra instalação em andamento (mesma família) | Aguarde e tente de novo |
