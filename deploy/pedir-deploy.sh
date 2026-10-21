#!/usr/bin/env bash
# pedir-deploy.sh — pede ao cPanel, pela UAPI, para implantar a branch
# `deploy` (F1-04, infra).
#
# Corre em `deploy.yml`, depois do merge na `main`. A UAPI chamada é
# `VersionControlDeployment::create`: cria uma tarefa de implantação para o
# repositório Git já ligado no cPanel (Git Version Control), que faz o pull
# `--ff-only` da branch `deploy` e corre as tarefas de `.cpanel.yml` — entre
# elas, o próprio `deploy/deploy.sh` no servidor. O caminho do repositório é
# construído a partir de `TOMAZIA_CPANEL_USER` pela convenção documentada em
# `docs/ESPECIFICACAO.md` (`/home/<utilizador>/repositories/tomazia`); é um
# ponto de extensão a confirmar com o Tomás na F1-05, quando o repositório
# for mesmo ligado no cPanel — se o caminho real for outro, este script tem
# de ser ajustado (ou de passar a ler outra variável de ambiente).
#
# Sem argumentos de linha de comandos: tudo entra por variáveis de
# ambiente, para o token nunca aparecer numa linha de comandos nos logs do
# GitHub Actions.
#
#   TOMAZIA_CPANEL_BASE_URL  — ex. https://servidor.dominios.pt:2083
#   TOMAZIA_CPANEL_USER      — utilizador do cPanel
#   TOMAZIA_CPANEL_TOKEN     — token da API (nunca sai em stdout nem stderr)
#
# A UAPI do cPanel responde sempre HTTP 200, mesmo quando o pedido falhou —
# por isso nunca se confia no código HTTP para decidir sucesso: lê-se
# sempre o campo `status` do corpo JSON (aceita `1` e `"1"`; tudo o resto é
# falha, incluindo `status` ausente ou nulo). Ver `docs/TAREFAS.md` (F1-04)
# e `.claude/agents/infra.md`.
#
# Regra 10 (um guarda tem de distinguir vazio de avaria): o estado do
# `curl` é sempre capturado à mão, nunca com `if curl ...; then`; o estado
# do `jq` é sempre distinguido (sucesso / erro de JSON), nunca com
# `if jq ...; then`.

set -euo pipefail

: "${TOMAZIA_CPANEL_BASE_URL:?TOMAZIA_CPANEL_BASE_URL em falta}"
: "${TOMAZIA_CPANEL_USER:?TOMAZIA_CPANEL_USER em falta}"
: "${TOMAZIA_CPANEL_TOKEN:?TOMAZIA_CPANEL_TOKEN em falta}"

repositorio="/home/${TOMAZIA_CPANEL_USER}/repositories/tomazia"
url="${TOMAZIA_CPANEL_BASE_URL%/}/execute/VersionControlDeployment/create"

corpo_tmp=$(mktemp)
# shellcheck disable=SC2064 # expandir agora o caminho, não a variável no momento do trap
trap "rm -f '${corpo_tmp}'" EXIT

# --- O pedido --------------------------------------------------------------
#
# O estado do curl é capturado à mão (regra 10): nunca `if curl ...; then`,
# porque isso escondia qual dos dois falhou — a ligação, ou o próprio
# pedido HTTP. `--max-time` corta um servidor lento ou pendurado; a
# verificação de TLS nunca se desliga, de propósito: um erro de TLS é um
# erro a sério, nunca se ignora.
set +e
codigo_http=$(
  curl -sS \
    --connect-timeout 10 \
    --max-time 15 \
    -o "$corpo_tmp" \
    -w '%{http_code}' \
    -H "Authorization: cpanel ${TOMAZIA_CPANEL_USER}:${TOMAZIA_CPANEL_TOKEN}" \
    --data-urlencode "repository_root=${repositorio}" \
    "$url"
)
estado_curl=$?
set -e

if [ "$estado_curl" -ne 0 ]; then
  echo "pedir-deploy.sh: erro de rede ao contactar a UAPI do cPanel (curl saiu com o código ${estado_curl})." >&2
  exit 1
fi

case "$codigo_http" in
  2??) ;;
  *)
    echo "pedir-deploy.sh: a UAPI do cPanel respondeu com o código HTTP ${codigo_http}." >&2
    exit 1
    ;;
esac

# --- A leitura do corpo -----------------------------------------------------
#
# A UAPI responde sempre 200, mesmo quando falha: o que importa é o campo
# `status` do JSON, nunca o código HTTP. O estado do jq é distinguido
# explicitamente (regra 10): um erro de JSON é uma avaria (HTML de login,
# corpo truncado, corpo vazio), nunca "sucesso silencioso".
set +e
status_bruto=$(jq -r '.status // empty' "$corpo_tmp" 2>/dev/null)
estado_jq=$?
set -e

if [ "$estado_jq" -ne 0 ]; then
  echo "pedir-deploy.sh: a resposta da UAPI não é JSON válido." >&2
  exit 1
fi

if [ "$status_bruto" != "1" ]; then
  mensagem=$(jq -r '(.errors // []) | map(tostring) | join("; ")' "$corpo_tmp" 2>/dev/null)
  if [ -z "$mensagem" ]; then
    mensagem="a UAPI devolveu status=${status_bruto:-ausente}."
  fi
  echo "pedir-deploy.sh: pedido de deploy recusado pelo cPanel: ${mensagem}" >&2
  exit 1
fi

echo "pedir-deploy.sh: pedido de deploy aceite pela UAPI do cPanel (status=1)."
exit 0
