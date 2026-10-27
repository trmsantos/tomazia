from logging.config import fileConfig

from alembic import context

from app.config import obter_definicoes
from app.db import criar_engine

# `Base` vem de `app.models`, não de `app.db`: é o import dos modelos que
# garante que as sete tabelas estão em `Base.metadata`. Importar de
# `app.db` dava um `MetaData` vazio sempre que alguém se esquecesse de
# importar os agregados, e o `autogenerate` propunha largar tudo.
from app.models import Base

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# A URL vem de `app.config`, não do `alembic.ini` (que não a tem embutida).
config.set_main_option("sqlalchemy.url", obter_definicoes().base_dados_url)

# MetaData dos modelos, para o autogenerate.
target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    O motor vem de `app.db.criar_engine`, nunca de `engine_from_config`:
    é na fábrica de `app/db.py` que vivem os três PRAGMAs. Um motor
    construído aqui por fora criaria no servidor, durante o deploy, uma
    base de dados sem WAL e com as chaves estrangeiras desligadas —
    incluindo durante as próprias migrações de dados.
    """
    connectable = criar_engine(obter_definicoes().base_dados_url)

    try:
        with connectable.connect() as connection:
            context.configure(
                connection=connection,
                target_metadata=target_metadata,
                # O SQLite não sabe alterar colunas; sem isto, qualquer
                # migração futura que mude uma coluna rebenta no servidor.
                render_as_batch=True,
            )

            with context.begin_transaction():
                context.run_migrations()
    finally:
        connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
