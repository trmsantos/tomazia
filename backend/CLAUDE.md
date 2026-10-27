# Backend

- Estrutura: `app/main.py`, `config.py`, `db.py`, `models/`, `schemas/`, `routers/` (`publico.py`, `gestao.py`, `auth.py`), `services/` (`imagens.py`, `auth.py`), `scripts/`, `migrations/`, `tests/`.
- As rotas definem-se sem o prefixo `/api`. Em produção o Passenger passa-o em `SCRIPT_NAME`.
- `app/config.py` lê variáveis de ambiente. O `AMBIENTE` é **obrigatório** e não tem omissão: é o que impede uma configuração em falta de ser tomada por desenvolvimento, em qualquer ponto de entrada — incluindo os `scripts/` corridos por SSH. Os restantes campos têm omissões de desenvolvimento (`DATA_DIR=./var`, BD `./var/dev.db`). Os testes usam uma BD temporária por teste.
- Pydantic v2 em todos os inputs e outputs. Nunca devolver modelos SQLAlchemy diretamente.
- O texto é guardado tal como foi escrito. Nunca fazer escape HTML ao guardar.
- Preços em cêntimos (`int`). Datas em UTC na BD; `Europe/Lisbon` só na apresentação.
- Rotas `/gestao/*` dependem de `exigir_admin`. Pedidos que alteram dados exigem o cabeçalho `X-Tomazia: 1`.
- Uploads: ignorar o nome e o `Content-Type` do cliente; abrir com Pillow; limitar tamanho e píxeis; recodificar para WebP sem EXIF; nome aleatório; guardar em `DATA_DIR/pendentes`.
- SQLite em modo WAL com `busy_timeout` de 5000 ms. Os três PRAGMAs (`journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout`) aplicam-se **em cada ligação**, no evento `connect` do motor: dois dos três não são persistentes, e `PRAGMA foreign_keys` numa ligação acabada de abrir devolve 0 — sem o PRAGMA, uma chave estrangeira é decoração que o SQLite grava no DDL e nunca verifica.
- **Os testes do backend usam sempre uma base de dados em ficheiro, dentro do `tmp_path` do teste — nunca `:memory:`.** `PRAGMA journal_mode=WAL` numa base de dados em memória devolve `memory`, nunca `wal` (medido, SQLite 3.50.4), e o guarda de `app/db.py` recusa uma base de dados que não consiga pôr em WAL: um teste sobre `:memory:` rebentaria no guarda em vez de provar o que queria. A fixture `isolar_definicoes` de `tests/conftest.py` já aponta `BASE_DADOS_URL` para um ficheiro dentro de `tmp_path` e cria a pasta; testes que construam motores à mão têm de fazer o mesmo.
- Erros em JSON: `{"erro": "codigo_curto", "mensagem": "Texto em PT-PT."}`.
- Testes: pytest com o `TestClient`. Testes de segurança em `tests/seguranca/test_sNN_*.py`, um por critério S-NN.
- `requirements.txt` gera-se com `uv export --no-dev --format requirements-txt -o requirements.txt` — **com** hashes. O servidor instala com `pip install --require-hashes`, e é o único ponto da cadeia onde os artefactos vêm da rede sem mais nada a verificá-los. O passo de deriva do CI usa exatamente este comando: regenerar sem hashes deixa-o vermelho.
- `python -m app.openapi` escreve o OpenAPI em `../frontend/openapi.json`.
