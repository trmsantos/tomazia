# Especificação — Bar da Tomazia

Fonte de verdade para pessoas e agentes. O plano completo, com diagramas, vive no doc "Bar da Tomazia — Plano de reestruturação". Quando divergirem, prevalece este ficheiro e o ADR mais recente em `docs/decisoes/`.

## Decisões

| Tema | Decisão |
| --- | --- |
| Quem decide | O Tomás decide tudo sobre a app e faz os merges. O dono paga o alojamento e usa a gestão. |
| Alojamento | cPanel partilhado da dominios.pt (30 processos de entrada, sem Docker, sem root). |
| Backend | FastAPI servida pelo Passenger através do a2wsgi, montada em `/api`. Python 3.11 ou superior. |
| Frontend | React + TypeScript + Vite + Tailwind, compilado no CI; o Apache serve os estáticos. |
| Base de dados | SQLite em `~/tomazia_data/`, fora do `public_html`. |
| Deploy | Merge na `main` → `deploy.yml` → branch `deploy` → UAPI do cPanel → `deploy/deploy.sh`. |
| Agentes | Vivem só no repositório. Nunca vão para o servidor nem falam com ele. |
| Fora da v1 | SMS ou email de marketing, contas de cliente, reservas, pagamentos. Ementa em inglês na v1.1. |

## Servidor

```text
/home/<utilizador>/
├── public_html/                 React compilado
│   ├── .htaccess                regras do SPA, cabeçalhos e bloco do Passenger (mantido à mão)
│   └── media/                   fotos aprovadas, em WebP; scripts bloqueados
├── tomazia_api/                 app do Setup Python App (passenger_wsgi.py, app/, .env)
├── tomazia_data/                tomazia.db, pendentes/, backups/
├── virtualenv/tomazia_api/3.x/  criado pelo cPanel
└── repositories/tomazia/        clone da branch deploy (Git Version Control)
```

- Durante a construção, o site novo vive em `novo.<domínio>` e o `WEB` do `deploy.sh` aponta para a pasta desse subdomínio.
- O deploy nunca toca em `.htaccess`, `media/`, `.env`, `tomazia_data/` nem nas pastas do cPanel.
- `GET /api/health` devolve `{"estado": "ok", "versao": "<sha>", "arrancado_em": "<ISO-8601 UTC>"}`. O `arrancado_em` é fixado à importação do processo, não por pedido. O deploy espera até ver a versão do commit **e** um `arrancado_em` posterior ao início do deploy: sem a segunda condição, um processo antigo que já servisse aquele `VERSION` daria o deploy por concluído sem ter reiniciado.

## Modelo de dados

| Tabela | Campos |
| --- | --- |
| categorias | id, nome (60), slug (único), ordem (int), visivel (bool, true) |
| produtos | id, categoria_id, nome (120), descricao (280, opcional), preco_cent (int ≥ 0), disponivel (bool, true), ordem (int) |
| eventos | id, titulo (120), inicio (datetime UTC; obrigatório para publicar — ver ADR 0009), descricao (opcional), imagem (opcional), publicado (bool, false) |
| fotos | id, ficheiro (uuid.webp), estado (pendente, aprovada, rejeitada), descricao (255, opcional), enviada_por (60, opcional), ip_hash, criada_em, moderada_em |
| clientes | id, nome (80), email (único), telemovel (opcional), consentimento_em, versao_termos, token_cancelar (único), criado_em |
| admins | id, utilizador (único), hash_password (argon2id), tentativas_falhadas, bloqueado_ate, sessao_versao, criado_em |
| definicoes | chave (pk), valor: wifi_rede, wifi_password, horario (JSON por dia), morada, telefone, instagram, maps_url |

Migração da BD antiga (`scripts/importar_bd_antiga.py`, só leitura, idempotente): junta os 12 valores de `tipo` em 11 categorias; importa os 140 produtos com preço em cêntimos e o texto sem `htmlspecialchars`; eventos sem data entram como rascunho; não importa a foto de teste, os clientes nem os admins.

## API

Caminhos relativos a `/api`. Erros em JSON: `{"erro": "codigo", "mensagem": "Texto em PT-PT."}`.

| Método e caminho | Para quê | Acesso |
| --- | --- | --- |
| `GET /health` | Estado, versão e instante de arranque | Público |
| `GET /ementa` | Categorias visíveis com produtos disponíveis, por ordem; cache 60 s | Público |
| `GET /eventos` | Eventos publicados a partir de hoje; cache 60 s | Público |
| `GET /galeria` | Fotos aprovadas | Público |
| `GET /info` | Horário, morada, contactos, WiFi | Público |
| `POST /fotos` | Envio para moderação | Público, 5 por hora por IP |
| `POST /novidades`, `POST /novidades/cancelar` | Inscrição com consentimento; cancelamento por token | Público, com limite |
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/eu` | Sessão de admin | Público / admin |
| `GET /gestao/resumo` | Pendentes, próximos eventos, novos registos | Admin |
| `/gestao/categorias`, `/gestao/produtos`, `/gestao/eventos` | CRUD e reordenação | Admin |
| `GET /gestao/fotos`, `GET /gestao/fotos/{id}/imagem`, `POST .../aprovar`, `POST .../rejeitar` | Moderação | Admin |
| `GET`, `PUT /gestao/definicoes` | WiFi, horário, morada, redes | Admin |
| `GET /gestao/clientes`, `GET /gestao/clientes.csv`, `DELETE /gestao/clientes/{id}` | Lista de novidades | Admin |

Autenticação: argon2id; cookie de sessão assinado, `HttpOnly`, `Secure`, `SameSite=Strict`, 12 horas; cabeçalho `X-Tomazia: 1` obrigatório em mutações; bloqueio de 15 minutos após 5 falhas, contado por conta. O logout revoga a sessão a sério, incrementando `admins.sessao_versao`, e por isso termina todas as sessões daquele admin (ADR 0016) — um cookie assinado não tem como revogar só uma.

Fotos: ignora nome e `Content-Type` do cliente; Pillow abre e valida (JPEG, PNG, WebP); 8 MB e limite de píxeis; recodifica para WebP sem EXIF; nome aleatório; guarda em `pendentes/`; ao aprovar, move para `public_html/media/`. O frontend reduz para 2000 px antes de enviar. Campo escondido contra bots.

## Critérios de segurança

| ID | Teste | Esperado |
| --- | --- | --- |
| S-01 | `.php` declarado como `image/jpeg` | 400, nada escrito em disco |
| S-02 | JPEG válido com PHP colado no fim | Aceite; ficheiro guardado é WebP novo sem `<?php` |
| S-03 | URL de uma foto pendente | 404 |
| S-04 | Cada rota `/gestao/*` sem sessão (lista gerada a partir das rotas) | 401 em todas |
| S-05 | Rota que crie admins | Não existe |
| S-06 | Mutação sem `X-Tomazia` | 403 |
| S-07 | Sexta tentativa de login falhada | 429 com tempo de espera |
| S-08 | `POST /novidades` com o email de outra pessoa | Registo existente não muda |
| S-09 | Texto com aspas e `<script>` | Guardado e devolvido igual; mostrado como texto |
| S-10 | `.db`, `.sqlite` ou `.env` no repositório ou no build | CI falha |
| S-11 | Imagem acima do limite de píxeis | 400 sem esgotar memória |
| S-12 | Pasta de deploy com `.claude/`, `CLAUDE.md`, `docs/`, `tests/` ou `e2e/` | CI falha |
| S-13 | `dangerouslySetInnerHTML` no frontend | ESLint falha |

O S-07 tem uma consequência que é melhor estar escrita do que ser redescoberta
como se fosse defeito: **a sexta tentativa revela que a conta existe.** Quem
mande seis passwords erradas recebe `429 conta_bloqueada` se o utilizador
existir, e `400` para sempre se não existir — a paridade perfeita das respostas
de falha, que o login mantém até à quinta, não sobrevive ao bloqueio. Decidido
pelo Tomás a 4 de novembro de 2026: fica como está. O que se revela é que
existe uma conta com aquele nome, num site com **uma só** conta de admin, criada
por SSH, cujo nome não é segredo. Fechá-lo custaria ou deixar o dono bloqueado
sem explicação durante 15 minutos (e a F4-01 sem o contador que vai mostrar),
ou uma tabela de tentativas por IP.


## Critérios de qualidade

| ID | Critério |
| --- | --- |
| Q-01 | Maior imagem do ecrã inicial em menos de 2,5 s em 4G simulado (Lighthouse CI) |
| Q-02 | JavaScript da área pública abaixo de 100 KB comprimido (size-limit) |
| Q-03 | axe sem violações sérias nas páginas públicas e de gestão |
| Q-04 | Alvos de toque com pelo menos 44 px e foco visível em todos os controlos |
| Q-05 | Texto visível em português de Portugal (revisão dominio-bar e ui-ux) |

## Design

| Token | Hex | Uso |
| --- | --- | --- |
| bordo-noite | `#3D0F24` | Fundo base |
| bordo-vinho | `#4A1830` | Superfícies: cabeçalho, folhas, painéis |
| bordo-tomazia | `#5D1F3A` | Marca; títulos e preços sobre creme |
| dourado-latao | `#D4AF37` | Ação principal, chip ativo, foco. Nunca sobre creme (1,7:1) |
| creme-papel | `#F5E6D3` | Texto no escuro; fundo dos cartões da ementa |
| creme-sombra | `#D9C3AE` | Texto secundário no escuro |
| sucesso / erro (escuro) | `#7FB77E` / `#E07A5F` | Estados sobre bordô |
| sucesso / erro (creme) | `#4F6B2E` / `#A63D2A` | Estados sobre creme |

- Tipografia: Playfair Display 700 em títulos (nunca abaixo de 22 px); Source Sans 3 no resto; preços com algarismos tabulares. Escala em telemóvel: 14, 17, 21, 27, 34 px; corpo 17 px, entrelinha 1,5. Fontes servidas pelo site.
- Espaçamento: 4, 8, 12, 16, 24, 32, 48 px. Cantos: 4 px em chips e campos, 12 px em cartões. Sem sombras no escuro; o cartão creme tem borda de 1 px em creme-sombra.
- Coluna pública até 640 px. Gestão: uma coluna no telemóvel, duas a partir de 1024 px.
- Movimento só em resposta a ações; `prefers-reduced-motion` respeitado. Sem vídeo de fundo.
- Componentes: Botão (principal, secundário, discreto, perigo), Campo, Chip de categoria, Linha de produto (nome, pontilhado, preço), Cartão de evento, Folha, Aviso temporário, Interruptor, Estado vazio, Linha de lista editável.
- Fica de fora: bordas douradas em tudo, desfoque de vidro, cartões que sobem no hover, carrossel automático, etiquetas em maiúsculas, emojis em títulos, setas nos botões.
- Texto: PT-PT, maiúscula só no início da frase, botões com a ação ("Copiar password", "Enviar foto", "Guardar alterações"), erros que dizem o que fazer.

## Ecrãs públicos

Uma página, de cima para baixo. O QR code da mesa abre diretamente aqui, sem formulário.

1. Cabeçalho fixo: logótipo e botão "WiFi", que abre uma folha com rede, password grande e "Copiar password".
2. Chips de categoria fixos, que acompanham o scroll; lupa que filtra por nome de produto ou de categoria (ADR 0013).
3. Ementa: um cartão creme por categoria; linhas com nome, pontilhado e preço; descrição opcional por baixo; indisponíveis escondidos.
4. Próximos eventos: até três, data grande em Playfair; a secção some sem eventos (ADR 0015).
5. Galeria: grelha de duas colunas com as seis últimas fotos; ecrã inteiro com deslizar; "Enviar uma foto" numa folha.
6. Visita-nos: horário com estado atual ("Aberto até às 02:00"), morada com "Abrir no Maps", telefone, Instagram. Sem mapa embutido.
7. Rodapé: "Receber novidades" (folha com consentimento por marcar), política de privacidade, Livro de Reclamações Eletrónico.

## Área de gestão

Pensada para o telemóvel do dono. Navegação inferior: Início, Ementa, Eventos, Galeria, Mais.

| Ecrã | Mostra | Ações |
| --- | --- | --- |
| Início | Fotos à espera, próximos eventos, últimas alterações | Ir para a fila de fotos |
| Ementa | Categorias e produtos, pesquisa | Preço editável na linha, interruptor "Disponível", arrastar para reordenar, adicionar |
| Eventos | Próximos e rascunhos; "Arquivo" com os passados | Criar (data obrigatória), publicar, duplicar |
| Galeria | Pendentes primeiro, uma a uma | Aprovar, rejeitar, enviar foto própria |
| Mais › Clientes | Inscritos com data de consentimento | Exportar CSV, eliminar a pedido |
| Mais › Definições | WiFi, horário por dia, morada, contactos | Guardar |
| Mais › Conta | Utilizador e sessão | Mudar password, sair |

Regras: aviso com o verbo da ação ("Preço atualizado"); ações reversíveis com "Desfazer" durante 5 s em vez de confirmação; apagar pede confirmação numa folha; erros junto do campo; login em `/gestao/entrar`.
