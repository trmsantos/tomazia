---
name: verificar
description: Corre localmente as mesmas verificações do CI, no backend e no frontend.
allowed-tools: Bash(uv sync*) Bash(uv run *) Bash(npm ci*) Bash(npm run *) Bash(npm test*) Bash(git diff --exit-code*)
---

Corre por esta ordem e para no primeiro passo que falhar. Mostra só o essencial do erro.

Backend, em `backend/`:

1. `uv sync --frozen`
2. `uv run ruff check .`
3. `uv run ruff format --check .`
4. `uv run mypy app passenger_wsgi.py`
5. `uv run pytest -q`

Frontend, em `frontend/`:

6. `npm ci`, só se `node_modules` não existir ou o `package-lock.json` mudou
7. `npm run lint`
8. `npm run typecheck`
9. `npm test -- --run`
10. `npm run build`
11. `npm run size`

Contrato:

12. `npm run gerar-api` seguido de `git diff --exit-code frontend/src/lib/api`

No fim, uma tabela com cada passo e "ok" ou "falhou", e para cada falha o comando que a reproduz.
