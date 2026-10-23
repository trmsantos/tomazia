#!/usr/bin/env bash
set -euo pipefail

# montar.sh — monta a pasta que vai para o servidor (F1-04, agente infra).
#
# Uso: montar.sh --sha <40 hex> --saida <pasta>
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

# --- Exclusão em silêncio do que o S-10/S-12 nunca deixam passar ---
#
# Duas passagens, mais funda primeiro: (1) diretorias proibidas do S-12,
# por COMPONENTE de caminho (`.claude`, `docs`, `tests`, `e2e` — a
# qualquer profundidade, vazias ou não: por isso esta é uma procura
# `-type d`, nunca só `-type f`); (2) ficheiros proibidos remanescentes,
# `CLAUDE.md` (nome base, sem distinguir maiúsculas, a qualquer
# profundidade) e os padrões do S-10.
find "$saida" -depth -type d \
  \( -name ".claude" -o -name "docs" -o -name "tests" -o -name "e2e" \) \
  -exec rm -rf -- {} +

find "$saida" -type f \( \
  -iname "claude.md" -o \
  -iname "*.db" -o -iname "*.db-*" -o -iname "*.db.*" -o -iname "*.db3" -o \
  -iname "*.sqlite" -o -iname "*.sqlite-*" -o -iname "*.sqlite.*" -o -iname "*.sqlitedb" -o \
  -iname "*.sqlite3" -o -iname "*.sqlite3-*" -o -iname "*.sqlite3.*" -o \
  -iname "*.sql" -o -iname "*.sql.gz" -o -iname "*.dump" -o -iname "*.mysql" -o \
  -iname ".env" -o -iname ".env.*" -o -iname "*.env" \
  \) ! -iname ".env.example" -delete

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

auditoria_falhou=0
find "$saida" -depth -type d \
  \( -name ".claude" -o -name "docs" -o -name "tests" -o -name "e2e" \) \
  >"$tmp_dirs" 2>"$tmp_dirs_err" || auditoria_falhou=1

find "$saida" -type f \( \
  -iname "claude.md" -o \
  -iname "*.db" -o -iname "*.db-*" -o -iname "*.db.*" -o -iname "*.db3" -o \
  -iname "*.sqlite" -o -iname "*.sqlite-*" -o -iname "*.sqlite.*" -o -iname "*.sqlitedb" -o \
  -iname "*.sqlite3" -o -iname "*.sqlite3-*" -o -iname "*.sqlite3.*" -o \
  -iname "*.sql" -o -iname "*.sql.gz" -o -iname "*.dump" -o -iname "*.mysql" -o \
  -iname ".env" -o -iname ".env.*" -o -iname "*.env" \
  \) ! -iname ".env.example" \
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
