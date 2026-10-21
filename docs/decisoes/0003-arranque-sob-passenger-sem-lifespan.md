# 0003. Arranque sob o Passenger sem `lifespan`

- Data: 2026-10-20
- Estado: aceite

## Contexto

O ADR 0001 fixou FastAPI servido pelo Passenger através do a2wsgi. O FastAPI oferece o protocolo `lifespan` como o sítio normal para o trabalho de arranque: abrir ligações, aplicar PRAGMAs ao SQLite, criar pastas, validar configuração.

Ao preparar a F1-02 confirmou-se que **o a2wsgi não emite eventos `lifespan`** na direção que usamos. Duas vias de confirmação, com a versão 1.10.10:

- O `ASGIMiddleware` de `a2wsgi/asgi.py`, que é o adaptador ASGI→WSGI, não contém uma única referência a `lifespan`. As referências existem só no `WSGIMiddleware`, que é a direção oposta e que não usamos.
- Uma app com `lifespan` instrumentado, servida pelo `ASGIMiddleware`, respondeu 200 a três pedidos com a bandeira de arranque sempre em `False`.

Isto importa porque a app recusa arrancar em produção com um segredo de sessão inseguro, e essa guarda tem de correr mesmo. Se vivesse num `lifespan`, seria código morto em produção — exatamente a falha que a revisão da F1-01 encontrou e que motivou pôr a validação no `criar_app()`.

## Decisão

O arranque do backend acontece no momento do import do módulo: o `criar_app()` é chamado ao nível de `app/main.py` e é lá que a configuração é validada. Nada do que o projeto precise no arranque vai para um `lifespan`.

O `passenger_wsgi.py` fixa a pasta de trabalho e a ordem dos imports antes de tocar em qualquer coisa de `app.*`, porque o `obter_definicoes()` tem `lru_cache`: um import prematuro de `app.config` fixaria para o processo inteiro um valor validado num ambiente incompleto, e a guarda nunca mais dispararia.

## Consequências

- A F2 não pode usar `lifespan` para o modo WAL, o `busy_timeout`, a criação de pastas nem o aquecimento de ligações. Isso acontece no import do módulo ou à primeira utilização.
- Um erro de configuração rebenta no import, em voz alta, e o Passenger recusa-se a servir — em vez de servir pedidos com uma chave fraca ou devolver 500 silenciosos.
- Um teste canário prende o comportamento do a2wsgi. Se uma versão futura passar a correr `lifespan`, esse teste falha — de propósito, para obrigar quem subir a dependência a reler esta decisão. É um teste que falha com boas notícias.
- A ordem das instruções no `passenger_wsgi.py` passa a ser matéria de segurança, e está prendida por um teste que percorre a árvore sintática do ficheiro.

## Alternativas consideradas

- **`lifespan` com um caminho alternativo**: não serve, porque o `lifespan` nunca corre. Não há nada a que recorrer.
- **Trocar o a2wsgi por um adaptador que corra `lifespan`**: não há nenhum conhecido no ecossistema WSGI que o cPanel suporta, e mudaria o ADR 0001.
- **Remover o `lru_cache` do `obter_definicoes()`**: não resolve o problema de a pasta de trabalho decidir onde está o ficheiro de ambiente, e faria a configuração ser relida a cada pedido.
