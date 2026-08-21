# pi-header

## O que é

O `pi-header` é uma extensão Pi que instala um widget de header enquadrado. Ele exibe o nome e a versão do Pi, o modelo em uso, o nível de thinking e o diretório atual.

## Como funciona

O widget é instalado no início de cada sessão interativa (`session_start`). Ele solicita um novo render quando os eventos `model_select` ou `thinking_level_select` ocorrem, mantendo o modelo e o nível de thinking atualizados no header.

O código foi separado historicamente da extensão `better-ui`; este pacote é autônomo.

## Mapa de módulos

| Módulo | Responsabilidade |
| --- | --- |
| `index.ts` | Ponto de entrada da extensão e registro do header. |
| `header.ts` | Implementação do widget enquadrado e da renderização das informações. |

## Convenções

- Pacote npm em `packages/pi-header/`, sem build: o Pi carrega os arquivos `.ts` diretamente.
- Usa o `pi-ui-shared` por nome para os helpers de formatação compartilhados.
- Imports relativos incluem a extensão `.ts`.
- Não há testes neste pacote; a validação de tipos é feita pelo `tsconfig.base.json` da raiz.
- Comentários, docstrings e documentação seguem o padrão em PT-BR; a indentação usa tabs.
