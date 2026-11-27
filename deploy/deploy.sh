#!/usr/bin/env bash
# deploy.sh — corre NO SERVIDOR (cPanel), sem argumentos, a seguir ao pull
# `--ff-only` da branch `deploy` feito pelo cPanel (F1-04, infra).
#
# Tudo deriva de $HOME, pela árvore descrita em `docs/ESPECIFICACAO.md`,
# secção Servidor:
#
#   API      = $HOME/tomazia_api            (passenger_wsgi.py, .env, app/, ...)
#   ORIGEM   = $HOME/repositories/tomazia    (o pacote montado por `deploy/montar.sh`,
#              com a MESMA árvore que ele escreve em `--saida`: `api/app`,
#              `api/migrations`, `api/scripts` (quando existir),
#              `api/alembic.ini`, `api/passenger_wsgi.py`,
#              `api/requirements.txt`, `api/VERSION`, e `frontend/dist/`
#              com os estáticos compilados — nunca `$ORIGEM/app` nem
#              `$ORIGEM/frontend/` diretamente, falta sempre o nível `api/`
#              e `dist/`)
#   WEB      = lido de $HOME/.tomazia-deploy.conf (linha "WEB=<caminho>")
#   virtualenv do Passenger: $HOME/virtualenv/tomazia_api/*/bin/activate
#
# $HOME/.tomazia-deploy.conf é a configuração do PRÓPRIO deploy.sh, nunca a
# da app (`API/.env`): persiste fora do pacote sincronizado, precisamente
# para sobreviver a cada deploy automático. É aqui que o Tomás aponta `WEB`
# para a pasta do subdomínio durante a construção (a pasta chama-se
# `~/novo.<domínio>`, mas o endereço é `new.<domínio>`), e para
# `public_html` no corte final (F5-02) — mudar o site de sítio passa a ser editar um ficheiro no
# servidor, nunca um commit.
#
# Ordem (provada pelos testes com o registo dos stubs): o trinco contra
# deploys em paralelo é o primeiro passo (ver `tomar_trinco`); `pip install`
# corre ANTES da sincronização do código (não depende dele); a sincronização do
# código e do frontend vêm a seguir; o `.env` é verificado outra vez depois
# de todas as sincronizações, antes de `alembic`, porque nenhuma delas pode
# apagar o `.env` a caminho de reiniciar a app com configuração em falta;
# `alembic` corre DEPOIS do código sincronizado (as migrações vêm com ele);
# `VERSION` é escrito penúltimo; `touch tmp/restart.txt` é sempre o último
# passo, com um mtime posterior ao de `VERSION` — é o sinal que o Passenger
# lê para reiniciar.
#
# SEM `rsync`. O primeiro deploy real (F1-05) morreu com "rsync: command
# not found" (código 127): o ambiente em que o cPanel da dominios.pt corre
# o `.cpanel.yml` (CloudLinux, CageFS) não o tem. A sincronização é feita
# pela função `sincronizar`, abaixo, só com `cp`, `mv`, `rm`, `mkdir`,
# `rmdir` e `find` — ferramentas que existem em qualquer CageFS — e reproduz
# a semântica dos três `rsync` que havia (ver o comentário da função). É
# SEMPRE este caminho, mesmo onde o `rsync` exista: dois caminhos seriam
# dois comportamentos para testar, e o que nunca corresse nos testes era o
# que ia correr no servidor.
#
# NÃO HÁ ROLLBACK AUTOMÁTICO. Se isto falhar depois de `alembic` ter
# corrido, fica código novo em disco (e possivelmente uma migração já
# aplicada) e o processo Passenger antigo ainda em memória, a servir os
# pedidos com o código e a configuração de antes — porque `tmp/restart.txt`
# só é tocado no último passo, e uma falha antes dele impede-o de
# acontecer. Recuperar desse estado é uma decisão manual do Tomás, nunca
# deste script.
#
# `pip install` usa `--require-hashes` explícito: um `requirements.txt` sem
# hashes (uma regressão da outra frente da F1-04) tem de rebentar aqui, não
# instalar em silêncio sem verificar nada.

set -euo pipefail

: "${HOME:?HOME em falta}"

API="$HOME/tomazia_api"
ORIGEM="$HOME/repositories/tomazia"
CONFIG="$HOME/.tomazia-deploy.conf"

PASSO_ATUAL="arranque"
REINICIADO=0

em_erro() {
  local codigo=$?
  echo "deploy.sh: falhou no passo '${PASSO_ATUAL}' (código ${codigo})." >&2
  if [ "$REINICIADO" -eq 1 ]; then
    echo "deploy.sh: tmp/restart.txt já tinha sido escrito antes desta falha; o Passenger já reiniciou com o que lá estava." >&2
  else
    echo "deploy.sh: tmp/restart.txt NÃO foi escrito; a app continua a correr o código e a configuração que já tinha em memória. Não há rollback automático, e o disco pode já não estar no estado antigo: a partir do passo do pip o virtualenv é o novo (e é partilhado com o processo que continua a servir), a partir das sincronizações o código em disco é o novo (possivelmente só em parte, se a falha foi a meio de uma), e a partir do alembic a base de dados pode já ter uma migração aplicada. O processo antigo aguenta-se porque tem o código carregado em memória, mas qualquer import tardio dele vai buscar o novo." >&2
  fi
  exit "$codigo"
}
trap em_erro ERR

# ---------------------------------------------------------------------------
# Trinco contra deploys em paralelo.
#
# Porquê: no primeiro deploy real, dois cliques em "Deploy HEAD Commit"
# puseram dois `deploy.sh` a correr ao mesmo tempo, os dois a apagar e a
# copiar nas mesmas pastas e os dois a caminho do `alembic`. O cPanel não
# os serializa, por isso é o script que tem de o fazer — e é o primeiro
# passo de todos, antes de qualquer leitura ou escrita.
#
# `mkdir` e não `flock`: o `mkdir` é atómico (dois `mkdir` da mesma pasta,
# ao mesmo tempo, dão exatamente um sucesso) e existe sempre; o `flock`
# pode não estar dentro do CageFS, e um guarda que dependesse dele tinha de
# ter um segundo caminho para quando não está — dois caminhos, um deles
# nunca testado.
#
# Lá dentro fica o PID do dono. Um deploy morto à força (`kill -9`, o
# cPanel a matar a tarefa por tempo) não chega a libertar o trinco; o
# seguinte vê que esse PID já não existe e recupera-o, dizendo-o na saída.
# O que NUNCA faz é tratar "não consegui saber se o dono está vivo" como
# "está morto" (regra 10): esse caso recusa, com uma mensagem à parte.
#
# Limite conhecido: se o PID do deploy morto tiver entretanto sido
# reutilizado por outro processo da mesma conta, o trinco parece vivo e o
# deploy recusa. A mensagem diz o PID e o caminho do trinco, para se
# confirmar com `ps` e apagar à mão. Recusar a mais é o lado seguro.
# ---------------------------------------------------------------------------

TRINCO="$HOME/.tomazia-deploy.trinco"
TRINCO_MEU=0

libertar_trinco() {
  if [ "$TRINCO_MEU" -ne 1 ]; then
    return 0
  fi
  TRINCO_MEU=0
  if ! rm -f -- "$TRINCO/pid" || ! rmdir -- "$TRINCO"; then
    echo "deploy.sh: não consegui libertar o trinco ${TRINCO}. Como este processo vai terminar, o próximo deploy encontra-o abandonado e recupera-o sozinho." >&2
  fi
}
# Os sinais passam a `exit`, para o trap EXIT correr também quando o
# deploy é interrompido. O bash com que isto foi testado já corre o trap
# EXIT ao morrer por SIGTERM sem estas linhas (o teste do SIGTERM passa
# sem elas), mas isso não está garantido em todas as versões, e escrito
# assim não depende de nenhuma. O `kill -9` não se apanha, e é para esse
# que existe a recuperação.
trap libertar_trinco EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# estado_do_processo <pid>
# Escreve "vivo", "morto" ou "indeterminado". O `kill -0` sai com erro
# tanto se o processo não existe como se existe mas é de outro utilizador
# — por isso o código de saída não chega, e lê-se a mensagem, em
# `LC_ALL=C` para não depender da língua do servidor. Só "No such process"
# é "morto"; tudo o resto que não seja sucesso é "indeterminado".
estado_do_processo() {
  local erro
  if erro=$(
    export LC_ALL=C
    kill -0 "$1" 2>&1
  ); then
    echo "vivo"
    return 0
  fi
  case "$erro" in
    *"No such process"*) echo "morto" ;;
    *) echo "indeterminado" ;;
  esac
}

# escrever_pid_no_trinco
# Só depois de o `mkdir` ter dado certo: a partir daqui o trinco é deste
# processo e o trap EXIT liberta-o, aconteça o que acontecer.
escrever_pid_no_trinco() {
  TRINCO_MEU=1
  if ! printf '%s\n' "$$" >"$TRINCO/pid"; then
    echo "deploy.sh: tomei o trinco ${TRINCO} mas não consegui escrever lá o PID. Recuso continuar. Nada foi alterado." >&2
    exit 1
  fi
}

tomar_trinco() {
  local pid_dono estado abandonado pid_movido

  if mkdir -- "$TRINCO" 2>/dev/null; then
    escrever_pid_no_trinco
    return 0
  fi

  # O `mkdir` falhou. Regra 10: ou o trinco já existe (resposta), ou não o
  # consegui criar por outra razão (avaria: permissões, um ficheiro com o
  # mesmo nome). Nunca a mesma mensagem.
  if [ -L "$TRINCO" ] || [ ! -d "$TRINCO" ]; then
    echo "deploy.sh: não consegui criar o trinco ${TRINCO}, e o que lá está não é uma pasta de trinco (ou não há nada e o mkdir falhou por outra razão). Recuso continuar sem trinco. Nada foi alterado." >&2
    exit 1
  fi

  if [ ! -f "$TRINCO/pid" ]; then
    echo "deploy.sh: o trinco ${TRINCO} existe mas não tem PID lá dentro. Ou outro deploy está a arrancar neste preciso momento, ou um deploy morreu entre criar o trinco e escrever o PID. Se tem a certeza de que nenhum deploy está a correr, apague a pasta à mão (rm -r ${TRINCO}) e volte a pedir o deploy. Nada foi alterado." >&2
    exit 1
  fi
  if ! pid_dono=$(cat -- "$TRINCO/pid"); then
    echo "deploy.sh: não consegui ler ${TRINCO}/pid. Recuso continuar sem saber quem tem o trinco. Nada foi alterado." >&2
    exit 1
  fi
  if ! [[ "$pid_dono" =~ ^[1-9][0-9]{0,9}$ ]]; then
    echo "deploy.sh: ${TRINCO}/pid não tem um PID válido ('${pid_dono}'). Se tem a certeza de que nenhum deploy está a correr, apague a pasta à mão (rm -r ${TRINCO}). Nada foi alterado." >&2
    exit 1
  fi

  estado=$(estado_do_processo "$pid_dono")
  case "$estado" in
    vivo)
      echo "deploy.sh: outro deploy está a correr (PID ${pid_dono}, trinco ${TRINCO}). Esta corrida termina aqui, sem tocar em nada. Espere que o outro acabe; não carregue outra vez no Deploy." >&2
      exit 1
      ;;
    morto) ;;
    *)
      echo "deploy.sh: o trinco ${TRINCO} é do PID ${pid_dono}, e não consegui saber se esse processo ainda existe (o kill -0 falhou por outra razão que não 'não existe'). Recuso continuar. Nada foi alterado." >&2
      exit 1
      ;;
  esac

  # Recuperar: primeiro tira-se o trinco abandonado do caminho com um `mv`
  # (atómico), e só depois se confirma que o que se tirou era mesmo o do
  # PID morto. Se dois deploys virem o mesmo trinco abandonado ao mesmo
  # tempo, só um `mv` encontra a pasta; e se o outro já tiver recuperado e
  # criado um trinco novo, o PID lá dentro já não é o morto e devolve-se.
  echo "deploy.sh: o trinco ${TRINCO} foi abandonado pelo PID ${pid_dono}, que já não existe (um deploy anterior morreu sem o libertar). A recuperá-lo."
  abandonado="${TRINCO}.abandonado.$$"
  if ! mv -- "$TRINCO" "$abandonado" 2>/dev/null; then
    if [ -d "$TRINCO" ]; then
      echo "deploy.sh: não consegui mover o trinco abandonado ${TRINCO} (o mv falhou e a pasta continua lá). Recuso continuar. Nada foi alterado." >&2
    else
      echo "deploy.sh: outro deploy está a correr: recuperou o trinco abandonado ${TRINCO} antes desta corrida. Esta corrida termina aqui, sem tocar em nada." >&2
    fi
    exit 1
  fi
  pid_movido=$(cat -- "$abandonado/pid" 2>/dev/null || true)
  if [ "$pid_movido" != "$pid_dono" ]; then
    if [ ! -e "$TRINCO" ] && mv -- "$abandonado" "$TRINCO"; then
      echo "deploy.sh: outro deploy está a correr: recuperou o trinco abandonado primeiro (PID ${pid_movido}). Devolvi-lhe o trinco; esta corrida termina aqui, sem tocar em nada." >&2
    else
      echo "deploy.sh: outro deploy está a correr (PID ${pid_movido}), e não consegui devolver-lhe o trinco, que ficou em ${abandonado}. Esta corrida termina aqui, sem tocar em mais nada." >&2
    fi
    exit 1
  fi
  if ! rm -rf -- "$abandonado"; then
    echo "deploy.sh: não consegui apagar o trinco abandonado, que ficou em ${abandonado}. Recuso continuar. Nada foi alterado." >&2
    exit 1
  fi
  if ! mkdir -- "$TRINCO" 2>/dev/null; then
    echo "deploy.sh: outro deploy está a correr: tomou o trinco ${TRINCO} logo a seguir à recuperação. Esta corrida termina aqui, sem tocar em nada." >&2
    exit 1
  fi
  escrever_pid_no_trinco
  echo "deploy.sh: trinco recuperado; este deploy continua."
}

PASSO_ATUAL="a tomar o trinco (${TRINCO})"
tomar_trinco

# versao_valida <texto>
# Mesma regra que `backend/app/versao.py` aceita ao ler `VERSION`: se o
# formato não bater certo aqui, o deploy.sh nunca devia sequer tentar
# escrever o ficheiro, mas se o fizesse, `obter_versao()` devolveria "dev"
# em silêncio, e `esperar-versao.sh` esperaria para sempre por um SHA que
# nunca vai aparecer.
versao_valida() {
  [[ "$1" =~ ^[A-Za-z0-9._-]{1,64}$ ]]
}

# verificar_env <caminho>
# Produz uma mensagem DIFERENTE consoante o `.env` esteja em falta, ou seja
# uma ligação simbólica pendurada (existe como ligação, mas o alvo não
# existe) — são avarias diferentes, mesmo que a reação (recusar) seja
# igual (regra 10: um guarda tem de distinguir vazio de avaria).
verificar_env() {
  local caminho="$1"
  if [ -L "$caminho" ] && [ ! -e "$caminho" ]; then
    echo "deploy.sh: ${caminho} é uma ligação simbólica pendurada (o alvo não existe)." >&2
    return 1
  fi
  if [ ! -e "$caminho" ]; then
    echo "deploy.sh: ${caminho} não existe." >&2
    return 1
  fi
  if [ ! -f "$caminho" ]; then
    echo "deploy.sh: ${caminho} existe mas não é um ficheiro regular." >&2
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# sincronizar <modo> <origem> <destino>
#
# O substituto do `rsync`, que o CageFS do cPanel não tem (ver cabeçalho).
# Três modos, um por cada `rsync` que havia, com a mesma semântica:
#
#   espelho     `rsync -a --delete`. O destino fica igual à origem: o que
#               só existe no destino desaparece. Para `api/app/` e
#               `api/migrations/`.
#   acrescenta  `rsync -a`, sem `--delete`. Copia tudo, não apaga nada.
#               Para `api/scripts/`.
#   site        `rsync -a --safe-links --delete --exclude='/media'
#               --exclude='.htaccess' --exclude='/.well-known'`. Para o
#               frontend, sobre `WEB`. As exclusões valem dos DOIS lados,
#               como no `rsync`: nunca se copia da origem, e nunca se apaga
#               nem sobrescreve no destino. `media` e `.well-known` só na
#               raiz (eram padrões ancorados, com `/`); `.htaccess` a
#               qualquer profundidade (padrão sem âncora). É isto que
#               protege `WEB/api/.htaccess`, onde o cPanel escreve o bloco do
#               Passenger: a pasta `WEB/api` não está na origem, o seu
#               conteúdo é apagado como qualquer resto do frontend antigo,
#               mas o `.htaccess` fica — e por isso a pasta também, porque
#               só se remove uma pasta que tenha ficado vazia.
#
# O que se manteve do `rsync -a`, de propósito:
#
#   - Ficheiros copiados com `cp -p` (modo e datas), para um temporário na
#     mesma pasta, e postos no lugar com `mv` — uma troca atómica: o Apache
#     nunca serve um ficheiro a meio de ser escrito.
#   - Ligações simbólicas no DESTINO nunca são seguidas: são substituídas
#     (o `rsync` também não escrevia através delas). Sem isto, um
#     `WEB/assets` que fosse uma ligação para fora levava o `cp` a escrever
#     lá fora.
#   - Ligações simbólicas na ORIGEM recusam a sincronização. O `rsync`
#     do frontend tinha `--safe-links` (ignorava as que saíam da árvore); o
#     guarda antes de qualquer escrita, mais abaixo, recusa o pacote
#     inteiro se encontrar alguma, e aqui volta-se a recusar entrada a
#     entrada, para o caso de uma aparecer entre o guarda e a cópia. O
#     `cp` segue ligações, e "nunca seguir" é mais fácil de garantir do que
#     "seguir só as boas".
#
# O que é diferente, e não importa aqui: o modo e as datas das PASTAS não
# são copiados (ficam os do `mkdir`, com o umask da conta), e os ficheiros
# são sempre copiados, mesmo iguais — o pacote tem umas centenas de
# ficheiros, e comparar custava mais código do que copiar.
#
# Regra 10: um `glob` sobre uma pasta que não se consegue ler devolve
# "vazio" — e no modo espelho "a origem está vazia" quer dizer "apaga o
# destino todo". Por isso cada pasta é verificada (`-r` e `-x`) antes de ser
# listada, e uma pasta ilegível é uma avaria, nunca uma pasta vazia.
#
# Os erros são todos tratados à mão (`|| return 1`) e nunca deixados ao
# `set -e`: dentro de uma função chamada a partir de um `||`, o `set -e`
# fica desligado, e a recursão abaixo é toda feita assim.
# ---------------------------------------------------------------------------

# excluido <modo> <relativo>
# Verdadeiro se o caminho (relativo à raiz da sincronização) está fora dela.
excluido() {
  [ "$1" = "site" ] || return 1
  case "$2" in
    media | .well-known) return 0 ;;
  esac
  case "${2##*/}" in
    .htaccess) return 0 ;;
  esac
  return 1
}

# pasta_legivel <caminho>
pasta_legivel() {
  if [ ! -r "$1" ] || [ ! -x "$1" ]; then
    echo "deploy.sh: não consigo ler a pasta ${1} — recuso tratá-la como vazia." >&2
    return 1
  fi
  return 0
}

# copiar_ficheiro <origem> <destino>
copiar_ficheiro() {
  local origem="$1" destino="$2" temporario
  temporario="${destino%/*}/.tomazia-sinc.$$.${destino##*/}"
  if ! rm -f -- "$temporario"; then
    echo "deploy.sh: não consegui limpar o temporário ${temporario}." >&2
    return 1
  fi
  if ! cp -p -- "$origem" "$temporario"; then
    echo "deploy.sh: não consegui copiar ${origem}." >&2
    rm -f -- "$temporario"
    return 1
  fi
  if ! mv -f -- "$temporario" "$destino"; then
    echo "deploy.sh: não consegui pôr ${destino} no lugar." >&2
    rm -f -- "$temporario"
    return 1
  fi
  return 0
}

# apagar <modo> <caminho> <relativo>
# Apaga uma entrada do destino que já não está na origem. No modo site
# desce pelas pastas, porque pode haver um `.htaccess` lá dentro a
# proteger; a pasta só sai se tiver ficado vazia.
apagar() {
  local modo="$1" caminho="$2" relativo="$3" entrada restantes
  if [ -L "$caminho" ] || [ ! -d "$caminho" ]; then
    if ! rm -f -- "$caminho"; then
      echo "deploy.sh: não consegui apagar ${caminho}." >&2
      return 1
    fi
    return 0
  fi
  if [ "$modo" != "site" ]; then
    if ! rm -rf -- "$caminho"; then
      echo "deploy.sh: não consegui apagar a pasta ${caminho}." >&2
      return 1
    fi
    return 0
  fi
  pasta_legivel "$caminho" || return 1
  for entrada in "$caminho"/*; do
    if excluido "$modo" "${relativo}/${entrada##*/}"; then
      continue
    fi
    apagar "$modo" "$entrada" "${relativo}/${entrada##*/}" || return 1
  done
  restantes=("$caminho"/*)
  if [ "${#restantes[@]}" -eq 0 ]; then
    if ! rmdir -- "$caminho"; then
      echo "deploy.sh: não consegui apagar a pasta vazia ${caminho}." >&2
      return 1
    fi
  fi
  return 0
}

# sincronizar_pasta <modo> <origem> <destino> <relativo>
# Assume `dotglob` e `nullglob` ligados (é o `sincronizar` que os liga).
sincronizar_pasta() {
  local modo="$1" origem="$2" destino="$3" relativo="$4"
  local entrada nome rel alvo
  pasta_legivel "$origem" || return 1
  pasta_legivel "$destino" || return 1

  for entrada in "$origem"/*; do
    nome="${entrada##*/}"
    rel="${relativo:+${relativo}/}${nome}"
    alvo="${destino}/${nome}"
    if excluido "$modo" "$rel"; then
      continue
    fi
    if [ -L "$entrada" ]; then
      echo "deploy.sh: ${entrada} é uma ligação simbólica — recuso segui-la ou copiá-la." >&2
      return 1
    elif [ -d "$entrada" ]; then
      # Um destino que seja ligação, ou ficheiro, onde a origem tem uma
      # pasta: sai do caminho (a ligação nunca é seguida).
      if [ -L "$alvo" ] || { [ -e "$alvo" ] && [ ! -d "$alvo" ]; }; then
        if ! rm -f -- "$alvo"; then
          echo "deploy.sh: não consegui substituir ${alvo} por uma pasta." >&2
          return 1
        fi
      fi
      if [ ! -d "$alvo" ] && ! mkdir -- "$alvo"; then
        echo "deploy.sh: não consegui criar a pasta ${alvo}." >&2
        return 1
      fi
      sincronizar_pasta "$modo" "$entrada" "$alvo" "$rel" || return 1
    elif [ -f "$entrada" ]; then
      # Uma pasta (verdadeira) onde a origem tem um ficheiro: apaga-se
      # primeiro, senão o `mv` punha o ficheiro DENTRO dela. Se ficar de
      # pé (tinha um `.htaccess` protegido), recusa-se.
      if [ ! -L "$alvo" ] && [ -d "$alvo" ]; then
        apagar "$modo" "$alvo" "$rel" || return 1
        if [ -d "$alvo" ]; then
          echo "deploy.sh: ${alvo} é uma pasta com conteúdo protegido, e a origem tem lá um ficheiro — recuso substituí-la." >&2
          return 1
        fi
      fi
      # Uma ligação no destino: o `mv` substitui-a, mas se apontar para
      # uma pasta o `mv` entraria nela. Tira-se antes.
      if [ -L "$alvo" ] && ! rm -f -- "$alvo"; then
        echo "deploy.sh: não consegui tirar a ligação simbólica ${alvo}." >&2
        return 1
      fi
      copiar_ficheiro "$entrada" "$alvo" || return 1
    else
      echo "deploy.sh: ${entrada} não é um ficheiro regular nem uma pasta — recuso copiá-lo." >&2
      return 1
    fi
  done

  if [ "$modo" = "acrescenta" ]; then
    return 0
  fi
  for entrada in "$destino"/*; do
    nome="${entrada##*/}"
    rel="${relativo:+${relativo}/}${nome}"
    if excluido "$modo" "$rel"; then
      continue
    fi
    if [ -e "${origem}/${nome}" ] || [ -L "${origem}/${nome}" ]; then
      continue
    fi
    apagar "$modo" "$entrada" "$rel" || return 1
  done
  return 0
}

sincronizar() {
  local modo="$1" origem="$2" destino="$3" codigo=0
  case "$modo" in
    espelho | acrescenta | site) ;;
    *)
      echo "deploy.sh: modo de sincronização desconhecido '${modo}'." >&2
      return 1
      ;;
  esac
  if [ -L "$origem" ] || [ ! -d "$origem" ]; then
    echo "deploy.sh: a origem ${origem} não é uma pasta (ou é uma ligação simbólica)." >&2
    return 1
  fi
  if [ -L "$destino" ]; then
    echo "deploy.sh: o destino ${destino} é uma ligação simbólica — recuso escrever através dela." >&2
    return 1
  fi
  if [ -e "$destino" ] && [ ! -d "$destino" ]; then
    echo "deploy.sh: o destino ${destino} existe e não é uma pasta." >&2
    return 1
  fi
  if [ ! -d "$destino" ] && ! mkdir -- "$destino"; then
    echo "deploy.sh: não consegui criar ${destino}." >&2
    return 1
  fi
  shopt -s dotglob nullglob
  sincronizar_pasta "$modo" "$origem" "$destino" "" || codigo=$?
  shopt -u dotglob nullglob
  return "$codigo"
}

# ---------------------------------------------------------------------------
# Guardas: tudo o que recusa o deploy tem de correr ANTES de qualquer
# escrita (pip, sincronizações, alembic, VERSION, restart.txt). Nenhuma toca
# em nada — só leem e validam.
# ---------------------------------------------------------------------------

PASSO_ATUAL="a ler ${CONFIG}"
if [ ! -f "$CONFIG" ]; then
  echo "deploy.sh: ficheiro de configuração ${CONFIG} não existe. Tem de ter uma linha 'WEB=<caminho absoluto>'." >&2
  exit 1
fi

web_bruto=$(sed -n 's/^WEB=//p' "$CONFIG" | tail -n1)
if [ -z "$web_bruto" ]; then
  echo "deploy.sh: ${CONFIG} não tem uma linha 'WEB=<caminho absoluto>'." >&2
  exit 1
fi

PASSO_ATUAL="a validar WEB (${web_bruto})"
case "$web_bruto" in
  /*) ;;
  *)
    echo "deploy.sh: WEB tem de ser um caminho absoluto (recebi '${web_bruto}')." >&2
    exit 1
    ;;
esac

home_real=$(realpath "$HOME")
# Regra 10, com consequência destrutiva: NUNCA um fallback aqui. O
# `realpath` falhar quer dizer "não consegui resolver este caminho", e
# isso não pode virar "resolve para si próprio". Com o fallback antigo, um
# WEB com `..` (p.ex. `$HOME/../../tmp/x`, um caminho que não existe, logo
# o `realpath` falhava) passava intacto para o `case` abaixo — e o `*` do
# padrão casa com barras, portanto `"$home_real"/*` dava-o por dentro do
# `$HOME`.
#
# O que isso provocava, exatamente: NÃO era escrita fora do `$HOME`. Para
# o `realpath` falhar, o caminho tem de não existir ou não ser legível —
# e nos dois casos o `[ ! -f "$WEB/.htaccess" ]` poucas linhas abaixo
# recusa antes de qualquer escrita. O guarda do `.htaccess` era a rede
# com que ninguém contava. O defeito real era a MENSAGEM: o deploy morria
# a dizer "WEB não tem .htaccess" quando o que tinha acontecido era "não
# consegui resolver o WEB" — uma avaria relatada como resposta, que é a
# regra 10 na letra. Corrige-se à mesma: depender de um guarda posterior
# por acaso não é desenho.
if ! web_real=$(realpath "$web_bruto" 2>/dev/null); then
  echo "deploy.sh: não consegui resolver WEB ('${web_bruto}') — ou não existe, ou não é legível. Recuso continuar sem saber para onde ia sincronizar." >&2
  exit 1
fi
case "$web_real" in
  "$home_real"/*) ;;
  *)
    echo "deploy.sh: WEB (${web_bruto}) tem de estar dentro de \$HOME (${HOME})." >&2
    exit 1
    ;;
esac
WEB="$web_real"

if [ ! -f "$WEB/.htaccess" ]; then
  echo "deploy.sh: WEB (${WEB}) não tem .htaccess — recuso-me a sincronizar o frontend para lá." >&2
  exit 1
fi
if [ ! -d "$WEB/media" ]; then
  echo "deploy.sh: WEB (${WEB}) não tem a pasta media/ — recuso-me a sincronizar o frontend para lá." >&2
  exit 1
fi

PASSO_ATUAL="a verificar o ficheiro de ambiente (antes de tudo)"
verificar_env "$API/.env"

PASSO_ATUAL="a validar VERSION no pacote (${ORIGEM}/api/VERSION)"
if [ ! -f "$ORIGEM/api/VERSION" ]; then
  echo "deploy.sh: ${ORIGEM}/api/VERSION não existe no pacote." >&2
  exit 1
fi
versao_pacote=$(cat "$ORIGEM/api/VERSION")
if ! versao_valida "$versao_pacote"; then
  echo "deploy.sh: ${ORIGEM}/api/VERSION tem um formato inválido." >&2
  exit 1
fi

PASSO_ATUAL="a validar o frontend no pacote (${ORIGEM}/frontend/dist/index.html)"
# A sincronização do frontend (modo site, que apaga), lá em baixo, era a
# única cujo lado de ORIGEM não tinha precondição nenhuma — o do `api/`
# tem o `VERSION` logo acima. Com um `frontend/dist/` presente mas vazio ou incompleto (um
# `.gitignore` dentro do pacote a tirar ficheiros do commit publicado, um
# `montar.sh` futuro com um erro), apagar o que falta apagava `index.html` e
# `assets/` do site em produção; e, pior, o deploy continuava e saía 0,
# com o `esperar-versao.sh` a dar verde, porque a API fica de pé. O site
# em baixo e a pipeline toda verde. Aqui ainda não se escreveu nada.
if [ ! -f "$ORIGEM/frontend/dist/index.html" ]; then
  echo "deploy.sh: ${ORIGEM}/frontend/dist/index.html não existe no pacote — recuso sincronizar o frontend, porque apagar o que não está na origem apagaria o site." >&2
  exit 1
fi

PASSO_ATUAL="a validar a app no pacote (${ORIGEM}/api/app/main.py)"
# A mesma rede, do lado do `api/`. O `VERSION` acima prova que o pacote
# foi montado, não que o `app/` lá dentro traz alguma coisa: um
# `api/app/` presente mas vazio fazia o modo espelho limpar o
# `$API/app`. O deploy abortava a seguir no alembic, antes do
# `restart.txt` — por isso a app velha continuava a servir de memória —
# mas o disco ficava destruído e o deploy seguinte partia de nada.
if [ ! -f "$ORIGEM/api/app/main.py" ]; then
  echo "deploy.sh: ${ORIGEM}/api/app/main.py não existe no pacote — recuso sincronizar a app, porque o modo espelho esvaziaria ${API}/app." >&2
  exit 1
fi

PASSO_ATUAL="a procurar ligações simbólicas no pacote (${ORIGEM}/api, ${ORIGEM}/frontend/dist)"
# Nenhuma ligação simbólica no que se vai copiar. Uma ligação no build
# (p.ex. `dist/logo.svg -> ../tomazia_api/.env`) aterrava no site e o
# Apache (`SymLinksIfOwnerMatch`) servia por HTTP o ficheiro do outro lado
# — que nunca esteve no pacote nem passou por guarda nenhum: o S-10/S-12
# olha para nomes, e o guarda de contagem do `publicar-branch.sh` não
# dispara, porque o git guarda a ligação como uma entrada (modo 120000).
# O `montar.sh` já recusa ligações no runner; esta é a segunda camada, no
# servidor, sobre o que o `git pull` deixou. O `rsync` tinha
# `--safe-links`, que as IGNORAVA em silêncio; aqui recusa-se o pacote
# inteiro, em voz alta, antes de qualquer escrita — um pacote com uma
# ligação é um pacote que não saiu do `montar.sh` deste repositório.
#
# Regra 10: o `find` a falhar (uma pasta ilegível) não é "não há
# ligações". O código de saída é lido à parte, e as duas recusas dizem
# coisas diferentes.
if ! ligacoes=$(find "$ORIGEM/api" "$ORIGEM/frontend/dist" -type l -print); then
  echo "deploy.sh: não consegui procurar ligações simbólicas no pacote (o find falhou — ver acima). Recuso continuar sem saber o que ia copiar. Nada foi alterado." >&2
  exit 1
fi
if [ -n "$ligacoes" ]; then
  echo "deploy.sh: o pacote tem ligações simbólicas — recuso sincronizá-lo, porque uma ligação no site serve por HTTP o ficheiro para onde aponta. Nada foi alterado. Ligações encontradas:" >&2
  printf '%s\n' "$ligacoes" >&2
  exit 1
fi

PASSO_ATUAL="a localizar o virtualenv (\$HOME/virtualenv/tomazia_api/*/bin/activate)"
shopt -s nullglob
candidatos_venv=("$HOME"/virtualenv/tomazia_api/*/bin/activate)
shopt -u nullglob
if [ "${#candidatos_venv[@]}" -eq 0 ]; then
  echo "deploy.sh: não encontrei nenhum \$HOME/virtualenv/tomazia_api/*/bin/activate." >&2
  exit 1
fi
venv_activate="${candidatos_venv[0]}"

# ---------------------------------------------------------------------------
# A partir daqui já se escreve. A ordem importa (ver cabeçalho).
# ---------------------------------------------------------------------------

PASSO_ATUAL="a ativar o virtualenv (${venv_activate})"
# shellcheck disable=SC1090 # caminho só conhecido em runtime (glob do cPanel)
source "$venv_activate"

PASSO_ATUAL="a instalar dependências (pip install --require-hashes)"
pip install --require-hashes -r "$ORIGEM/api/requirements.txt"

PASSO_ATUAL="a sincronizar o código (api/app/, api/migrations/)"
# Modo espelho (o antigo `--delete`) só nestas duas pastas — nunca na raiz
# de tomazia_api/, onde vive o `.env`. O resto copia-se individualmente,
# sem apagar nada.
sincronizar espelho "$ORIGEM/api/app" "$API/app"
sincronizar espelho "$ORIGEM/api/migrations" "$API/migrations"

PASSO_ATUAL="a sincronizar os scripts (api/scripts/)"
# `scripts/` existe desde a F2-08 (o `importar_bd_antiga.py`), mas o
# `montar.sh` só a copia para o pacote `if [ -d ]` e a condição aqui tem
# de ficar: um pacote montado antes da F2-08 — ou um rollback para um —
# não a tem, e sem esta condição a sincronização recusava a origem em
# falta e o deploy inteiro morria por uma pasta ausente.
#
# Modo acrescenta (sem apagar), ao contrário de `app/` e `migrations/`: um
# script apagado do repositório sobrevive no servidor. Fica assim de
# propósito — `tomazia_api/` está fora do `public_html` e só se alcança por
# SSH — mas está escrito para quem precisar de limpar saber que tem de o
# fazer à mão.
if [ -d "$ORIGEM/api/scripts" ]; then
  sincronizar acrescenta "$ORIGEM/api/scripts" "$API/scripts"
fi

PASSO_ATUAL="a copiar alembic.ini, passenger_wsgi.py e requirements.txt"
cp -f "$ORIGEM/api/alembic.ini" "$API/alembic.ini"
cp -f "$ORIGEM/api/passenger_wsgi.py" "$API/passenger_wsgi.py"
cp -f "$ORIGEM/api/requirements.txt" "$API/requirements.txt"

PASSO_ATUAL="a sincronizar o frontend (WEB=${WEB})"
# media/, .htaccess e .well-known/ sobrevivem: nunca apagados, nunca
# sobrescritos. Um ficheiro antigo do frontend que já não está no pacote
# desaparece — por isso o modo site apaga, à raiz de WEB (nunca tocou em
# tomazia_api/, que é outra árvore). Isto inclui ficheiros escondidos
# postos à mão na raiz do site: um `.env` deixado em `WEB` por engano é
# apagado no deploy seguinte, como qualquer outro resto. A ORIGEM é
# `frontend/dist/`, não `frontend/` — `montar.sh` escreve o build do Vite
# dentro de `dist/` (`cp -a frontend/dist "${saida}/frontend/dist"`);
# sincronizar a partir de `frontend/` (sem o `dist/`) punha
# `WEB/dist/index.html` em vez de `WEB/index.html`.
#
# `.htaccess` excluído a QUALQUER profundidade (era o `--exclude` sem
# âncora do `rsync`, nunca `/.htaccess` sozinho): um `.htaccess` dentro de
# uma subpasta do build (ex.: `dist/assets/.htaccess`, vindo de uma
# dependência ou de um erro de build) também tem de ficar de fora — o
# Apache honra-o (o cPanel deixa `AllowOverride All`), e uma exclusão só à
# raiz deixava-o passar e sobrepor-se à configuração real do servidor. Do
# lado do destino, a mesma regra protege `WEB/api/.htaccess`, onde o
# cPanel escreve o bloco do Passenger. `montar.sh` recusa, como rede
# adicional, qualquer `.htaccess` dentro do próprio pacote (ver o
# comentário lá).
sincronizar site "$ORIGEM/frontend/dist" "$WEB"

PASSO_ATUAL="a verificar o ficheiro de ambiente outra vez (depois das sincronizações, antes de alembic e do reinício)"
# O caso que esta tarefa descreve: uma sincronização (nunca devia, mas
# pode, por bug ou por uma ferramenta adulterada no PATH) apagar o .env a
# meio do deploy. Isto tem de ser apanhado AQUI — nunca só na verificação
# do início — porque é depois de sincronizar que o ficheiro pode ter
# desaparecido.
verificar_env "$API/.env"

PASSO_ATUAL="a correr migrações (alembic upgrade head)"
(cd "$API" && alembic -c "$API/alembic.ini" upgrade head)

PASSO_ATUAL="a escrever VERSION (penúltimo passo)"
cp -f "$ORIGEM/api/VERSION" "$API/VERSION"

PASSO_ATUAL="a sinalizar o reinício (tmp/restart.txt, sempre o último passo)"
mkdir -p "$API/tmp"
touch "$API/tmp/restart.txt"
REINICIADO=1

echo "deploy.sh: deploy concluído (versão ${versao_pacote})."
