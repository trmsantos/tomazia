# Deploy do Bar da Tomazia

Como o código chega da `main` ao cPanel da dominios.pt. Fonte de verdade
para a arquitetura: `docs/ESPECIFICACAO.md`, secção Servidor. Esta
página é só o operacional — o "como corre" e o "o que o Tomás tem de
configurar à mão".

## Visão geral

```
merge na main
  └─ ci.yml corre (backend, frontend, contrato, segurança, resumo)
       └─ CI termina com sucesso, na main
            └─ deploy.yml dispara (workflow_run)
                 ├─ porteiro   confirma o SHA e o sucesso do CI
                 ├─ montar     npm ci && npm run build; deploy/montar.sh; S-12/S-10
                 ├─ publicar   empurra o pacote para a branch `deploy` (fast-forward)
                 ├─ pedir      UAPI do cPanel: puxa `deploy` e corre deploy/deploy.sh
                 └─ verificar  espera /api/health responder com o SHA novo
```

`deploy.yml` nunca corre em `pull_request`: só depois do CI terminar com
sucesso na `main` (`workflow_run`). Cada deploy publica exatamente o SHA
que o CI validou (`workflow_run.head_sha`) — nunca o tip atual da `main`,
que pode já ter andado entre o fim do CI e o início do deploy.

## Os cinco scripts, em `deploy/`

| Script | Corre onde | Faz |
| --- | --- | --- |
| `montar.sh` | CI (job `montar`) | Monta a pasta que vai para o servidor. **A disposição do pacote não é a do repositório**: o backend inteiro fica debaixo de `api/` (`api/app`, `api/migrations`, `api/scripts` só a partir da F2-02, `api/alembic.ini`, `api/passenger_wsgi.py`, `api/requirements.txt`, `api/VERSION` com o SHA), o build do Vite em `frontend/dist/`, os próprios scripts em `deploy/`, e `.cpanel.yml` na raiz. `deploy.sh` lê exatamente estes caminhos — ler a tabela como se fossem `backend/...` foi o que partiu o primeiro deploy desta tarefa. `--sha <40 hex> --saida <pasta>`. |
| `publicar-branch.sh` | CI (job `publicar`) | Põe a árvore da branch `deploy` igual à pasta montada e empurra `--ff-only` (nunca `--force`). `--pasta <pasta> --sha <sha> --branch deploy`. |
| `pedir-deploy.sh` | CI (job `pedir`) | Pede à UAPI do cPanel para puxar `deploy` e correr `deploy.sh` no servidor. Sem argumentos — tudo por variável de ambiente (nunca na linha de comandos, para não ficar nos logs do Actions). |
| `esperar-versao.sh` | CI (job `verificar`) | Faz polling a `/api/health` até a versão certa responder, de um processo arrancado depois do deploy ter começado. `<url-base> <sha-esperado> <timeout-s> <intervalo-s> <inicio-deploy-iso8601>`. |
| `deploy.sh` | **No servidor**, chamado por `.cpanel.yml` | `pip install`, `rsync` do código e do frontend, `alembic upgrade head`, grava `VERSION`, sinaliza o reinício do Passenger (`tmp/restart.txt`). Nunca toca em `.htaccess`, `media/`, `.env` nem `tomazia_data/`. |

Testados com `bash -n`, `shellcheck` e, no caso do `deploy.sh`, com um
`HOME` falso (`HOME=$(mktemp -d) bash deploy/deploy.sh`) — nunca contra o
servidor real.

## `.cpanel.yml`

Vive em `deploy/.cpanel.yml` (fonte) e é copiado para a raiz do pacote
por `montar.sh`. É de propósito o ficheiro menos inteligente do
pipeline: uma única tarefa, que invoca `deploy/deploy.sh`. Toda a lógica
vive no script, nunca aqui — um erro num `.cpanel.yml` só se descobre no
servidor, ao vivo.

## `htaccess.exemplo`

Modelo do `.htaccess` real de `public_html/` — nunca é esse ficheiro
(esse é mantido à mão no servidor, fora deste repositório, e o deploy
nunca lhe toca). Cobre o fallback do SPA (excluindo `/api`), os
cabeçalhos de segurança (CSP estrita, HSTS sem `includeSubDomains` nem
`preload` até à F5-02, `nosniff`, `Permissions-Policy`,
`X-Frame-Options`), `Cache-Control` diferente para `/assets/*` e para
`index.html`, o bloqueio de execução de scripts em `media/`, e o bloco
do Passenger com `PassengerFriendlyErrorPages Off`.

## O que o Tomás tem de configurar à mão

### No GitHub (uma vez)

1. **Environment `production`**, em Settings → Environments, com os
   segredos abaixo. Considerar exigir aprovação manual ("required
   reviewers") neste environment enquanto o site ainda está em
   construção em `novo.<domínio>` — não é exigido por nenhum destes
   workflows, mas é uma rede extra barata.
2. **Secrets no environment `production`:**
   - `TOMAZIA_CPANEL_BASE_URL` — base da UAPI do cPanel (ex.:
     `https://<host>:2083`). **Tem mesmo de começar por `https://`**:
     `pedir-deploy.sh` recusa-se a correr com qualquer outra coisa (a
     única exceção é `http://127.0.0.1`, que só os testes usam). Com o
     secret mal preenchido, o deploy falha de propósito no job `pedir` em
     vez de mandar o token do cPanel por uma ligação em claro.
   - `TOMAZIA_CPANEL_USER` — utilizador do cPanel.
   - `TOMAZIA_CPANEL_TOKEN` — token da API do cPanel (nunca a password
     da conta).
   - `TOMAZIA_API_BASE_URL` — URL pública do site (ex.:
     `https://novo.<domínio>`), usado por `verificar` (em `deploy.yml`)
     e por `saude.yml` para chamar `/api/health` e `/`. É secret, não
     placeholder, porque é um domínio real.
3. **Regras de proteção de branch** para `main` e para `deploy` (branch
   protection): exigir o check `resumo` do `ci.yml` antes do merge em
   `main`; e, na `deploy`, não permitir push direto de ninguém a não ser
   o `GITHUB_TOKEN` do job `publicar` — essa branch só avança por
   fast-forward, nunca por força.
4. Confirmar que `CLAUDE_CODE_OAUTH_TOKEN` (usado por `claude.yml`) e os
   quatro secrets acima só existem nos sítios certos — nenhum deles no
   ambiente por omissão do repositório.
5. **Workflow permissions** (Settings → Actions → General) não podem
   estar mais restritivas do que `contents: read`. Os jobs `pedir` e
   `verificar` deixaram de ir buscar os scripts ao artefacto e fazem
   agora o seu próprio checkout — se a organização tiver essa permissão
   desligada globalmente, esses dois jobs falham no checkout.

### No cPanel (F1-05, manual, descrito em `docs/TAREFAS.md`)

1. Confirmar a versão do Python (3.11+) disponível no Setup Python App.
2. Criar o subdomínio `novo.<domínio>` durante a construção.
3. Setup Python App, apontado para `~/tomazia_api/` — é aqui que o
   cPanel cria `~/virtualenv/tomazia_api/<versão>/`.
4. Git Version Control, a clonar este repositório na branch `deploy`,
   em `~/repositories/tomazia/`.
5. Chave SSH do deploy (deploy key) com acesso de leitura ao
   repositório, para o Git Version Control do cPanel conseguir clonar.
6. Gerar o API Token do cPanel (UAPI) e guardá-lo só no secret
   `TOMAZIA_CPANEL_TOKEN`.
7. `~/.tomazia-deploy.conf`, com uma única linha `WEB=<caminho
   absoluto>` — sem aspas. Aponta para a pasta do subdomínio
   `novo.<domínio>` durante a construção; muda para `public_html` só no
   corte final (F5-02). É o ficheiro de configuração do `deploy.sh` em
   si (nunca o `.env` da app), e fica fora do pacote sincronizado — por
   isso sobrevive a cada deploy automático.
8. `~/tomazia_api/.env` à mão, a partir de `backend/.env.example`
   (nunca o repositório escreve isto).
9. `.htaccess` do servidor à mão, a partir de `deploy/htaccess.exemplo`
   — substituir os placeholders por valores reais.
10. **Pedido ao suporte da dominios.pt** (texto já escrito em
    `deploy/htaccess.exemplo`, secção `media/`): aplicar `AllowOverride
    None` no contexto de servidor para a pasta `media/` — não é uma
    diretiva que se possa pôr num `.htaccess`, só o suporte do
    alojamento consegue aplicar isto num cPanel partilhado.

## Como se testou (sem nunca contactar o cPanel real)

- `bash -n` e `shellcheck -x` sobre todos os `deploy/*.sh` e
  `.github/scripts/*.sh` (job `seguranca` do `ci.yml`, com contagem
  mínima de ficheiros — um glob vazio não pode passar a verde).
- `deploy/deploy.sh` testado com `HOME=$(mktemp -d)`, `pip`/`alembic`
  substituídos por stubs no `PATH`, nunca a rede real nem o cPanel.
- `deploy/pedir-deploy.sh` e `deploy/esperar-versao.sh` testados contra
  um `http.server` real em `127.0.0.1`, nunca a UAPI nem o `/api/health`
  verdadeiros.
- `deploy/publicar-branch.sh` testado contra um `git init --bare` local,
  nunca o repositório real nem a branch `deploy` real.
- `deploy/montar.sh` testado com árvores de trabalho fabricadas em
  `tmp_path`, nunca escreve no repositório.
- `backend/requirements.txt` com hashes (`uv export --no-dev --format
  requirements-txt`); `pip install --require-hashes --dry-run` provado
  num venv descartável, em Linux x86_64 com Python 3.11 (a mesma
  plataforma do servidor).

Nenhum destes testes chama a API do cPanel nem acede ao servidor —
regra 3 do `CLAUDE.md` da raiz.
