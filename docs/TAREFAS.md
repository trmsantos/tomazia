# Tarefas

Cada tarefa é um PR, feito com `/tarefa <ID>`. As tarefas marcadas **manual** são do Tomás, porque mexem no cPanel ou no GitHub. Os critérios S-xx e Q-xx estão em `docs/ESPECIFICACAO.md`.

O estado de cada tarefa vê-se no GitHub (PR aberto ou merged), não neste ficheiro.

## Fase 0: segurança no site atual (manual)

### F0-01 Fechar as falhas do site PHP

- **Quem:** Tomás, manual.
- **Faz:** repositório antigo privado; apagar `criaradmin.php` e `register.php`; bloquear scripts em `img/uploads/`; procurar `.php` em `img/uploads/`; mover `bd_teste.db` para fora do `public_html`; ver Raw Access; mudar passwords dos admins e do WiFi; desativar o separador de SMS; limpar o histórico com `git filter-repo`; avaliar com o dono a notificação à CNPD.
- **Feito quando:** a checklist da Fase 0 do plano está toda marcada.

## Fase 1: fundações

### F1-00 Estrutura de agentes

- **Quem:** Tomás, manual.
- **Faz:** repositório novo e privado `trmsantos/tomazia` com `.claude/`, `CLAUDE.md`, `docs/`, `.github/` e `.gitignore`. O repositório antigo `projetotomazia` fica privado, como arquivo do site PHP.
- **Feito quando:** o Claude Code carrega os nove agentes e as quatro skills, e o secret `CLAUDE_CODE_OAUTH_TOKEN` está configurado.

### F1-01 Esqueleto do monorepo

- **Agentes:** infra, backend, frontend.
- **Depende de:** nada.
- **Faz:** `backend/` com uv, FastAPI, SQLAlchemy, Alembic, ruff, mypy e pytest; `app/config.py` com valores por omissão para desenvolvimento. `frontend/` com Vite, React, TypeScript, Tailwind, ESLint (com proibição de `dangerouslySetInnerHTML`), Prettier, Vitest e size-limit. O `.gitignore` já existe; acrescenta o que faltar. `.env.example` sem valores reais.
- **Feito quando:** `/verificar` passa num repositório só com o esqueleto; `uv run uvicorn app.main:app` arranca; S-13 ativo no ESLint.

### F1-02 Health, Passenger e prefixo /api

- **Agentes:** qa, backend.
- **Depende de:** F1-01.
- **Faz:** `GET /health` com a versão lida de `VERSION` (ou `dev`); `passenger_wsgi.py` com a2wsgi; `app/openapi.py` que escreve o OpenAPI para o frontend.
- **Feito quando:** um teste monta a app como WSGI com `SCRIPT_NAME=/api` e `GET /api/health` responde 200 com a versão; `/docs` desligado quando `AMBIENTE=producao`.

### F1-03 CI

- **Agentes:** infra.
- **Depende de:** F1-01.
- **Faz:** `.github/workflows/ci.yml` com os jobs backend, frontend e contrato; ações fixadas por SHA; `dependabot.yml` semanal para pip, npm e Actions; passo que falha se houver `.db`, `.sqlite` ou `.env` no repositório.
- **Feito quando:** o CI corre em PRs e pushes; S-10 testado com um ficheiro falso num branch de teste.

### F1-04 Scripts de deploy

- **Agentes:** infra; revisor-seguranca obrigatório.
- **Depende de:** F1-02, F1-03.
- **Faz:** `deploy/montar.sh`, `publicar-branch.sh`, `pedir-deploy.sh`, `esperar-versao.sh`, `deploy.sh`, `.cpanel.yml`, `htaccess.exemplo` (SPA, CSP, HSTS, `nosniff`, scripts bloqueados em `media/`) e `.github/workflows/deploy.yml` com ambiente `production` e `concurrency`. Workflow agendado que verifica `/api/health` de hora a hora.
- **Feito quando:** shellcheck verde; o CI corre `montar.sh` e falha se a pasta tiver `.claude/`, `CLAUDE.md`, `docs/`, `tests/` ou `e2e/` (S-12, com o `CLAUDE.md` excluído por padrão recursivo — há três); `deploy.sh` testado com `HOME` falso; `pedir-deploy.sh` falha quando a UAPI devolve `status: 0` (testado com uma resposta simulada); o `deploy.sh` recusa reiniciar se o ficheiro de ambiente não existir no servidor.
- **Requisitos de segurança que vêm das revisões da F1-02 e F1-03:** `AllowOverride None` em `media/` não é higiene, é requisito — um `.htaccess` honrado nessa pasta chega para repor a configuração inteira com um `SetEnv`. O `PassengerFriendlyErrorPages` fica `Off`, senão um erro de configuração renderiza no browser com caminhos do servidor. O `pip install -r requirements.txt` do cPanel não tem verificação de integridade, porque o `uv export` corre com `--no-hashes`: ou se passa a exportar com hashes, ou se regista num ADR porque se vive sem ela.

### F1-05 Configuração do cPanel e primeiro deploy (manual)

- **Quem:** Tomás, manual.
- **Depende de:** F1-04.
- **Faz:** confirmar a versão do Python; criar `novo.<domínio>`; Setup Python App; chave SSH como deploy key; Git Version Control na branch `deploy`; API token; secrets no ambiente `production`; `.env` e `.htaccess` à mão; regras de proteção da `main` e da `deploy`.
- **Feito quando:** um merge na `main` aparece em `novo.<domínio>/api/health` com o SHA certo, sem passos manuais; e, com o `CLAUDE_CODE_OAUTH_TOKEN` já configurado, o `persist-credentials: false` no `claude.yml` foi testado com um `@claude` num PR descartável e ficou aplicado — é o único workflow com token de escrita, e sem essa linha o token fica em `.git/config` ao alcance de um `postinstall` durante um `npm ci` dentro da própria ação.

- **Herança da F2-06, duas coisas para fazer à mão no servidor:**
  1. **Medir se há proxy à frente** (ADR 0017). Abre o site do telemóvel em dados móveis e compara a última linha de `~/access-logs/<domínio>` com o IP que um serviço externo te diz. Se baterem certo, não há nada a fazer. Se o log disser `127.0.0.1` ou um endereço interno, há proxy — e o endereço que ele mostra é exatamente o que vai para `PROXIES_DE_CONFIANCA` no `.env`. **Sem isto, se houver proxy, são cinco fotos por hora para o bar inteiro**: o sexto visitante da noite é recusado por causa dos cinco anteriores.
  2. **`LimitRequestBody 8650752`** no `.htaccess`, para o Apache recusar um corpo grande demais **antes** de o Passenger arrancar o Python. Hoje, um corpo gigante enviado em troços (sem `Content-Length`) é recebido e escrito no `/tmp` antes de a guarda da app o ver.

## Fase 2: backend e dados

### F2-01 Modelos e primeira migração

- **Agentes:** qa, backend.
- **Depende de:** F1-02.
- **Faz:** as sete tabelas da especificação; migração Alembic inicial; SQLite em modo WAL com `busy_timeout`.
- **Feito quando:** `alembic upgrade head` cria a BD do zero; testes de constraints (slug único, preço ≥ 0, evento publicado sem data rejeitado).

### F2-02 Scripts de admin e backup

- **Agentes:** qa, backend; revisor-seguranca obrigatório.
- **Depende de:** F2-01.
- **Faz:** `scripts/criar_admin.py` (pede a password no terminal, nunca por argumento); `scripts/backup.py` com a API de backup do SQLite, guardando os últimos 30.
- **Feito quando:** S-05; backup testado numa BD temporária, incluindo quando a BD ainda não existe.

- **Herança da F2-04, decidido pelo Tomás a 4 de novembro de 2026:** o bloqueio de 15 minutos conta **por conta**, e por isso quem souber o nome de utilizador consegue trancar o dono à porta, 15 minutos de cada vez, indefinidamente. Foi aceite com uma condição: o `criar_admin.py` leva um **`--desbloquear`** que põe `tentativas_falhadas = 0` e `bloqueado_ate = NULL`. Uma linha de script em vez de uma tabela nova. Sem isto, o pior caso não tem saída nenhuma.
- **Aviso de calendário, da F2-04:** esta tarefa **não está na `main`**, e é ela que cria o `scripts/criar_admin.py`. Até fundir, **não há forma de criar uma conta de admin no servidor** — só as fixturas dos testes criam contas. A F4-01 pode aterrar com um ecrã de login perfeito contra uma base de dados sem contas nenhumas. Só depende da F2-01, logo já está desbloqueada.

### F2-03 Endpoints públicos de leitura

- **Agentes:** qa, backend.
- **Depende de:** F2-01.
- **Faz:** `GET /ementa`, `/eventos`, `/galeria`, `/info`, com `Cache-Control: max-age=60` em ementa e eventos.
- **Feito quando:** categorias e produtos por ordem, sem invisíveis nem indisponíveis; eventos passados e rascunhos excluídos; S-09.

### F2-04 Autenticação

- **Agentes:** qa, backend; revisor-seguranca obrigatório.
- **Depende de:** F2-01.
- **Faz:** `POST /auth/login`, `/auth/logout`, `GET /auth/eu`; argon2id; cookie de sessão; dependência `exigir_admin`; verificação de `X-Tomazia`; bloqueio após 5 falhas.
- **Feito quando:** S-04, S-06, S-07; cookie com `HttpOnly`, `Secure` e `SameSite=Strict`.
- **Decidido pelo Tomás, 4 de novembro de 2026**, sobre quatro coisas que a especificação não toma: a assinatura do cookie usa o **`itsdangerous`** e não `hmac` à mão (num primitivo de segurança, código revisto por muita gente em vez de trinta linhas nossas); o **`Secure` é incondicional**, sem ramo por ambiente, mesmo sabendo que em Safari isso impede desenvolver em `localhost` — um `secure = (ambiente == "producao")` cria um caminho que nunca é exercitado em produção, que é a forma de falha que os ADR 0008 e 0012 já castigaram duas vezes; a **quinta falha responde 400** e só a **sexta responde 429**, leitura literal do S-07; e o **bloqueio conta por conta**, nas colunas que a F2-01 já criou, sem dimensão de IP e sem tabela nova.
- **Assumido por mim, não perguntado:** uma sessão já aberta **sobrevive** ao bloqueio da conta. O bloqueio defende a porta, não a sala, e expulsar quem já está dentro tornaria o ataque descrito na F2-02 bastante mais útil. Se isto estiver errado, é uma linha a mudar no `exigir_admin`.
- **Medido na F2-04, e é uma armadilha do `TestClient`:** um cookie `Secure` **nunca volta** no `TestClient` por omissão, porque a base é `http://testserver`. Quem escrever o primeiro teste de sessão vê **401 onde esperava 200**, e a correção óbvia é tirar o `Secure` — que é exatamente o critério desta tarefa. A fixture nasce com `base_url="https://testserver"`, e o `Secure` prova-se a ler o cabeçalho `Set-Cookie`, não por round-trip.
- **Herança da F2-03, e é uma armadilha do S-04:** o critério diz "lista gerada a partir das rotas". Medido na F2-03, com FastAPI 0.161.1: o `include_router()` **não copia as rotas** para `app.routes` — deixa lá um `_IncludedRouter`, que não é uma rota e não tem `.routes`. Um `for rota in app.routes` com `isinstance(rota, APIRoute)` devolve **lista vazia** numa app cheia de rotas, e o S-04 passava a verificar zero rotas, a verde. Usa `backend/tests/apoio_rotas.py`, escrito na F2-03 para isto: desce recursivamente, acumula prefixos e **rebenta** diante de um objeto de rota que não saiba classificar. **Remedido na F2-04, em 0.162.0: a armadilha sobreviveu ao upgrade** — a contagem ingénua continua a dar 0 numa app com 9 rotas. E ao remedir apareceu um segundo buraco, no próprio ficheiro escrito para o impedir: a linha `prefixo + getattr(contexto, "prefix", "")` dá o mesmo resultado a "o prefixo é vazio" e a "não sei onde está o prefixo". Medido com `include_router(r, prefix="/gestao")`: as rotas internas guardam `/categorias` e o prefixo vive só no `_RouterIncludeContext`; com o `.prefix` ausente a travessia devolve **`/categorias`**, calada, e um teste do S-04 que filtre `startswith("/gestao")` encontra zero rotas numa app cheia delas. É a regra 10 partida dentro do ficheiro que existe para a fazer cumprir. Corrigido na F2-04, que é a primeira tarefa a usar `prefix=`.

### F2-05 Endpoints de gestão

- **Agentes:** qa, backend.
- **Depende de:** F2-03, F2-04.
- **Faz:** CRUD e reordenação de categorias, produtos e eventos; definições; clientes com exportação CSV e eliminação; resumo.
- **Feito quando:** S-04 continua verde com as rotas novas; reordenar é atómico; o CSV usa `;` e UTF-8 com BOM (abre bem no Excel em português).
- **Buraco da especificação, encontrado na F2-04:** a tabela de endpoints (`docs/ESPECIFICACAO.md`, linhas 60-67) **não tem rota para mudar a password**, mas a linha 146 promete "Mudar password" no ecrã "Mais › Conta". O ecrã não pode existir sem a rota, e a F4-05 é tarde de mais para descobrir isso. Decidir aqui, que é onde há contexto: a rota nova, e se mudar a password **mata as sessões antigas** — que é o que qualquer pessoa espera de mudar uma password, e que com cookie assinado não acontece sozinho. A F2-04 deixou o caminho aberto: basta o valor assinado levar um prefixo de `HMAC(segredo, hash_password)`.

- **Herança da F2-04, do revisor de código:** a linha `for rota in list(getattr(atual, "routes", []))` de `backend/tests/apoio_rotas.py` é o mesmo molde que a F2-04 corrigiu no `.prefix` logo abaixo — um `[]` por omissão dá o mesmo resultado a "este nó não tem rotas" e a "esta versão do FastAPI/Starlette deixou de ter `.routes` aqui". Não é regressão da F2-04 e não havia como a exercitar com zero rotas de gestão; é esta a tarefa que estreia rotas `/gestao/*` a sério e em que a Camada 3 do S-04 passa de um conjunto vazio a um conjunto com conteúdo — o primeiro momento em que uma travessia que devolva menos do que existe esconde alguma coisa que importa. O caso concreto é o `Mount`: o `starlette.routing.Mount.routes` é uma propriedade que já faz `getattr(self.app, "routes", [])` por dentro, portanto o silêncio é duplo.
- **Herança da F2-04, e morde quem escrever o primeiro ecrã:** o OpenAPI documenta `422 → HTTPValidationError` (`{detail: ValidationError[]}`), que é a omissão do FastAPI, mas a app devolve o envelope `{erro, mensagem}` — o tratador do `RequestValidationError` substituiu o corpo e **não** o esquema. Os tipos gerados estão fiéis ao OpenAPI; é o OpenAPI que promete uma forma que a app nunca produz. Quem escrever o ecrã de login da F4-01 a partir dos tipos vai ler `detail` e encontrar `undefined`. Corrige-se com `responses={422: ...}` nas rotas ou no `app/openapi.py`.
- **Herança da F2-04, sobre o `detail` descartado em silêncio:** o tratador de `HTTPException` usa um mapa de mensagens por estado e deita fora um `detail` em texto. Para os 404/405 do Starlette é o que se quer (evita o inglês), mas aqui um `raise HTTPException(404, "Esta categoria não existe.")` devolve uma frase plausível e **errada**, sem erro nem registo. A convenção da casa é o `ErroDaApi`; confirma na F2-04 o que ficou feito a esse respeito antes de escreveres o primeiro `HTTPException` com texto.

### F2-06 Fotos

- **Agentes:** qa, backend; revisor-seguranca obrigatório.
- **Depende de:** F2-04.
- **Faz:** `POST /fotos`; serviço de imagens com Pillow; moderação (`/gestao/fotos`, aprovar, rejeitar, imagem pendente servida só a admins); mover aprovadas para `MEDIA_DIR`.
- **Feito quando:** S-01, S-02, S-03, S-11; EXIF removido (testado com uma imagem com GPS); limite de 5 por hora por IP.
- **Decidido pelo Tomás, 5 de novembro de 2026**, sobre quatro coisas que a especificação não toma: o limite conta **tentativas**, não envios aceites (**ADR 0018** — a decisão original era contar linhas da `fotos`, e foi substituída horas depois, quando medi que um ficheiro de 58 bytes gastava 90 MB sem gastar quota nenhuma); **o dono salta o limite** quando tem sessão de admin, para não ficar bloqueado a meio do próprio ecrã depois de uma noite de música; o limite de píxeis é **30 MP**; e **rejeitar apaga os bytes** do disco, porque é a foto de um terceiro que o dono decidiu não publicar — a linha fica, que é ela que sustenta o limite.
- **A condição que a decisão original trazia está extinta** (ADR 0018): o contador deixou de ser a galeria, logo já não é preciso que uma linha de `fotos` nunca se apague. Rejeitar continua a apagar os bytes e a manter a linha, mas por outras razões.
- **Medido na F2-06, em Pillow 13.0.0, e nenhuma das duas é óbvia:** o `Image.MAX_IMAGE_PIXELS` **sozinho não cumpre o S-11** — com o máximo a 8000 e uma imagem de 9600 píxeis, o Pillow abre na mesma e emite só um `DecompressionBombWarning`, que é engolido por omissão (o `filterwarnings` em falta é item da F3-07); só **acima do dobro** levanta erro. Quem decide o critério é uma comparação explícita sobre `im.size`. E **o EXIF sobrevive ao `resize()`**: o `info` com o `exif` passa intacto, e só o `Image.frombytes(mode, size, tobytes())` o deixa vazio — confiar no `resize`+`save` faria a remoção do EXIF depender do plugin WebP, que o Dependabot sobe sozinho.
- **ADR 0017** fixa de onde vem o IP do cliente. Medido: o `a2wsgi` só preenche o `scope["client"]` quando o `environ` traz `REMOTE_ADDR` **e** `REMOTE_PORT`; faltando um, o `request.client` é `None` e um `.host` ingénuo dá **500 numa rota pública** — e nenhum teste o apanha, porque o `TestClient` põe sempre um `client`.
- **Esta é a tarefa que estreia rotas `/gestao/*` a sério**, porque o `/gestao/fotos` chega antes da F2-05. Três consequências, todas da F2-04:
  1. **A Camada 3 do teste do S-04 vai ficar vermelha, e isso é o desenho a funcionar.** `backend/tests/seguranca/test_s04_gestao_exige_sessao.py` tem `ROTAS_DE_GESTAO_ESPERADAS = frozenset()` escrito à mão, com a razão por escrito: com zero rotas, um teste parametrizado sobre a lista gerada produzia zero casos e ficava verde sem verificar nada. A primeira rota de gestão torna o conjunto diferente do esperado e obriga alguém a abrir o ficheiro. **Atualizar o conjunto é o trabalho certo; apagar o teste não.** E a partir daqui liga-se o parametrizado (cada rota × cada método → 401 sem cookie), que é o que o critério pede.
  2. **As heranças que ficaram escritas na F2-05 aplicam-se aqui primeiro:** o `getattr(atual, "routes", [])` do `tests/apoio_rotas.py`, o OpenAPI a prometer `422 → HTTPValidationError` quando a app devolve o envelope, e o `detail` em texto que o tratador descarta em silêncio. Lê-as lá antes de começar.
  3. **O router de gestão já existe e já traz o `exigir_admin` nas `dependencies`** (`app/routers/gestao.py`, montado com `prefix="/gestao"`). As rotas novas nascem protegidas sem fazer nada; o que **não** se pode fazer é criar outro router para as fotos e esquecer a guarda.
- **O `media/` já é servido em desenvolvimento**, pelo plugin `servirMediaEmDesenvolvimento` do `frontend/vite.config.ts`, escrito na F3-04 e endurecido depois de quatro achados de segurança (travessia de caminho, symlinks, maiúsculas no macOS, `nosniff`). A F3-05 herda-o. O importador da F2-08 já recusa symlinks e extensões que não sejam de imagem para dentro do `media/` — **o caminho de upload desta tarefa tem de recusar pelo menos o mesmo**, e convém comparar as duas listas em vez de escrever uma nova de memória.

### F2-07 Novidades

- **Agentes:** qa, backend, dominio-bar.
- **Depende de:** F2-01.
- **Faz:** `POST /novidades` com consentimento obrigatório e versão dos termos; `POST /novidades/cancelar` com token.
- **Feito quando:** S-08; sem consentimento devolve 422; cancelar apaga o registo.
- **Herança da F2-01, para não se descobrir a meio:** o `clientes.email` é único mas **sensível a maiúsculas** — `Ana@exemplo.pt` e `ana@exemplo.pt` entram como duas linhas, e aí o cancelamento de uma delas não cala a outra. Fica por decidir aqui, que é onde há contexto: normalizar à entrada, acrescentar um índice único sobre `lower(email)` (aditivo, não cai na regra 7), ou as duas coisas. O `token_cancelar` já tem `CHECK (length >= 32)` desde a F2-01; gerar um mais curto rebenta na escrita, não em silêncio. **E se o índice levar `COLLATE NOCASE`:** a comparação de esquemas de `tests/apoio_esquema.py` não compara collation — é preciso trocar `index_info` por `index_xinfo` nessa mesma tarefa, senão a rede fica a prometer o que não faz.

### F2-08 Importação da BD antiga

- **Agentes:** qa, backend, dominio-bar.
- **Depende de:** F2-01.
- **Como se corre:** `docs/legado/importacao.md`. O procedimento vive lá e não aqui — é um documento para ter à frente numa sessão de SSH, não uma entrada de lista.
- **Faz:** `scripts/importar_bd_antiga.py` e uma BD de teste falsa gerada por script a partir de `docs/legado/esquema-bd-antiga.sql` (nunca a real).
- **Feito quando:** a importação é idempotente; categorias "Bebidas" e "bebidas" juntam-se; preços em cêntimos certos; texto sem entidades HTML; o Tomás confirma localmente, numa cópia da BD real fora do repositório, 140 produtos e 11 categorias.
- **Herança da F2-01, para não se descobrir a meio:** `eventos.imagem` e `fotos.ficheiro` são **nomes de ficheiro**, nunca caminhos — a BD recusa `/`, `\` e `..` por `CHECK`. O esquema antigo guarda caminhos (`eventos.imagem_url`, `fotos.caminho`, valores do género `img/uploads/x.jpg`), por isso o importador tem de os reduzir ao nome do ficheiro. Falha alto e linha a linha se não o fizer, com o nome da restrição na mensagem — mas é trabalho a prever, não a descobrir. E as datas entram já em UTC: um `INSERT` em SQL cru com hora local é **rotulado** UTC sem ser convertido (ver `DataHoraUTC`).
- **Herança da F3-02, do agente de domínio:** cinco das onze categorias reais são garrafas — whiskys, gin, portos, brandy, licores — e aí os nomes de produto vêm com marca: `J&B`, `Ballantine's`, `Chivas 12 anos`, `Four Roses`. **As fixturas do frontend não tinham um único nome de produto com "&", apóstrofo ou algarismo** até a F3-02 os acrescentar, por isso o ecrã da ementa nunca os tinha visto. O "&" e o apóstrofo mexem com o escape; os algarismos mexem com a pesquisa (escrever "12") e com os `tabular-nums` da coluna de preços. Convém que a BD de teste falsa deste importador os traga.
- **Âmbito e execução, decididos pelo Tomás em 2026-10-29.**
  - **A galeria começa vazia.** As `fotos` antigas não se importam. O esquema novo exige um `ficheiro` `uuid.webp` único e **existente** em `media/`, e um `ip_hash` que a BD antiga não tem de onde tirar. Importar linhas sem recodificar as imagens e mover os ficheiros dava uma galeria de imagens partidas. Recodificar é o serviço da F2-06, não desta tarefa.
  - **As imagens dos eventos entram.** O script tem `--imagens <pasta>` e verifica ficheiro a ficheiro, parando no primeiro que falte; tem também `--imagens ignorar`, que mete `imagem = NULL` e lista o que ficou de fora. **Não há omissão:** "este evento não tem imagem" e "ninguém me disse o que fazer às imagens" não podem acabar os dois em `NULL`. Como a importação corre no servidor (abaixo), a pasta `img/uploads/` do site antigo já lá está e não há nada para descarregar.
  - **Corre por SSH, no servidor.** O `deploy/montar.sh` já leva o `backend/scripts/` para o pacote, por isso funciona. **Mas está dependente da F1-05** — não há servidor configurado até lá. E tem um custo que fica escrito: um erro de importação é um erro em produção, e a F2-02 (que traz o `scripts/backup.py`) ainda não está fundida. Daí as duas redes: o runbook manda copiar a BD de destino à mão antes de aplicar, e **o script simula por omissão**, só escrevendo com `--aplicar`, com o caminho do destino impresso na primeira linha do relatório.
  - **O `mypy` passa a verificar `scripts/`.** Esta tarefa cria a pasta `backend/scripts/`, e hoje a verificação de tipos só olha para `app` e `passenger_wsgi.py`. Um script que escreve na base de dados do bar merece a mesma rede que o resto. Mexe no `CLAUDE.md`, no `.claude/skills/verificar/SKILL.md` e no `ci.yml`.
- **As onze categorias, decididas pelo Tomás em 2026-10-29.** O `tipo` da BD antiga passa a `categorias`, com o nome que o cliente lê e a ordem na ementa. A ordem é a forma de um dia: o que se pede de dia primeiro, a prateleira da noite depois.

  | `tipo` antigo | Nome no site | Ordem |
  | --- | --- | --- |
  | `cafetaria` | Cafetaria | 1 |
  | `comidas` | Comidas | 2 |
  | `Bebidas` + `bebidas` | Bebidas | 3 |
  | `aguardentes` | Aguardentes | 4 |
  | `portos` | Vinhos do Porto | 5 |
  | `licores` | Licores | 6 |
  | `martinis` | Martinis | 7 |
  | `brandy` | Brandy | 8 |
  | `whiskys` | Whisky | 9 |
  | `gin` | Gin | 10 |
  | `espirituosas` | Espirituosas | 11 |

  Três mudam de forma e não é cosmético: **"portos" → "Vinhos do Porto"** porque "portos" é o que o empregado diz e não o que uma carta imprime (e é a única que um turista reconhece, o que a v1.1 em inglês agradece); **"whiskys" → "Whisky"** porque "whiskys" é um plural inventado e o singular fica coerente com "Brandy" e "Gin" na mesma barra — nunca "uísque", que é a forma do Brasil; **"espirituosas" fica na forma curta** e não "Bebidas espirituosas", porque pelo ADR 0013 quem escrevesse "bebidas" recebia dois cartões inteiros.

  O Tomás confirmou que **"espirituosas" são vodka, rum e tequila** — logo não é duplicado de "aguardentes" e as categorias são mesmo onze — e que **"martinis" são os vermutes de garrafa**, não cocktails. **"comidas" importa-se como uma categoria só**, fiel ao que ele tem: dividi-la é trabalho editorial dele na F4-02, com a carta à frente, e não de um script a adivinhar pelo nome do produto.

  Consequência mecânica, e é boa: `cafe` é subcadeia de `Cafetaria`, por isso o exemplo que motivou o ADR 0013 — escrever "cafes" e não receber nada — resolve-se sozinho. E nenhum dos onze nomes é subcadeia de outro, logo não há cartões a aparecer aos pares.
- **Para o Tomás ver depois de importar, não para mudar antes:** a pesquisa condiz com o nome da categoria por **subcadeia** (ADR 0013), e algumas categorias reais têm nomes curtos. Escrever "gin" vai encontrar a categoria **gin**, a **Ginjinha** dos licores e o **Ginger ale** das bebidas. Não é defeito — a pessoa vê o g-i-n dentro de "Ginjinha" e explica o resultado a olhar para o ecrã —, mas é o tipo de ruído que o próprio ADR 0013 diz que justificaria a reversão, e as fixturas escondem-no por completo. Escrever "gin" com os 140 produtos antes de dar o assunto por fechado.

### F2-09 Contrato da API no frontend

- **Agentes:** infra, frontend.
- **Depende de:** F2-03.
- **Faz:** `npm run gerar-api` (openapi-typescript a partir de `frontend/openapi.json`); cliente em `src/lib/api` com `X-Tomazia` e `credentials: "include"`; job de contrato no CI.
- **Feito quando:** o CI falha se os tipos gerados não estiverem atualizados.

### F2-10 Mensagens de recurso do cliente da API

- **Agentes:** dominio-bar, frontend, qa.
- **Depende de:** F2-09. **Tem de estar feita antes** do primeiro ecrã que mostre `ErroDaApi.mensagem` — pelo plano, a F3-05 ou a primeira da F4.
- **Porquê, descoberto na F3-02:** o `src/lib/api/cliente.ts` tem cinco frases de recurso para quando o backend responde sem envelope, e **nenhuma tem um teste a prendê-la**. Uma delas diz "dentro de momentos", a locução que o dominio-bar reprovou no ecrã da ementa. Hoje nenhuma chega a ninguém, porque a secção 5.3 da `docs/ecras/F3-02.md` obriga a ementa a usar frases fixas — mas são o que qualquer ecrã futuro mostrará se ler a mensagem.
- **A decisão de fundo, antes das frases:** estas mensagens são **para o dono, não para o cliente**. Se a regra da 5.3 é boa para a ementa, é boa para os eventos, a galeria e o rodapé — nenhum ecrã público devia renderizar `ErroDaApi.mensagem`. Fixar isso primeiro muda o registo em que as cinco se escrevem.
- **Faz:** 404 → "Não encontrei isto. Atualiza a página."; 429 → "Tentaste demasiadas vezes seguidas. Espera um bocado e tenta outra vez."; ≥500 → "O servidor teve um problema. Tenta outra vez daqui a pouco." (só muda a locução: "servidor" fica, porque para o dono é verdade e é útil); resto → "Não consegui fazer isto. Tenta outra vez." O 401/403 é decisão do Tomás: estão juntos e dizem "Entra outra vez", que resolve a sessão expirada e não resolve a falta de permissão — com um só utilizador, quase todos os casos são o primeiro, e "A tua sessão expirou. Entra outra vez." seria mais útil. Separá-los muda a estrutura do ramo.
- **Feito quando:** um teste por ramo, **mais um que exija que as cinco sejam diferentes umas das outras** — é a regra 10 aplicada a texto: duas mensagens iguais em ramos diferentes dizem à pessoa que aconteceu a mesma coisa quando não aconteceu, e uma cópia distraída não dá erro nenhum. E está respondido o caso que não está na tabela: estas cinco só valem quando **não há** envelope do backend; quando há, é a frase do backend que chega, escrita para quem chama a API. Reescrever o recurso e deixar de pé o caminho mais provável não é fazer a tarefa.

## Fase 3: área pública

### F3-01 Tokens, fontes e componentes base

- **Agentes:** ui-ux (especifica), frontend, qa.
- **Depende de:** F1-01.
- **Faz:** `tokens.css` e `tailwind.config.ts` com a paleta e a escala; Playfair Display e Source Sans 3 servidas localmente; Botão, Campo, Chip, Folha, Aviso temporário, Interruptor, Estado vazio, com testes.
- **Feito quando:** Q-03 e Q-04 nos componentes; nenhum hex fora dos tokens (regra de lint ou teste).

### F3-02 Ementa

- **Agentes:** ui-ux, dominio-bar, frontend, qa.
- **Depende de:** F2-09, F3-01.
- **Faz:** chips fixos com scroll-spy, pesquisa, cartões creme, Linha de produto com pontilhado e preço tabular, estados vazio, a carregar e erro.
- **Feito quando:** Q-02, Q-03, Q-05; preço formatado "6,50 €"; teste e2e que pesquisa um produto e salta para uma categoria.

### F3-03 Cabeçalho e WiFi

- **Agentes:** ui-ux, frontend, qa.
- **Depende de:** F3-01, F2-09.
- **Faz:** cabeçalho fixo; folha do WiFi com "Copiar password" e confirmação "Copiado".
- **Feito quando:** funciona por teclado; Q-04.

### F3-04 Eventos

- **Agentes:** ui-ux, dominio-bar, frontend, qa.
- **O que se sabe do bar, e com que confiança** (perguntado ao Tomás em 2026-11-02). Fica escrito porque esta é a área onde mais vezes se inventaram factos nesta sessão, e porque a diferença entre «sabemos» e «achamos» desapareceu duas vezes ao ser repetida:
  - **Há uma noite de samba às quintas-feiras.** Confirmado pelo Tomás.
  - **A cadência é incerta.** Palavras dele: «é sempre na 3ª quinta-feira do mês, penso eu, não tenho a certeza». Qualquer desenho que dependa de ser a 1.ª, a 3.ª ou todas as semanas está a assumir o que ninguém confirmou.
  - **A entrada é sempre livre.** Não há eventos pagos nem consumo mínimo — logo o cartão não fala de preço, e isso é uma decisão, não uma omissão.
  - **A hora mostra-se sempre.** O Tomás recusou a convenção de `00:00` significar «sem hora»: é escondida, e prefere não a ter.
- **Consequência de haver repetição:** três cartões podem ser o mesmo evento em três datas, e aí a secção não diz mais nada a quem olha. **Não se desduplica por título** — é frágil, e faria o dono perguntar porque é que o evento dele desapareceu do site.
- **Depende de:** F3-01, F2-09.
- **Faz:** secção "Próximos eventos" com até três (ADR 0015 — o título era "Esta semana" e mentia com um evento a três semanas).
- **Feito quando:** secção escondida sem eventos; datas em `Europe/Lisbon`. E «sem eventos» e «não consegui perguntar» não podem dar o mesmo ecrã: sem eventos a secção some, com o pedido falhado ela aparece com o erro.

### F3-05 Galeria e envio de fotos

- **Agentes:** ui-ux, frontend, qa; revisor-seguranca obrigatório.
- **Depende de:** F2-06, F3-01.
- **Faz:** grelha, visualização em ecrã inteiro, folha de envio com redução para 2000 px no browser e campo escondido contra bots.
- **Feito quando:** e2e envia uma foto e vê "A tua foto aparece depois de aprovada"; Q-03.

### F3-06 Visita-nos, novidades e rodapé

- **Agentes:** ui-ux, dominio-bar, frontend, qa.
- **Depende de:** F2-07, F3-01.
- **Faz:** horário com estado atual, "Abrir no Maps", telefone, Instagram; folha de novidades com consentimento por marcar; política de privacidade; link do Livro de Reclamações Eletrónico.
- **Feito quando:** Q-05 validado pelo dominio-bar; o estado "Aberto até às…" tem testes com relógio fixo.

### F3-07 Qualidade ponta a ponta

- **Descoberto na F2-04, ao atualizar o FastAPI para 0.162.0:** o `backend/pyproject.toml` não configura `filterwarnings`, por isso um aviso de depreciação **nunca faz o CI falhar** — fica uma linha no fim do output do pytest, onde ninguém olha. Há um a correr já: o Starlette 1.9.0 avisa que `Using httpx with starlette.testclient is deprecated; install httpx2 instead`. **Não é regressão** (o Starlette não mudou de versão no bump, e o aviso já lá estava), mas no dia em que o Starlette cumprir a ameaça são **856 testes** a cair de uma vez, sem que nada o tenha anunciado. Pôr `filterwarnings = ["error", ...]` com uma lista explícita de exceções faz o aviso deixar de ser decorativo. É o mesmo padrão da regra 10: degradar em voz alta, não em silêncio.

- **Herança da F2-08, sugestão do revisor de código:** o teste do `except Exception` do importador prova três coisas que **não dependem de condição nenhuma do mundo real** — o detalhe sai numa linha antes, a conclusão é de uma linha só, a exceção é re-levantada — mas está preso a um gatilho que vai envelhecendo: um índice único que o esquema não tem. Já trocou de gatilho uma vez, porque o anterior (um `MEDIA_DIR` a apontar para um ficheiro) ganhou recusa própria. **À medida que as condições previsíveis ganham nome, o imprevisto tem de ser procurado mais fundo.** Separar o contrato do gatilho — o contrato por `monkeypatch` em processo, o gatilho a sério só para o que só ele prova (o estado de saída através do `SystemExit`, a separação `stdout`/`stderr` a atravessar o processo) — paga isso uma vez só. Não é urgente: o teste degrada **em voz alta**, com uma falha vermelha que manda procurar outro gatilho, e não em silêncio.

- **Agentes:** qa, infra.
- **Depende de:** F3-02.
- **Faz:** `e2e/capturas.spec.ts` (capturas 390×844 de cada ecrã), axe em todas as páginas, Lighthouse CI no CI.
- **Feito quando:** Q-01, Q-02 e Q-03 a correr no CI.

## Fase 4: área de gestão

### F4-01 Login e navegação

- **Agentes:** ui-ux, frontend, qa.
- **Depende de:** F2-04, F3-01.
- **Faz:** `/gestao/entrar`; barra inferior no telemóvel e coluna lateral a partir de 1024 px; gestão carregada à parte (lazy).
- **Feito quando:** mensagem clara de conta bloqueada com o tempo que falta; o JavaScript da gestão não entra no pacote público (Q-02).

### F4-02 Ementa na gestão

- **Agentes:** ui-ux, dominio-bar, frontend, qa.
- **Depende de:** F2-05, F4-01.
- **Faz:** preço editável na linha, interruptor "Disponível" com "Desfazer" durante 5 s, arrastar para reordenar, adicionar produto, pesquisa.
- **Feito quando:** mudar um preço leva no máximo dois toques (e2e); aviso "Preço atualizado".
- **Entrega da F3-02:** um `preco_cent` a **0** aparece na ementa pública como **"Oferta"**, não como "0,00 €". A entrega para aqui, tal como a secção 14 da `docs/ecras/F3-02.md` a escreve, é **avisar** ao guardar: "Este produto fica como oferta na ementa." A razão é que um engano de digitação (escrever `0` e sair do campo) publica "Oferta" sem ninguém dar por isso, e a base de dados aceita-o de bom grado (o `CHECK` é `>= 0`) — é o único valor em que o erro produz uma frase com sentido em vez de um número errado, e por isso o único que passa despercebido. **Decidido pelo Tomás em 2026-10-28:** um aviso chega — não é confirmação, para não pôr atrito no dono a cada produto gratuito. Quem implementar escolhe o aviso que já existe (`AvisoTemporario`) e não um diálogo.

### F4-03 Eventos na gestão

- **Agentes:** ui-ux, dominio-bar, frontend, qa.
- **Depende de:** F2-05, F4-01.
- **Faz:** lista de próximos e rascunhos, arquivo, criar com data obrigatória, publicar, duplicar.
- **Feito quando:** duplicar um evento semanal cria um rascunho com a data da semana seguinte.

### F4-04 Moderação de fotos

- **Agentes:** ui-ux, frontend, qa.
- **Depende de:** F2-06, F4-01.
- **Faz:** fila de pendentes, uma foto de cada vez, botões grandes para aprovar e rejeitar; envio de foto própria.
- **Feito quando:** aprovar mostra "Foto aprovada" e passa à seguinte; fila vazia com estado vazio.

### F4-05 Definições, clientes, conta e início

- **Agentes:** ui-ux, dominio-bar, frontend, qa; revisor-seguranca obrigatório.
- **Depende de:** F2-05, F4-01.
- **Faz:** definições (WiFi, horário por dia, morada, contactos); clientes com exportar e eliminar; mudar password; ecrã Início com o resumo.
- **Feito quando:** eliminar um cliente pede confirmação numa folha; mudar o WiFi aparece no site público sem deploy.

## Fase 5: lançamento

### F5-01 Redirecionamentos dos endereços antigos

- **Agentes:** infra.
- **Depende de:** F1-04.
- **Faz:** regras em `htaccess.exemplo` que levam `/index.php`, `/bemvindo.php`, `/cardapio.php`, `/fotos.php` e `/termos.php` para os sítios novos, com 301.
- **Feito quando:** um teste verifica as regras com um Apache em contentor no CI.

### F5-02 Corte (manual)

- **Quem:** Tomás, manual.
- **Depende de:** todas as anteriores.
- **Faz:** congelar o admin antigo; importação final; guardar cópia do PHP; apontar `WEB` para o `public_html`; atualizar o `.htaccess`; apagar os ficheiros PHP.
- **Feito quando:** os QR codes impressos abrem a ementa nova; `/api/health` responde no domínio principal.
