#!/usr/bin/env bash
set -euo pipefail

# publicar-branch.sh — põe a árvore da branch `deploy` igual à pasta
# montada (`deploy/montar.sh --saida <pasta>`) e empurra fast-forward
# para `origin` (F1-04, agente infra).
#
# Uso: publicar-branch.sh --pasta <pasta> --sha <40 hex> --branch deploy
#
# Corre a partir de um checkout normal do projeto (`cwd` = um clone do
# repositório, com `origin` já configurado) — nunca precisa de nenhum
# ficheiro irmão relativo ao seu próprio caminho, só de `--pasta` e de
# operações git em `cwd`.
#
# --- Nunca `--force` ---
#
# Este script NUNCA usa `--force`/`--force-with-lease` em `git push`. A
# proteção fast-forward vem do próprio git: cada publicação cria um commit
# cujo PAI é o commit que este script reconhece como o último que ele
# próprio publicou (ver "Proveniência", abaixo) — nunca o que o remoto
# diz ser o estado atual, aceite às cegas. Um `git push` normal (sem
# `--force`) só avança uma branch já existente se o commit novo for
# descendente do valor REAL e atual dessa branch no remoto (é o próprio
# protocolo do git que verifica isto, nunca uma suposição nossa); se
# alguém ou algo mexeu em `deploy` por fora deste script (ver
# "Proveniência"), o parentesco que construímos deixa de bater certo com
# o que está la, e o push falha sozinho — sem precisarmos de o detetar
# nós próprios. O lado do servidor, por sua vez, puxa com `--ff-only`
# (`docs/ESPECIFICACAO.md`, secção Servidor): as duas pontas, em conjunto,
# nunca aceitam um recuo silencioso de histórico.
#
# --- Proveniência: de onde vem o "último SHA publicado" ---
#
# Cada commit que este script cria em `deploy` leva, no corpo da
# mensagem, uma linha exata "Sha-Origem: <sha>" (o `--sha` pedido nessa
# publicação). Para decidir o que fazer a seguir, o script primeiro faz
# `git fetch origin <branch>` (só essa branch, nunca `main`) e olha para
# o commit atual aí:
#
#   - Branch ainda não existe no remoto: primeira publicação, o commit
#     novo não tem pai (raiz de `deploy`).
#   - Branch existe, mas o commit de topo NÃO tem a linha
#     "Sha-Origem: <40 hex>": histórico que este script não reconhece
#     como seu (por exemplo, algo publicado à mão, ou uma branch
#     divergente empurrada por fora deste mecanismo). Recusa-se a
#     publicar — exige confirmação humana antes de continuar, em vez de
#     construir às cegas em cima de histórico desconhecido.
#   - Branch existe e É reconhecida (tem a linha): o SHA aí dentro é o
#     "último publicado". Se o `--sha` desta chamada for ESSE MESMO sha,
#     publica na mesma (um commit novo, de conteúdo igual ou não — um
#     republicar manual tem de mexer a branch, senão parece que não fez
#     nada). Se for DIFERENTE, recusa-se quando o novo `--sha` for
#     antepassado do último publicado (anti-retrocesso); caso contrário,
#     publica com o commit atual como pai.
#
# --- S-12 (e S-10) sobre a pasta, outra vez, aqui ---
#
# `montar.sh` já exclui estes padrões ao montar o pacote; isto corre a
# MESMA verificação (`.github/scripts/verificar-ficheiros-proibidos.sh
# --pasta <pasta> --conjunto todos`) outra vez, sobre a pasta que nos foi
# dada, imediatamente antes de construir a árvore git — presa aos BYTES
# do pacote, não à ordem dos passos de quem chama este script: mesmo que
# o workflow venha a ser reordenado (ou outra coisa qualquer monte a
# pasta sem passar por `montar.sh`), esta publicação continua a recusar
# um `.claude/`, `CLAUDE.md`, `docs/`, `tests/`, `e2e/`, `.env` ou `.db`
# que lá apareça.

uso() {
  echo "Uso: $(basename "$0") --pasta <pasta> --sha <40 hex> --branch deploy" >&2
}

pasta=""
sha=""
branch=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --pasta)
      if [ "$#" -lt 2 ]; then uso; exit 2; fi
      pasta="$2"
      shift 2
      ;;
    --sha)
      if [ "$#" -lt 2 ]; then uso; exit 2; fi
      sha="$2"
      shift 2
      ;;
    --branch)
      if [ "$#" -lt 2 ]; then uso; exit 2; fi
      branch="$2"
      shift 2
      ;;
    *)
      uso
      exit 2
      ;;
  esac
done

if [ -z "$pasta" ] || [ -z "$sha" ] || [ -z "$branch" ]; then
  uso
  exit 2
fi

# Nunca publica noutra branch: o lado do servidor só conhece `deploy`.
# Verificado em primeiro lugar, antes de qualquer operação git — uma
# chamada com o nome errado não pode ter efeito nenhum, nem sequer um
# `fetch`.
if [ "$branch" != "deploy" ]; then
  echo "Erro: --branch tem de ser 'deploy', recebi '${branch}'." >&2
  exit 1
fi

if [ ! -d "$pasta" ]; then
  echo "Erro: a pasta '${pasta}' não existe." >&2
  exit 1
fi

if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Erro: --sha tem de ser exatamente 40 carateres hexadecimais em minúsculas (^[0-9a-f]{40}\$), recebi '${sha}'." >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Erro: a pasta atual não está dentro de um repositório git." >&2
  exit 2
fi

# --- S-12/S-10 sobre a pasta, antes de tocar em git ---
#
# Resolvido a partir do PRÓPRIO caminho deste script (nunca a partir de
# `git rev-parse`, nem do `cwd`): ao contrário de `montar.sh`, este
# script corre sempre a partir do seu caminho real dentro do
# repositório (nunca copiado para outra árvore), por isso
# `.github/scripts/verificar-ficheiros-proibidos.sh` está sempre lá.
raiz_projeto="$(cd "$(dirname "$0")/.." && pwd)"
verificador="${raiz_projeto}/.github/scripts/verificar-ficheiros-proibidos.sh"

if [ ! -x "$verificador" ]; then
  echo "Erro: '${verificador}' não existe (ou não é executável) — sem ele não há como confirmar o S-12/S-10 sobre '${pasta}'; recuso-me a publicar às cegas." >&2
  exit 1
fi

if ! "$verificador" --pasta "$pasta" --conjunto todos; then
  echo "Erro: '${pasta}' tem pelo menos um caminho proibido pelo S-12/S-10 (ver acima) — publicação recusada." >&2
  exit 1
fi

# --- Proveniência: o que já está publicado, se alguma coisa estiver ---

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

branch_existe=0
tip_remoto=""
if git fetch --quiet origin "$branch" 2>"${tmp_dir}/fetch.err"; then
  branch_existe=1
  tip_remoto="$(git rev-parse FETCH_HEAD)"
fi

novo_pai=""
if [ "$branch_existe" -eq 1 ]; then
  mensagem_anterior="$(git log -1 --format=%B "$tip_remoto")"
  sha_anterior="$(
    printf '%s\n' "$mensagem_anterior" \
      | grep -E '^Sha-Origem: [0-9a-f]{40}$' \
      | tail -n1 \
      | awk '{print $2}'
  )"

  if [ -z "$sha_anterior" ]; then
    echo "Erro: a branch '${branch}' já existe no remoto, mas o commit de topo (${tip_remoto}) não tem a linha 'Sha-Origem: <sha>' — histórico que este script não reconhece como seu (publicado à mão, ou por outra coisa qualquer). Confirma o estado da branch antes de tentar outra vez; publicação recusada." >&2
    exit 1
  fi

  if [ "$sha" != "$sha_anterior" ]; then
    if git merge-base --is-ancestor "$sha" "$sha_anterior"; then
      echo "Erro: --sha '${sha}' é antepassado do já publicado ('${sha_anterior}') — recuso publicar um retrocesso. Publicação recusada." >&2
      exit 1
    fi
  fi

  novo_pai="$tip_remoto"
fi

# --- Constrói a árvore git a partir de `$pasta`, sem checkout nenhum ---
#
# Índice temporário + `GIT_WORK_TREE=$pasta`: a forma padrão de indexar
# o conteúdo de uma pasta qualquer como se fosse a raiz de um commit, sem
# nunca tocar no índice nem na árvore de trabalho REAIS deste checkout
# (que continuam a ser o checkout do projeto, nunca `$pasta`).
indice_tmp="${tmp_dir}/indice"
git_dir="$(git rev-parse --absolute-git-dir)"

GIT_INDEX_FILE="$indice_tmp" git --git-dir="$git_dir" --work-tree="$pasta" -C "$pasta" add -A
arvore="$(GIT_INDEX_FILE="$indice_tmp" git --git-dir="$git_dir" write-tree)"

mensagem_commit="$(printf 'deploy: publica %s\n\nSha-Origem: %s\n' "$sha" "$sha")"

if [ -n "$novo_pai" ]; then
  novo_commit="$(git commit-tree "$arvore" -p "$novo_pai" -m "$mensagem_commit")"
else
  novo_commit="$(git commit-tree "$arvore" -m "$mensagem_commit")"
fi

# `git push`, sem `--force`: ver o comentário no topo do ficheiro.
git push origin "${novo_commit}:refs/heads/${branch}"

exit 0
