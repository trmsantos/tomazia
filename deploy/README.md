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
| `montar.sh` | CI (job `montar`) | Monta a pasta que vai para o servidor. **A disposição do pacote não é a do repositório**: o backend inteiro fica debaixo de `api/` (`api/app`, `api/migrations`, `api/scripts` só a partir da F2-02, `api/alembic.ini`, `api/passenger_wsgi.py`, `api/requirements.txt`, `api/VERSION` com o SHA), o build do Vite em `frontend/dist/`, os próprios scripts em `deploy/`, e `.cpanel.yml` na raiz. `deploy.sh` lê exatamente estes caminhos — ler a tabela como se fossem `backend/...` foi o que partiu o primeiro deploy desta tarefa. `--sha <40 hex> --saida <pasta>`. A pasta de `--saida` é apagada e recriada a cada corrida, por isso recusa-se a apontar para `/`, `$HOME`, a raiz do projeto, o que estiver dentro dela ou o que a contenha — a correr à mão, usar uma pasta descartável (`"$(mktemp -d)/pacote"`). |
| `publicar-branch.sh` | CI (job `publicar`) | Põe a árvore da branch `deploy` igual à pasta montada e empurra `--ff-only` (nunca `--force`). `--pasta <pasta> --sha <sha> --branch deploy`. |
| `pedir-deploy.sh` | CI (job `pedir`) | Pede à UAPI do cPanel para puxar `deploy` e correr `deploy.sh` no servidor. Sem argumentos — tudo por variável de ambiente (nunca na linha de comandos, para não ficar nos logs do Actions). |
| `esperar-versao.sh` | CI (job `verificar`) | Faz polling a `/api/health` até a versão certa responder, de um processo arrancado depois do deploy ter começado. `<url-base> <sha-esperado> <timeout-s> <intervalo-s> <inicio-deploy-iso8601>`. |
| `deploy.sh` | **No servidor**, chamado por `.cpanel.yml` | `pip install`, sincroniza o código e o frontend, `alembic upgrade head`, grava `VERSION`, sinaliza o reinício do Passenger (`tmp/restart.txt`). Nunca toca em `.htaccess` (a qualquer profundidade, incluindo `WEB/api/.htaccess`, onde está o bloco do Passenger), `media/`, `.well-known/`, `.env` nem `tomazia_data/`. **Não usa `rsync`**: o CageFS do cPanel da dominios.pt não o tem, e o primeiro deploy morreu por isso. Sincroniza só com `cp`, `mv`, `rm`, `mkdir`, `rmdir` e `find` (ver a função `sincronizar`). Recusa o pacote, antes de escrever o que quer que seja, se lá houver uma ligação simbólica. |

No CI, o job `seguranca` do `ci.yml` corre `shellcheck -x` sobre todos
eles — e só isso: o `bash -n` faz-se à mão, no desenvolvimento, e não é
um check do CI. O `deploy.sh` leva ainda um `HOME` falso
(`HOME=$(mktemp -d) bash deploy/deploy.sh`) e, como os outros, os testes
de `backend/tests/` — nunca contra o servidor real.

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
`index.html`, a recusa de qualquer ficheiro ou pasta começado por ponto
(`/.env`, `/.git/...`) com a única exceção de `/.well-known/` na raiz, o
bloqueio de execução de scripts em `media/`, e o bloco do Passenger com
`PassengerFriendlyErrorPages Off`.

## O que o Tomás tem de configurar à mão

### No GitHub (uma vez)

1. **Environment `production`**, em Settings → Environments, com os
   segredos abaixo. Considerar exigir aprovação manual ("required
   reviewers") neste environment enquanto o site ainda está em
   construção em `new.<domínio>` — não é exigido por nenhum destes
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
     `https://new.<domínio>`), usado por `verificar` (em `deploy.yml`)
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

### No cPanel e no servidor (F1-05, manual)

Por esta ordem: cada passo depende do anterior. Os pontos de verificação
existem para não se descobrir no fim que alguma coisa ficou para trás.

> **Armadilhas que apareceram no primeiro deploy.** Ler antes de começar.
>
> - **"Share document root" desmarcado** ao criar o subdomínio (passo 1).
>   Marcado, o subdomínio passa a servir o `public_html` — e o deploy, com
>   `WEB` a apontar para lá, sincronizava o site novo por cima do PHP
>   antigo, apagando o que não estivesse no build.
> - **O ficheiro de ambiente da app (`.env`) vai em `~/tomazia_api/`,
>   NUNCA na raiz do site.** Na raiz do site, sem a regra dos ficheiros
>   escondidos do `htaccess.exemplo`, descarrega-se por
>   `https://new.bardatomazia.pt/.env`, com o segredo de sessão lá
>   dentro. Se lá esteve, mesmo que pouco tempo, gerar um segredo novo.
> - **`~/.tomazia-deploy.conf` vai na pasta pessoal (`~/`), e o nome
>   começa por ponto.** Sem o ponto, ou noutra pasta, o `deploy.sh` não o
>   encontra e recusa ("ficheiro de configuração ... não existe").
> - **Não carregar duas vezes em "Deploy HEAD Commit".** O cPanel não
>   serializa os pedidos. O `deploy.sh` tem um trinco
>   (`~/.tomazia-deploy.trinco`) e o segundo sai com "outro deploy está a
>   correr" sem tocar em nada, mas o normal é esperar que o primeiro
>   acabe. Se um deploy morrer à força, o seguinte recupera o trinco
>   sozinho e di-lo na saída.
> - **O repositório é público: clona-se por HTTPS, sem deploy key.** Não
>   é preciso gerar chaves no cPanel nem pô-las no GitHub.

**1. Subdomínio.** Criar `new.bardatomazia.pt` enquanto o site PHP antigo
continua no `public_html`, com **"Share document root" desmarcado**. A
pasta que o cPanel cria chama-se `novo.bardatomazia.pt` (o nome da pasta
não é o do endereço: a pasta é `novo`, o endereço é `new`). **Anotar o
caminho completo** (algo como `/home/<utilizador>/novo.bardatomazia.pt`) —
é o valor do passo 5.

**2. Setup Python App.** Python **3.11 ou superior**; *application root*
`tomazia_api`; *application URL*: escolher o subdomínio `new.bardatomazia.pt`
na lista e escrever **`api`** na caixa do caminho, ao lado (a app é
montada em `/api`, nunca na raiz do site); *startup file*
`passenger_wsgi.py`. Cria `~/tomazia_api/` e o virtualenv em
`~/virtualenv/tomazia_api/<versão>/`.

O cPanel escreve o bloco do Passenger em **`WEB/api/.htaccess`** (uma
pasta `api/` dentro da pasta do subdomínio, que só existe para isso), não
no `.htaccess` da raiz. O deploy nunca apaga essa pasta nem esse ficheiro.
É lá que se confirma a linha `PassengerFriendlyErrorPages Off` (ver o
passo 7).

**3. Sem deploy key.** O repositório é público, por isso o passo 4 clona
por HTTPS e não precisa de chave nenhuma.

**4. Git Version Control.** Clonar
`https://github.com/trmsantos/tomazia.git` para `~/repositories/tomazia/`,
na branch **`deploy`** — nunca na `main`. Essa branch já existe e já traz
o pacote montado pelo CI.

> **Verificação.** `ls -a ~/repositories/tomazia/` tem de mostrar `api/`,
> `frontend/`, `deploy/` e `.cpanel.yml`. Se faltar o `.cpanel.yml`, o
> cPanel não corre tarefa nenhuma — e a causa mais provável é o
> `include-hidden-files` do `upload-artifact` ter deixado de funcionar
> numa subida de versão da ação.

**5. `~/.tomazia-deploy.conf`** — na pasta pessoal, com o ponto no
início do nome —, uma linha, sem aspas:

```
WEB=/home/<utilizador>/novo.bardatomazia.pt
```

O caminho do passo 1 (a pasta, `novo`; não o endereço, `new`). No corte
final (F5-02) muda para `public_html`. É a configuração do `deploy.sh`, nunca a da app, e fica **fora** da pasta
sincronizada — por isso sobrevive a cada deploy.

**6. Ficheiro de ambiente da app**, em `~/tomazia_api/` — **nunca na
pasta do site** —, copiado de `backend/.env.example` e preenchido à mão.
O repositório nunca o escreve.
O segredo de sessão gera-se no servidor:

```
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

E a pasta de dados tem de ser criada à mão — o SQLite não cria a pasta do
ficheiro.

A app **recusa arrancar** em produção com o segredo por omissão, com um
valor com menos de 32 caracteres, ou com o placeholder do exemplo. É um
guarda da F1-01, não um erro de configuração.

**7. `.htaccess`** da raiz do subdomínio, à mão, a partir de
`deploy/htaccess.exemplo`, com os `<...>` substituídos — tudo menos o
bloco do Passenger, que o cPanel já escreveu em `WEB/api/.htaccess` (passo
2). Nesse, confirmar que está a linha `PassengerFriendlyErrorPages Off` e
acrescentá-la se não estiver. O deploy nunca toca em nenhum dos dois.

Sempre que o `htaccess.exemplo` mudar num PR, a alteração tem de ser
colada à mão no `.htaccess` real: o deploy não o faz.

**8. API Token do cPanel.** *Security → Manage API Tokens*. **Copiar no
momento** — não volta a aparecer. Vai só para o secret
`TOMAZIA_CPANEL_TOKEN`, nunca para o repositório.

**9. Pedido ao suporte da dominios.pt.** Aplicar `AllowOverride None` ao
contexto de servidor da pasta `media/`. **Não é uma diretiva que se possa
pôr num `.htaccess`** — num cPanel partilhado só o suporte do alojamento a
consegue aplicar. O texto do pedido está em `deploy/htaccess.exemplo`,
secção `media/`. Sem isto, quem consiga escrever um `.htaccess` nessa
pasta desfaz as proteções todas dela.

> **Verificação final.** Fazer um merge qualquer na `main` e seguir o
> `deploy.yml`: `porteiro` → `montar` → `publicar` → `pedir` →
> `verificar`. Os três primeiros já passam sem servidor nenhum; o
> **`pedir`** é o primeiro que fala com o cPanel, e é aí que se vê se os
> secrets estão certos. No fim, `https://new.<domínio>/api/health`
> devolve `estado`, `versao` (igual ao SHA do commit) e `arrancado_em`. A
> partir daqui o `saude.yml` fica verde sozinho, de hora a hora.

**Enquanto a F1-05 não estiver feita**, o `deploy.yml` falha no `pedir` e o
`saude.yml` falha no primeiro `curl`, os dois por falta de secrets e com a
mensagem a dizê-lo. É o comportamento esperado, não uma avaria.

## Como se testou (sem nunca contactar o cPanel real)

- `shellcheck -x` sobre todos os `deploy/*.sh` e `.github/scripts/*.sh`
  (job `seguranca` do `ci.yml`, com contagem mínima de ficheiros — um
  glob vazio não pode passar a verde). É o único passo do `ci.yml` que
  olha para os scripts em si.
- `bash -n` sobre os mesmos ficheiros, à mão, por quem lhes mexer antes
  de abrir o PR. Não é um check do CI — não contar com ele para apanhar
  um erro de sintaxe que o `shellcheck` deixe passar.
- Os quatro pontos a seguir são testes de `backend/tests/`, que correm no
  `pytest` do job `backend`; nenhum deles escreve fora de uma pasta
  temporária.
- `deploy/deploy.sh` testado com `HOME=$(mktemp -d)`, `pip`/`alembic`
  substituídos por stubs no `PATH`, nunca a rede real nem o cPanel. Um
  dos testes corre-o com um `PATH` montado só com as ferramentas de que
  ele precisa, e sem `rsync` — é a lista das dependências do script no
  servidor (`FERRAMENTAS_DO_SERVIDOR`, em
  `backend/tests/seguranca/test_deploy_sh_sincroniza_sem_rsync.py`).
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
