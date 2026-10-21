#!/usr/bin/env bash
# deploy.sh — corre NO SERVIDOR (cPanel), sem argumentos, a seguir ao pull
# `--ff-only` da branch `deploy` feito pelo cPanel (F1-04, infra).
#
# Tudo deriva de $HOME, pela árvore descrita em `docs/ESPECIFICACAO.md`,
# secção Servidor:
#
#   API      = $HOME/tomazia_api            (passenger_wsgi.py, .env, app/, ...)
#   ORIGEM   = $HOME/repositories/tomazia    (o pacote montado, com frontend/)
#   WEB      = lido de $HOME/.tomazia-deploy.conf (linha "WEB=<caminho>")
#   virtualenv do Passenger: $HOME/virtualenv/tomazia_api/*/bin/activate
#
# $HOME/.tomazia-deploy.conf é a configuração do PRÓPRIO deploy.sh, nunca a
# da app (`API/.env`): persiste fora do pacote sincronizado, precisamente
# para sobreviver a cada deploy automático. É aqui que o Tomás aponta `WEB`
# para `novo.<domínio>` durante a construção, e para `public_html` no corte
# final (F5-02) — mudar o site de sítio passa a ser editar um ficheiro no
# servidor, nunca um commit.
#
# Ordem (provada pelos testes com o registo dos stubs): `pip install` corre
# ANTES do rsync do código (não depende dele); o rsync do código e do
# frontend vêm a seguir; o `.env` é verificado outra vez depois de todos os
# rsyncs, antes de `alembic`, porque um rsync nunca pode apagar o `.env` a
# caminho de reiniciar a app com configuração em falta; `alembic` corre
# DEPOIS do código sincronizado (as migrações vêm com ele); `VERSION` é
# escrito penúltimo; `touch tmp/restart.txt` é sempre o último passo, com
# um mtime posterior ao de `VERSION` — é o sinal que o Passenger lê para
# reiniciar.
#
# NÃO HÁ ROLLBACK AUTOMÁTICO. Se isto falhar depois de `alembic` ter
# corrido, fica código novo em disco (e possivelmente uma migração já
# aplicada) e o processo Passenger antigo ainda em memória, a servir os
# pedidos com o código e a configuração de antes — porque `tmp/restart.txt`
# só é tocado no último passo, e uma falha antes dele impede-o de
# acontecer. Recuperar desse estado é uma decisão manual do Tomás, nunca
# deste script.
#
# `pip install` usa `--require-hashes` explícito: um `requirements.txt` sem
# hashes (uma regressão da outra frente da F1-04) tem de rebentar aqui, não
# instalar em silêncio sem verificar nada.

set -euo pipefail

: "${HOME:?HOME em falta}"

API="$HOME/tomazia_api"
ORIGEM="$HOME/repositories/tomazia"
CONFIG="$HOME/.tomazia-deploy.conf"

PASSO_ATUAL="arranque"
REINICIADO=0

em_erro() {
  local codigo=$?
  echo "deploy.sh: falhou no passo '${PASSO_ATUAL}' (código ${codigo})." >&2
  if [ "$REINICIADO" -eq 1 ]; then
    echo "deploy.sh: tmp/restart.txt já tinha sido escrito antes desta falha; o Passenger já reiniciou com o que lá estava." >&2
  else
    echo "deploy.sh: tmp/restart.txt NÃO foi escrito; a app continua a correr o código e a configuração anteriores, em memória. Não há rollback automático — se o passo falhado for posterior ao alembic, há código novo em disco (e possivelmente uma migração já aplicada) com o processo antigo ainda a servir pedidos." >&2
  fi
  exit "$codigo"
}
trap em_erro ERR

# versao_valida <texto>
# Mesma regra que `backend/app/versao.py` aceita ao ler `VERSION`: se o
# formato não bater certo aqui, o deploy.sh nunca devia sequer tentar
# escrever o ficheiro, mas se o fizesse, `obter_versao()` devolveria "dev"
# em silêncio, e `esperar-versao.sh` esperaria para sempre por um SHA que
# nunca vai aparecer.
versao_valida() {
  [[ "$1" =~ ^[A-Za-z0-9._-]{1,64}$ ]]
}

# verificar_env <caminho>
# Produz uma mensagem DIFERENTE consoante o `.env` esteja em falta, ou seja
# uma ligação simbólica pendurada (existe como ligação, mas o alvo não
# existe) — são avarias diferentes, mesmo que a reação (recusar) seja
# igual (regra 10: um guarda tem de distinguir vazio de avaria).
verificar_env() {
  local caminho="$1"
  if [ -L "$caminho" ] && [ ! -e "$caminho" ]; then
    echo "deploy.sh: ${caminho} é uma ligação simbólica pendurada (o alvo não existe)." >&2
    return 1
  fi
  if [ ! -e "$caminho" ]; then
    echo "deploy.sh: ${caminho} não existe." >&2
    return 1
  fi
  if [ ! -f "$caminho" ]; then
    echo "deploy.sh: ${caminho} existe mas não é um ficheiro regular." >&2
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Guardas: tudo o que recusa o deploy tem de correr ANTES de qualquer
# escrita (pip, rsync, alembic, VERSION, restart.txt). Nenhuma delas toca
# em nada — só leem e validam.
# ---------------------------------------------------------------------------

PASSO_ATUAL="a ler ${CONFIG}"
if [ ! -f "$CONFIG" ]; then
  echo "deploy.sh: ficheiro de configuração ${CONFIG} não existe. Tem de ter uma linha 'WEB=<caminho absoluto>'." >&2
  exit 1
fi

web_bruto=$(sed -n 's/^WEB=//p' "$CONFIG" | tail -n1)
if [ -z "$web_bruto" ]; then
  echo "deploy.sh: ${CONFIG} não tem uma linha 'WEB=<caminho absoluto>'." >&2
  exit 1
fi

PASSO_ATUAL="a validar WEB (${web_bruto})"
case "$web_bruto" in
  /*) ;;
  *)
    echo "deploy.sh: WEB tem de ser um caminho absoluto (recebi '${web_bruto}')." >&2
    exit 1
    ;;
esac

home_real=$(realpath "$HOME")
web_real=$(realpath "$web_bruto" 2>/dev/null) || web_real="$web_bruto"
case "$web_real" in
  "$home_real"/*) ;;
  *)
    echo "deploy.sh: WEB (${web_bruto}) tem de estar dentro de \$HOME (${HOME})." >&2
    exit 1
    ;;
esac
WEB="$web_real"

if [ ! -f "$WEB/.htaccess" ]; then
  echo "deploy.sh: WEB (${WEB}) não tem .htaccess — recuso-me a sincronizar o frontend para lá." >&2
  exit 1
fi
if [ ! -d "$WEB/media" ]; then
  echo "deploy.sh: WEB (${WEB}) não tem a pasta media/ — recuso-me a sincronizar o frontend para lá." >&2
  exit 1
fi

PASSO_ATUAL="a verificar o ficheiro de ambiente (antes de tudo)"
verificar_env "$API/.env"

PASSO_ATUAL="a validar VERSION no pacote (${ORIGEM}/VERSION)"
if [ ! -f "$ORIGEM/VERSION" ]; then
  echo "deploy.sh: ${ORIGEM}/VERSION não existe no pacote." >&2
  exit 1
fi
versao_pacote=$(cat "$ORIGEM/VERSION")
if ! versao_valida "$versao_pacote"; then
  echo "deploy.sh: ${ORIGEM}/VERSION tem um formato inválido." >&2
  exit 1
fi

PASSO_ATUAL="a localizar o virtualenv (\$HOME/virtualenv/tomazia_api/*/bin/activate)"
shopt -s nullglob
candidatos_venv=("$HOME"/virtualenv/tomazia_api/*/bin/activate)
shopt -u nullglob
if [ "${#candidatos_venv[@]}" -eq 0 ]; then
  echo "deploy.sh: não encontrei nenhum \$HOME/virtualenv/tomazia_api/*/bin/activate." >&2
  exit 1
fi
venv_activate="${candidatos_venv[0]}"

# ---------------------------------------------------------------------------
# A partir daqui já se escreve. A ordem importa (ver cabeçalho).
# ---------------------------------------------------------------------------

PASSO_ATUAL="a ativar o virtualenv (${venv_activate})"
# shellcheck disable=SC1090 # caminho só conhecido em runtime (glob do cPanel)
source "$venv_activate"

PASSO_ATUAL="a instalar dependências (pip install --require-hashes)"
pip install --require-hashes -r "$ORIGEM/requirements.txt"

PASSO_ATUAL="a sincronizar o código (app/, migrations/)"
# `--delete` só nestas duas pastas — nunca na raiz de tomazia_api/, onde
# vive o `.env`. O resto copia-se individualmente, sem `--delete`.
rsync -a --delete "$ORIGEM/app/" "$API/app/"
rsync -a --delete "$ORIGEM/migrations/" "$API/migrations/"
rsync -a "$ORIGEM/scripts/" "$API/scripts/"
cp -f "$ORIGEM/alembic.ini" "$API/alembic.ini"
cp -f "$ORIGEM/passenger_wsgi.py" "$API/passenger_wsgi.py"
cp -f "$ORIGEM/requirements.txt" "$API/requirements.txt"

PASSO_ATUAL="a sincronizar o frontend (WEB=${WEB})"
# media/, .htaccess e .well-known/ sobrevivem: nunca apagados, nunca
# sobrescritos. Um ficheiro antigo do frontend que já não está no pacote
# desaparece — por isso o --delete aqui, à raiz de WEB (nunca tocou em
# tomazia_api/, que é outra árvore).
rsync -a --delete \
  --exclude='/media' \
  --exclude='/.htaccess' \
  --exclude='/.well-known' \
  "$ORIGEM/frontend/" "$WEB/"

PASSO_ATUAL="a verificar o ficheiro de ambiente outra vez (depois do rsync, antes de alembic e do reinício)"
# O caso que esta tarefa descreve: um rsync (nunca devia, mas pode, por bug
# ou por um stub malicioso) apagar o .env a meio do deploy. Isto tem de
# ser apanhado AQUI — nunca só na verificação do início — porque é depois
# do rsync que o ficheiro pode ter desaparecido.
verificar_env "$API/.env"

PASSO_ATUAL="a correr migrações (alembic upgrade head)"
(cd "$API" && alembic -c "$API/alembic.ini" upgrade head)

PASSO_ATUAL="a escrever VERSION (penúltimo passo)"
cp -f "$ORIGEM/VERSION" "$API/VERSION"

PASSO_ATUAL="a sinalizar o reinício (tmp/restart.txt, sempre o último passo)"
mkdir -p "$API/tmp"
touch "$API/tmp/restart.txt"
REINICIADO=1

echo "deploy.sh: deploy concluído (versão ${versao_pacote})."
