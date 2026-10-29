# 0014. A chave da importação é o id do site antigo, e a importação só insere

- Data: 2026-10-29
- Estado: proposta — fixa o espaço de identificadores da aplicação, por isso é o Tomás que a aceita no PR

## Contexto

A F2-08 lê uma cópia da base de dados do site PHP antigo e enche `categorias`,
`produtos` e `eventos`. A tarefa exige que seja **idempotente**: correr uma vez
ou vinte dá o mesmo resultado.

"Idempotente" não diz qual é a chave, e a chave é a decisão toda. Ela decide o
que acontece no único momento que interessa: o Tomás importa, o dono começa a
trabalhar na gestão, alguém mexe no site antigo, e a importação corre outra
vez.

Dois factos condicionam a escolha, e os dois foram medidos:

- **O esquema novo não tem onde guardar o id antigo.** Pela regra 7 do
  `CLAUDE.md`, as migrações Alembic só acrescentam, e acrescentar uma coluna a
  uma tabela SQLite com restrições é reconstruí-la — tarefa à parte, noutro
  deploy. Ou seja: ou se decide agora, ou não se decide.
- **Um `id` explícito entra sem problema.** Medido numa base de dados nova: o
  `INSERT` com `id` dado é aceite e o autoincremento seguinte continua em
  `max+1`.

## Decisão

**A chave é a identidade do site antigo, levada para a chave primária do site
novo.** `produtos.id` recebe o `produtos.id_produto` antigo; `eventos.id`
recebe o `eventos.id` antigo.

**As categorias não têm identidade na origem** — nascem do valor da coluna
`tipo` — e por isso a chave delas é o `slug` normalizado. É a normalização que
junta "Bebidas" e "bebidas", e não um caso especial para esse par: um caso
especial resolve um par e deixa o próximo por resolver.

**Só inserção.** Ausente, insere. Presente e igual ao que escreveríamos, não
toca e conta como "já lá estava". Presente e **diferente**, não toca, lista, e
o script sai com estado diferente de zero. Tudo numa transação: ou entra tudo,
ou não entra nada. Nunca atualiza, nunca apaga.

**As categorias criam-se a pedido**, só quando há um produto novo para lhes
pendurar. Sem isto, a segunda corrida depois de o dono renomear uma categoria
na gestão criava uma categoria vazia — que o `JOIN` interno da F2-03 esconde do
site, e que por isso fica invisível também para quem a tivesse de corrigir.

**Uma data de evento sem hora entra à meia-noite de Lisboa**, convertida para
UTC (ADR 0010), e escreve-se pelo ORM.

## Consequências

Três coisas passam a ser **impossíveis**, e é melhor estarem escritas do que
descobertas:

- **Propagar uma correção feita no site antigo.** Mudar um preço no PHP e
  voltar a correr não muda nada: a linha aparece na lista de divergências e
  fica à espera de uma pessoa. A partir da primeira importação, a fonte de
  verdade é o site novo. É a troca que protege o trabalho do dono na gestão —
  que é o que não se recupera.
- **Propagar uma eliminação.** Um produto apagado no site antigo fica no novo
  para sempre, e o importador nem o consegue ver: ele não distingue uma linha
  que importou de uma que o dono criou. Apaga-se na gestão.
- **Recriar no site antigo.** Apagar e voltar a criar o mesmo produto lá dá-lhe
  um `id_produto` novo, e cá entra como segunda linha — duplicado **visível** na
  ementa, não um erro silencioso.

E uma que não é impossibilidade mas é consequência: renomear uma categoria na
gestão e importar produtos novos a seguir traz a categoria antiga de volta,
porque o slug é a chave. Os produtos já importados não se mexem; só um produto
novo do site antigo a faz renascer. Isso é uma divergência real, e o relatório
nomeia-a.

**A garantia que o teste prende:** a segunda corrida seguida escreve zero
linhas, e um despejo do destino sai byte a byte igual ao da primeira.

## Alternativas consideradas

- **Chave `(nome, categoria)`.** Perde duplicados legítimos — dois produtos com
  o mesmo nome na mesma categoria existem numa carta real — e duplica tudo no
  dia em que o dono renomeia uma categoria na gestão.
- **Uma coluna `id_legado`.** Seria mais limpa e é o que se faria num projeto
  novo. Aqui muda o modelo de dados e, pela regra 7, obriga a reconstruir a
  tabela num deploy posterior. Não vale a reconstrução.
- **`INSERT OR REPLACE`.** Propaga correções do site antigo — e esmaga, em
  silêncio, o trabalho que o dono já tenha feito na gestão. É a alternativa que
  parece mais útil e é a única que destrói dados.
- **Apagar o destino e importar de novo a cada corrida.** Idempotente por
  construção, e inútil: a partir do segundo dia a gestão tem trabalho dentro.
