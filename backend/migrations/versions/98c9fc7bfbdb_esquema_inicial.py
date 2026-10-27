"""esquema inicial

Revision ID: 98c9fc7bfbdb
Revises:
Create Date: 2026-10-27 12:41:00.837421

Gerado com `alembic revision --autogenerate` e revisto à mão, campo a
campo, contra a secção "Modelo de dados" de `docs/ESPECIFICACAO.md`. A
revisão não é zelo: o `alembic check` compara os modelos com as
migrações, nunca os modelos com a especificação. Um `CHECK` que falte no
modelo falta na migração, e o `alembic check` fica verde a confirmar que
os dois erros concordam um com o outro. E pela regra 7 do `CLAUDE.md`
este é o único ficheiro que não se corrige depois: acrescentar um
`CHECK`, mudar uma nulidade ou mudar um `ON DELETE` obriga a reconstruir
a tabela.

Duas correcções à mão sobre o que o `autogenerate` escreveu:

1. `import app.models.tipos`. O Alembic emite
   `app.models.tipos.DataHoraUTC()` nas oito colunas de data e **não**
   escreve o import — o `upgrade()` rebentava com
   `NameError: name 'app' is not defined` na primeira coluna.
2. O `CHECK` dos estados da foto ficou uma vez só. O `autogenerate`
   escrevia-o em duas linhas `sa.CheckConstraint` **e** o
   `sa.Enum(create_constraint=True)` da coluna acrescentava uma terceira
   ao criar a tabela: três restrições idênticas no DDL. Fica a do tipo,
   que é a que acompanha o modelo.

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.models.tipos

# revision identifiers, used by Alembic.
revision: str = "98c9fc7bfbdb"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "admins",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("utilizador", sa.String(length=60), nullable=False),
        sa.Column("hash_password", sa.String(length=255), nullable=False),
        sa.Column("tentativas_falhadas", sa.Integer(), nullable=False),
        sa.Column("bloqueado_ate", app.models.tipos.DataHoraUTC(), nullable=True),
        sa.Column("criado_em", app.models.tipos.DataHoraUTC(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_admins")),
        sa.UniqueConstraint("utilizador", name=op.f("uq_admins_utilizador")),
    )
    op.create_table(
        "categorias",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("nome", sa.String(length=60), nullable=False),
        sa.Column("slug", sa.String(length=60), nullable=False),
        sa.Column("ordem", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("visivel", sa.Boolean(), server_default=sa.text("1"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_categorias")),
        sa.UniqueConstraint("slug", name=op.f("uq_categorias_slug")),
    )
    op.create_table(
        "clientes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("nome", sa.String(length=80), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("telemovel", sa.String(length=32), nullable=True),
        sa.Column("consentimento_em", app.models.tipos.DataHoraUTC(), nullable=False),
        sa.Column("versao_termos", sa.String(length=20), nullable=False),
        sa.Column("token_cancelar", sa.String(length=64), nullable=False),
        sa.Column("criado_em", app.models.tipos.DataHoraUTC(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_clientes")),
        sa.UniqueConstraint("email", name=op.f("uq_clientes_email")),
        sa.UniqueConstraint("token_cancelar", name=op.f("uq_clientes_token_cancelar")),
    )
    op.create_table(
        "definicoes",
        sa.Column("chave", sa.String(length=60), nullable=False),
        sa.Column("valor", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("chave", name=op.f("pk_definicoes")),
    )
    op.create_table(
        "eventos",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("titulo", sa.String(length=120), nullable=False),
        sa.Column("inicio", app.models.tipos.DataHoraUTC(), nullable=True),
        sa.Column("descricao", sa.Text(), nullable=True),
        sa.Column("imagem", sa.String(length=64), nullable=True),
        # `publicado` é NOT NULL por causa do CHECK abaixo, não por
        # arrumação: com um operando NULL a expressão dá NULL, que não é
        # falso, e a linha passava. Ver ADR 0009 e `app/models/eventos.py`.
        sa.Column("publicado", sa.Boolean(), nullable=False),
        sa.CheckConstraint(
            "publicado = 0 OR inicio IS NOT NULL",
            name=op.f("ck_eventos_publicado_exige_inicio"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_eventos")),
    )
    op.create_table(
        "fotos",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("ficheiro", sa.String(length=64), nullable=False),
        # `create_constraint=True` é o que deixa o CHECK dos três estados na
        # base de dados; sem ele a validação vivia só do lado do Python e um
        # INSERT em SQL cru metia 'banana' na coluna.
        sa.Column(
            "estado",
            sa.Enum(
                "pendente",
                "aprovada",
                "rejeitada",
                name="estadofoto",
                native_enum=False,
                create_constraint=True,
                length=10,
            ),
            nullable=False,
        ),
        sa.Column("descricao", sa.String(length=255), nullable=True),
        sa.Column("enviada_por", sa.String(length=60), nullable=True),
        sa.Column("ip_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "criada_em",
            app.models.tipos.DataHoraUTC(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("moderada_em", app.models.tipos.DataHoraUTC(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fotos")),
        sa.UniqueConstraint("ficheiro", name=op.f("uq_fotos_ficheiro")),
    )
    op.create_table(
        "produtos",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("categoria_id", sa.Integer(), nullable=False),
        sa.Column("nome", sa.String(length=120), nullable=False),
        sa.Column("descricao", sa.String(length=280), nullable=True),
        sa.Column("preco_cent", sa.Integer(), nullable=False),
        sa.Column("disponivel", sa.Boolean(), nullable=False),
        sa.Column("ordem", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.CheckConstraint(
            "preco_cent >= 0", name=op.f("ck_produtos_preco_cent_nao_negativo")
        ),
        sa.ForeignKeyConstraint(
            ["categoria_id"],
            ["categorias.id"],
            name=op.f("fk_produtos_categoria_id_categorias"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_produtos")),
    )
    with op.batch_alter_table("produtos", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_produtos_categoria_id"), ["categoria_id"], unique=False
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("produtos", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_produtos_categoria_id"))

    op.drop_table("produtos")
    op.drop_table("fotos")
    op.drop_table("eventos")
    op.drop_table("definicoes")
    op.drop_table("clientes")
    op.drop_table("categorias")
    op.drop_table("admins")
