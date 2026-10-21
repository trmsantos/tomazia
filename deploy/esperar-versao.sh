#!/usr/bin/env bash
# esperar-versao.sh <url-base> <sha-esperado> <timeout-segundos> \
#                    <intervalo-segundos> <inicio-deploy-iso8601>
#
# Faz polling a `<url-base>/api/health` até o processo a responder ser
# mesmo o código novo — não só até um ficheiro `VERSION` ter mudado no
# disco (F1-04, infra). Corre em `deploy.yml`, depois de `pedir-deploy.sh`.
#
# `<timeout-segundos>` e `<intervalo-segundos>` são parâmetros, não
# constantes, para os testes não demorarem minutos.
#
# `<inicio-deploy-iso8601>`: instante (UTC) em que o deploy começou. Só há
# sucesso se a versão bater certo E `arrancado_em` (do corpo da resposta)
# for posterior a este instante — durante a janela de reinício do
# Passenger há processos velhos a responder com o `VERSION` já novo
# (ficheiro mudou, processo não), e só o `arrancado_em` distingue um do
# outro.
#
# Classificação de cada leitura (tabela da tarefa):
#   - curl falha por ligação/timeout/reset, ou HTTP 429/502/503/504, ou 200
#     com versão antiga (ou "dev"), ou versão certa mas `arrancado_em` não
#     posterior ao início do deploy -> "ainda não" (continua a tentar);
#   - 200 com JSON válido, versão certa e `arrancado_em` posterior, duas
#     vezes seguidas (N = 2, decisão do qa a confirmar) -> sucesso;
#   - 200 com HTML ou JSON inválido, HTTP 4xx exceto 429, ou erro de TLS,
#     ou JSON sem `versao` útil / `estado` diferente de "ok" -> falha já,
#     sem esperar pelo timeout.
#
# Regra 10: o estado do curl é sempre capturado à mão (nunca
# `if curl ...; then`), e o estado do jq é sempre distinguido (JSON válido
# / inválido), nunca um `if jq` ingénuo que tratasse os dois casos da mesma
# forma.
#
# As datas são comparadas com Python (stdlib `datetime`, sempre presente
# num Python 3.11+): o `jq` tem `fromdateiso8601`, mas só aceita o formato
# estrito `%Y-%m-%dT%H:%M:%SZ`, sem frações de segundo nem deslocamento
# `+00:00` — e os testes (e, em geral, qualquer `datetime.isoformat()` em
# Python) produzem as duas variantes. Python lida com ambas sem ambiguidade.

set -euo pipefail

if [ "$#" -ne 5 ]; then
  echo "Uso: esperar-versao.sh <url-base> <sha-esperado> <timeout-segundos> <intervalo-segundos> <inicio-deploy-iso8601>" >&2
  exit 1
fi

url_base=$1
sha_esperado=$2
timeout_segundos=$3
intervalo_segundos=$4
inicio_deploy_iso=$5

url="${url_base%/}/api/health"

#: Leituras de sucesso consecutivas exigidas antes de dar "chegou". O
#: suficiente para não dar verde numa única leitura porventura
#: inconsistente, sem exigir mais um parâmetro que a tarefa não pediu.
readonly N_LEITURAS_CONSECUTIVAS=2

# --- Datas: um único sítio que sabe interpretar ISO 8601 -------------------

# epoch_de_iso <instante-iso8601>
# Imprime o instante em segundos (float) desde a epoch. Aceita `Z` ou
# deslocamento explícito (`+00:00`), com ou sem frações de segundo. Sai
# com erro se o texto não for um instante válido.
epoch_de_iso() {
  python3 -c '
import sys
import datetime

texto = sys.argv[1].strip()
if texto.endswith("Z"):
    texto = texto[:-1] + "+00:00"
try:
    instante = datetime.datetime.fromisoformat(texto)
except ValueError:
    sys.exit(1)
if instante.tzinfo is None:
    instante = instante.replace(tzinfo=datetime.timezone.utc)
print(instante.timestamp())
' "$1"
}

# arrancado_e_posterior <instante-iso8601> <limite-epoch>
# Sai 0 se o instante (ISO 8601) for posterior ao limite (epoch, float);
# 1 se não for; 2 se o instante não se conseguir interpretar.
arrancado_e_posterior() {
  python3 -c '
import sys
import datetime

texto = sys.argv[1].strip()
limite = float(sys.argv[2])
if texto.endswith("Z"):
    texto = texto[:-1] + "+00:00"
try:
    instante = datetime.datetime.fromisoformat(texto)
except ValueError:
    sys.exit(2)
if instante.tzinfo is None:
    instante = instante.replace(tzinfo=datetime.timezone.utc)
sys.exit(0 if instante.timestamp() > limite else 1)
' "$1" "$2"
}

# tempo_esgotado <inicio-epoch> <limite-segundos>
# Sai 0 se já passou pelo menos <limite-segundos> desde <inicio-epoch>.
tempo_esgotado() {
  python3 -c '
import sys
import time

inicio = float(sys.argv[1])
limite = float(sys.argv[2])
sys.exit(0 if (time.time() - inicio) >= limite else 1)
' "$1" "$2"
}

set +e
inicio_deploy_epoch=$(epoch_de_iso "$inicio_deploy_iso")
estado_data=$?
set -e
if [ "$estado_data" -ne 0 ]; then
  echo "esperar-versao.sh: inicio-deploy-iso8601 inválido: '${inicio_deploy_iso}'." >&2
  exit 1
fi

inicio_espera_epoch=$(python3 -c 'import time; print(time.time())')
contagem_sucesso=0
ultima_observacao="(nenhuma leitura ainda)"

while true; do
  corpo_tmp=$(mktemp)

  # O estado do curl, capturado à mão (regra 10): nunca `if curl ...;
  # then`. 502/503/504 são "servidor ainda a reiniciar"; qualquer outro
  # 4xx (exceto 429) é tratado como falha definitiva mais abaixo.
  set +e
  codigo_http=$(
    curl -sS \
      --connect-timeout 5 \
      --max-time 10 \
      -o "$corpo_tmp" \
      -w '%{http_code}' \
      "$url"
  )
  estado_curl=$?
  set -e

  classificacao="ainda-nao"

  if [ "$estado_curl" -ne 0 ]; then
    case "$estado_curl" in
      # Códigos de erro do curl relacionados com TLS (handshake, cadeia de
      # certificados, cifras, motor SSL) — ver EXIT CODES em `man curl`.
      # Nunca "ainda não": um erro de TLS não se resolve sozinho a repetir
      # o pedido.
      35 | 51 | 53 | 54 | 58 | 59 | 60 | 64 | 66 | 77 | 80 | 82 | 83 | 90 | 91)
        classificacao="falha"
        ultima_observacao="erro de TLS (curl saiu com o código ${estado_curl})"
        ;;
      *)
        classificacao="ainda-nao"
        ultima_observacao="curl falhou a ligar (código ${estado_curl})"
        ;;
    esac
  else
    case "$codigo_http" in
      2??)
        # O estado do jq, distinguido explicitamente (regra 10): JSON
        # inválido (incluindo HTML, ou um corpo vazio) é falha definitiva,
        # nunca "ainda não".
        # Nota: `// ""`, nunca `// empty` — dentro de um array do jq,
        # `empty` não produz um valor nenhum, encolhe o array quando o
        # campo falta, e desalinha os campos a seguir (versão ausente
        # passaria a ocupar a posição do `arrancado_em`).
        #
        # Nota: o separador é `\u001f` (Unit Separator), nunca tab — tab
        # (e espaço) são sempre tratados como espaço em branco pelo `read`
        # do bash, mesmo com `IFS` só com um tab; duas colunas vazias
        # seguidas colapsavam num só campo e desalinhavam tudo. `\u001f`
        # não é espaço em branco: cada separador conta, mesmo entre dois
        # campos vazios.
        set +e
        linha=$(
          jq -r '[(.estado // ""), (.versao // ""), (.arrancado_em // "")] | join("\u001f")' \
            "$corpo_tmp" 2>/dev/null
        )
        estado_jq=$?
        set -e

        if [ "$estado_jq" -ne 0 ]; then
          classificacao="falha"
          ultima_observacao="resposta HTTP 200 não é JSON válido"
        else
          IFS=$'\x1f' read -r estado_campo versao_campo arrancado_campo <<<"$linha"

          if [ "$estado_campo" != "ok" ] || [ -z "$versao_campo" ]; then
            classificacao="falha"
            ultima_observacao="estado='${estado_campo}' versao='${versao_campo}' (sem versão útil)"
          elif [ "$versao_campo" != "$sha_esperado" ]; then
            classificacao="ainda-nao"
            ultima_observacao="versao='${versao_campo}' (à espera de '${sha_esperado}')"
          else
            set +e
            arrancado_e_posterior "$arrancado_campo" "$inicio_deploy_epoch"
            estado_comparacao=$?
            set -e
            case "$estado_comparacao" in
              0)
                classificacao="sucesso-leitura"
                ultima_observacao="versao='${versao_campo}' arrancado_em='${arrancado_campo}'"
                ;;
              1)
                classificacao="ainda-nao"
                ultima_observacao="versao='${versao_campo}' mas arrancado_em='${arrancado_campo}' não é posterior ao início do deploy"
                ;;
              *)
                classificacao="falha"
                ultima_observacao="arrancado_em='${arrancado_campo}' não é um instante válido"
                ;;
            esac
          fi
        fi
        ;;
      429 | 502 | 503 | 504)
        classificacao="ainda-nao"
        ultima_observacao="HTTP ${codigo_http}"
        ;;
      *)
        classificacao="falha"
        ultima_observacao="HTTP ${codigo_http}"
        ;;
    esac
  fi

  rm -f "$corpo_tmp"

  case "$classificacao" in
    sucesso-leitura)
      contagem_sucesso=$((contagem_sucesso + 1))
      echo "esperar-versao.sh: leitura boa (${contagem_sucesso}/${N_LEITURAS_CONSECUTIVAS}): ${ultima_observacao}"
      if [ "$contagem_sucesso" -ge "$N_LEITURAS_CONSECUTIVAS" ]; then
        echo "esperar-versao.sh: versão ${sha_esperado} confirmada — código novo a correr."
        exit 0
      fi
      ;;
    falha)
      echo "esperar-versao.sh: falha definitiva: ${ultima_observacao}" >&2
      exit 1
      ;;
    *)
      contagem_sucesso=0
      echo "esperar-versao.sh: ainda não (${ultima_observacao})"
      ;;
  esac

  if tempo_esgotado "$inicio_espera_epoch" "$timeout_segundos"; then
    echo "esperar-versao.sh: esgotou o tempo (${timeout_segundos}s) à espera da versão ${sha_esperado}. Última observação: ${ultima_observacao}" >&2
    exit 1
  fi

  sleep "$intervalo_segundos"
done
