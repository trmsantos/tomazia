# 0002. Agentes só no repositório

- Data: 2026-10-20
- Estado: aceite

## Contexto

O desenvolvimento é feito com agentes do Claude Code (arquitetura, testes, implementação, design, domínio, infraestrutura e revisões). O site antigo foi comprometido por falhas simples e por segredos no repositório. O Tomás decide tudo sobre a app e é o único que faz merge.

## Decisão

Os agentes vivem em `.claude/` e trabalham só sobre o repositório e o GitHub. Nunca falam com o servidor, nunca leem segredos e nunca fazem merge. A única ligação a produção é o `deploy.yml`, que corre depois de um merge na `main`, com secrets do ambiente `production`.

## Consequências

- Os hooks e as regras de permissão do Claude Code, mais as regras do GitHub, bloqueiam push para `main` e `deploy`, force push, merge, `.env` e pedidos ao cPanel.
- A pasta de deploy exclui `.claude/`, `CLAUDE.md`, `docs/`, `tests/` e `e2e/`, e o CI verifica-o (S-12).
- A revisão dos agentes no GitHub é consultiva; o que bloqueia o merge é o CI e a decisão do Tomás.

## Alternativas consideradas

- Dar aos agentes acesso ao Terminal do cPanel para diagnosticar problemas: rejeitado, porque um erro ou uma instrução injetada teria impacto direto em produção.
- Deixar os agentes fazer merge quando o CI e os revisores aprovam: rejeitado, porque o Tomás quer decidir cada alteração.
