# pi-footer

## O que é

Extensão Pi com um footer compacto, migrado da extensão `better-ui`.

## Comportamento

O footer ocupa até duas linhas:

- identidade: provider/model, nível de thinking, diretório de trabalho e branch;
- consumo: tokens de entrada e saída, contexto atual e velocidade em t/s.

Os itens são priorizados por largura disponível para manter as informações mais importantes visíveis.

## Mapa de módulos

- `index.ts`: ponto de entrada da extensão Pi.
- `footer.ts`: instalação, coleta de estado e renderização do footer.

## Convenções

- O pacote usa TypeScript nativo do monorepo e módulo ES.
- Helpers compartilhados são importados por nome de `pi-ui-shared`.
- A extensão é carregada pelo campo `pi.extensions` do `package.json`.
