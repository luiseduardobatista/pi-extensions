# Worktree

Cria ou reutiliza um git worktree para a branch informada e troca a sessão do Pi para ele.

## Uso

```text
/worktree <branch>
```

O nome da branch é usado exatamente como informado. O diretório do worktree espelha o nome da branch, incluindo subdiretórios quando houver `/`.

## Exemplos

```text
/worktree fix/issue-1
/worktree feature/auth/login-form
/worktree hotfix/v1.2.0
```

## Comportamento

1. Valida que você está dentro de um repositório Git.
2. Valida o nome da branch.
3. Cria a branch se ela não existir, ou reutiliza a branch existente.
4. Cria o diretório `.worktrees/<branch>` na raiz do repositório.
5. Executa `git worktree add` para criar o worktree nesse diretório.
6. Cria ou reutiliza a sessão do Pi e troca para o worktree.

Se o diretório já existir, a extensão verifica se ele é um worktree válido do mesmo repositório antes de reutilizá-lo. Alterações e comandos posteriores ficam no worktree selecionado.

## Caminho dos worktrees

Os worktrees ficam em `.worktrees/<branch>` na raiz do repositório. O caminho espelha o nome da branch:

```text
/worktree feature/auth/login-form
# cria .worktrees/feature/auth/login-form/
```

Para entrar manualmente em outro terminal:

```bash
cd .worktrees/feature/auth/login-form/
```

## Fluxo com tmux

Cada pane pode executar uma sessão do Pi em um worktree diferente:

Pane 1:

```text
/worktree fix/issue-1
```

Pane 2:

```text
/worktree feat/add-login
```

Pane 3:

```text
/worktree chore/update-deps
```

Cada sessão do Pi opera isolada no seu worktree.

## Dois terminais no mesmo worktree

Você pode abrir um terminal extra no mesmo worktree. Não precisa executar `git checkout`: o worktree já está na branch correta.

```text
Pane 1: Pi executando no worktree fix/issue-1
Pane 2: cd .worktrees/fix/issue-1/ && git diff
```

## `git push`

O push funciona normalmente dentro do worktree:

```bash
git commit -m "mensagem"
git push origin fix/issue-1
```

## `git worktree list`

Lista todos os worktrees do repositório:

```bash
git worktree list
```
