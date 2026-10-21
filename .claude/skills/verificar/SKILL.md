---
name: verificar
description: Corre localmente as mesmas verificações do CI, no backend e no frontend.
allowed-tools: Bash(uv sync*) Bash(uv run *) Bash(uv lock --check*) Bash(uv export *) Bash(npm ci*) Bash(npm run *) Bash(npm test*) Bash(git status --porcelain*) Bash(.github/scripts/*)
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

12. `npm run gerar-api` seguido de `git status --porcelain --untracked-files=all -- frontend/src/lib/api`, que tem de vir vazio

O `git diff --exit-code` não serve aqui: não vê ficheiros novos por versionar, e deixaria passar a verde um tipo gerado por commitar.

Deriva e ficheiros proibidos, da raiz do repositório:

13. Em `backend/`, `uv lock --check` — **sem** `uv run`, que relocka antes de correr o comando e faz o check passar sempre. Depois regenerar o `requirements.txt` com o comando do `backend/CLAUDE.md` e confirmar, da raiz, que `git status --porcelain --untracked-files=all -- backend/requirements.txt` vem vazio
14. `.github/scripts/verificar-ficheiros-proibidos.sh --git`
15. `.github/scripts/verificar-ficheiros-proibidos.sh --pasta frontend/dist`, depois do passo 10 ter construído

Os passos 13 a 15 existem porque o CI os corre: sem eles aqui, volta a haver "local verde, CI vermelho".

O que **não** se corre localmente são as duas auditorias de dependências (`npm audit` com a allowlist e `pip-audit`), por precisarem de rede e mudarem de resultado sozinhas — essas vivem só no CI.

No fim, uma tabela com cada passo e "ok" ou "falhou", e para cada falha o comando que a reproduz.
