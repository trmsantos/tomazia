---
name: tarefa
description: Executa uma tarefa de docs/TAREFAS.md de ponta a ponta, do branch ao PR aberto, usando os agentes do projeto.
argument-hint: "[ID da tarefa, por exemplo F2-03]"
disable-model-invocation: true
allowed-tools: Bash(git status*) Bash(git switch *) Bash(git pull --ff-only*) Bash(git add *) Bash(git commit *) Bash(git push -u origin tarefa/*) Bash(gh pr create *)
---

Executa a tarefa **$ARGUMENTS** de `docs/TAREFAS.md`.

1. Confirma que a árvore está limpa (`git status`). Atualiza a `main` com `git switch main && git pull --ff-only`.
2. Cria o branch `tarefa/$ARGUMENTS-<slug-curto>` com `git switch -c`.
3. Pede ao agente **arquiteto** o plano da tarefa. Se ele disser que falta uma dependência, para e reporta ao Tomás.
4. Se a tarefa toca em ecrãs, texto visível ou fluxos do dono, pede ao **ui-ux** a especificação do ecrã e ao **dominio-bar** que valide texto e fluxo. Integra as correções no plano.
5. Pede ao **qa** os testes que definem "feito". Confirma que falham pela razão certa.
6. Implementa com o agente certo (**backend**, **frontend** ou **infra**) pela ordem do plano. Backend primeiro quando há contrato novo; depois `npm run gerar-api`.
7. Corre `/verificar` e corrige até estar verde.
8. Corre `/pronto-para-merge`. Se o veredito for PRECISA DE ALTERAÇÕES, corrige com o agente certo e repete. Ao fim de duas voltas sem aprovação, para e mostra ao Tomás o que falta.
9. Faz commit em Conventional Commits, em português, e `git push -u origin` do branch.
10. Abre o PR com `gh pr create`, título `<ID> <título da tarefa>`, corpo segundo `.github/pull_request_template.md`, com os vereditos dos revisores e as capturas de ecrã.

Nunca faças merge, push para `main` ou `deploy`, nem force push. O PR fica à espera do Tomás.
