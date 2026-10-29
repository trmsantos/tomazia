# 0013. A pesquisa da ementa condiz com o nome da categoria, e devolve o cartão inteiro

- Data: 2026-10-28
- Estado: aceite

## Contexto

A `docs/ESPECIFICACAO.md`, na lista dos ecrãs públicos, escreve: «lupa que
filtra **produtos pelo nome**». A F3-02 implementou a pesquisa a condizer
também com o **nome da categoria**, e nesse caso a mostrar o cartão **inteiro**
em vez das linhas que condizem.

É um desvio, pequeno mas real, e por isso leva um ADR em vez de uma nota de
rodapé. A regra do `CLAUDE.md` é essa: se uma decisão da especificação mudou,
há um ADR novo.

O que o desvio resolve é concreto e vê-se com os dados reais. As categorias do
bar são onze e os produtos são cerca de 140. Escrever «cafes» com a regra
literal devolve os produtos que tenham «cafes» no nome — e o produto chama-se
«Café», não «Cafés». Ou seja: a pesquisa mais provável de um ecrã de ementa, o
nome de uma família de bebidas, devolvia menos do que a pessoa esperava, ou
nada.

## Decisão

**Condiz com o nome da categoria, além do nome do produto.** Quando quem condiz
é a categoria, o cartão aparece **inteiro**, com todos os seus produtos. Quem
escreve «cafes» quer os cafés todos, não os produtos com «cafes» no nome.

Confirmado pelo Tomás em 2026-10-28, com as duas formas postas lado a lado.

A descrição do produto continua **fora** da pesquisa, e isso não muda. Uma
tónica a aparecer numa pesquisa por «gin» porque a descrição diz «com gin» é um
resultado que a pessoa não consegue explicar a olhar para o ecrã. A regra, em
voz alta: **o que se pesquisa é o que se vê em letra grande.**

## Consequências

- A linha da `docs/ESPECIFICACAO.md` foi corrigida no mesmo PR, para
  "filtra por nome de produto ou de categoria (ADR 0013)". Deixá-la a dizer
  outra coisa era pior do que o desvio: o `CLAUDE.md` chama-lhe fonte de
  verdade, e uma fonte de verdade que contradiz o que o site faz é uma
  armadilha para quem vier a seguir. A regra exata — cartão inteiro quando
  condiz a categoria — continua a viver na secção 4.3 da `docs/ecras/F3-02.md`,
  que é a letra miúda.
- A contagem de resultados conta **produtos**, não cartões, e por isso uma
  pesquisa que condiz com uma categoria de quatro produtos diz «4 produtos
  encontrados». É coerente com o que se vê.
- **A reversão é barata e está medida**: são três linhas de código e uma de
  teste. Se com os 140 produtos importados isto se revelar ruidoso — uma
  categoria com nome genérico a aparecer em pesquisas onde ninguém a quer — a
  volta atrás não é um projeto.
- O índice de pesquisa guarda a forma normalizada do nome da categoria ao lado
  da dos produtos, e é construído **uma vez**, quando a ementa chega. O custo
  por tecla não muda: era já uma passagem pela lista em memória.

## Alternativas consideradas

- **Literal, só nomes de produto**, como a linha 127 da especificação. Recusada
  pela razão acima: falha a pesquisa mais provável do ecrã.
- **Condizer com a categoria mas filtrar à mesma as linhas.** Dava um cartão
  «Cafés» com zero linhas visíveis sempre que o nome da categoria condiz e
  nenhum produto condiz — um cartão vazio, que é pior do que não aparecer.
- **Pesquisar também a descrição.** Recusada em 4.3 e não reaberta aqui: o
  resultado deixa de se explicar a olhar para o ecrã.
- **Um endpoint de pesquisa no servidor.** Não há, e não vai haver: a ementa
  inteira já veio num pedido e filtrar no cliente é instantâneo, funciona com a
  rede em baixo e não gasta dados (F2-03).
