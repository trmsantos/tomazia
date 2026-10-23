#!/usr/bin/env bash
set -euo pipefail

# montar.sh — monta a pasta que vai para o servidor (F1-04, agente infra).
#
# Uso: montar.sh --sha <40 hex> --saida <pasta>
#
# `--saida` é apagada e recriada do zero a cada corrida. Por isso é
# validada antes de tudo o resto (ver "Sanidade de `--saida`", abaixo):
# a raiz do sistema de ficheiros, `$HOME`, a raiz do projeto, o que
# estiver dentro dela e o que a contenha são recusados em vez de
# apagados.
#
# Resolve a sua PRÓPRIA raiz do projeto a partir do seu próprio caminho
# (`dirname "$0"/..`), nunca via `git rev-parse` — isto é o que permite
# correr `montar.sh` contra uma árvore de trabalho copiada (como fazem os
# testes), sem precisar de um repositório git a sério por trás.
#
# O pacote leva, e só, a partir dessa raiz:
#   backend/app, backend/migrations, backend/scripts (quando existir —
#   ainda não existe hoje, chega só na F2-02), backend/alembic.ini,
#   backend/passenger_wsgi.py, backend/requirements.txt, frontend/dist,
#   deploy/ (a pasta toda, incluindo este script e o `.cpanel.yml`, se já
#   lá estiver) e `api/VERSION` (o SHA, e mais nada).
#
# `.cpanel.yml` é também copiado para a RAIZ do pacote (não só para
# dentro de `deploy/`): o cPanel só o lê ali. Esse ficheiro é de outra
# frente da F1-04; se `deploy/.cpanel.yml` ainda não existir na raiz do
# projeto quando este script corre, recusa-se com uma mensagem clara em
# vez de inventar um.
#
# --- S-10 e S-12, dentro do próprio pacote ---
#
# A pasta de deploy nunca pode levar nada do S-10 (`.db`, `.sqlite`,
# `.env`, dumps SQL, ...) nem do S-12 (`.claude/`, `CLAUDE.md`, `docs/`,
# `tests/`, `e2e/` — regra 4 do `CLAUDE.md` da raiz). Este script NÃO
# invoca `.github/scripts/verificar-ficheiros-proibidos.sh`: esse
# caminho é relativo à raiz do REPOSITÓRIO real, não à raiz resolvida a
# partir do próprio `montar.sh` (que, em teste, é uma árvore de trabalho
# fabricada sem pasta `.github/` nenhuma) — depender dele quebraria a
# idempotência e a independência deste script. A exclusão é feita aqui,
# de propósito duplicada (ver comentário acima do guarda central em
# `.github/scripts/verificar-ficheiros-proibidos.sh`), com a mesma lógica
# de padrões.
#
# Decisão: exclui-se em silêncio durante a cópia (um `docs/` ou um
# `CLAUDE.md` apanhados aqui não travam um deploy só por isso — não é
# uma falha de quem monta o pacote, é o próprio processo de exclusão a
# funcionar). Mas, como rede de segurança final (defesa em profundidade:
# presa aos BYTES do pacote já montado, não à ordem dos passos de quem
# chama este script), corre-se a mesma verificação outra vez sobre a
# árvore já montada, no fim — se, apesar da exclusão, algo proibido
# sobreviver (um erro nesta lógica, um ficheiro que chegou por outro
# caminho que não os explicitamente copiados acima), o script recusa
# (código de saída 1). Nunca pode sair 0 com um proibido dentro.

uso() {
  echo "Uso: $(basename "$0") --sha <40 hex> --saida <pasta>" >&2
}

sha=""
saida=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --sha)
      if [ "$#" -lt 2 ]; then
        uso
        exit 2
      fi
      sha="$2"
      shift 2
      ;;
    --saida)
      if [ "$#" -lt 2 ]; then
        uso
        exit 2
      fi
      saida="$2"
      shift 2
      ;;
    *)
      uso
      exit 2
      ;;
  esac
done

if [ -z "$sha" ] || [ -z "$saida" ]; then
  uso
  exit 2
fi

# Exatamente 40 carateres hexadecimais em minúsculas — nunca maiúsculas,
# nunca mais curto/comprido, nunca nada a seguir (incluindo um newline).
if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Erro: --sha tem de ser exatamente 40 carateres hexadecimais em minúsculas (^[0-9a-f]{40}\$), recebi '${sha}'." >&2
  exit 1
fi

# Raiz do projeto a partir do PRÓPRIO caminho deste script — nunca
# `git rev-parse`. `$0` é o caminho com que este script foi invocado
# (sempre absoluto, nos testes e no CI); `dirname` dá a pasta `deploy/`,
# e `/..` sobe para a raiz.
raiz_projeto="$(cd "$(dirname "$0")/.." && pwd)"

raiz_backend="${raiz_projeto}/backend"
raiz_frontend_dist="${raiz_projeto}/frontend/dist"
raiz_deploy="${raiz_projeto}/deploy"
cpanel_yml_origem="${raiz_deploy}/.cpanel.yml"

# --- Sanidade de `--saida`: o único passo destrutivo deste script ---
#
# Mais abaixo há um `rm -rf -- "$saida"`, e esse é o único comando aqui
# que apaga alguma coisa. No CI o caminho vem fixo e descartável
# (`${runner.temp}/pacote`), mas este script também se corre à mão — e
# aí `--saida .`, `--saida "$HOME"` ou `--saida deploy` apagam o alvo
# antes de o script sequer chegar a montar seja o que for (com `--saida
# deploy`, apaga a própria pasta que ia copiar e só depois falha).
#
# Recusa-se, portanto: a raiz do sistema de ficheiros, a pasta pessoal
# (`$HOME`), a raiz do projeto, qualquer caminho DENTRO dela e qualquer
# caminho que a CONTENHA (um `--saida ~/Desktop` levaria o repositório
# inteiro à frente). Esta verificação vem antes de todas as outras: as
# que faltam só dizem "não há o que montar", esta diz "não se apaga
# isto", e é a única cuja ordem importa.

# normalizar_caminho <caminho>
# Imprime o caminho absoluto e sem `.` nem `..` — sem exigir que exista
# (a pasta de saída normalmente ainda não existe). Duas passagens:
# primeiro lexical (resolve `.` e `..` sobre o texto, para um
# `.../x/../trabalho/pacote` não escapar às comparações abaixo), depois
# física (`cd -P`) sobre o prefixo que JÁ existe, com o resto colado de
# volta no fim. Símbolos só se resolvem nesse prefixo: os componentes
# que ainda não existem não podem ser símbolo nenhum. Sai 1 se nem o
# prefixo se conseguir resolver — e aí não se apaga nada: um caminho que
# não se consegue sequer nomear nunca pode ser tomado por seguro
# (regra 10).
normalizar_caminho() {
  local entrada lexical resto_entrada componente cauda prefixo base

  entrada="$1"
  case "$entrada" in
    /*) ;;
    *) entrada="${PWD}/${entrada}" ;;
  esac

  lexical=""
  resto_entrada="$entrada"
  while [ -n "$resto_entrada" ]; do
    componente="${resto_entrada%%/*}"
    if [ "$componente" = "$resto_entrada" ]; then
      resto_entrada=""
    else
      resto_entrada="${resto_entrada#*/}"
    fi
    case "$componente" in
      "" | ".") ;;
      "..") lexical="${lexical%/*}" ;;
      *) lexical="${lexical}/${componente}" ;;
    esac
  done
  [ -n "$lexical" ] || lexical="/"

  cauda=""
  prefixo="$lexical"
  while [ ! -d "$prefixo" ] && [ "$prefixo" != "/" ]; do
    cauda="${prefixo##*/}${cauda:+/}${cauda}"
    prefixo="${prefixo%/*}"
    [ -n "$prefixo" ] || prefixo="/"
  done

  base="$(CDPATH='' cd -P -- "$prefixo" 2>/dev/null && pwd -P)" || return 1
  [ -n "$base" ] || return 1

  if [ -n "$cauda" ]; then
    printf '%s' "${base%/}/${cauda}"
  else
    printf '%s' "$base"
  fi
}

# Regra 10: o estado de `normalizar_caminho` é capturado à mão, nunca
# dentro de um `if`. "Não consegui resolver o caminho" e "o caminho é
# aceitável" não podem dar no mesmo — o passo a seguir é um `rm -rf`.
#
# O resultado sai por `$CAMINHO_NORMALIZADO`, de propósito, e nunca por
# substituição de comando: um `exit 1` dentro de `$( )` só mata o
# subshell, e o script continuaria em frente com a variável vazia — isto
# é, com a recusa impressa no stderr e o `rm -rf` a correr à mesma.
normalizar_ou_recusar() {
  local estado_normalizacao
  set +e
  CAMINHO_NORMALIZADO="$(normalizar_caminho "$1")"
  estado_normalizacao=$?
  set -e
  if [ "$estado_normalizacao" -ne 0 ] || [ -z "$CAMINHO_NORMALIZADO" ]; then
    echo "Erro: não foi possível resolver o caminho '${1}' (${2}) — não é seguro continuar, porque este script começa por apagar a pasta de saída." >&2
    exit 1
  fi
}

recusar_saida() {
  echo "Erro: --saida '${saida}' resolve para '${saida_real}', que é ${1}. Este script começa por apagar a pasta de saída ('rm -rf'), e isso nunca pode ser dirigido aí. Escolhe uma pasta descartável e fora da raiz do projeto (ex.: \"\$(mktemp -d)/pacote\")." >&2
  exit 1
}

normalizar_ou_recusar "$saida" "--saida"
saida_real="$CAMINHO_NORMALIZADO"

normalizar_ou_recusar "$raiz_projeto" "raiz do projeto"
raiz_projeto_real="$CAMINHO_NORMALIZADO"

if [ "$saida_real" = "/" ]; then
  recusar_saida "a raiz do sistema de ficheiros"
fi

if [ -n "${HOME:-}" ]; then
  normalizar_ou_recusar "$HOME" "\$HOME"
  home_real="$CAMINHO_NORMALIZADO"
  if [ "$saida_real" = "$home_real" ]; then
    recusar_saida "a pasta pessoal (\$HOME)"
  fi
fi

if [ "$saida_real" = "$raiz_projeto_real" ]; then
  recusar_saida "a raiz do projeto ('${raiz_projeto_real}')"
fi

if [ "${saida_real#"${raiz_projeto_real%/}/"}" != "$saida_real" ]; then
  recusar_saida "um caminho dentro da raiz do projeto ('${raiz_projeto_real}')"
fi

if [ "${raiz_projeto_real#"${saida_real%/}/"}" != "$raiz_projeto_real" ]; then
  recusar_saida "uma pasta que CONTÉM a raiz do projeto ('${raiz_projeto_real}')"
fi

if [ ! -f "${raiz_frontend_dist}/index.html" ]; then
  echo "Erro: '${raiz_frontend_dist}/index.html' não existe — o build do frontend ('npm run build') não correu." >&2
  exit 1
fi

for obrigatorio in \
  "${raiz_backend}/app" \
  "${raiz_backend}/migrations" \
  "${raiz_backend}/alembic.ini" \
  "${raiz_backend}/passenger_wsgi.py" \
  "${raiz_backend}/requirements.txt"; do
  if [ ! -e "$obrigatorio" ]; then
    echo "Erro: '${obrigatorio}' não existe — não há o que montar." >&2
    exit 1
  fi
done

if [ ! -f "$cpanel_yml_origem" ]; then
  echo "Erro: '${cpanel_yml_origem}' não existe. Esse ficheiro é de outra frente da F1-04 (não é este script que o cria) — o pacote não pode sair sem ele, porque o cPanel só lê '.cpanel.yml' na raiz do pacote." >&2
  exit 1
fi

# --- Limpa e recria a pasta de saída (idempotência: cada corrida parte
# sempre da mesma folha em branco) ---

if [ -e "$saida" ]; then
  if ! rm -rf -- "$saida"; then
    echo "Erro: não foi possível limpar a pasta de saída '${saida}' (ver mensagens do 'rm' acima); não é seguro continuar." >&2
    exit 1
  fi
fi
mkdir -p -- "$saida"

api_dir="${saida}/api"
mkdir -p -- "$api_dir"

cp -a -- "${raiz_backend}/app" "${api_dir}/app"
cp -a -- "${raiz_backend}/migrations" "${api_dir}/migrations"
if [ -d "${raiz_backend}/scripts" ]; then
  cp -a -- "${raiz_backend}/scripts" "${api_dir}/scripts"
fi
cp -- "${raiz_backend}/alembic.ini" "${api_dir}/alembic.ini"
cp -- "${raiz_backend}/passenger_wsgi.py" "${api_dir}/passenger_wsgi.py"
cp -- "${raiz_backend}/requirements.txt" "${api_dir}/requirements.txt"

mkdir -p -- "${saida}/frontend"
cp -a -- "$raiz_frontend_dist" "${saida}/frontend/dist"

cp -a -- "$raiz_deploy" "${saida}/deploy"

# `api/VERSION`: o SHA, e mais nada — sem newline, sem espaços.
printf '%s' "$sha" >"${api_dir}/VERSION"

# `.cpanel.yml` duplicado na RAIZ do pacote: é o único sítio que o
# cPanel lê. Fica também dentro de `deploy/` (copiado acima, como parte
# da pasta inteira) — isso não é um problema, só a ausência na raiz é
# que seria.
cp -- "$cpanel_yml_origem" "${saida}/.cpanel.yml"

# Artefactos de build do Python (bytecode em cache): nunca são o
# critério S-10/S-12, mas não têm nada que fazer num pacote de deploy —
# higiene, não segurança. Removidos antes da exclusão de segurança,
# abaixo, para não poluir a lista de "encontrados" caso algo corra mal.
find "$saida" -depth -type d -name "__pycache__" -exec rm -rf -- {} +
find "$saida" -type f -name "*.pyc" -delete

# --- Os padrões do S-10/S-12, escritos uma única vez ---
#
# A exclusão (logo abaixo) e a auditoria final (mais abaixo) têm de
# procurar EXATAMENTE a mesma coisa: no dia em que divergirem, a
# auditoria deixa de ser uma rede por baixo da exclusão e passa a ser
# uma segunda opinião sobre outro assunto — e a passagem que ficar para
# trás é a que deixa sair o ficheiro. Com os predicados escritos aqui,
# acrescentar um padrão novo é mexer num sítio só.
#
# Cada passagem acrescenta depois o que a distingue: a exclusão junta
# `-exec rm -rf -- {} +` / `-delete`, a auditoria redireciona para
# ficheiro. É também assim que se distinguem uma da outra nos testes.
#
# Duas listas, não uma: (1) diretorias proibidas do S-12, por COMPONENTE
# de caminho (`.claude`, `docs`, `tests`, `e2e` — a qualquer
# profundidade, vazias ou não: por isso é `-type d`, nunca só `-type f`),
# com `-depth` porque as duas passagens o querem (apagar de dentro para
# fora, listar na mesma ordem); (2) ficheiros proibidos, `CLAUDE.md`
# (nome base, sem distinguir maiúsculas, a qualquer profundidade) e os
# padrões do S-10.
readonly -a PREDICADO_DIRETORIAS_PROIBIDAS=(
  -depth -type d
  '(' -name ".claude" -o -name "docs" -o -name "tests" -o -name "e2e" ')'
)

readonly -a PREDICADO_FICHEIROS_PROIBIDOS=(
  -type f
  '('
  -iname "claude.md" -o
  -iname "*.db" -o -iname "*.db-*" -o -iname "*.db.*" -o -iname "*.db3" -o
  -iname "*.sqlite" -o -iname "*.sqlite-*" -o -iname "*.sqlite.*" -o -iname "*.sqlitedb" -o
  -iname "*.sqlite3" -o -iname "*.sqlite3-*" -o -iname "*.sqlite3.*" -o
  -iname "*.sql" -o -iname "*.sql.gz" -o -iname "*.dump" -o -iname "*.mysql" -o
  -iname ".env" -o -iname ".env.*" -o -iname "*.env"
  ')'
  '!' -iname ".env.example"
)

# --- Exclusão em silêncio do que o S-10/S-12 nunca deixam passar ---
#
# Mais funda primeiro (diretorias), ficheiros remanescentes a seguir.
find "$saida" "${PREDICADO_DIRETORIAS_PROIBIDAS[@]}" -exec rm -rf -- {} +

find "$saida" "${PREDICADO_FICHEIROS_PROIBIDOS[@]}" -delete

# --- Defesa em profundidade: audita o pacote já montado, não confia só
# na exclusão acima ---
#
# Presa aos BYTES do pacote, não à ordem dos passos de quem chama este
# script: mesmo que a exclusão acima tenha um erro, ou que um passo
# futuro copie mais alguma coisa para dentro de `$saida` depois deste
# ponto, esta auditoria final apanha-o. Nunca pode sair 0 com um
# proibido dentro.
#
# Regra 10 (um guarda tem de distinguir vazio de avaria): os dois `find`
# abaixo escrevem para FICHEIRO, nunca para dentro de um `{ ...; }`
# agrupado numa substituição de comando só para o stdout — isso escondia
# o estado de cada `find` a título individual; só o último a correr
# determinava `$?` da substituição inteira (e nem esse chegava a ser
# verificado). Se a procura de diretorias falhasse (p.ex. uma subpasta
# sem permissão de leitura), a falha desaparecia em silêncio e o script
# podia sair 0 sem ter revistado o pacote todo. O mesmo padrão já usado em
# `.github/scripts/verificar-ficheiros-proibidos.sh` (grava para ficheiro,
# verifica o estado à parte) aplica-se aqui.
tmp_auditoria="$(mktemp -d)"
trap 'rm -rf -- "${tmp_auditoria}"' EXIT

tmp_dirs="${tmp_auditoria}/dirs"
tmp_dirs_err="${tmp_auditoria}/dirs.err"
tmp_ficheiros="${tmp_auditoria}/ficheiros"
tmp_ficheiros_err="${tmp_auditoria}/ficheiros.err"

# Os MESMOS predicados da exclusão acima (`PREDICADO_*_PROIBIDAS/OS`),
# sem `-exec`/`-delete`: aqui só se lê e se relata.
auditoria_falhou=0
find "$saida" "${PREDICADO_DIRETORIAS_PROIBIDAS[@]}" \
  >"$tmp_dirs" 2>"$tmp_dirs_err" || auditoria_falhou=1

find "$saida" "${PREDICADO_FICHEIROS_PROIBIDOS[@]}" \
  >"$tmp_ficheiros" 2>"$tmp_ficheiros_err" || auditoria_falhou=1

if [ "$auditoria_falhou" -ne 0 ]; then
  echo "Erro: a auditoria final (find) falhou a percorrer '${saida}' — não é seguro assumir que não há caminhos proibidos (regra 10: 'não encontrei' e 'não consegui procurar' nunca podem dar o mesmo resultado). Ver abaixo:" >&2
  cat "$tmp_dirs_err" "$tmp_ficheiros_err" >&2
  exit 1
fi

proibidos_remanescentes="$(cat "$tmp_dirs" "$tmp_ficheiros")"

if [ -n "$proibidos_remanescentes" ]; then
  echo "Erro: o pacote montado em '${saida}' ainda contém caminhos proibidos pelo S-10/S-12, apesar da exclusão:" >&2
  printf '%s\n' "$proibidos_remanescentes" >&2
  exit 1
fi

# --- `.htaccess` nunca pode sair no pacote ---
#
# O `.htaccess` real do site é mantido à mão, fora deste repositório (ver
# `deploy/htaccess.exemplo` e `docs/ESPECIFICACAO.md`, secção Servidor) —
# o deploy nunca lhe toca. Um `.htaccess` dentro do pacote (por exemplo,
# `frontend/dist/assets/.htaccess`, vindo de uma dependência de build ou
# de um erro) seria sincronizado para `WEB` por `deploy.sh` e honrado pelo
# Apache (o cPanel deixa `AllowOverride All`), sobrepondo-se à
# configuração real do servidor — nunca se exclui isto em silêncio, como
# o S-10/S-12 acima: recusa-se o pacote inteiro, em voz alta.
tmp_htaccess="${tmp_auditoria}/htaccess"
tmp_htaccess_err="${tmp_auditoria}/htaccess.err"
estado_find_htaccess=0
find "$saida" -type f -iname ".htaccess" \
  >"$tmp_htaccess" 2>"$tmp_htaccess_err" || estado_find_htaccess=1

if [ "$estado_find_htaccess" -ne 0 ]; then
  echo "Erro: a procura por '.htaccess' falhou a percorrer '${saida}' — não é seguro assumir que não há nenhum. Ver abaixo:" >&2
  cat "$tmp_htaccess_err" >&2
  exit 1
fi

if [ -s "$tmp_htaccess" ]; then
  echo "Erro: o pacote montado em '${saida}' contém pelo menos um ficheiro '.htaccess' — isto nunca pode acontecer (o .htaccess real do servidor é mantido à mão, fora deste repositório; ver deploy/htaccess.exemplo):" >&2
  cat "$tmp_htaccess" >&2
  exit 1
fi

exit 0
