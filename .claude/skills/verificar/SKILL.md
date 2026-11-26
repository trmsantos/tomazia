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
4. `uv run mypy app passenger_wsgi.py scripts`
5. `uv run pytest -q`

Frontend, em `frontend/`:

6. `npm ci`, só se `node_modules` não existir ou o `package-lock.json` mudou
7. `npm run lint`
8. `npm run typecheck`
9. `npm test -- --run`
10. `VITE_URL_PUBLICA=https://novo.bardatomazia.pt npm run build` (o build falha sem a variável; F3-08)
11. `npm run size`

Contrato:

12a. Em `backend/`, `AMBIENTE=desenvolvimento uv run python -m app.openapi`
12b. Em `frontend/`, `npm run gerar-api`
12c. Da raiz, `.github/scripts/verificar-gerado-em-dia.sh --caminho frontend/src/lib/api/gerado --sugestao "cd frontend && npm run gerar-api"`

Cada um leva a sua linha na tabela final. **A ordem é a correção.**

O 12a não é cerimónia. O `app.openapi` só escreve o ficheiro **depois** de construir o esquema com sucesso, por isso um export falhado deixa o `frontend/openapi.json` antigo intacto — e sem o 12a os tipos eram regenerados a partir desse ficheiro velho, ficavam iguais, e este passo dizia "ok" com o backend possivelmente a nem sequer importar. No CI o problema nunca existiu, porque lá o `openapi.json` está no `.gitignore` e nunca vem do checkout; localmente existia, e era exatamente a forma de erro que este passo devia apanhar.

O 12c é um script, e não um `git status` dentro de um `if`, por quatro razões medidas: a substituição de comandos engole o estado do git (se ele sair 128, a saída vem vazia e o `if` dá verde); um caminho que não existe não tem o que comparar; um caminho abrangido pelo `.gitignore` é invisível ao `git status`; e uma regra do `.gitignore` sobre o **conteúdo** do caminho escapa à verificação da anterior. O script distingue tudo isso — 0 em dia, 1 há diferenças, 2 não consegui verificar, 3 o caminho não existe — e nunca confunde "não encontrei" com "não consegui procurar".

O `git diff --exit-code` não serve em sítio nenhum destes: não vê ficheiros novos por versionar, e deixaria passar a verde um tipo gerado por commitar.

Deriva e ficheiros proibidos, da raiz do repositório:

13. Em `backend/`, `uv lock --check` — **sem** `uv run`, que relocka antes de correr o comando e faz o check passar sempre. Depois regenerar o `requirements.txt` com o comando do `backend/CLAUDE.md` e confirmar, da raiz, que `git status --porcelain --untracked-files=all -- backend/requirements.txt` vem vazio
14. `.github/scripts/verificar-ficheiros-proibidos.sh --git`
15. `.github/scripts/verificar-ficheiros-proibidos.sh --pasta frontend/dist`, depois do passo 10 ter construído

Os passos 13 a 15 existem porque o CI os corre: sem eles aqui, volta a haver "local verde, CI vermelho".

O que **não** se corre localmente são as duas auditorias de dependências (`npm audit` com a allowlist e `pip-audit`), por precisarem de rede e mudarem de resultado sozinhas — essas vivem só no CI.

No fim, uma tabela com cada passo e "ok" ou "falhou", e para cada falha o comando que a reproduz.
