# 0010. O dia do bar é o dia de Lisboa

- Data: 2026-10-27
- Estado: aceite

## Contexto

A especificação diz, na tabela da API: `GET /eventos` — "Eventos publicados **a partir de hoje**". Não diz em que fuso horário é "hoje".

`eventos.inicio` é um instante em UTC (`DataHoraUTC`, F2-01). "Hoje" não é um instante: é um **dia civil**, e um dia civil só existe dentro de um fuso. A escolha não é cosmética, e o bar está do lado mau dela: fecha às 02:00.

Medido, com `zoneinfo` e SQLite 3.50.4:

```text
evento às 00:30 de 15/07/2026 em Lisboa   = 2026-07-14T23:30:00Z
corte "meia-noite de hoje em Lisboa"      = 2026-07-14T23:00:00Z   -> incluído
corte "meia-noite de hoje em UTC"         = 2026-07-15T00:00:00Z   -> EXCLUÍDO
```

Ou seja: com o corte em UTC, um evento que começa às 00:30 **desaparece do site à 01:00 da manhã** do próprio dia — enquanto está a acontecer — e já não volta. É o horário em que este bar vive.

`backend/CLAUDE.md` diz "Datas em UTC na BD; `Europe/Lisbon` só na apresentação". Lido à letra, um filtro não é apresentação, e o corte teria de ser em UTC. É essa leitura que este ADR corrige: a fronteira de um **dia civil** é uma noção de calendário local, mesmo quando serve de filtro.

## Decisão

"A partir de hoje", em `GET /eventos`, é **a partir da meia-noite do dia corrente em `Europe/Lisbon`**, convertida para UTC:

```text
corte = meia-noite(data local de agora em Europe/Lisbon) -> UTC
filtro = publicado = 1 AND inicio >= corte
ordem  = inicio ascendente, desempate por id
```

O corte vive numa função pura (`inicio_do_dia_do_bar(agora: datetime) -> datetime`), que recebe o instante em vez de ler o relógio, e que **recusa um `datetime` ingénuo** — pela mesma razão que `DataHoraUTC` o recusa: um instante sem fuso não diz a que dia pertence.

A regra "UTC na BD, Lisboa na apresentação" passa a ter uma exceção escrita: **fronteiras de dia civil são sempre em `Europe/Lisbon`**, venham elas servir um filtro ou um ecrã. Nenhum instante muda de fuso na base de dados.

`Europe/Lisbon` passa a ser um nome de que o backend depende em produção. O `zoneinfo` lê-o da base de dados do sistema (`/usr/share/zoneinfo`), que no cPanel partilhado não é nossa e não está garantida: em falta, `ZoneInfo("Europe/Lisbon")` levanta `ZoneInfoNotFoundError`. Por isso o `tzdata` entra como dependência do backend — é um pacote só de dados, puro Python, e torna o comportamento independente da máquina. Um teste canário confirma que o fuso resolve.

## Consequências

- Meia-noite em Lisboa nunca é ambígua nem inexistente: as mudanças de hora dão-se às 01:00 e às 02:00 locais. O corte é sempre um instante único, sem precisar de `fold`.
- Nos dois dias de mudança de hora de 2026 o corte é `2026-03-29T00:00:00Z` e `2026-10-24T23:00:00Z` — à meia-noite desses dias Lisboa ainda estava no fuso anterior. Uma implementação com "+1h no verão" acerta no primeiro e falha no segundo.
- No inverno o corte em Lisboa e o corte em UTC são **o mesmo valor**. Um teste escrito só com datas de janeiro fica verde contra uma implementação em UTC: os testes que discriminam são os de verão, e têm de existir.
- A F4-03 ("Arquivo" com os passados) e a F3-04 ("Esta semana") herdam a mesma fronteira. A F3-04 formata em `Europe/Lisbon`, como já estava previsto.
- Uma dependência nova (`tzdata`), com justificação no PR. O `requirements.txt` é regenerado com hashes.

## Alternativas consideradas

- **Corte à meia-noite UTC**: uma linha mais curta e nenhuma dependência nova. Apaga do site os eventos de madrugada à 01:00, metade do ano. É o defeito que este ADR existe para não deixar entrar.
- **Corte em `agora` (eventos a partir deste instante)**: defensável, mas não é o que a especificação diz, e esconde um evento às 22:00 para quem abre o site às 22:30 — exatamente quem está a caminho.
- **Guardar também a data local numa coluna**: duplica o instante, desalinha-se na primeira edição, e muda o modelo de dados.
- **Fixar o fuso numa definição em `definicoes`**: configurável que ninguém vai configurar; o bar é em Estarreja e muda de sítio menos vezes do que a base de dados muda de esquema.
