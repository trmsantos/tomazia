#!/usr/bin/env bash
set -euo pipefail

# auditar-npm.sh — corre `npm audit --audit-level=high` em frontend/ e
# falha se encontrar um advisory alto ou crítico que não esteja na
# allowlist `.github/auditoria-npm-permitidas.json`, ou se uma entrada da
# allowlist já tiver expirado.
#
# A allowlist existe para o caso de uma vulnerabilidade sem correção
# disponível (ver as entradas no próprio ficheiro para o porquê de cada
# uma). Cada entrada tem: id (identificador GHSA do advisory), pacote,
# severidade, razao (porque é aceitável agora), validade (AAAA-MM-DD; a
# partir desta data a entrada deixa de ser aceite, mesmo que o advisory
# continue a existir) e "sai-quando" (o que resolve isto de vez).
#
# Regras:
#   - advisory high/critical fora da allowlist (ou cuja entrada expirou)
#     -> sai 1.
#   - entrada da allowlist com `validade` no passado -> sai 1, mesmo que
#     o advisory ainda exista: é o sinal de que a isenção precisa de ser
#     revista.
#   - entrada da allowlist que já não corresponde a nenhum advisory ativo
#     -> escreve um aviso (`::warning`) e uma linha no resumo, mas sai 0
#     de propósito: um PR do Dependabot que resolva a vulnerabilidade não
#     pode ficar vermelho só por sobrar uma linha na allowlist.
#
# Nunca baixar o `--audit-level` para menos que "high", e nunca envolver
# esta chamada em `continue-on-error` no workflow.
#
# Depende de: npm, jq, coreutils.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ_REPO="$(cd "${SCRIPT_DIR}/../.." && pwd)"
FRONTEND_DIR="${RAIZ_REPO}/frontend"
ALLOWLIST="${RAIZ_REPO}/.github/auditoria-npm-permitidas.json"
NIVEL_AUDITORIA="high"

if [ ! -d "${FRONTEND_DIR}" ]; then
  echo "Erro: a pasta '${FRONTEND_DIR}' não existe." >&2
  exit 1
fi

if [ ! -f "${ALLOWLIST}" ]; then
  echo "Erro: a allowlist '${ALLOWLIST}' não existe." >&2
  exit 1
fi

if ! jq empty "${ALLOWLIST}" 2>/dev/null; then
  echo "Erro: '${ALLOWLIST}' não é JSON válido." >&2
  exit 1
fi

resumo() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    echo "$1" >>"${GITHUB_STEP_SUMMARY}"
  fi
}

# `npm audit --json` escreve sempre o relatório para o stdout, mesmo
# quando o próprio comando sai com estado 1 por haver vulnerabilidades no
# nível pedido ou acima; por isso captura-se a saída antes de decidir o
# que fazer, em vez de deixar o `set -e` interromper o script aqui.
saida_auditoria=""
estado_npm=0
saida_auditoria="$(cd "${FRONTEND_DIR}" && npm audit --json --audit-level="${NIVEL_AUDITORIA}")" || estado_npm=$?

if ! jq empty <<<"${saida_auditoria}" 2>/dev/null; then
  echo "Erro: 'npm audit --json' não devolveu JSON válido (estado ${estado_npm})." >&2
  echo "${saida_auditoria}" >&2
  exit 1
fi

hoje="$(date -u +%Y-%m-%d)"
falhou=0

# Advisories encontrados: só os nós do relatório que trazem o próprio
# advisory (campo `.url`, de onde se extrai o GHSA) com severidade alta
# ou crítica. Pacotes que só aparecem como efeito de outro (ex.:
# `chokidar` por causa do `braces`) não repetem o advisory, por isso não
# geram entradas novas aqui — o que é o comportamento desejado: os cinco
# "high" do Tailwind colapsam no único GHSA do `braces`.
encontrados=()
while IFS= read -r linha; do
  [ -n "${linha}" ] && encontrados+=("${linha}")
done < <(
  jq -r '
    [
      .vulnerabilities[]?.via[]?
      | select(type == "object")
      | select(.severity == "high" or .severity == "critical")
      | (.url | sub(".*/advisories/"; ""))
    ]
    | unique
    | .[]
  ' <<<"${saida_auditoria}"
)

ids_allowlist_validos=()
while IFS= read -r linha; do
  [ -n "${linha}" ] && ids_allowlist_validos+=("${linha}")
done < <(
  jq -r --arg hoje "${hoje}" '
    [.[] | select(.validade >= $hoje) | .id] | unique | .[]
  ' "${ALLOWLIST}"
)

ids_allowlist_expirados=()
while IFS= read -r linha; do
  [ -n "${linha}" ] && ids_allowlist_expirados+=("${linha}")
done < <(
  jq -r --arg hoje "${hoje}" '
    .[] | select(.validade < $hoje) | .id
  ' "${ALLOWLIST}"
)

em_lista() {
  # $1 = valor a procurar; restantes argumentos = lista
  local alvo="$1"
  shift
  local item
  for item in "$@"; do
    [ "$item" = "$alvo" ] && return 0
  done
  return 1
}

for id in "${ids_allowlist_expirados[@]+"${ids_allowlist_expirados[@]}"}"; do
  [ -z "${id}" ] && continue
  echo "::error::Entrada '${id}' da allowlist tem a validade expirada (hoje: ${hoje}). Revê .github/auditoria-npm-permitidas.json: renova a validade ou resolve a vulnerabilidade." >&2
  resumo "- Entrada \`${id}\` da allowlist de auditoria npm está expirada (precisa de revisão)."
  falhou=1
done

for id in "${encontrados[@]+"${encontrados[@]}"}"; do
  [ -z "${id}" ] && continue
  if ! em_lista "${id}" "${ids_allowlist_validos[@]+"${ids_allowlist_validos[@]}"}"; then
    echo "::error::Advisory ${id} (alto ou crítico, npm audit --audit-level=${NIVEL_AUDITORIA}) não está na allowlist (ou a entrada expirou). Resolve a vulnerabilidade ou acrescenta uma entrada a .github/auditoria-npm-permitidas.json." >&2
    resumo "- Advisory \`${id}\` fora da allowlist de auditoria npm."
    falhou=1
  fi
done

for id in "${ids_allowlist_validos[@]+"${ids_allowlist_validos[@]}"}"; do
  [ -z "${id}" ] && continue
  if ! em_lista "${id}" "${encontrados[@]+"${encontrados[@]}"}"; then
    echo "::warning::Entrada '${id}' da allowlist já não corresponde a nenhum advisory ativo. Podes removê-la de .github/auditoria-npm-permitidas.json."
    resumo "- Entrada \`${id}\` da allowlist de auditoria npm já não corresponde a nenhum advisory (pode ser removida)."
  fi
done

if [ "${falhou}" -eq 0 ]; then
  echo "auditar-npm.sh: nenhum advisory alto/crítico fora da allowlist."
fi

exit "${falhou}"
