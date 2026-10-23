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

# Regra 10 (um guarda tem de distinguir vazio de avaria): a existência da
# branch e uma avaria de rede/credenciais são coisas diferentes, e não
# podem produzir a mesma reação. `git ls-remote --exit-code` tem três
# saídas possíveis (ver `git-ls-remote(1)`): 0 (encontrou a referência —
# a branch existe), 2 (não encontrou nenhuma — a branch ainda não
# existe), e qualquer outra coisa (avaria: rede em baixo, autenticação
# recusada, `origin` mal configurado, ...). Só o 2 pode ser lido como
# "primeira publicação"; tudo o resto tem de abortar — um guarda que
# tratasse uma avaria de rede como "a branch ainda não existe" publicaria
# às cegas por cima de histórico que nem chegou a conseguir ler.
set +e
git ls-remote --exit-code --heads origin "$branch" >"${tmp_dir}/ls-remote.out" 2>"${tmp_dir}/ls-remote.err"
estado_ls_remote=$?
set -e

case "$estado_ls_remote" in
  0) branch_existe=1 ;;
  2) branch_existe=0 ;;
  *)
    echo "Erro: não foi possível confirmar se a branch '${branch}' existe no remoto (git ls-remote saiu com o código ${estado_ls_remote}); ver abaixo. Publicação recusada — nunca se trata uma avaria de rede/autenticação como \"a branch ainda não existe\"." >&2
    cat "${tmp_dir}/ls-remote.err" >&2
    exit 1
    ;;
esac

if [ "$branch_existe" -eq 1 ]; then
  # A existência já está confirmada acima; isto só traz os objetos para
  # o repositório local. Corre sem guarda manual de propósito: com
  # `set -euo pipefail` ainda ativo, uma falha AQUI (depois de já
  # sabermos que a branch existe) é sempre uma avaria a sério, e tem de
  # abortar o script — nunca ser confundida com "a branch não existe".
  git fetch --quiet origin "$branch"
  tip_remoto="$(git rev-parse FETCH_HEAD)"
fi

novo_pai=""
if [ "$branch_existe" -eq 1 ]; then
  mensagem_anterior="$(git log -1 --format=%B "$tip_remoto")"
  # Regra 10, outra vez: com `pipefail`, um `grep` sem correspondência
  # (branch existente, mas sem a linha `Sha-Origem:`) faz a pipeline
  # inteira sair com código 1, e `set -e` apanhava isso ANTES da
  # mensagem clara abaixo — abortava com um código de saída vazio e sem
  # explicação nenhuma, em vez de dizer que o histórico não é
  # reconhecido. `set +e`/`set -e` à volta só da extração garante que é
  # sempre o `if [ -z "$sha_anterior" ]`, a seguir, que decide e explica.
  set +e
  sha_anterior="$(
    printf '%s\n' "$mensagem_anterior" \
      | grep -E '^Sha-Origem: [0-9a-f]{40}$' \
      | tail -n1 \
      | awk '{print $2}'
  )"
  set -e

  if [ -z "$sha_anterior" ]; then
    echo "Erro: a branch '${branch}' já existe no remoto, mas o commit de topo (${tip_remoto}) não tem a linha 'Sha-Origem: <sha>' — histórico que este script não reconhece como seu (publicado à mão, ou por outra coisa qualquer). Confirma o estado da branch antes de tentar outra vez; publicação recusada." >&2
    exit 1
  fi

  if [ "$sha" != "$sha_anterior" ]; then
    # Regra 10, outra vez: `git merge-base --is-ancestor` tem TRÊS saídas
    # possíveis (ver `git-merge-base(1)`), não duas — 0 (é antepassado),
    # 1 (não é antepassado) e qualquer outro código (tipicamente 128,
    # quando falta um objeto: um dos dois commits não está presente no
    # repositório local, p. ex. por um `fetch-depth` raso). Um `if git
    # merge-base --is-ancestor ...; then` lê 128 exatamente como lê 1 —
    # "não é antepassado" — e deixa passar em silêncio o cenário para que
    # este guarda existe: sem o commit antigo localmente, não há como
    # confirmar se há ou não retrocesso, e isso tem de abortar, nunca
    # assumir que está tudo bem.
    set +e
    git merge-base --is-ancestor "$sha" "$sha_anterior"
    estado_merge_base=$?
    set -e

    case "$estado_merge_base" in
      0)
        echo "Erro: --sha '${sha}' é antepassado do já publicado ('${sha_anterior}') — recuso publicar um retrocesso. Publicação recusada." >&2
        exit 1
        ;;
      1) ;; # não é antepassado: segue para publicar com o commit atual como pai.
      *)
        echo "Erro: não foi possível confirmar se '${sha}' é antepassado de '${sha_anterior}' (git merge-base --is-ancestor saiu com o código ${estado_merge_base}, não 0 nem 1 — provavelmente falta algum objeto localmente, por exemplo por um checkout com 'fetch-depth' raso). Publicação recusada: sem essa confirmação não há como garantir que isto não é um retrocesso." >&2
        exit 1
        ;;
    esac
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

# `--force` e `core.excludesFile=/dev/null` não são zelo a mais: sem eles,
# um `.gitignore` DENTRO do pacote (por exemplo `frontend/dist/.gitignore`
# com `*.js`, vindo de uma dependência de build ou lá posto de propósito)
# faz o `add -A` deixar esses ficheiros de fora, e a árvore publicada
# deixa de ser a árvore que o S-12/S-10 acabou de auditar em disco. O
# resultado é o pior possível: audita-se uma coisa e publica-se outra, o
# `deploy.sh` sincroniza com `--delete` o que recebeu, e o site desaparece
# com a pipeline toda verde. `excludesFile` cobre o mesmo por um
# `.gitignore` global da máquina, que no runner nem sequer é nosso.
GIT_INDEX_FILE="$indice_tmp" git -c core.excludesFile=/dev/null \
  --git-dir="$git_dir" --work-tree="$pasta" -C "$pasta" add -A --force
arvore="$(GIT_INDEX_FILE="$indice_tmp" git --git-dir="$git_dir" write-tree)"

# E, mesmo com `--force`, confirma-se à mão que a árvore escrita tem
# tantas entradas quantos os ficheiros do pacote. `--force` resolve o
# `.gitignore`, mas não é o único caminho para uma árvore incompleta (um
# `.git` aninhado entraria como gitlink, um erro de permissões deixaria
# ficheiros para trás). O guarda é sobre o RESULTADO, não sobre a causa:
# o que se publica tem de ser, ficheiro a ficheiro, o que se auditou.
# Compara CONJUNTOS de caminhos, nunca contagens.
#
# Contar linhas não era inseguro — vale a pena ser exato sobre isto, para
# a próxima pessoa não pensar que aqui houve um buraco. O `find` imprime
# `N + E` linhas (E = newlines embutidos em nomes) e o `git ls-tree`
# imprime `N - D` (D = ficheiros que não entraram na árvore, e os nomes
# com `\n` vêm citados numa linha só). Para as contagens baterem certo
# era preciso `E + D = 0`: as duas distorções empurram para lados
# opostos, por isso o erro só podia dar falso POSITIVO (um nome com `\n`
# recusava um pacote íntegro), nunca deixar passar um ficheiro em falta.
#
# Troca-se por conjuntos na mesma, por duas razões melhores do que o
# medo: deixa de haver falsos positivos, e a mensagem passa a dizer QUAL
# é o ficheiro em falta em vez de dois números que não ajudam ninguém às
# duas da manhã.
#
# `ls-tree -z | tr` desliga a citação, para os dois lados partirem os
# nomes da mesma maneira. Os caminhos saem relativos à raiz do pacote nos
# dois casos (daí o `cd` e o corte do `./`).
lista_pacote="${tmp_dir}/lista-pacote"
lista_arvore="${tmp_dir}/lista-arvore"
lista_erro="${tmp_dir}/lista-pacote.err"

estado_find=0
( cd "$pasta" && find . \( -type f -o -type l \) -print ) \
  >"${lista_pacote}.bruta" 2>"$lista_erro" || estado_find=1
if [ "$estado_find" -ne 0 ]; then
  echo "publicar-branch.sh: não consegui percorrer '${pasta}' para confirmar o que vou publicar (regra 10: 'não encontrei' e 'não consegui procurar' nunca podem dar o mesmo resultado). Ver abaixo:" >&2
  cat "$lista_erro" >&2
  exit 1
fi
sed 's|^\./||' "${lista_pacote}.bruta" | LC_ALL=C sort >"$lista_pacote"

GIT_INDEX_FILE="$indice_tmp" git --git-dir="$git_dir" \
  ls-tree -r -z --name-only "$arvore" | tr '\0' '\n' | LC_ALL=C sort >"$lista_arvore"

if ! diff_caminhos="$(diff "$lista_pacote" "$lista_arvore")"; then
  echo "publicar-branch.sh: a árvore a publicar não é a árvore que foi auditada — recuso publicar. '<' é o que está no pacote e falta na árvore; '>' é o contrário:" >&2
  echo "$diff_caminhos" >&2
  exit 1
fi

mensagem_commit="$(printf 'deploy: publica %s\n\nSha-Origem: %s\n' "$sha" "$sha")"

# Identidade explícita: `commit-tree` usa `IDENT_STRICT`, e num runner sem
# `user.email` configurado nem FQDN detetável falhava com "unable to
# auto-detect email address" — já depois do pacote montado e auditado. Os
# commits da branch `deploy` são gerados, nunca de uma pessoa, e assim
# dizem-no.
export GIT_AUTHOR_NAME="deploy (automático)"
export GIT_AUTHOR_EMAIL="deploy@tomazia.invalid"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"

if [ -n "$novo_pai" ]; then
  novo_commit="$(git commit-tree "$arvore" -p "$novo_pai" -m "$mensagem_commit")"
else
  novo_commit="$(git commit-tree "$arvore" -m "$mensagem_commit")"
fi

# `git push`, sem `--force`: ver o comentário no topo do ficheiro.
git push origin "${novo_commit}:refs/heads/${branch}"

exit 0
