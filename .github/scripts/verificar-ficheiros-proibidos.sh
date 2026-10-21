#!/usr/bin/env bash
set -euo pipefail

# verificar-ficheiros-proibidos.sh — S-10: garante que nenhuma base de
# dados nem ficheiro de ambiente está versionado no repositório, nem
# acaba dentro de uma pasta de build ou de deploy.
#
# Uso:
#   verificar-ficheiros-proibidos.sh --git [<raiz>]
#   verificar-ficheiros-proibidos.sh --pasta <dir>
#
#   --git   : percorre os ficheiros VERSIONADOS em <raiz> (omitido = pasta
#             atual), com `git ls-files -z --recurse-submodules` (para um
#             eventual submódulo não ficar escondido atrás do gitlink).
#   --pasta : percorre <dir> no disco com `find -L -type f -o -type l
#             -print0`, para apanhar também o que não está versionado
#             (por exemplo, um build gerado em CI) e o que só existe
#             através de uma ligação simbólica.
#
# Padrões proibidos, sobre o nome base do ficheiro, sem distinguir
# maiúsculas de minúsculas: *.db, *.sqlite, *.sqlite3 (e os ficheiros
# auxiliares do modo WAL destes três: *-wal, *-shm, *-journal, incluindo
# *.sqlite3-*), *.sql, *.sql.gz, .env, .env.*, *.env.
#
# Exceções, sempre explícitas e documentadas, nunca por heurística:
#   - o nome exato ".env.example".
#   - o caminho exato "docs/legado/esquema-bd-antiga.sql" (ver
#     `eh_excecao_caminho`, abaixo): é o esquema do MySQL do site antigo,
#     não dados — documentação legítima, versionada de propósito.
#
# Saída: um caminho proibido por linha. Com a variável de ambiente
# GITHUB_ACTIONS=true (GitHub Actions), cada linha ganha o prefixo
# "::error file=<caminho>::" para anotar o diff do PR.
#
# Códigos de saída:
#   0 — nada encontrado
#   1 — encontrou pelo menos um ficheiro proibido
#   2 — uso errado: argumento inválido, pasta inexistente, --git fora de
#       um repositório git, ou falha a meio da própria procura (`git
#       ls-files`/`find` saiu com erro, índice corrompido, subpasta sem
#       permissão de leitura, etc.). Um guarda que passa a verde porque a
#       procura não conseguiu terminar é um guarda que não existe.
#
# Sem dependências além de git, find e coreutils.

uso() {
  echo "Uso: $(basename "$0") --git [<raiz>]" >&2
  echo "   ou: $(basename "$0") --pasta <dir>" >&2
}

modo="${1:-}"

if [ "$modo" != "--git" ] && [ "$modo" != "--pasta" ]; then
  uso
  exit 2
fi
shift

# Caminhos exatos excecionados, apesar de corresponderem a um padrão
# proibido. Cada entrada tem de vir com o porquê, exatamente como o
# ".env.example": nunca uma heurística genérica (ex.: "tudo dentro de
# docs/legado/"), sempre um caminho fixo.
EXCECOES_CAMINHO=(
  # Esquema (DDL) do MySQL do site PHP antigo, não dados: documentação
  # legítima de como a base antiga estava estruturada, versionada de
  # propósito para consulta durante a migração.
  "docs/legado/esquema-bd-antiga.sql"
)

eh_excecao_caminho() {
  # $1 = caminho tal como devolvido por `git ls-files`/`find`
  local caminho="$1"
  local excecao
  for excecao in "${EXCECOES_CAMINHO[@]}"; do
    if [ "$caminho" = "$excecao" ]; then
      return 0
    fi
  done
  return 1
}

eh_proibido() {
  # $1 = caminho do ficheiro (usado para a exceção por caminho exato);
  # o padrão em si olha só para o nome base, sem distinguir maiúsculas.
  local caminho="$1"
  local nome_base
  nome_base="$(basename "$caminho")"
  local nome_minusculo
  nome_minusculo="$(printf '%s' "$nome_base" | tr '[:upper:]' '[:lower:]')"

  if [ "$nome_minusculo" = ".env.example" ]; then
    return 1
  fi

  if eh_excecao_caminho "$caminho"; then
    return 1
  fi

  case "$nome_minusculo" in
    *.db | *.db-wal | *.db-shm | *.db-journal | \
      *.sqlite | *.sqlite-wal | *.sqlite-shm | *.sqlite-journal | \
      *.sqlite3 | *.sqlite3-* | \
      *.sql | *.sql.gz | \
      .env | .env.* | *.env)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

encontrados=()
tmp_lista="$(mktemp)"
trap 'rm -f "$tmp_lista"' EXIT

if [ "$modo" = "--git" ]; then
  raiz="${1:-.}"
  if [ "$#" -gt 1 ]; then
    uso
    exit 2
  fi

  if [ ! -d "$raiz" ]; then
    echo "Erro: a pasta '$raiz' não existe." >&2
    exit 2
  fi

  if ! git -C "$raiz" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "Erro: '$raiz' não está dentro de um repositório git." >&2
    exit 2
  fi

  # Grava para ficheiro em vez de ler de `< <(...)`: a substituição de
  # processo corre em subshell, e o `while` que lê dela não vê (nem
  # pode propagar) o estado de saída do `git ls-files` — um índice
  # corrompido imprimiria "fatal:" e o script seguiria em frente como se
  # não houvesse nada a assinalar.
  if ! git -C "$raiz" ls-files -z --recurse-submodules >"$tmp_lista" 2>"${tmp_lista}.err"; then
    echo "Erro: 'git ls-files' falhou em '$raiz' (ver abaixo); não é seguro assumir que não há ficheiros proibidos." >&2
    cat "${tmp_lista}.err" >&2
    exit 2
  fi

  while IFS= read -r -d '' caminho; do
    if eh_proibido "$caminho"; then
      encontrados+=("$caminho")
    fi
  done <"$tmp_lista"
else
  # --pasta
  dir="${1:-}"
  if [ -z "$dir" ] || [ "$#" -gt 1 ]; then
    uso
    exit 2
  fi

  if [ ! -d "$dir" ]; then
    echo "Erro: a pasta '$dir' não existe." >&2
    exit 2
  fi

  # `-L`: segue ligações simbólicas, para uma pasta ligada ou um
  # ficheiro ligado para fora de `$dir` não escaparem à procura.
  # `\( -type f -o -type l \)`: com `-L`, uma ligação para um alvo que
  # não existe (ou inacessível) deixa de ser `-type f`; mantém-se aqui
  # como `-type l` para não desaparecer da procura em silêncio.
  #
  # Grava para ficheiro pela mesma razão do modo `--git`: uma subpasta
  # sem permissão de leitura faz o `find` escrever "Permission denied"
  # e sair com erro; sem verificar o estado, o script seguiria em frente
  # como se essa subpasta tivesse sido revistada e estivesse limpa.
  if ! find -L "$dir" \( -type f -o -type l \) -print0 >"$tmp_lista" 2>"${tmp_lista}.err"; then
    echo "Erro: 'find' falhou a percorrer '$dir' (ver abaixo); não é seguro assumir que não há ficheiros proibidos." >&2
    cat "${tmp_lista}.err" >&2
    exit 2
  fi

  while IFS= read -r -d '' caminho; do
    if eh_proibido "$caminho"; then
      encontrados+=("$caminho")
    fi
  done <"$tmp_lista"
fi

if [ "${#encontrados[@]}" -eq 0 ]; then
  exit 0
fi

for caminho in "${encontrados[@]}"; do
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "::error file=${caminho}::${caminho}"
  else
    echo "${caminho}"
  fi
done

exit 1
