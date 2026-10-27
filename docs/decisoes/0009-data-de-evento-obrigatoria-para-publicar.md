# 0009. Data de evento obrigatória para publicar, opcional em rascunho

- Data: 2026-10-27
- Estado: aceite

## Contexto

A especificação dizia duas coisas incompatíveis sobre o mesmo campo, a poucas linhas de distância em `docs/ESPECIFICACAO.md`, secção "Modelo de dados":

- na tabela: `eventos | ... inicio (datetime UTC, obrigatório) ...`;
- no parágrafo da migração da BD antiga, logo a seguir: "eventos sem data entram como rascunho".

O caso é real, não hipotético. `docs/legado/esquema-bd-antiga.sql` declara `data_evento DATE NOT NULL` e traz a nota "eventos.data_evento pode estar como texto vazio ('')": o site PHP contornava o `NOT NULL` com a string vazia, e há eventos assim à espera de serem importados na F2-08.

Lido como `NOT NULL`, o campo não deixa a F2-08 cumprir a linha da importação. Restariam duas saídas, ambas más: inventar uma data — inventar factos sobre o bar, que o `CLAUDE.md` proíbe — ou deitar fora eventos que a especificação manda guardar.

A escolha também não se adia para quando houver mais informação. Em SQLite, trocar `NOT NULL` por anulável obriga a reconstruir a tabela (o procedimento de 12 passos, o `batch_alter_table` do Alembic), contra a regra 7 do `CLAUDE.md`: as migrações só acrescentam. O mesmo vale para o sentido contrário, e para acrescentar um `CHECK` a uma tabela que já existe. O que ficar de fora da migração inicial da F2-01 fica caro.

O dono confirmou o caso de uso de frente: precisa de guardar um evento antes de saber a data.

## Decisão

`eventos.inicio` é anulável, com uma restrição que liga a data à publicação:

```sql
CHECK (publicado = 0 OR inicio IS NOT NULL)   -- ck_eventos_publicado_exige_inicio
```

Lê-se: **um rascunho pode não ter data; publicar exige data.** "Obrigatório", na linha da tabela do modelo de dados, quer dizer "obrigatório para publicar", não "obrigatório para existir".

A obrigatoriedade na criação pela área de gestão ("Criar (data obrigatória)", em "Área de gestão") mantém-se, e passa a viver no esquema Pydantic da F2-05, não no DDL.

## Consequências

- A F2-08 tem onde pôr os eventos sem data do site antigo: entram como rascunhos, e o dono decide um a um na gestão.
- O critério da F2-01 "evento sem data rejeitado" passa a ter duas metades, e por isso dois sítios onde se prova. A base de dados recusa **publicar** sem data; a fronteira recusa **criar** sem data, na F2-05. O critério em `docs/TAREFAS.md` foi corrigido em conformidade.
- A base de dados recusa pelos **dois** caminhos, `INSERT` e `UPDATE` — medido com SQLite 3.50.4:

  ```text
  INSERT (publicado=1, inicio=NULL)                  -> CHECK constraint failed: ck_..._publicado_exige_inicio
  UPDATE SET publicado=1 num rascunho sem data       -> CHECK constraint failed: ck_..._publicado_exige_inicio
  ```

  Quem se esquece do `UPDATE` é o **teste**, não o SQLite. E é o `UPDATE` que importa: publicar um rascunho que já existe é o que o botão "Publicar" faz todos os dias. Um teste que só exercite o `INSERT` deixa por provar o caminho real, e deixa passar uma implementação futura que mova a validação para o modelo e só a corra na criação.

- **`eventos.publicado` tem de ser `NOT NULL`**, e isso é correção, não arrumação. Em SQLite um `CHECK` só falha quando a expressão dá **falso**; com um operando NULL dá NULL, e NULL não é falso — passa. Medido:

  ```text
  publicado ANULÁVEL,  (publicado=NULL, inicio=NULL)  -> ACEITE          <- a restrição nasce com um buraco
  publicado NOT NULL,  (publicado=NULL, inicio=NULL)  -> NOT NULL constraint failed
  ```

- As restrições nascem com nomes determinísticos, dados pela `naming_convention` em `Base.metadata` desde a migração inicial. O SQLite devolve esse nome na mensagem de erro (`CHECK constraint failed: ck_eventos_publicado_exige_inicio`), o que permite à F2-05 mapear a restrição violada para uma mensagem em PT-PT junto do campo certo, em vez de devolver um 500 genérico ou de tentar interpretar texto de erro.
- Qualquer leitura de eventos publicados pode tratar `inicio` como garantido. Qualquer leitura que inclua rascunhos — a lista da gestão, na F4-03 — tem de tratar o `None`, incluindo na ordenação da lista.
- A linha da especificação foi corrigida no mesmo commit deste ADR. Quem a vier reler não deve "corrigir" o `obrigatório` de volta: a contradição era entre a tabela do modelo de dados e o parágrafo da importação, e resolveu-se a favor do parágrafo.

## Alternativas consideradas

- **`inicio NOT NULL`, com a importação a inventar uma data** (a da importação, ou a que o site antigo tivesse quando tivesse): guarda os eventos, mas põe no site uma data que ninguém escolheu. Um evento publicado com data errada é pior do que um rascunho sem data.
- **`inicio NOT NULL`, com a importação a deitar fora os eventos sem data**: contraria a linha da especificação e perde conteúdo que o dono pode querer recuperar.
- **Sem `CHECK`, com a regra só na fronteira**: deixava a base de dados aceitar um evento publicado sem data vindo de um script — e o `scripts/importar_bd_antiga.py` escreve diretamente, sem passar pela API. Um `CHECK` não se acrescenta depois sem reconstruir a tabela, por isso não é uma decisão que se possa adiar e corrigir.
- **Uma coluna `estado` (rascunho, publicado, arquivado) em vez do booleano `publicado`**: mais expressiva, e tornava a restrição desnecessária para o caso "arquivado". Mas muda a tabela da especificação e não serve nada que a v1 faça: o "Arquivo" da área de gestão é uma consulta por data passada, não um estado guardado.
