# pi-effort

Extensão Pi que fornece o comando `/effort` para mudar o nível de thinking
do modelo atual.

## Comando `/effort`

Ao executar o comando, a extensão consulta os níveis de thinking suportados
pelo modelo atual e exibe uma seleção. O nível atual é marcado na lista. Ao
confirmar uma opção, o nível é aplicado ao Pi e a interface mostra uma
notificação.

Se não houver modelo selecionado, o comando informa um erro. Cancelar a
seleção não altera o nível configurado.

A descoberta dos níveis depende de `getSupportedThinkingLevels`, fornecido em
`@earendil-works/pi-ai` e executado contra o modelo em uso. A extensão não
mantém uma lista própria de níveis; o comportamento acompanha o runtime e o
adaptador do modelo atual.

## Mapa de módulos

- `index.ts` — ponto de entrada e registro do comando `/effort`.
- `package.json` — manifesto do pacote, peers do runtime e declaração da
  extensão Pi.
- `README.md` — documentação do pacote.

## Convenções

- Código TypeScript cru, sem etapa de build própria.
- O pacote usa o `tsconfig.base.json` da raiz; não há `tsconfig.json` local.
- Comentários e documentação ficam em PT-BR, com indentação por tabs.
- Imports relativos, quando necessários, usam a extensão `.ts`.
- As APIs do Pi são declaradas como `peerDependencies`; o runtime fornece as
  implementações.
