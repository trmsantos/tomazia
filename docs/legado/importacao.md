# Importar a base de dados do site antigo (F2-08)

Runbook do `backend/scripts/importar_bd_antiga.py`. Corre-se **uma vez**, por
SSH, no servidor, e é o Tomás que o corre. Lê de cima a baixo antes de escrever
o primeiro comando: a partir do passo 4 não há volta atrás barata.

As decisões que estão por trás disto vivem em
`docs/decisoes/0014-a-chave-da-importacao-e-o-id-do-site-antigo.md` e na entrada
F2-08 de `docs/TAREFAS.md`. Este documento é só o operacional.

## 1. O que isto faz e o que não faz

O script lê uma **cópia** da base de dados do site antigo e enche três tabelas
do site novo: `categorias`, `produtos` e `eventos`. Copia também para o
`MEDIA_DIR` as imagens dos eventos que a origem refere. **Não** importa a
galeria, os clientes nem os admins, e nunca escreve na origem — abre-a só para
leitura. **Só insere**: o que já lá estiver não é atualizado nem apagado. É por
isso que, na prática, isto não se desfaz: a seguir à primeira importação a
fonte de verdade passa a ser o site novo, e o site antigo deixa de poder
corrigir o que quer que seja.

### Irreversível na prática: três coisas que ficam impossíveis (ADR 0014)

Isto é o que precisas de saber **antes** de carregar no botão, não depois:

1. **Propagar uma correção feita no site antigo.** Mudar um preço no PHP e
   voltar a correr o importador não muda nada no site novo. A linha aparece na
   lista de divergências, o script recusa-se a escrever seja o que for, e fica
   à espera de uma pessoa. Corrige-se na gestão do site novo.
2. **Propagar uma eliminação.** Um produto apagado no site antigo fica no novo
   para sempre, e o importador nem o consegue ver — ele não distingue uma linha
   que importou de uma que o dono criou. Apaga-se na gestão.
3. **Recriar no site antigo.** Apagar e voltar a criar o mesmo produto lá dá-lhe
   um `id_produto` novo, e cá entra como **segunda linha**: um duplicado
   visível na ementa.

E uma consequência que não é impossibilidade: renomear uma categoria na gestão
e importar produtos novos a seguir faz a categoria antiga renascer, porque a
chave das categorias é o `slug`. O relatório nomeia-a como divergência.

## 2. Antes de começar

### 2.1 A F1-05 tem de estar feita. Sem servidor, isto não começa

**Nada deste runbook se pode fazer enquanto a F1-05 não estiver feita.** Até lá
não há Setup Python App, não há `tomazia_api/`, não há ficheiro de ambiente, não
há base de dados de destino e não há SSH onde correr nada. Se a F1-05 ainda não
está feita, fecha este documento: não há aqui um caminho alternativo, e não é
suposto haver — o script corre **no servidor**, e é por isso que a pasta
`img/uploads/` do site antigo já lá está e não há nada para descarregar.

O script chega ao servidor com o deploy desta própria tarefa (o `montar.sh`
leva o `backend/scripts/` para o pacote e o `deploy.sh` sincroniza-o para
`tomazia_api/scripts/`). Entra por SSH e confirma que lá está:

```bash
ssh UTILIZADOR@DOMINIO
```

```bash
ls -l "$HOME/tomazia_api/scripts/importar_bd_antiga.py"
cat "$HOME/tomazia_api/VERSION"
```

Se o ficheiro não estiver lá, o deploy da F2-08 ainda não correu — vai ver o
`deploy.yml` no GitHub antes de continuar. O `VERSION` tem de ser o SHA do
commit de merge da F2-08 na `main`; se for outro, estás a olhar para código
mais velho do que este documento.

Ativa o virtualenv do Passenger, que é onde as dependências estão instaladas:

```bash
ls -d "$HOME"/virtualenv/tomazia_api/*/bin/activate
```

Isso tem de imprimir **uma** linha. Se imprimir mais do que uma, há mais do que
uma versão de Python configurada: para, e vê no Setup Python App qual é a que
serve a app — correr com a errada dá erros de dependências que não dizem nada.
Com uma linha só:

```bash
source "$(ls -d "$HOME"/virtualenv/tomazia_api/*/bin/activate)"
```

E prepara a pasta de trabalho e os caminhos. Tudo o que vem a seguir usa estas
variáveis, por isso define-as **nesta** sessão de SSH e não feches o terminal a
meio:

```bash
mkdir -p "$HOME/importacao"

IMPORTADOR="$HOME/tomazia_api/scripts/importar_bd_antiga.py"
ANTIGA="$HOME/importacao/copia-do-site-antigo.db"
GUARDADO="$HOME/importacao/destino-antes-da-importacao.db"
UPLOADS="$HOME/public_html/img/uploads"
DESTINO="$HOME/tomazia_data/tomazia.db"
```

O `DESTINO` é o que o `.env` do servidor tem em `BASE_DADOS_URL`, e o caminho
acima é o que a `docs/ESPECIFICACAO.md` descreve. **Não o tomes por garantido:**
a primeira linha do relatório do passo 3 diz qual é o destino verdadeiro, e é
contra ela que o confirmas.

### 2.2 A cópia da base de dados do site antigo

O script nunca escreve na origem — abre-a com `mode=ro`. A cópia não é por
desconfiança do script: é porque aquele ficheiro é a única cópia que existe dos
dados do bar, e porque assim podes corrigir linhas na cópia sem tocar no que
está a servir o site antigo.

Põe o caminho da base de dados do site antigo na variável — é a que moveste
para fora do `public_html` na F0-01 — e copia-a com o nome que quiseres:

```bash
# Preenche com o caminho completo da base de dados do site antigo.
ORIGINAL_DO_SITE_ANTIGO=

cp -a "$ORIGINAL_DO_SITE_ANTIGO" "$ANTIGA"
ls -l "$ANTIGA"
```

Se deixares a variável vazia, o `cp` falha em voz alta — é o que se quer.

Confirma que a cópia abre e que traz o que é suposto trazer:

```bash
python - "$ANTIGA" <<'FIM'
import sqlite3, sys

bd = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
for tabela in ("produtos", "eventos"):
    (quantas,) = bd.execute(f"SELECT count(*) FROM {tabela}").fetchone()
    print(f"{tabela}: {quantas}")
tipos = [t for (t,) in bd.execute("SELECT DISTINCT tipo FROM produtos ORDER BY tipo")]
print(f"tipos distintos: {len(tipos)} -> {tipos}")
bd.close()
FIM
```

À espera: **140 produtos** e **12 tipos distintos**. Doze tipos, onze
categorias — `Bebidas` e `bebidas` juntam-se, e isso é o passo 3 que o mostra.

**Esta cópia tem dados pessoais lá dentro** — a tabela dos clientes com emails e
telemóveis, e a dos admins com as passwords antigas. Fica em `$HOME/importacao`,
que não é servido pela web, **nunca** dentro do `public_html` nem de
`novo.<domínio>`, e apaga-se assim que a importação estiver confirmada (passo
8). O importador não lê nenhuma dessas tabelas, e há um teste de segurança que o
prende; a cuidar do ficheiro és tu.

### 2.3 A cópia da base de dados de destino

**Isto não se salta.** A F2-02, que traz o `scripts/backup.py`, ainda não está
fundida: não há cópia de segurança automática nenhuma, e o deploy não faz
rollback. A rede é esta cópia, feita à mão, agora.

Não uses `cp` na base de dados de destino: ela está em modo WAL e tem ficheiros
ao lado (`-wal`, `-shm`) com dados que o ficheiro principal ainda não tem. A API
do SQLite tira uma fotografia consistente, num ficheiro só:

```bash
python - "$DESTINO" "$GUARDADO" <<'FIM'
import sqlite3, sys

origem = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
copia = sqlite3.connect(sys.argv[2])
with copia:
    origem.backup(copia)
origem.close()
copia.close()
print(f"cópia feita: {sys.argv[2]}")
FIM

ls -l "$GUARDADO"
```

Guarda o caminho do `$GUARDADO`. É com ele que se volta atrás (passo 7.1).

**Uma armadilha deste passo, e é por isso que está escrita aqui.** O comando
acima cria um ficheiro **novo**, com as permissões normais da tua conta — e é
uma das razões para usar a API do SQLite e não um `cp`. O `cp -a` do passo 2.2
leva as permissões do original atrás da cópia, e ali isso é o que se quer
(aquele ficheiro não é para escrever). Aqui não: uma cópia só-leitura que mais
tarde volte para o lugar do destino **com o modo dela** — um `cp -a` ou um `mv`
no restauro, em vez do `cp -f` do passo 7.1 — deixa-te com a base de dados de
produção em só-leitura.

Se isso acontecer, o relatório diz-to com todas as letras e **não é defeito
nenhum: é `chmod u+w`**. As três mensagens possíveis estão no passo 7.2 (c), e
as três aparecem já na simulação — nenhuma delas te apanha no dia do
`--aplicar`.

### 2.4 Onde está o `img/uploads/` do site antigo

As imagens dos eventos já estão no servidor — o site antigo serve-as de dentro
do `public_html`. Confirma a pasta antes de a passar ao script:

```bash
ls -d "$UPLOADS"
ls "$UPLOADS" | head
ls "$UPLOADS" | wc -l
```

Se o site antigo não estiver em `public_html/`, ajusta o `UPLOADS` para onde
ele estiver. A pasta costuma ter muito mais ficheiros do que os que interessam:
o script só procura lá os que os **eventos** referem, e ignora tudo o resto
(as fotos da galeria antiga não se importam — ver o passo 8).

**O que o script se recusa a copiar de lá, e porquê.** O `MEDIA_DIR` fica
dentro do `public_html` e é servido pelo Apache: é a única pasta do site que se
escreve a partir de dados que vieram de fora, e o `img/uploads/` do site antigo
é precisamente uma pasta de uploads. Por isso o script só copia ficheiros
`.jpg`, `.jpeg`, `.png`, `.gif` e `.webp` (lista branca), exige **uma extensão
só**, recusa nomes começados por ponto, e recusa ligações simbólicas — tanto na
pasta de origem como dentro do `MEDIA_DIR`. Um `.htaccess` ali repunha a execução de PHP exatamente onde
ela não pode haver, um `.php` é código que o servidor corre, um `.html` ou um
`.svg` é JavaScript no domínio do bar, e uma ligação a apontar para o ficheiro
de ambiente publicava o segredo da sessão num URL.

A exigência de **uma extensão só** é a que parece exagerada e não é: o Apache
despacha um ficheiro pelas extensões **todas** do nome, não pela última. Um
`shell.php.jpg` acaba em `.jpg` e é corrido como PHP na mesma — é a armadilha
que o `deploy/htaccess.exemplo` já descreve por extenso, e a razão de o
`FilesMatch` de lá acabar em `(\.|$)` e não em `$`. O custo está assumido: um
`cartaz.2026.jpg`, que não tem mal nenhum, também é recusado. A correção é
renomeá-lo para uma extensão só, na pasta das imagens e na origem — nunca
pedir uma exceção ao script. Se alguma destas aparecer, o
que fazer está no passo 7.2 — as do nome do ficheiro (ponto, extensão) em (e),
com as outras linhas que não convertem; as das ligações simbólicas em (f), com
as imagens.

## 3. Simular

**O script simula por omissão.** Sem `--aplicar` ele lê tudo, abre uma
transação, diz exatamente o que faria, e desfaz tudo no fim — não deixa uma
linha na base de dados nem um ficheiro no `MEDIA_DIR`. Corre isto quantas vezes
quiseres.

E simular não é só contar linhas: a pergunta a que a simulação responde é **"o
`--aplicar` vai correr bem?"**. Por isso a transação é aberta de verdade (um
`CHECK` ou um `NOT NULL` do destino aparece aqui, não só no dia em que se
escreve) e as três verificações de permissões — ficheiro do destino, pasta do
destino, `MEDIA_DIR` — correm **também na simulação**, antes de qualquer cópia.
Uma simulação verde seguida de um `--aplicar` que rebenta seria o pior dos
resultados: a rede que a simulação existe para dar, desperdiçada.

```bash
RELATORIO="$HOME/importacao/simulacao-$(date +%Y%m%d-%H%M%S).txt"

AMBIENTE=producao python "$IMPORTADOR" \
    --origem "$ANTIGA" \
    --imagens "$UPLOADS" \
    --esperar-produtos 140 \
    --esperar-categorias 11 > "$RELATORIO" 2>&1
echo "estado: $?"

cat "$RELATORIO"
```

Os dois `--esperar-*` são a confirmação dos números, e estão explicados no passo
5. Vão aqui desde a primeira corrida de propósito: eles conferem a **origem**,
correm **antes** de o destino ser aberto para escrita e antes de qualquer imagem
ser copiada, e por isso um número que não bate significa que nada foi tocado.

O `AMBIENTE=producao` vai explícito de propósito: a variável **não tem valor por
omissão em sítio nenhum**, e sem ela o script recusa logo à cabeça com "Não
consegui ler a configuração". Ou vem do ficheiro de ambiente do servidor, ou vem
daqui — pô-la na linha de comandos tem precedência sobre o ficheiro, com o mesmo
valor, e torna óbvio a quem ler o relatório mais tarde em que ambiente isto
correu.

O `2>&1` está lá por uma razão: o relatório inteiro sai em `stdout`, de
propósito — a conclusão é a última linha, e uma linha de `stderr` a aparecer
depois dela tornava a conclusão a frase errada. Há um só caso em que sai alguma
coisa em `stderr`: um defeito do script, e aí a conclusão (em `stdout`) começa
por "Rebentei a meio," e o `traceback` vem a seguir. É outra conversa, e está no
passo 7.2 (i).

### O que ler no relatório

```text
Destino: /home/UTILIZADOR/tomazia_data/tomazia.db
Origem: /home/UTILIZADOR/importacao/copia-do-site-antigo.db
Modo: simulação — não escrevo nada. Acrescenta --aplicar para escrever mesmo.
Categorias: 11 por criar, 0 já lá estavam.
Produtos: 140 por inserir, 0 já lá estavam.
Eventos: N por inserir, 0 já lá estavam.
Categorias, por esta ordem na ementa: Cafetaria, Comidas, Bebidas, Aguardentes, Vinhos do Porto, Licores, Martinis, Brandy, Whisky, Gin, Espirituosas.
Os tipos «Bebidas» e «bebidas» são o mesmo escrito de duas maneiras: os produtos dos dois ficam todos em «Bebidas».
Dois tipos mudam de nome no site novo: «portos» passa a «Vinhos do Porto» e «whiskys» passa a «Whisky».
Textos descodificados: X nomes de produto, Y títulos de evento e Z descrições de evento tinham entidades HTML na origem e entram como se escrevem.
  Produto 15: «J&amp;B» -> «J&B»
  Produto 16: «Ballantine&#039;s» -> «Ballantine's»
Imagens: K por copiar para /home/UTILIZADOR/public_html/media, 0 já lá estavam.
Simulei e não escrevi nada: com --aplicar entravam 11 categorias, 140 produtos e N eventos.
```

(As linhas dos textos descodificados são uma por nome de produto e por título de
evento que tenham mudado; as duas acima são só exemplo da forma. As descrições
de evento contam-se mas não se listam — uma descrição pode ter parágrafos e
partia a linha do relatório ao meio.)

Por ordem de importância:

1. **A primeira linha é o destino.** Tem de ser o mesmo caminho do `$DESTINO`
   que copiaste no passo 2.3. Se for outro, **para já**: o ficheiro que
   guardaste não é o que ias escrever. Acerta o `$DESTINO`, repete o passo 2.3,
   e só depois continua.
2. **A segunda linha é a origem.** Tem de ser a tua cópia, nunca o ficheiro
   original do site antigo.
3. **`Categorias: 11 por criar`, e a seguir as onze nomeadas e por ordem.** Onze
   a partir de doze `tipo` (passo 2.2) — e a linha seguinte diz exatamente
   porquê: `Os tipos «Bebidas» e «bebidas» são o mesmo escrito de duas maneiras`.
   A junção não é um caso especial escrito à mão para este par: a chave da
   categoria é o `slug` normalizado do `tipo`, e qualquer outro par que apareça
   na origem sai nesta linha sozinho. É esperado, não é perda.
4. **`Dois tipos mudam de nome no site novo`.** `portos` → "Vinhos do Porto" e
   `whiskys` → "Whisky". Está aqui porque, a olhar para a ementa sem esta linha,
   parece um erro de importação. `espirituosas` → "Espirituosas" não aparece: é
   só a maiúscula.
5. **`Produtos: 140 por inserir`.** É o número da especificação, e é o que o
   `--esperar-produtos 140` já conferiu antes de o relatório chegar aqui.
6. **`Textos descodificados:`** e a lista do antes e do depois. São nomes da
   carta do dono reescritos por um script — `J&amp;B` tanto podia dar `J&B` como
   ficar na mesma —, e a lista é o único sítio onde isso se confirma. Lê-a toda.
7. **`Eventos: N por inserir`.** Entram **todos** os eventos do site antigo,
   incluindo os que já passaram — o site novo é que não os mostra
   (`GET /eventos` corta a partir de hoje). Um evento sem data entra sempre como
   rascunho, mesmo que o site antigo o tivesse visível.
8. **`Imagens: K por copiar`.** K é quantas serão copiadas, e o caminho é o
   `MEDIA_DIR`. Na primeira corrida, "0 já lá estavam".
9. **A última linha não vazia é a conclusão, e a primeira palavra dela arruma o
   resultado** — "Simulei", "Importação", "Já", "Recusei" ou "Rebentei", e a
   tabela delas está no fim do passo 4. Aqui, com `estado: 0`, começa por
   "Simulei e não escrevi nada". Nunca aceites um `estado` diferente de zero
   como "correu bem": aí a conclusão começa por **"Recusei importar:"** (ou por
   "Rebentei a meio,"), e o passo 7.2 explica o que fazer com cada caso.

### O que é normal aparecer e não é problema

- **Linhas de nota sobre eventos**, do género `Evento 7: a coluna visivel da
  origem está a NULL; entra por publicar, e é na gestão que se publica.` É
  informação, não recusa: a coluna tem `DEFAULT 1` na origem, por isso um `NULL`
  lá dentro foi escrito por alguém de propósito e o script não adivinha o que
  queria dizer. O evento entra por publicar, que é o lado que se desfaz na
  gestão com um clique.
- **A linha da junção e a dos nomes que mudam**, como acima.
- **Nada sobre os `--esperar-*`.** Quando os números batem, o relatório não lhes
  dedica uma linha: é o silêncio que confirma. Quando não batem, é a única coisa
  que ele diz, e sai com estado diferente de zero.
- **"0 já lá estavam"** em tudo, na primeira corrida. Na segunda é ao contrário,
  e também está certo (fim do passo 4).

Enquanto o relatório não te agradar, repete a simulação. Nada do que ela diz
fica escrito.

## 4. Aplicar

Antes de carregar: a cópia do passo 2.3 existe (`ls -l "$GUARDADO"`) e a
primeira linha da simulação bate certo com o `$DESTINO`. É o mesmo comando, com
mais uma palavra no fim:

```bash
RELATORIO="$HOME/importacao/importacao-$(date +%Y%m%d-%H%M%S).txt"

AMBIENTE=producao python "$IMPORTADOR" \
    --origem "$ANTIGA" \
    --imagens "$UPLOADS" \
    --esperar-produtos 140 \
    --esperar-categorias 11 \
    --aplicar > "$RELATORIO" 2>&1
echo "estado: $?"

cat "$RELATORIO"
```

O que muda no relatório (as linhas das categorias nomeadas, da junção, dos nomes
que mudam e dos textos descodificados saem iguais às da simulação — elas falam
da origem, não do que ficou escrito):

```text
Modo: a aplicar — o que faltar é escrito no destino.
Categorias: 11 novas, 0 já lá estavam.
Produtos: 140 novos, 0 já lá estavam.
Eventos: N novos, 0 já lá estavam.
Imagens: K copiadas para /home/UTILIZADOR/public_html/media, 0 já lá estavam.
Importação feita: entraram 11 categorias, 140 produtos e N eventos.
```

Tudo numa transação só: ou entrou tudo, ou não entrou nada. As imagens copiam-se
**antes** da consolidação, de propósito — pela ordem contrária, uma cópia
falhada deixava linhas a apontar para imagens que o site não serve. As
verificações de permissões são as mesmas da simulação e correm outra vez aqui,
antes de se escrever o que quer que seja: entre a simulação e o `--aplicar` pode
ter passado tempo, e as permissões de um ficheiro mudam.

### Correr outra vez, para ver a importação não fazer nada

Vale os dez segundos que demora. Repete o comando do passo 4, tal e qual, com o
`--aplicar`:

```text
Categorias: 0 novas, 11 já lá estavam.
Produtos: 0 novos, 140 já lá estavam.
Eventos: 0 novos, N já lá estavam.
Imagens: 0 copiadas para /home/UTILIZADOR/public_html/media, K já lá estavam.
Já lá estava tudo: o destino tem tudo o que a origem diz, e não houve nada a escrever.
```

**A primeira palavra da conclusão arruma o resultado**, e cada resultado começa
com a sua:

| Primeira palavra | Quer dizer | Estado |
| --- | --- | --- |
| **Simulei** | corri sem `--aplicar`; nada ficou escrito | 0 |
| **Importação** | escrevi o que faltava | 0 |
| **Já** | não havia nada a escrever; o destino já tinha tudo | 0 |
| **Recusei** | parei de propósito, e digo porquê nas linhas de cima | ≠ 0 |
| **Rebentei** | defeito do script, não recusa (passo 7.2 i) | ≠ 0 |

Se a segunda corrida disser "Importação feita", alguma coisa está errada —
guarda o relatório e não corras mais nada.

## 5. Confirmar

### 5.1 Os dois números, conferidos pela máquina

O "Feito quando" da F2-08 é *o Tomás confirma 140 produtos e 11 categorias*. Ler
esse número no relatório não é confirmá-lo: ler um número e concordar com ele é
o mesmo gesto. Por isso o número vai **antes**, na linha de comandos, e é a
máquina que o confere:

```text
--esperar-produtos 140 --esperar-categorias 11
```

Quatro coisas que vale a pena saber sobre estas duas bandeiras:

1. **Conferem a origem, não o destino.** Contam os produtos que a cópia traz e
   as categorias que ela pede — não as linhas que ficaram na base de dados. Por
   isso a resposta é **a mesma** na simulação, na corrida a sério e na segunda
   corrida, em que já não entra nada. É isso que as torna uma confirmação, e não
   um efeito da corrida.
2. **Correm antes de qualquer escrita.** Antes de o destino ser aberto para
   escrita e antes de uma única imagem ser copiada. Um número que não bate
   quer dizer, quase sempre, que a cópia não é a que pensas — e aí não se
   escreve nem uma linha nem um ficheiro.
3. **São opcionais e não têm omissão.** Sem elas o script corre à mesma, sem
   conferir nada. Vão nos comandos dos passos 3 e 4 porque é assim que se usa
   isto a sério.
4. **O silêncio é a confirmação.** Com os números certos o relatório não diz
   nada sobre elas e o estado é 0. Com um número errado, diz:

```text
Esperava 140 produtos e a origem dá 139. Ou a cópia que passaste não é a que pensas, ou o número que puseste em --esperar-produtos já não é o de hoje. Não escrevi nada.
Recusei importar: há 1 problema por resolver acima, e o destino ficou exatamente como estava.
```

O que fazer nesse caso está no passo 7.2 (h) — e não é mexer no script.

### 5.2 As onze categorias, nomeadas no próprio relatório

Não é preciso abrir a base de dados para as ver: o relatório dos passos 3 e 4
traz as três linhas que faltavam, e são elas que deixam confirmar o "Feito
quando" com o relatório à frente:

```text
Categorias, por esta ordem na ementa: Cafetaria, Comidas, Bebidas, Aguardentes, Vinhos do Porto, Licores, Martinis, Brandy, Whisky, Gin, Espirituosas.
Os tipos «Bebidas» e «bebidas» são o mesmo escrito de duas maneiras: os produtos dos dois ficam todos em «Bebidas».
Dois tipos mudam de nome no site novo: «portos» passa a «Vinhos do Porto» e «whiskys» passa a «Whisky».
```

Confere a primeira linha, nome a nome e pela ordem, contra a tabela que está em
5.4.

### 5.3 O que o relatório não diz, e se vê na base de dados

Quantos produtos ficaram em cada categoria, e que as outras quatro tabelas
ficaram como estavam:

```bash
python - "$DESTINO" <<'FIM'
import sqlite3, sys

bd = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
for tabela in ("categorias", "produtos", "eventos", "fotos", "clientes", "admins", "definicoes"):
    (quantas,) = bd.execute(f"SELECT count(*) FROM {tabela}").fetchone()
    print(f"{tabela:<12} {quantas}")
print()
for ordem, slug, nome, quantos in bd.execute(
    "SELECT c.ordem, c.slug, c.nome, count(p.id) "
    "FROM categorias c LEFT JOIN produtos p ON p.categoria_id = c.id "
    "GROUP BY c.id ORDER BY c.ordem"
):
    print(f"{ordem:>2}  {slug:<13} {nome:<16} {quantos} produtos")
bd.close()
FIM
```

À espera:

- `categorias 11`, `produtos 140`, `eventos N`;
- `fotos 0` — a galeria começa vazia, de propósito (passo 8);
- `clientes 0` e `definicoes 0` — não se importam;
- `admins 0`, a não ser que já tenhas criado um com o `criar_admin.py` da F2-02.

### 5.4 Os onze pares decididos

É a tabela que decidiste, e é contra ela que se confere a linha
`Categorias, por esta ordem na ementa:` do relatório e a saída da consulta
acima:

| Ordem | `slug` | Nome no site |
| --- | --- | --- |
| 1 | `cafetaria` | Cafetaria |
| 2 | `comidas` | Comidas |
| 3 | `bebidas` | Bebidas |
| 4 | `aguardentes` | Aguardentes |
| 5 | `portos` | Vinhos do Porto |
| 6 | `licores` | Licores |
| 7 | `martinis` | Martinis |
| 8 | `brandy` | Brandy |
| 9 | `whiskys` | Whisky |
| 10 | `gin` | Gin |
| 11 | `espirituosas` | Espirituosas |

O `slug` nasce do `tipo` antigo, não do nome novo — daí `portos` com o nome
"Vinhos do Porto" e `whiskys` com o nome "Whisky". É isso que faz as âncoras
`#ementa-<slug>` da ementa sobreviverem a uma mudança de nome na gestão.

A contagem de produtos por categoria é tua para olhar: a soma tem de dar 140, e
o cartão "Bebidas" tem de trazer os produtos dos dois `tipo` antigos juntos.

### 5.5 A olho, no site

Abre o site novo (`new.<domínio>`, o endereço da F1-05) na ementa e confirma:

- **onze cartões**, pela ordem da tabela acima, com um chip por cartão no topo;
- o cartão **Bebidas** com os produtos dos dois `tipo` antigos;
- os preços com o formato "6,50 €" — e, se algum produto estiver a 0, a linha a
  dizer **Oferta** em vez de "0,00 €";
- **o texto sem entidades HTML**: nas categorias de garrafa (whisky, gin,
  licores, portos, brandy) os nomes vêm com marca e trazem `&`, apóstrofos e
  algarismos. Têm de aparecer como se escrevem — nunca `&amp;`, `&#039;` nem
  `&quot;` à vista. É o sítio onde um defeito de descodificação se vê a olho;
- clicar num chip salta para o cartão certo.

A ementa tem `Cache-Control: max-age=60`: se acabaste de importar e ainda vês o
estado vazio, espera um minuto e atualiza antes de ires procurar um defeito.

## 6. A verificação que vem da F3-02: escrever "gin"

Esta é a que ninguém faz sozinho e por isso está escrita. **Com os 140 produtos
reais à frente**, escreve `gin` na pesquisa da ementa.

Pelo ADR 0013, a pesquisa condiz também com o **nome da categoria**, e aí mostra
o cartão **inteiro**. Com as categorias reais, `gin` vai encontrar três coisas
ao mesmo tempo:

- a categoria **Gin**, com o cartão todo, de alto a baixo;
- a **Ginjinha**, que está em Licores;
- o **Ginger ale**, que está em Bebidas.

(É o que a entrada F2-08 de `docs/TAREFAS.md` prevê. O ponto deste passo é
exatamente confirmá-lo no ecrã, com a carta toda à frente, e ver se é só isto ou
se vem mais coisa atrás.)

(A comparação é por subcadeia, sem acentos e sem maiúsculas — "g-i-n" dentro da
palavra chega.)

**Não é defeito.** A pessoa vê o g-i-n dentro de "Ginjinha" e explica o
resultado a olhar para o ecrã, que é a regra. Mas é exatamente o tipo de ruído
que o próprio ADR 0013 diz que justificaria reverter a decisão — e as fixturas
do frontend escondem-no por completo, porque não têm estes nomes.

Olha para o ecrã e decide uma de duas coisas:

- **fica como está** — e o ADR 0013 passa de "aceite com uma reserva" a fechado;
- **ou reverte** — são três linhas de código e uma de teste, está medido no
  próprio ADR, e dá uma tarefa pequena.

Repara também na contagem: ela conta **produtos**, não cartões, por isso uma
pesquisa que condiz com uma categoria de quatro produtos diz "4 produtos
encontrados". É coerente com o que se vê, e com `gin` o número vai ser maior do
que parece à primeira.

Enquanto isto não estiver visto com os dados reais, o assunto da pesquisa não
está fechado.

## 7. Se correr mal

### 7.1 Voltar atrás com a cópia

Só serve se a importação escreveu mesmo (passo 4). Se o script **recusou**,
não escreveu nada e não há nada para desfazer — vai direto ao 7.2.

O que se perde ao restaurar: tudo o que foi escrito na base de dados **depois**
da cópia do passo 2.3. Hoje isso é a importação e mais nada, porque os ecrãs de
gestão ainda não existem (Fase 4) e os endpoints públicos só leem. Se já houver
trabalho feito na gestão, **isto apaga-o** — e aí a decisão é outra: deixar a
importação ficar e corrigir linha a linha na gestão.

```bash
# 1. Faz o Passenger largar os processos antigos (e as ligações abertas).
touch "$HOME/tomazia_api/tmp/restart.txt"
curl -s -o /dev/null "https://novo.DOMINIO/api/health"

# 2. Repõe o ficheiro e tira os ficheiros laterais do WAL, que já não lhe
#    correspondem. A cópia do passo 2.3 é um ficheiro completo e consistente.
cp -f "$GUARDADO" "$DESTINO"
rm -f "$DESTINO-wal" "$DESTINO-shm"

# 3. Reinicia outra vez e confirma que a API está de pé.
touch "$HOME/tomazia_api/tmp/restart.txt"
curl -s "https://novo.DOMINIO/api/health"
```

(Substitui `novo.DOMINIO` pelo endereço do site novo. O `curl` só serve para
**chegar um pedido à app** depois do `touch` — o Passenger só arranca processos
novos no pedido seguinte, e é isso que faz os antigos largarem a base de dados.
Abrir o site no browser serve igualmente.)

Confirma a seguir com a consulta do passo 5.3: as contagens têm de ser as de
antes da importação.

**As imagens não se desfazem com isto.** Os ficheiros copiados ficam no
`MEDIA_DIR` e são inofensivos: nenhum evento aponta para eles depois do
restauro, e uma importação futura dirá "já lá estavam" (são byte a byte iguais,
e o script nunca sobrepõe). Deixa-os.

### 7.2 As famílias de recusa — e a última, que não é uma recusa

Em qualquer recusa o script escreve os problemas, termina com `Recusei importar:
há N problemas por resolver acima, e o destino ficou exatamente como estava.` e
sai com estado diferente de zero. **Nada foi escrito** — nem linhas, nem
ficheiros.

**a) Configuração.** "Não consegui ler a configuração... a variável AMBIENTE".
Correste sem `AMBIENTE=producao` **e** o ficheiro de ambiente do servidor não
foi encontrado. O script procura-o ao lado do pacote `app` da instalação de
onde foi chamado — ou seja, em `tomazia_api/`, e não na pasta onde estás —, por
isso o que interessa é chamá-lo pelo caminho completo
(`$HOME/tomazia_api/scripts/importar_bd_antiga.py`, que é o `$IMPORTADOR`) e
não por uma cópia noutro sítio. Repete o comando tal como está no passo 3.

**b) Destino.** "O destino ... não existe", "não tem a tabela alembic_version",
"está na versão «X» e esta instalação está na versão «Y»", "não tem versão
nenhuma lá dentro". A base de dados da aplicação cria-se e atualiza-se com
`alembic upgrade head`, nunca com este script — e o `deploy.sh` já o corre a
cada deploy. Se a mensagem apanhar um caminho que não esperavas, o problema é o
`BASE_DADOS_URL` do ficheiro de ambiente, não o script. Também aqui: "a
BASE_DADOS_URL não aponta para um ficheiro SQLite" quer dizer exatamente isso.

**c) Permissões.** Três mensagens, três sítios, e a **mesma** correção —
`chmod u+w`, nunca mexer no script. As três aparecem já na simulação, e todas
antes de se copiar ou escrever o que quer que seja:

- **O ficheiro do destino em só-leitura**: "O destino ... está em só-leitura:
  não consigo abri-lo para escrita. ... Acontece a uma cópia feita à mão que
  ficou com as permissões do original — dá ao ficheiro permissão de escrita
  (`chmod u+w`) e corre outra vez." É o caso que o passo 2.3 avisa.
- **A pasta do destino em só-leitura** — a menos óbvia das três: "A pasta ...,
  onde o destino está, não me deixa escrever. Não chega a base de dados aceitar
  escrita: em modo WAL o SQLite escreve os ficheiros `-wal` e `-shm` **ao lado**
  dela, e para isso precisa da pasta." Com o ficheiro escrevível e a pasta não,
  a importação rebentava à mesma, e a quem olhasse só para o `ls -l` da base de
  dados parecia não haver problema nenhum.
- **O `MEDIA_DIR` sem escrita**: "A pasta ... não me deixa escrever, e há N
  imagens de eventos para copiar para o MEDIA_DIR." Só se queixa quando há mesmo
  imagens por copiar — numa segunda corrida, com tudo já lá, um `MEDIA_DIR` em
  só-leitura não impede nada e não recusa. A alternativa ao `chmod`, se a pasta
  não for tua para mexer, é `--imagens ignorar` e pôr os cartazes depois na
  gestão.

Duas vizinhas desta família, que **não** são permissões e por isso têm frases
próprias: "Não consegui abrir o destino ... para escrita: ... Não é uma recusa
por permissões do ficheiro — é o sistema a dizer outra coisa" (um sistema de
ficheiros montado em só-leitura, por exemplo), e "o MEDIA_DIR aponta para X, e Y
existe mas não é uma pasta", que se corrige no ficheiro de ambiente.

As permissões verificam-se **antes** do esquema (família b), e isso é de
propósito: com os dois errados ao mesmo tempo, a correção do esquema é
`alembic upgrade head`, que também precisa de escrita e falharia na mesma, com
um erro do alembic a dizer outra coisa qualquer. O `chmod` é o que destranca o
resto.

**d) Origem.** "A origem ... não existe", "não consegui abrir", "não tem as
tabelas eventos e produtos" ou "A tabela produtos da origem não tem uma única
linha". É quase sempre a cópia errada. Repete o passo 2.2 e confere os 140 e os
12 tipos antes de voltar ao passo 3. ("Importei zero" e "abri a cópia errada"
nunca dão o mesmo relatório, e é por isso que uma origem vazia recusa em vez de
dar verde.)

**e) Linhas que não convertem.** O script converte **todas** as linhas e
lista-as de uma vez — não pára na primeira —, cada uma com o id da linha e,
quando é legível, o valor. As famílias:

- **Preço**: em branco, a `NULL`, que não é número ("Se o produto é mesmo de
  oferta, o preço na origem é 0."), com três casas decimais, negativo, guardado
  como binário, ou **grande de mais** para caber no inteiro onde o destino
  guarda os cêntimos — este último é quase sempre uma gralha, e a mensagem
  diz-o.
- **Nome de produto**: a `NULL`, em branco, ou acima de 120 caracteres ("um
  nome assim também não cabia na linha de um cartão da ementa").
- **Título de evento**: a `NULL`, em branco, ou acima de 120 caracteres.
- **`tipo`**: a `NULL`, em branco, ou fora dos doze da carta antiga — e nesse
  caso a mensagem enumera os doze, para se ver se é gralha ou categoria nova.
- **Texto escapado duas vezes**: sobra uma entidade depois de desfazer uma
  camada. A mensagem mostra as três formas — o que está na origem, o que ficou
  depois de uma passagem, e como "pelos vistos devia ler-se". O script **não**
  desfaz a segunda camada: isso transformaria também num `&` qualquer `&amp;`
  que o dono tenha escrito de propósito.
- **Data de evento ilegível**: não bate com `AAAA-MM-DD`. Se ainda não há data
  marcada, deixa a coluna vazia na origem e o evento entra por publicar.
- **Data de evento com hora** (`2026-07-01 21:00`): é uma família **à parte** da
  anterior, e com razão — o dia está ali, legível, e dizer "não está em
  AAAA-MM-DD" seria falso. Todos os outros eventos entram à meia-noite do dia em
  Lisboa: ficar com a meia-noite deitava fora as horas que alguém escreveu, e
  ficar com as horas dava a este evento um começo que nenhum outro tem.
  Escolher por ti era decidir a que horas abre a noite. Tira a hora na origem.
- **Nome de imagem**: com `..`, acima de 64 caracteres, começado por ponto, com
  uma extensão fora de `.jpg`, `.jpeg`, `.png`, `.gif` e `.webp`, com **mais do
  que uma** extensão, ou **sem nenhuma**. As quatro últimas são guardas de
  segurança, não de arrumação — ver o fim do passo 2.4.

  A das **duas extensões** é a única em que o ficheiro parece inofensivo a olho:
  um `cartaz.2026.jpg` na pasta de uploads é recusado, e a correção é renomeá-lo
  para uma extensão só. Não é defeito do script e não se pede exceção — o Apache
  olha para as extensões todas, e é por isso que um `shell.php.jpg` seria corrido
  como PHP apesar de acabar em `.jpg`.

**Corrige-se na cópia** (`$ANTIGA`), não no original e não no script — e, se a
correção também valer para o site antigo enquanto ele estiver de pé, faz-se lá e
tira-se uma cópia nova. Depois repete o passo 3. Nenhuma destas se resolve a
adivinhar: um preço arredondado em silêncio é decidir o preço pelo dono, e um
`tipo` novo não tem nome nem ordem decididos por ninguém.

**f) Imagens.** O script **pára no primeiro problema** de imagens, e não junta a
lista como nos produtos: aqui o que vem a seguir são ficheiros copiados, e
metade dos cartazes no sítio é pior do que nenhum. Quatro mensagens:

- "a imagem «X» não está em ...": o ficheiro não está na pasta que passaste no
  `--imagens`. O script procura só **pelo nome do ficheiro**, sem subpastas, por
  isso um caminho antigo do género `img/uploads/2024/x.jpg` não é encontrado
  dentro de `uploads/`. Nesse caso monta uma pasta de reunião, passa-a ao
  `--imagens`, e vai-a enchendo à medida que as mensagens nomeiam ficheiros:

  ```bash
  mkdir -p "$HOME/importacao/imagens"
  find "$UPLOADS" -maxdepth 1 -type f -exec cp {} "$HOME/importacao/imagens/" \;
  cp "$UPLOADS/2024/x.jpg" "$HOME/importacao/imagens/"   # o que a mensagem nomeou
  ```

  Como o script pára no primeiro que falta, é um ciclo: copiar, simular, ler o
  nome seguinte. Chato, mas cada volta nomeia exatamente um ficheiro e nunca
  ficas na dúvida sobre qual é qual. **Não aches a pasta toda de uma vez** com
  um `find -exec cp` recursivo: dois ficheiros com o mesmo nome em subpastas
  diferentes ficariam reduzidos a um, em silêncio, e o evento podia acabar com o
  cartaz do outro. Se o ficheiro estiver mesmo perdido, ver o `--imagens
  ignorar` abaixo.
- "já existe um ficheiro «X» em ... com outro conteúdo": há no `MEDIA_DIR` um
  ficheiro com o mesmo nome e conteúdo diferente. O script **nunca sobrepõe** —
  um ficheiro sobreposto não se recupera como uma linha de base de dados.
  Decide tu qual fica, à mão, e corre outra vez.
- "é uma ligação simbólica para ...": ou na pasta das imagens, ou já dentro do
  `MEDIA_DIR`. O script não segue ligações em lado nenhum: uma ligação na pasta
  de origem punha no `MEDIA_DIR` — que é servido pela web — os bytes do que
  estiver do outro lado; e uma ligação já no `MEDIA_DIR` fazia a cópia escrever
  **para fora dele**, no sítio para onde ela aponta. Põe lá o ficheiro de imagem
  mesmo, ou tira a ligação à mão, e corre outra vez.
- "dois eventos referem ficheiros diferentes que dão o mesmo nome": dois
  caminhos antigos distintos reduzidos ao mesmo nome de ficheiro. Renomeia um
  deles na pasta que passas ao `--imagens` e corrige o `imagem_url` desse evento
  na cópia da origem.

**A porta de saída, quando uma imagem não aparece:** correr com `--imagens
ignorar` em vez da pasta. Os eventos entram todos, sem imagem (`imagem` a
`NULL`), e o relatório **lista** quais ficaram de fora, com o id e o título. Não
é perda definitiva: a imagem põe-se depois na gestão. Mas é uma decisão, não um
acidente — e é por isso que o `--imagens` não tem valor por omissão.

**g) Divergências.** "no destino o nome é «X» e a origem diz «Y». Não toquei em
nada (ADR 0014: só se insere); quem decide qual dos dois vale é uma pessoa." O
destino já tem aquela linha com conteúdo diferente. O script não escolhe por ti
e não escreve **nada** — nem as linhas que não divergem. Ou corriges na gestão
do site novo, ou na cópia da origem, consoante qual dos dois tem razão. É o
preço, conhecido e escrito, de proteger o trabalho do dono. Nos preços a
mensagem traz os euros e os cêntimos lado a lado (`9,99 € (999 cêntimos)`): os
euros para se ler, os cêntimos porque é esse o número que resolve a divergência
na gestão.

**h) Os `--esperar-*` que não batem.** "Esperava 140 produtos e a origem dá 139."
A correção **não** é mexer no script nem tirar a bandeira: é descobrir qual dos
dois números está certo. Ou a cópia não é a que pensas — refaz o passo 2.2 —, ou
a carta mudou desde que os 140 foram contados, e aí o número novo tem de ser
confirmado por ti antes de entrar no comando. A recusa acontece antes de
qualquer escrita, por isso não há nada para desfazer.

**i) "Rebentei a meio".** Um defeito do script, e **não** uma recusa. São três
coisas no relatório, por esta ordem:

```text
O erro foi: OperationalError: (sqlite3.OperationalError) attempt to write a readonly database
[SQL: INSERT INTO categorias (nome, slug, ordem, visivel) VALUES (?, ?, ?, ?) RETURNING id]
...
Rebentei a meio, com um OperationalError — o detalhe está acima e o traceback vai a seguir, em stderr. Isto não é uma recusa: uma recusa corrige-se na origem ou nas permissões, e isto abre uma tarefa. A base de dados não leva nada que não tenha passado por um commit. Guarda o relatório inteiro.
```

O detalhe do erro vai **antes** e em linha própria, e a conclusão é de **uma**
linha, de propósito: a mensagem de um erro do SQLAlchemy traz o SQL e os
parâmetros em várias linhas, e metida dentro da conclusão fazia da última linha
do relatório um pedaço de um URL — partindo exatamente a regra que o passo 4 te
ensina a usar, a de ler a última linha não vazia como conclusão. A seguir a isto
vem o `traceback` em `stderr`, e o `2>&1` do comando já o pôs dentro do
`$RELATORIO`.

A distinção recusa/defeito decide o que fazes: uma recusa corrige-se na origem
ou com um `chmod`, isto abre uma tarefa. Guarda o `$RELATORIO` inteiro e
confirma o estado da base de dados com a consulta do passo 5.3 antes de voltares
a correr seja o que for. (O exemplo acima é real, e é de um destino em
só-leitura — hoje já não rebenta assim: é a recusa (c), com a frase do `chmod`.)

## 8. O que fica por fazer depois

A importação não deixa o site completo. Três coisas ficam à espera, e são
esperadas:

- **A galeria começa vazia.** As `fotos` do site antigo não se importam: o
  esquema novo exige um ficheiro `uuid.webp` único e existente no `media/` e um
  `ip_hash` que a base de dados antiga não tem de onde tirar. Recodificar as
  imagens é o serviço da **F2-06**, não desta tarefa. Até lá, `GET /galeria`
  responde com uma lista vazia e o ecrã mostra o estado vazio.
- **As definições ficam por preencher.** WiFi, horário, morada, telefone,
  Instagram e Maps não vêm do site antigo — preenchem-se na área de gestão, que
  chega com a **F2-05** (endpoints) e os ecrãs da Fase 4. Até lá, o `GET /info`
  responde sem esses valores e a folha do WiFi não tem o que mostrar.
- **O `placeholder` da pesquisa muda.** Está escrito como entrega na secção 14
  da `docs/ecras/F3-02.md`: **confirmados os 140 produtos importados**, o
  `placeholder` passa de "Nome do produto" para **"Café, galão…"** — e não
  "Imperial, galão…". A razão é a lista de categorias que acabaste de confirmar:
  `cafetaria` está lá, e não há cafetaria portuguesa sem café e sem galão; já a
  cerveja cai em "bebidas", onde o produto tanto se pode chamar "Imperial" como
  "Cerveja" ou pelo nome da marca. Depende de confirmares os produtos no passo
  5, e é por isso que está aqui no fim e não antes.

E, do passo 6, fica a decisão sobre o ADR 0013: ou fechado, ou uma tarefa de
reversão de três linhas.

### Arrumar o que ficou em `$HOME/importacao`

Com a importação confirmada (passos 5 e 6), **apaga a cópia da base de dados do
site antigo**: tem emails, telemóveis e passwords antigas lá dentro e já não
serve para nada.

```bash
shred -u "$ANTIGA" 2>/dev/null || rm -f "$ANTIGA"
ls -l "$HOME/importacao"
```

Os relatórios podem ficar — são texto, nomeiam produtos e eventos, e são o
registo do que entrou e quando. A cópia do destino (`$GUARDADO`) guarda-se uns
dias, até teres a certeza de que não precisas de voltar atrás, e deixa de fazer
sentido assim que a **F2-02** trouxer o `scripts/backup.py` e os backups
passarem a ser automáticos.
