# 0006. `GET /health` passa a dizer quando o processo arrancou

- Data: 2026-10-23
- Estado: aceite

## Contexto

O `docs/ESPECIFICACAO.md` fixava `GET /api/health` a devolver `{"estado", "versao"}`, e o deploy esperava até a versão ser a do commit.

Isso não chega para decidir que um deploy correu bem. No Passenger, escrever o ficheiro `VERSION` e reiniciar o processo são dois acontecimentos distintos: o `deploy.sh` copia o `VERSION` e só depois toca em `tmp/restart.txt`. Entre os dois, e sempre que o reinício falha, há uma janela em que **o processo antigo serve o `VERSION` novo** — ele lê o ficheiro, não a sua própria idade. O verificador dava verde a um deploy que não tinha reiniciado nada, e o bug que motivou o deploy continuava vivo em produção com a pipeline verde.

É o mesmo erro de fundo que a regra 10 descreve, noutra forma: "li a versão certa" e "o código novo está a correr" não são a mesma coisa, e estavam a dar o mesmo resultado.

## Decisão

A resposta passa a ter três chaves: `{"estado", "versao", "arrancado_em"}`. O `arrancado_em` é um instante ISO 8601 em UTC, fixado **à importação do processo** — nunca por pedido.

O `esperar-versao.sh` exige as duas condições ao mesmo tempo: a versão tem de ser a do commit **e** o `arrancado_em` tem de ser posterior ao instante em que o deploy começou. Exige-as em duas leituras consecutivas, para não apanhar um processo a meio da substituição.

## Consequências

- `docs/ESPECIFICACAO.md` foi atualizado: é o contrato público do endpoint, não um detalhe interno.
- O `arrancado_em` é propriedade do processo, não do pedido. Um teste prende isso explicitamente — se alguém o passar a calcular por pedido, o endpoint continua a responder e o verificador de deploy fica verde para sempre, que é a pior forma possível de falhar.
- O verificador compara o relógio do cPanel com o do runner do GitHub. Com NTP nos dois não há problema. Se o relógio do servidor estiver atrasado mais do que a duração do deploy, o job falha com o deploy bem feito — a "última observação" que ele imprime diz exatamente isso, por isso é diagnosticável.
- O `/health` continua público e sem autenticação. Revela a versão em produção e o instante de arranque; é informação que um atacante consegue de outras formas, e o valor operacional compensa.

## Alternativas consideradas

- **Comparar a data de modificação do ficheiro `VERSION`**: é a idade do ficheiro, não a do processo. Mede exatamente a coisa errada.
- **Um identificador aleatório por processo, em vez de um instante**: distingue processos, mas não diz qual é o mais recente. Obrigava o verificador a guardar o valor anterior, e o valor anterior não existe no primeiro deploy.
- **Pedir ao Passenger o PID do processo**: não está exposto por nenhuma via fiável no alojamento partilhado, e mudaria a cada reinício do próprio Passenger, não a cada deploy.
