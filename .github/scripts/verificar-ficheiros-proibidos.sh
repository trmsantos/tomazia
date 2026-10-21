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
#             atual), com `git ls-files -z`.
#   --pasta : percorre <dir> no disco com `find -type f -print0`, para
#             apanhar também o que não está versionado (por exemplo, um
#             build gerado em CI).
#
# Padrões proibidos, sobre o nome base do ficheiro, sem distinguir
# maiúsculas de minúsculas: *.db, *.sqlite, *.sqlite3, .env, .env.*, *.env.
# Exceção única: o nome exato ".env.example".
#
# Saída: um caminho proibido por linha. Com a variável de ambiente
# GITHUB_ACTIONS=true (GitHub Actions), cada linha ganha o prefixo
# "::error file=<caminho>::" para anotar o diff do PR.
#
# Códigos de saída:
#   0 — nada encontrado
#   1 — encontrou pelo menos um ficheiro proibido
#   2 — uso errado: argumento inválido, pasta inexistente, ou --git fora
#       de um repositório git. Um guarda que passa a verde porque a pasta
#       não existe é um guarda que não existe.
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

eh_proibido() {
  # $1 = nome base do ficheiro (sem a pasta)
  local nome_minusculo
  nome_minusculo="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"

  if [ "$nome_minusculo" = ".env.example" ]; then
    return 1
  fi

  case "$nome_minusculo" in
    *.db | *.sqlite | *.sqlite3 | .env | .env.* | *.env)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

encontrados=()

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

  while IFS= read -r -d '' caminho; do
    nome_base="$(basename "$caminho")"
    if eh_proibido "$nome_base"; then
      encontrados+=("$caminho")
    fi
  done < <(git -C "$raiz" ls-files -z)
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

  while IFS= read -r -d '' caminho; do
    nome_base="$(basename "$caminho")"
    if eh_proibido "$nome_base"; then
      encontrados+=("$caminho")
    fi
  done < <(find "$dir" -type f -print0)
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
