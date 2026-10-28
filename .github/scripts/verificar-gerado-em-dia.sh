#!/usr/bin/env bash
set -euo pipefail

# verificar-gerado-em-dia.sh — "o que está versionado é mesmo o que o
# gerador acabou de produzir?".
#
# Uso:
#   verificar-gerado-em-dia.sh --caminho <caminho> [--caminho <caminho> ...]
#                              [--sugestao "<comando que corrige>"]
#
#   --caminho  : caminho LITERAL (relativo à pasta atual) a verificar.
#                Repetível; pelo menos um é obrigatório. Literal mesmo:
#                o `git status` é invocado com `--literal-pathspecs`, por
#                isso um `*`, um `?` ou um `:(exclude)` no valor são
#                tratados como caracteres do nome do ficheiro e não como
#                magia de pathspec. Um guarda cujo alvo possa ser
#                reinterpretado pelo git é um guarda que pode acabar a
#                vigiar outra coisa — ou nada. (O `git check-ignore`,
#                abaixo, não leva a flag: recebe nomes de caminho, não
#                pathspecs, e já os trata à letra — ver o comentário no
#                ponto de chamada.)
#   --sugestao : comando a mostrar a quem vir a falha ("Corrige com:
#                ..."). Opcional; sem ele a mensagem diz só o que falhou.
#
# Chama-se depois de correr o gerador (p. ex. `npm run gerar-api`), com
# o caminho onde o gerador escreve. É a forma partilhada da guarda que
# o `ci.yml` tinha embutida num `run:`.
#
# ## Códigos de saída
#
#   0 — em dia: o caminho existe, não está escondido do git, e o `git
#       status` não tem nada a dizer sobre ele.
#   1 — há diferenças: o gerador produziu algo diferente do que está
#       versionado (alterado, apagado, ou novo e por versionar).
#   2 — não se conseguiu verificar: o `git status` não respondeu (não é
#       um repositório, índice corrompido, `git` em falta...), ou o
#       caminho existe mas está fora do alcance desta verificação (ver
#       "O caminho ignorado" e "Diretoria ilegível", abaixo). NUNCA
#       confundir com 0: um guarda que fica verde porque não conseguiu
#       perguntar é um guarda que não existe (regra 10 do `CLAUDE.md`).
#   3 — o caminho não existe (ou existe como diretoria vazia). É o caso
#       do gerador que falha em silêncio e não escreve nada: não há
#       diferença nenhuma a assinalar, e é precisamente por isso que não
#       pode ser 0.
#  64 — uso errado: nenhum `--caminho`, argumento desconhecido, valor em
#       falta ou vazio. Deliberadamente DIFERENTE do 2 (e de 1 e 3):
#       assim um teste que espera "o git não respondeu" não pode passar
#       por acidente só por ter os argumentos trocados. 64 é o EX_USAGE
#       dos `sysexits`, para não colidir com os três códigos acima.
#
# ## Porquê `git status --porcelain`, e não `git diff --exit-code`
#
# Pela mesma razão já documentada no cabeçalho de
# `.github/workflows/ci.yml`: o `git diff --exit-code` só compara o que
# já está versionado. Não vê um ficheiro gerado que foi APAGADO (deixa
# de existir, não há diff a mostrar) nem um ficheiro gerado NOVO e nunca
# commitado. Daí também o `--untracked-files=all`: um tipo gerado por
# versionar não é "sem deriva".
#
# ## Porquê um ficheiro temporário, e não `[ -n "$(git status ...)" ]`
#
# Porque a substituição de comandos engole o estado de saída: se o `git`
# falhar (sai 128 e escreve no stderr), a saída vem vazia, o `-n` dá
# falso e a guarda fica VERDE. E o `set -e` não salva — dentro da
# condição de um `if`, o `errexit` está desligado. Aqui a saída vai para
# ficheiro, o estado é guardado à mão (`|| estado=$?`) e verificado à
# parte, e o "tem conteúdo?" é um `[ -s ... ]` sobre o ficheiro — nunca
# sobre o resultado de uma substituição.
#
# ## O caminho ignorado (2, não 0)
#
# Um caminho abrangido pelo `.gitignore` é invisível para o `git status
# --untracked-files=all`: os ficheiros que o gerador lá escrevesse de
# novo nunca apareceriam, e esta guarda ficaria verde para sempre sem
# nunca mais verificar nada. Como o projeto já ignora de propósito um
# artefacto gerado (`frontend/openapi.json`), é um erro fácil de repetir
# na pasta dos tipos. Por isso pergunta-se primeiro ao `git check-ignore`
# e, se a resposta for "sim, é ignorado", sai-se 2 ("não consigo
# verificar isto"), nunca 0.
#
# O `git check-ignore` tem o mesmo tipo de armadilha que o `grep`: 0 =
# "pelo menos um é ignorado", 1 = "nenhum é ignorado", >= 2 = "não
# consegui responder". O 1 é o caso BOM, e só um `if` ingénuo os trata
# todos como "correu mal". Por isso o estado é lido num `case`.
#
# Limite conhecido, para isto não ser lido como mais do que é: a
# pergunta é feita com `--no-index` (ver o comentário no ponto de
# chamada), por isso um ficheiro abrangido por uma regra mas versionado
# à força (`git add -f`) também sai 2, apesar de o `git status` continuar
# a ver as alterações DESSE ficheiro. Falha fechado de propósito: nesse
# sítio, qualquer ficheiro gerado NOVO continuaria invisível, e um
# guarda que não consegue garantir o que promete tem de dizê-lo.
#
# ## Diretoria ilegível (2, não 3)
#
# Para distinguir "diretoria vazia" (3) de "diretoria que não consigo
# ler" (2), a legibilidade é verificada antes: um glob sobre uma pasta
# sem permissões devolve vazio, exatamente como uma pasta vazia.
#
# Sem dependências além do git e do bash.

SAIDA_EM_DIA=0
SAIDA_HA_DIFERENCAS=1
SAIDA_NAO_CONSEGUI_VERIFICAR=2
SAIDA_CAMINHO_INEXISTENTE=3
SAIDA_USO_ERRADO=64

uso() {
  echo "Uso: $(basename "$0") --caminho <caminho> [--caminho <caminho> ...] [--sugestao \"<comando>\"]" >&2
}

# Prefixo da linha de erro: anotação do GitHub Actions quando lá corre,
# texto simples quando corre na máquina de alguém.
prefixo_erro() {
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    printf '::error::'
  else
    printf 'Erro: '
  fi
}

falhar() {
  # $1 = código de saída; $2 = mensagem.
  local codigo="$1"
  local mensagem="$2"
  echo "$(prefixo_erro)${mensagem}"
  exit "$codigo"
}

caminhos=()
sugestao=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --caminho)
      if [ "$#" -lt 2 ]; then
        uso
        falhar "$SAIDA_USO_ERRADO" "--caminho precisa de um valor."
      fi
      if [ -z "$2" ]; then
        # Um pathspec vazio não é "nenhum caminho": para o git é um erro
        # (e noutras ferramentas seria "tudo"). Recusa-se aqui, por ser
        # sempre um engano de quem chama.
        uso
        falhar "$SAIDA_USO_ERRADO" "--caminho não pode ser vazio."
      fi
      caminhos+=("$2")
      shift 2
      ;;
    --sugestao)
      if [ "$#" -lt 2 ]; then
        uso
        falhar "$SAIDA_USO_ERRADO" "--sugestao precisa de um valor."
      fi
      sugestao="$2"
      shift 2
      ;;
    *)
      uso
      falhar "$SAIDA_USO_ERRADO" "argumento desconhecido: '$1'."
      ;;
  esac
done

# Zero caminhos é erro, nunca sucesso: "não verifiquei nada" não pode
# sair 0. É o mesmo princípio da contagem mínima do passo do shellcheck
# no `ci.yml` (um glob vazio que não corre nada não fica verde).
if [ "${#caminhos[@]}" -eq 0 ]; then
  uso
  falhar "$SAIDA_USO_ERRADO" "é preciso pelo menos um --caminho; sem caminhos não se verificou nada."
fi

# --- O caminho existe e tem alguma coisa lá dentro? ---
#
# Esta é a metade que o `git status` sozinho nunca dá: ele responde "não
# há diferenças" tanto para um gerador que escreveu exatamente o que
# estava versionado como para um gerador que não escreveu nada num
# caminho que não existe. Os dois casos têm de ter respostas diferentes.
for caminho in "${caminhos[@]}"; do
  if [ ! -e "$caminho" ] && [ ! -L "$caminho" ]; then
    falhar "$SAIDA_CAMINHO_INEXISTENTE" \
      "o caminho '${caminho}' não existe depois de correr o gerador — não há diferenças a assinalar porque não foi gerado nada.${sugestao:+ Corrige com: ${sugestao}}"
  fi

  if [ -d "$caminho" ]; then
    if [ ! -r "$caminho" ] || [ ! -x "$caminho" ]; then
      # Sem permissões, um glob devolve vazio tal como numa pasta vazia:
      # "não consegui olhar" nunca pode ser dito como "está vazia".
      falhar "$SAIDA_NAO_CONSEGUI_VERIFICAR" \
        "o caminho '${caminho}' é uma diretoria que não se consegue ler (permissões); não é seguro concluir seja o que for sobre o que lá está."
    fi

    # `dotglob` para um `.gitkeep` (ou qualquer ficheiro escondido)
    # contar como conteúdo; `nullglob` para um glob sem resultados dar
    # array vazio em vez do texto literal do padrão.
    shopt -s nullglob dotglob
    entradas=("${caminho}"/*)
    shopt -u nullglob dotglob
    if [ "${#entradas[@]}" -eq 0 ]; then
      falhar "$SAIDA_CAMINHO_INEXISTENTE" \
        "o caminho '${caminho}' existe mas está vazio depois de correr o gerador — não foi gerado nada.${sugestao:+ Corrige com: ${sugestao}}"
    fi
  fi
done

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT
tmp_saida="${tmp_dir}/saida"
tmp_erro="${tmp_dir}/saida.err"

# --- O caminho está escondido do git pelo `.gitignore`? ---
#
# Ver "O caminho ignorado", no cabeçalho. O 1 é o caso bom; só o 0 e o
# >= 2 são maus, por razões opostas.
#
# Sem `--literal-pathspecs` aqui, ao contrário do `git status` abaixo: o
# `check-ignore` recebe NOMES DE CAMINHO, não pathspecs, e recusa-se a
# correr com qualquer magia de pathspec ligada ("magic pathspec
# unsupported by this command", estado 128). Já trata o argumento à
# letra, que é o que se quer.
#
# `--no-index` é obrigatório para esta pergunta, e foi preciso descobri-lo
# a correr: por omissão o `check-ignore` consulta o índice e responde
# "não ignorado" para uma DIRETORIA que contenha ficheiros versionados —
# mesmo que a regra a abranja, e mesmo que um ficheiro NOVO lá dentro
# fique de facto invisível para o `git status`. Que é exatamente o caso
# cego que se quer apanhar. Com `--no-index` a resposta é só sobre as
# regras.
estado_ignore=0
git check-ignore --no-index -- "${caminhos[@]}" \
  >"$tmp_saida" 2>"$tmp_erro" || estado_ignore=$?

case "$estado_ignore" in
  0)
    echo "$(prefixo_erro)há caminhos abrangidos pelo .gitignore (listados abaixo): o 'git status' nunca mostraria um ficheiro novo lá dentro, por isso esta verificação ficaria verde sem verificar nada. Tira-os do .gitignore ou aponta a guarda para outro sítio."
    cat "$tmp_saida"
    exit "$SAIDA_NAO_CONSEGUI_VERIFICAR"
    ;;
  1)
    : # Nenhum caminho ignorado: é o que se quer.
    ;;
  *)
    echo "$(prefixo_erro)'git check-ignore' não respondeu (estado ${estado_ignore}); não é seguro concluir que o caminho está em dia. Razão, tal como o git a deu:"
    cat "$tmp_erro" >&2
    exit "$SAIDA_NAO_CONSEGUI_VERIFICAR"
    ;;
esac

# --- O que o git tem a dizer sobre o caminho ---
estado_git=0
git --literal-pathspecs status --porcelain --untracked-files=all -- "${caminhos[@]}" \
  >"$tmp_saida" 2>"$tmp_erro" || estado_git=$?

if [ "$estado_git" -ne 0 ]; then
  echo "$(prefixo_erro)'git status' não respondeu (estado ${estado_git}); não é seguro concluir que o caminho está em dia — 'não há diferenças' e 'não consegui perguntar' não são a mesma coisa. Razão, tal como o git a deu:"
  cat "$tmp_erro" >&2
  exit "$SAIDA_NAO_CONSEGUI_VERIFICAR"
fi

if [ -s "$tmp_saida" ]; then
  echo "$(prefixo_erro)${caminhos[*]} ficou diferente depois de correr o gerador (alterado, apagado, ou novo e por versionar).${sugestao:+ Corrige com: ${sugestao}} Estado, segundo o git:"
  cat "$tmp_saida"
  exit "$SAIDA_HA_DIFERENCAS"
fi

echo "Em dia: ${caminhos[*]} (o gerador não mudou nada do que está versionado)."
exit "$SAIDA_EM_DIA"
