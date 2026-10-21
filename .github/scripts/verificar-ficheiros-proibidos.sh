#!/usr/bin/env bash
set -euo pipefail

# verificar-ficheiros-proibidos.sh — S-10 (BD/segredos) e S-12 (pasta de
# deploy sem `.claude/`, `CLAUDE.md`, `docs/`, `tests/`, `e2e/`).
#
# Uso:
#   verificar-ficheiros-proibidos.sh --git [<raiz>] [--conjunto s10|s12|todos]
#   verificar-ficheiros-proibidos.sh --pasta <dir> [--conjunto s10|s12|todos]
#
#   --git      : percorre os ficheiros VERSIONADOS em <raiz> (omitido =
#                pasta atual), com `git ls-files -z --recurse-submodules`
#                (para um eventual submódulo não ficar escondido atrás do
#                gitlink).
#   --pasta    : percorre <dir> no disco com `find -L -type f -o -type l
#                [-o -type d]) -print0`, para apanhar também o que não
#                está versionado (por exemplo, um build gerado em CI) e o
#                que só existe através de uma ligação simbólica.
#   --conjunto : que família de padrões aplicar. Pode vir em qualquer
#                posição dos argumentos. Omitido = `s10` — é o que mantém
#                todas as chamadas existentes (e os testes de S-10) a
#                correr exatamente como antes, sem edição.
#       s10   : só os padrões de BD/segredos (o comportamento histórico
#               deste script, descrito abaixo).
#       s12   : só os padrões da pasta de deploy (regra 4 do `CLAUDE.md`
#               da raiz): `CLAUDE.md` pelo nome base, sem distinguir
#               maiúsculas, em qualquer profundidade; e `.claude`, `docs`,
#               `tests`, `e2e` como COMPONENTES DE CAMINHO (não nomes
#               base) — por isso `--pasta` passa a percorrer também
#               diretorias (`-type d`), e não só ficheiros/ligações: uma
#               `docs/` vazia não tem `-type f` nenhum lá dentro, e um
#               guarda que só soubesse procurar ficheiros deixava-a
#               passar. Sem exceções (ao contrário do S-10, não há aqui
#               nenhum caminho legítimo para um `docs/`, `tests/`, etc.
#               dentro de uma pasta de deploy).
#       todos : os dois conjuntos de padrões, um ficheiro proibido por
#               qualquer um deles entra na lista.
#
#       Nota para quem vier ligar isto ao CI: o conjunto `s12`/`todos`
#       só faz sentido contra `--pasta <pacote-montado-ou-build>` — a
#       árvore de trabalho do repositório TEM, de propósito, `docs/`,
#       `tests/`, `.claude/`; `--git . --conjunto s12` assinalaria-os
#       (corretamente, pela letra da regra, mas sem utilidade nenhuma
#       nesse alvo).
#
# Padrões do S-10, sobre o nome base do ficheiro, sem distinguir
# maiúsculas de minúsculas: *.db, *.sqlite, *.sqlite3, e tudo o que destes
# três pareça um ficheiro auxiliar (modo WAL, master journal, etc.) ou uma
# cópia renomeada/comprimida: *.db-*, *.sqlite-*, *.sqlite3-* (jornais e
# afins, p.ex. "-wal", "-shm", "-journal", ou o sufixo de hash de um master
# journal), *.db.*, *.sqlite.*, *.sqlite3.* (p.ex. ".gz", ".bak", ".zip"),
# *.db3, *.sqlitedb. E ainda, para dumps SQL: *.sql, *.sql.gz, *.dump,
# *.mysql. E segredos: .env, .env.*, *.env.
#
# Este guarda olha para NOMES de ficheiro, não para formato nem conteúdo
# (exceto a exceção por caminho do S-10, abaixo, que é a única com leitura
# de conteúdo). Não apanha uma exportação para outro formato — um
# "clientes.csv", um "utilizadores.json" ou um "site-antigo.tar.gz" passam
# por este guarda tal como qualquer outro ficheiro de dados do projeto.
# A lista de extensões nunca fecha; isto é uma rede de segurança para o
# erro mais comum (commitar a BD ou um dump a direito), não um substituto
# para olhar para o que se commita.
#
# Exceções do S-10, sempre explícitas e documentadas, nunca por heurística:
#   - o nome exato ".env.example".
#   - o caminho exato "docs/legado/esquema-bd-antiga.sql" (ver
#     `eh_excecao_caminho`, abaixo): é o esquema do MySQL do site antigo,
#     não dados — documentação legítima, versionada de propósito. Esta é
#     a única exceção com guarda de conteúdo: mesmo neste caminho exato,
#     um ficheiro com uma instrução que insere dados (INSERT, REPLACE,
#     LOAD DATA, COPY) continua proibido — ver `conteudo_tem_instrucoes_dados`,
#     abaixo. O comentário do próprio ficheiro promete "só estrutura, sem
#     dados"; isto verifica a promessa em vez de confiar nela.
#
# Saída: um caminho proibido por linha. Com a variável de ambiente
# GITHUB_ACTIONS=true (GitHub Actions), cada linha ganha o prefixo
# "::error file=<caminho>::" para anotar o diff do PR.
#
# Códigos de saída:
#   0 — nada encontrado
#   1 — encontrou pelo menos um ficheiro proibido
#   2 — uso errado: argumento inválido, pasta inexistente, --git fora de
#       um repositório git, --conjunto desconhecido, ou falha a meio da
#       própria procura (`git ls-files`/`find` saiu com erro, índice
#       corrompido, subpasta sem permissão de leitura, etc.). Um guarda
#       que passa a verde porque a procura não conseguiu terminar é um
#       guarda que não existe.
#
# Sem dependências além de git, find, grep e coreutils.

uso() {
  echo "Uso: $(basename "$0") --git [<raiz>] [--conjunto s10|s12|todos]" >&2
  echo "   ou: $(basename "$0") --pasta <dir> [--conjunto s10|s12|todos]" >&2
}

# `--conjunto` pode vir em qualquer posição: extrai-se primeiro, antes de
# interpretar o resto como `--git`/`--pasta` (e o seu argumento), para o
# resto da análise de argumentos, abaixo, ficar exatamente como era antes
# de `--conjunto` existir.
conjunto="s10"
argumentos_restantes=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --conjunto)
      if [ "$#" -lt 2 ]; then
        uso
        exit 2
      fi
      conjunto="$2"
      shift 2
      ;;
    *)
      argumentos_restantes+=("$1")
      shift
      ;;
  esac
done
set -- "${argumentos_restantes[@]}"

case "$conjunto" in
  s10 | s12 | todos) ;;
  *)
    echo "Erro: --conjunto tem de ser 's10', 's12' ou 'todos' (recebi '$conjunto')." >&2
    exit 2
    ;;
esac

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

# A única exceção por caminho ("docs/legado/esquema-bd-antiga.sql") é um
# dump de esquema MySQL — e um dump gerado com `mysqldump` a direito, em
# vez de `mysqldump --no-data`, traz dados a par da estrutura (INSERT),
# ou até `REPLACE`/`LOAD DATA`/`COPY` consoante a ferramenta. É a única
# porta que este guarda abre de propósito para um `.sql`; não pode ser
# uma porta que fica aberta independentemente do que lá é posto depois.
conteudo_tem_instrucoes_dados() {
  # $1 = caminho no disco do ficheiro (não o caminho relativo ao `--git
  # <raiz>`: tem de ser um caminho que se consiga abrir a partir da pasta
  # atual do script).
  local caminho_disco="$1"

  if [ ! -f "$caminho_disco" ]; then
    # Não é seguro assumir "sem dados" quando nem se consegue ler o
    # ficheiro (ex.: caminho desaparecido entre o `git ls-files`/`find` e
    # aqui) — falha fechado: trata como se tivesse dados.
    return 0
  fi

  # A palavra-chave tem de estar no início da linha (só espaço em branco
  # antes) — é o que um `mysqldump` real escreve, uma instrução por
  # linha, por isso o caso que interessa fica apanhado; mas isto é uma
  # rede, não uma prova: um "LOAD  DATA" com dois espaços, ou um INSERT
  # que não começa a linha, escapam a este padrão.
  #
  # Não se pode usar o código de saída do `grep` tal e qual: ele sai 2
  # (ou mais) quando não consegue ler o ficheiro — permissão, erro de
  # I/O — e um código assim não é zero, por isso um `if` ingénuo lê-lo
  # como "não encontrou a instrução" e concede a exceção ao ficheiro que
  # nem sequer se conseguiu inspecionar. Por isso o estado é guardado e
  # distinguido à mão.
  local estado=0
  grep -Eiq '^[[:space:]]*(INSERT|REPLACE|LOAD DATA|COPY)[[:space:]]' "$caminho_disco" || estado=$?
  [ "$estado" -eq 0 ] && return 0  # tem instruções de dados
  [ "$estado" -eq 1 ] && return 1  # lido até ao fim, sem dados
  return 0                         # >= 2: não se conseguiu ler — falha fechado
}

eh_proibido_s10() {
  # $1 = caminho do ficheiro tal como devolvido por `git ls-files`/`find`
  # (usado para o nome base e para a exceção por caminho exato); o padrão
  # em si olha só para o nome base, sem distinguir maiúsculas.
  # $2 = caminho no disco do mesmo ficheiro, só para ler o conteúdo
  # quando a exceção por caminho se aplica (default: igual a $1 — é o
  # caso do modo `--pasta`, onde `find` já devolve um caminho no disco).
  # Em modo `--git` este caminho lê a árvore de trabalho, não o blob do
  # índice que o `git ls-files` acabou de listar — no CI são o mesmo
  # ficheiro, e se divergirem (algo alterado sem `git add`) o pior que
  # acontece é o caso sujo falhar fechado lá em cima, em
  # `conteudo_tem_instrucoes_dados`.
  #
  # Corpo idêntico ao `eh_proibido` de antes de `--conjunto` existir — só
  # o nome mudou, para dar lugar ao `eh_proibido_s12` e ao despachante
  # `eh_proibido`, abaixo. É o que garante que `--conjunto s10` (a
  # omissão) continua byte a byte igual ao comportamento histórico.
  local caminho="$1"
  local caminho_disco="${2:-$1}"
  local nome_base
  nome_base="$(basename "$caminho")"
  local nome_minusculo
  nome_minusculo="$(printf '%s' "$nome_base" | tr '[:upper:]' '[:lower:]')"

  if [ "$nome_minusculo" = ".env.example" ]; then
    return 1
  fi

  if eh_excecao_caminho "$caminho"; then
    if conteudo_tem_instrucoes_dados "$caminho_disco"; then
      # Deixa de ser exceção: cai para o `case` abaixo, que o apanha por
      # ser um ".sql" como outro qualquer.
      :
    else
      return 1
    fi
  fi

  case "$nome_minusculo" in
    *.db | *.db-* | *.db.* | *.db3 | \
      *.sqlite | *.sqlite-* | *.sqlite.* | *.sqlitedb | \
      *.sqlite3 | *.sqlite3-* | *.sqlite3.* | \
      *.sql | *.sql.gz | *.dump | *.mysql | \
      .env | .env.* | *.env)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# Componentes de caminho proibidos pelo S-12 (critério: pasta de deploy
# sem `.claude/`, `docs/`, `tests/`, `e2e/`). Comparação por COMPONENTE,
# não por nome base: "backend/app/tests/conftest.py" tem de ser apanhado
# tanto quanto uma "tests/" vazia — o que importa é que algum segmento do
# caminho seja exatamente um destes nomes, sensível a maiúsculas (ao
# contrário do `CLAUDE.md`, a regra 4 do `CLAUDE.md` da raiz não pede
# insensibilidade aqui).
tem_componente_proibido() {
  # $1 = caminho relativo à raiz da procura (NUNCA um caminho absoluto do
  # disco nem um caminho com a raiz da pesquisa por diante — ver os dois
  # pontos de chamada, em `--git` e em `--pasta`, abaixo).
  local caminho_relativo="$1"
  local componente
  while IFS= read -r componente; do
    case "$componente" in
      .claude | docs | tests | e2e)
        return 0
        ;;
    esac
  done <<<"$(printf '%s' "$caminho_relativo" | tr '/' '\n')"
  return 1
}

eh_proibido_s12() {
  # $1 = caminho do ficheiro/diretoria tal como devolvido por
  # `git ls-files`/`find` (usado só para o nome base: `CLAUDE.md`, sem
  # distinguir maiúsculas, em qualquer profundidade).
  # $2 = caminho relativo à raiz da procura, para a comparação por
  # componente (default: igual a $1 — correto em modo `--git`, onde o
  # caminho que `git ls-files` devolve já é relativo a `--git <raiz>`;
  # em modo `--pasta` quem chama tem de passar o caminho já despido do
  # prefixo `$dir`, porque `find` devolve o caminho no disco a direito).
  local caminho="$1"
  local caminho_componentes="${2:-$1}"
  local nome_base
  nome_base="$(basename "$caminho")"
  local nome_minusculo
  nome_minusculo="$(printf '%s' "$nome_base" | tr '[:upper:]' '[:lower:]')"

  if [ "$nome_minusculo" = "claude.md" ]; then
    return 0
  fi

  tem_componente_proibido "$caminho_componentes"
}

eh_proibido() {
  # Despachante: aplica o(s) conjunto(s) de padrões pedido(s) em
  # `--conjunto` (variável global `$conjunto`, omissão "s10").
  # $1 = caminho (ver `eh_proibido_s10`/`eh_proibido_s12`)
  # $2 = caminho no disco (só usado pelo S-10)
  # $3 = caminho relativo para componentes (só usado pelo S-12)
  local caminho="$1"
  local caminho_disco="${2:-$1}"
  local caminho_componentes="${3:-$1}"

  case "$conjunto" in
    s10)
      eh_proibido_s10 "$caminho" "$caminho_disco"
      ;;
    s12)
      eh_proibido_s12 "$caminho" "$caminho_componentes"
      ;;
    todos)
      if eh_proibido_s10 "$caminho" "$caminho_disco"; then
        return 0
      fi
      eh_proibido_s12 "$caminho" "$caminho_componentes"
      ;;
  esac
}

encontrados=()
# Pasta temporária própria (e não `mktemp` a solo para `$tmp_lista`): o
# stderr de `git ls-files`/`find` precisa de um segundo ficheiro
# (`$tmp_lista_err`), e um nome derivado por concatenação (`"${x}.err"`)
# não é criado atomicamente pelo `mktemp` — ao contrário de `$tmp_dir`,
# que cobre os dois com uma só chamada e um só `trap`.
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT
tmp_lista="${tmp_dir}/lista"
tmp_lista_err="${tmp_dir}/lista.err"

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
  if ! git -C "$raiz" ls-files -z --recurse-submodules >"$tmp_lista" 2>"$tmp_lista_err"; then
    echo "Erro: 'git ls-files' falhou em '$raiz' (ver abaixo); não é seguro assumir que não há ficheiros proibidos." >&2
    cat "$tmp_lista_err" >&2
    exit 2
  fi

  while IFS= read -r -d '' caminho; do
    # Segundo argumento: caminho no disco, para a verificação de
    # conteúdo da exceção (`$caminho` vem relativo a `$raiz`, não à pasta
    # atual do script).
    if eh_proibido "$caminho" "${raiz}/${caminho}"; then
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

  # Sem barra final: simplifica despir o prefixo `$dir/` de cada caminho
  # devolvido pelo `find`, abaixo, para obter o caminho relativo que o
  # S-12 compara por componente.
  dir="${dir%/}"

  # `-L`: segue ligações simbólicas, para uma pasta ligada ou um
  # ficheiro ligado para fora de `$dir` não escaparem à procura.
  # `\( -type f -o -type l \)`: com `-L`, uma ligação para um alvo que
  # não existe (ou inacessível) deixa de ser `-type f`; mantém-se aqui
  # como `-type l` para não desaparecer da procura em silêncio.
  # Com `--conjunto s12`/`todos` acrescenta-se `-type d`: uma `docs/`
  # vazia não tem `-type f` nenhum lá dentro, e um guarda que só soubesse
  # procurar ficheiros deixava-a passar (o caso que o arquiteto pediu
  # para prender). Não se acrescenta por omissão (`s10`), para o
  # comportamento e a saída desse modo ficarem byte a byte como antes.
  # `-xdev`: não atravessa para outro sistema de ficheiros — fecha uma
  # ligação tipo `dist/x -> /`. Não fecha `dist/x -> $HOME`, nem
  # nenhuma ligação para dentro do mesmo sistema de ficheiros: essa é
  # percorrida na mesma, `-xdev` ou não. Quem protege contra essa
  # travessia desenfreada é o `timeout-minutes` do job, não isto.
  #
  # Grava para ficheiro pela mesma razão do modo `--git`: uma subpasta
  # sem permissão de leitura faz o `find` escrever "Permission denied"
  # e sair com erro; sem verificar o estado, o script seguiria em frente
  # como se essa subpasta tivesse sido revistada e estivesse limpa.
  if [ "$conjunto" = "s10" ]; then
    find_falhou=0
    find -L "$dir" -xdev \( -type f -o -type l \) -print0 \
      >"$tmp_lista" 2>"$tmp_lista_err" || find_falhou=1
  else
    find_falhou=0
    find -L "$dir" -xdev \( -type f -o -type l -o -type d \) -print0 \
      >"$tmp_lista" 2>"$tmp_lista_err" || find_falhou=1
  fi
  if [ "$find_falhou" -ne 0 ]; then
    echo "Erro: 'find' falhou a percorrer '$dir' (ver abaixo); não é seguro assumir que não há ficheiros proibidos." >&2
    cat "$tmp_lista_err" >&2
    exit 2
  fi

  # O código de saída do `find` não é garantia suficiente: a
  # implementação do GNU findutils (runners Ubuntu) sai com erro quando
  # encontra um ciclo de ligações simbólicas, mas o `bfs` (find usado
  # nalgumas máquinas) só escreve "Filesystem loop back to..." no stderr
  # e sai 0 — percorreu a árvore incompleta sem o dizer no código de
  # saída. Por isso: qualquer coisa escrita no stderr, mesmo com `find`
  # a sair 0, é tratada como procura incompleta. (`git ls-files`, no
  # outro modo, não tem este problema — não se sabe de avisos benignos
  # dessa ferramenta para o caso de uso daqui — por isso aquele ramo
  # continua a confiar só no código de saída.)
  #
  # Limite conhecido, para não se ler isto como cobertura total: há uma
  # terceira implementação, o BSD find do macOS, com proteção de ciclo
  # própria e silenciosa — pára de descer no ponto do ciclo, não escreve
  # no stderr e sai 0. Nem o código de saída nem esta verificação o
  # apanham. Importa pouco na prática: o ponto de aplicação é o CI, que
  # corre em Ubuntu com o GNU find e falha fechado; localmente, no macOS,
  # um ciclo faria a procura saltar parte da árvore em silêncio. Fechá-lo
  # exigiria rastrear pares dispositivo/inode em shell, desproporcionado
  # para o risco.
  if [ -s "$tmp_lista_err" ]; then
    echo "Erro: 'find' escreveu para o erro padrão ao percorrer '$dir', apesar de sair com sucesso (ver abaixo); consoante a implementação do 'find', isto pode significar que a procura não percorreu a árvore toda (p.ex. um ciclo de ligações simbólicas). Não é seguro assumir que não há ficheiros proibidos." >&2
    cat "$tmp_lista_err" >&2
    exit 2
  fi

  while IFS= read -r -d '' caminho; do
    # Caminho relativo a `$dir`, para a comparação por componente do
    # S-12 (`tem_componente_proibido`). A própria `$dir` (a raiz
    # pesquisada, sempre `-type d`) nunca é, ela própria, considerada
    # proibida por este componente: só o que está DENTRO dela.
    if [ "$caminho" = "$dir" ]; then
      caminho_componentes="."
    else
      caminho_componentes="${caminho#"$dir"/}"
    fi
    if eh_proibido "$caminho" "$caminho" "$caminho_componentes"; then
      encontrados+=("$caminho")
    fi
  done <"$tmp_lista"
fi

if [ "${#encontrados[@]}" -eq 0 ]; then
  exit 0
fi

for caminho in "${encontrados[@]}"; do
  texto="$caminho"
  # Só chega aqui um caminho da lista de exceções se `eh_proibido` tiver
  # decidido que, apesar do caminho, o conteúdo tinha uma instrução de
  # dados — nunca por o caminho ter deixado de corresponder à exceção.
  if eh_excecao_caminho "$caminho"; then
    texto="${caminho}: o esquema legado é só estrutura (DDL); dados nunca entram aqui, mesmo sendo este o caminho excecionado para o *.sql"
  fi
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "::error file=${caminho}::${texto}"
  else
    echo "${texto}"
  fi
done

exit 1
