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

### F2-05 Endpoints de gestão

- **Agentes:** qa, backend.
- **Depende de:** F2-03, F2-04.
- **Faz:** CRUD e reordenação de categorias, produtos e eventos; definições; clientes com exportação CSV e eliminação; resumo.
- **Feito quando:** S-04 continua verde com as rotas novas; reordenar é atómico; o CSV usa `;` e UTF-8 com BOM (abre bem no Excel em português).

### F2-06 Fotos

- **Agentes:** qa, backend; revisor-seguranca obrigatório.
- **Depende de:** F2-04.
- **Faz:** `POST /fotos`; serviço de imagens com Pillow; moderação (`/gestao/fotos`, aprovar, rejeitar, imagem pendente servida só a admins); mover aprovadas para `MEDIA_DIR`.
- **Feito quando:** S-01, S-02, S-03, S-11; EXIF removido (testado com uma imagem com GPS); limite de 5 por hora por IP.

### F2-07 Novidades

- **Agentes:** qa, backend, dominio-bar.
- **Depende de:** F2-01.
- **Faz:** `POST /novidades` com consentimento obrigatório e versão dos termos; `POST /novidades/cancelar` com token.
- **Feito quando:** S-08; sem consentimento devolve 422; cancelar apaga o registo.

### F2-08 Importação da BD antiga

- **Agentes:** qa, backend, dominio-bar.
- **Depende de:** F2-01.
- **Faz:** `scripts/importar_bd_antiga.py` e uma BD de teste falsa gerada por script a partir de `docs/legado/esquema-bd-antiga.sql` (nunca a real).
- **Feito quando:** a importação é idempotente; categorias "Bebidas" e "bebidas" juntam-se; preços em cêntimos certos; texto sem entidades HTML; o Tomás confirma localmente, numa cópia da BD real fora do repositório, 140 produtos e 11 categorias.

### F2-09 Contrato da API no frontend

- **Agentes:** infra, frontend.
- **Depende de:** F2-03.
- **Faz:** `npm run gerar-api` (openapi-typescript a partir de `frontend/openapi.json`); cliente em `src/lib/api` com `X-Tomazia` e `credentials: "include"`; job de contrato no CI.
- **Feito quando:** o CI falha se os tipos gerados não estiverem atualizados.

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
- **Depende de:** F3-01, F2-09.
- **Faz:** secção "Esta semana" com até três eventos.
- **Feito quando:** secção escondida sem eventos; datas em `Europe/Lisbon`.

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
