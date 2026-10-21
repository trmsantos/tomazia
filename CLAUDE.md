# Bar da Tomazia

Site do Bar da Tomazia, em Estarreja: ementa pública, WiFi, eventos, galeria com moderação e área de gestão para o dono. Substitui o site PHP antigo.

- Especificação (fonte de verdade): `docs/ESPECIFICACAO.md`
- Tarefas, uma por PR: `docs/TAREFAS.md`
- Decisões: `docs/decisoes/`
- Como trabalhar com os agentes: `docs/AGENTES.md`

## Quem decide

O Tomás decide tudo sobre a app e é o único que faz merge. O dono do bar paga e usa a área de gestão. Se uma tarefa não diz o suficiente, pergunta ao Tomás. Não inventes requisitos nem factos sobre o bar.

## Stack

- `backend/`: Python 3.11+, FastAPI, SQLAlchemy 2, Alembic, SQLite, Pillow, argon2-cffi, gerido com uv. Em produção corre no Passenger do cPanel através do a2wsgi, montado em `/api`.
- `frontend/`: React + TypeScript + Vite + Tailwind. Compila no CI; o Apache serve os ficheiros estáticos.
- Deploy: `deploy.yml` → branch `deploy` → API do cPanel → `deploy/deploy.sh`. Só corre depois do merge na `main`.

## Comandos

Backend (em `backend/`):

```bash
uv sync
uv run ruff check . && uv run ruff format --check .
uv run mypy app passenger_wsgi.py
uv run pytest
AMBIENTE=desenvolvimento uv run uvicorn app.main:app --reload --port 8070
```

`AMBIENTE` não tem valor por omissão: faltando, a app recusa arrancar. É o que
impede uma configuração em falta de ser tomada por desenvolvimento. Precisam
dela os comandos que constroem a app ou abrem a base de dados — `uvicorn`,
`python -m app.openapi` e o `alembic`. O `pytest`, o `ruff` e o `mypy` não,
porque as fixtures já a definem.

Frontend (em `frontend/`):

```bash
npm ci
npm run lint && npm run typecheck && npm test -- --run && npm run build
npm run gerar-api      # tipos TypeScript a partir do OpenAPI do backend
npx playwright test    # ponta a ponta
```

Tudo de uma vez: `/verificar`.

## Regras que não se quebram

1. Nunca ler, criar ou alterar `.env`, chaves, tokens ou a BD antiga (`bd_teste.db`). Em desenvolvimento usa os valores por omissão de `app/config.py` e dados falsos.
2. Nunca fazer push para `main` ou `deploy`, nunca force push, nunca `gh pr merge`.
3. Nunca contactar o servidor nem a API do cPanel. Os agentes vivem só no repositório.
4. `.claude/`, `CLAUDE.md`, `docs/`, `tests/` e `e2e/` nunca entram na pasta de deploy (critério S-12).
5. Cada falha de segurança corrigida ganha um teste em `backend/tests/seguranca/`.
6. Texto visível em português de Portugal: "ementa", "ficheiro", "eliminar", "Tem a certeza?". Nunca "cardápio", "arquivo", "deletar".
7. Migrações Alembic só acrescentam. Remover uma coluna é uma tarefa à parte, num deploy posterior.
8. Dependência nova só com uma linha de justificação no PR.
9. Ficheiros gerados (`frontend/src/lib/api/`, `backend/requirements.txt`) nunca se editam à mão.
10. Num guarda, "não encontrei" e "não consegui procurar" nunca podem dar o mesmo resultado. Em `grep`, `find`, `git` e no estado de saída de um processo, verificar o estado à mão em vez de o deixar cair num `if` — em bash, não-zero diz as duas coisas, e no `grep` o 1 e o 2 significam o oposto um do outro. Esta regra nasceu de sete instâncias reais neste projeto, todas descobertas em revisão e nenhuma apanhada por um teste de caminho feliz.

## Como se trabalha

- Uma tarefa de `docs/TAREFAS.md` = um branch `tarefa/<ID>-<slug>` = um PR.
- `/tarefa <ID>` faz o fluxo completo. `/pronto-para-merge` junta os revisores antes de abrir o PR.
- Agentes em `.claude/agents/`: arquiteto, qa, backend, frontend, ui-ux, dominio-bar, infra, revisor-codigo, revisor-seguranca.
- Commits em Conventional Commits, em português: `feat(ementa): pesquisa por nome`.
- PR com o template de `.github/pull_request_template.md`. Alterações visuais levam capturas de ecrã em 390×844.

## Definição de pronto

- `/verificar` verde.
- Testes novos para o comportamento novo; `backend/tests/seguranca` passa.
- revisor-codigo e revisor-seguranca com APROVADO; ui-ux com APROVADO se houve alteração visual.
- Se uma decisão da especificação mudou, há um ADR novo em `docs/decisoes/`.
