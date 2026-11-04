# 0015. "Próximos eventos" em vez de "Esta semana", e sem janela de dias

- Data: 2026-11-02
- Estado: aceite

## Contexto

A `docs/ESPECIFICACAO.md` escrevia, na lista dos ecrãs públicos:

> Esta semana: até três eventos, data grande em Playfair; a secção some sem
> eventos.

O backend já estava feito quando a F3-04 chegou, e faz outra coisa: o
`GET /eventos` devolve **todos** os eventos publicados com início a partir da
meia-noite de hoje em Lisboa (ADR 0010), ordenados por data, **sem limite** — e
isso está escrito no serviço de propósito, porque a F4-03 conta com a lista
inteira para o "Arquivo".

Logo, a 2 de novembro, um bar com um único evento marcado para 25 de novembro
mostrava-o debaixo de um título que dizia "Esta semana". O título estava a
afirmar uma coisa que o conteúdo desmentia.

## Decisão

**O título passa a "Próximos eventos".** O frontend corta nos três primeiros;
o título deixa de prometer uma janela de tempo que o conteúdo não cumpre.

**Não se filtra por sete dias**, que era a outra saída. A razão é de negócio e
não de código: as festas de calendário anunciam-se com semanas de antecedência,
e uma Passagem de Ano publicada a 10 de dezembro ficaria **invisível até 25 de
dezembro** — a secção estaria escondida precisamente no mês em que o bar mais
tem para dizer. E o dono paga por uma área de gestão para publicar eventos: um
filtro que esconde o que ele publicou é um defeito do ponto de vista dele, por
mais defensável que seja no código.

**A data relativa faz o trabalho que o título fazia.** Cada cartão diz "hoje",
"amanhã", "quinta-feira" ou "25 de novembro", e quem lê percebe sozinho se é já
ou se é longe. O título não tem de o dizer, e por isso não tem de mentir.

**Rejeitou-se o título dinâmico** — "Esta semana" quando os três eventos cabem
em sete dias, "Próximos eventos" quando não cabem. Quem lê não ganha nada, e
passam a existir dois ecrãs para testar, um dos quais quase nunca se vê.

## Consequências

- A linha 129 da `docs/ESPECIFICACAO.md` foi corrigida no mesmo PR. A
  especificação é a fonte de verdade do projeto; deixá-la a dizer "Esta semana"
  enquanto o site diz outra coisa é a armadilha que o ADR 0013 já tinha evitado
  uma vez.
- **O backend não muda.** Continua sem limite e com o corte à meia-noite de
  Lisboa. O três é do ecrã, e é no ecrã que se altera se um dia forem quatro.
- A secção continua a **desaparecer** quando não há eventos nenhuns — isso não
  mudou e é critério da tarefa. "Não há eventos" e "não consegui perguntar" é
  que não podem dar o mesmo ecrã.
- Fica por resolver no desenho, e está registado na F3-04: **há repetição**. O
  bar tem uma noite de samba às quintas, com cadência que o próprio Tomás não
  dá por certa, e três cartões podem ser o mesmo evento em três datas. Não se
  desduplica por título — é frágil, e faria o dono perguntar porque é que o
  evento dele desapareceu.

## Alternativas consideradas

- **Filtrar por sete dias e manter "Esta semana".** Honesto no título e cego no
  conteúdo: a secção desaparece sempre que o próximo evento estiver a mais de
  uma semana, que num bar com eventos quinzenais ou mensais é a maior parte do
  tempo.
- **Limitar no backend em vez do frontend.** Poupava três linhas e tirava à
  F4-03 a lista de que ela precisa. O serviço já dizia isto por escrito antes
  de esta tarefa existir.
- **"O que vem aí"**, mais caseiro. Igualmente honesto; "Próximos eventos" foi
  a escolha do Tomás.
