# 0017. O `X-Forwarded-For` só se lê de um proxy declarado, e "não há IP" não é um valor

- Data: 2026-11-05
- Estado: proposta

## Contexto

A F2-06 traz o primeiro limite por IP do projeto: **5 envios de foto por
hora por IP** (`docs/ESPECIFICACAO.md`, tabela de endpoints). Para o
cumprir é preciso responder a uma pergunta que o projeto nunca teve de
responder: **qual é o IP do cliente?**

Em produção a app corre no Passenger do cPanel, através do `a2wsgi`. Duas
coisas medidas, não lembradas:

**O `scope["client"]` pode não existir.** O `a2wsgi` só o preenche quando o
`environ` do WSGI traz `REMOTE_ADDR` **e** `REMOTE_PORT`
(`a2wsgi/asgi.py:109-111`). Faltando um deles, o Starlette devolve `None`
em `request.client` — e `request.client.host` levanta `AttributeError`,
ou seja **500 numa rota pública**.

E nenhum teste apanharia isso, porque o `TestClient` põe sempre
`client=("testclient", 50000)`. É a regra 10 do `CLAUDE.md` na sua forma
mais pura: *"não sei qual é o IP"* e *"o IP é este"* a dar o mesmo
resultado.

**O `X-Forwarded-For` é um cabeçalho que qualquer cliente escreve.** Lê-lo
sem mais não é um detalhe de implementação: é o limite a deixar de
existir. Basta um valor diferente por pedido para ter quota infinita, e o
critério fica a verde a proteger coisa nenhuma.

Mas o contrário também tem custo, e é um custo para o bar: se o
alojamento estiver atrás de um proxy e nós lermos o IP do par TCP, **todos
os visitantes partilham o mesmo balde**. O sexto visitante da noite é
recusado por causa dos cinco anteriores.

Não dá para medir qual dos dois é o caso daqui: os agentes não contactam
o servidor (ADR 0002) e a F1-05 ainda não foi feita.

## Decisão

1. **O IP do cliente é o do par TCP**, lido de `request.client`, e a
   função que o lê devolve `str | None`. **"Não há IP" é um resultado
   próprio**, nunca um `AttributeError` e nunca um valor inventado.
2. **O `X-Forwarded-For` nunca é lido por omissão.** Só se lê quando o IP
   observado do par TCP está na lista `PROXIES_DE_CONFIANCA`, um campo de
   configuração novo, **vazio por omissão**.
3. Quando se lê, toma-se a entrada **mais à direita que não seja um proxy
   de confiança** — as da esquerda são as que o cliente pode escrever.
4. **Vazio por omissão = nunca confiar = seguro por omissão.** Em produção
   fecha-se com uma linha no `.env` do servidor: sem deploy, sem código.

## Como se mede, depois da F1-05

O Passenger e o `%h` do log de acessos do Apache leem o mesmo campo do
pedido. O Tomás abre o site do telemóvel em dados móveis e compara a
última linha de `~/access-logs/<domínio>` com o IP que um serviço externo
lhe diz:

- **Batem certo** → não há proxy à frente, não há nada a fazer.
- **O log diz `127.0.0.1` ou um endereço interno** → há proxy, e o
  endereço que ele mostra é exatamente o que vai para
  `PROXIES_DE_CONFIANCA`.

Fica como item explícito da F1-05.

## Consequências

**Enquanto não estiver medido, o comportamento é o conservador.** Se o
alojamento estiver atrás de proxy e ninguém tiver preenchido a lista,
são cinco fotos por hora **para o bar inteiro**. É um defeito visível e
chato, não uma falha silenciosa — e a correção é uma linha de
configuração, não uma suposição no código. Preferimos isto ao contrário:
um limite que parece funcionar e que qualquer pessoa contorna com um
cabeçalho.

**Um teste prende os dois sentidos:** dois pedidos do mesmo par TCP com
`X-Forwarded-For` diferentes partilham o mesmo balde; e com
`PROXIES_DE_CONFIANCA` a apontar para o IP do cliente de teste, o
cabeçalho passa a valer.

**O IP nunca é guardado em claro.** A coluna `fotos.ip_hash` recebe um
`hmac-sha256` com chave derivada do `segredo_sessao` e etiqueta própria
(`b"ip.v1"`), no mesmo padrão do `ETIQUETA_DO_SEGREDO` de
`services/auth.py`. Um `sha256` sem chave não serviria: o espaço IPv4
inteiro são 2³² hashes, percorríveis em minutos — seria o IP em claro com
passos a mais. Consequência a saber: **mudar o `SEGREDO_SESSAO` zera
todos os baldes.**

**Esta decisão vai ser revisitada na F1-05**, com dados reais do servidor.
É por isso que fica em "proposta" e não em "aceite".
