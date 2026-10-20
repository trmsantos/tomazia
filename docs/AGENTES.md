# Como trabalhar com os agentes

Os agentes vivem em `.claude/` e só existem no repositório e no GitHub. Não vão para a dominios.pt e não têm forma de falar com o servidor: o único caminho para produção é o `deploy.yml`, depois de tu fazeres merge.

## Configuração, uma vez

1. Instala o Claude Code, o `gh` e o `jq` (`brew install gh jq`) e faz `gh auth login`.
2. O repositório é `trmsantos/tomazia`, privado. O antigo, `projetotomazia`, fica privado como arquivo do PHP.
3. No repositório, abre `claude` e corre `/install-github-app`. Escolhe o token da subscrição (fica no secret `CLAUDE_CODE_OAUTH_TOKEN`). Se te pedir para escolher workflows, não escolhas nenhum, ou fecha sem merge o PR que ele abrir: os workflows deste repositório já lá estão.
4. Regras de branch (Settings › Rules) para a `main` (só por PR, checks do `ci.yml`, sem force push) e para a `deploy` (só o GitHub Actions escreve). Em repositórios privados de contas pessoais isto exige GitHub Pro. Sem Pro, a proteção fica nos hooks do Claude Code e na tua disciplina de nunca fazer push direto.
5. Opcional: exporta o doc do plano para Markdown e guarda-o como `docs/PLANO.md`, para teres os diagramas e o contexto completo no repositório.

## Dia a dia

| Quero… | Faço |
| --- | --- |
| Fazer a próxima tarefa | `claude` na raiz e `/tarefa F2-03` |
| Ver se um branch está pronto | `/pronto-para-merge` |
| Correr tudo o que o CI corre | `/verificar` |
| Registar uma decisão | `/adr Mudar de SQLite para MariaDB` |
| Perguntar algo ao especialista | `@"dominio-bar (agent)" como se escreve galão na ementa?` |
| Pedir uma correção num PR | Comentar `@claude corrige o teste que falha` no PR |
| Fazer duas tarefas em paralelo | Um `git worktree` por tarefa (`git worktree add ../tomazia-F3-02 -b tarefa/F3-02-ementa`) e um `claude` em cada. Só tarefas que não mexem nos mesmos ficheiros |

Fluxo de uma tarefa: `/tarefa` → arquiteto planeia → qa escreve os testes → backend, frontend ou infra implementam → `/verificar` → revisores → PR aberto → CI e revisão Claude no GitHub → tu revês e fazes merge → deploy automático.

## O que os agentes não conseguem fazer

| Ação | Bloqueada por |
| --- | --- |
| Push para `main` ou `deploy`, force push | Regras de permissão, hook `proteger.sh` e regras do GitHub |
| Merge de PRs | Regra de permissão e hook |
| Ler ou criar `.env`, abrir a BD antiga | Regras de permissão e hook |
| Pedidos à API do cPanel, `ssh`, `scp` | Hook e regras de permissão |
| Levar `.claude/` ou `CLAUDE.md` para o servidor | `montar.sh` e o teste S-12 no CI |

## Custos

Cada PR que não seja rascunho dispara uma revisão com até quatro revisores. Com o token da subscrição, conta para os limites do teu plano. Para poupar, abre os PRs como rascunho enquanto trabalhas e marca "Ready for review" só no fim.

## Quando o veredito do Claude e o teu não coincidem

O veredito do Claude é consultivo. Se discordares de um bloqueante, responde no comentário com a razão. Se a razão for uma regra nova do projeto, acrescenta-a ao `CLAUDE.md` ou ao agente certo, para não voltar a aparecer.
