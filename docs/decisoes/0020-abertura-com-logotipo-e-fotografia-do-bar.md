# 0020. Abertura com o logótipo e uma fotografia do bar, sem vídeo

- Data: 2026-11-16
- Estado: aceite

## Contexto

A especificação não prevê abertura: a página pública começa no cabeçalho e na
ementa ("a ementa aparece sem um toque", F3-02), e a linha do movimento diz
"Sem vídeo de fundo". A análise de lacunas de 16 de novembro, que comparou o
site novo com o PHP antigo, mostrou que a impressão de "muito aquém" vem menos
do que se tirou de propósito e mais do que nunca se substituiu: nenhum
logótipo e nenhuma fotografia do bar.

O site antigo abria com um vídeo em ecrã inteiro
(`img/3772392-hd_1920_1080_25fps.mp4`), e contra ele há três factos:

1. **Pesa 4 947 500 bytes.** O Q-01 pede a maior imagem do ecrã inicial em
   menos de 2,5 s em 4G simulado; a ~1,6 Mbit/s do perfil do Lighthouse, o
   ficheiro leva ~24 s, quase dez vezes o orçamento, e disputa a ligação com o
   JavaScript (Q-02) e as duas fontes pré-carregadas.
2. **A CSP de produção bloqueia-o.** `deploy/htaccess.exemplo` serve
   `default-src 'none'` sem `media-src`; um `<video>` não carregava sem abrir a
   política.
3. **Não é o bar.** O nome segue o padrão de um vídeo de banco de imagens (um
   barman a servir um cocktail). Quem lê o QR à mesa está a olhar para o
   Tomazia verdadeiro.

## Decisão

**O ecrã inicial ganha uma abertura com o logótipo e uma fotografia real do
bar**, em WebP leve (na ordem dos 100 KB), com `width` e `height` reservados.
**O vídeo continua fora.** A fotografia é arranjada pelo Tomás; sem ela a
tarefa não começa.

## Consequências

- A especificação muda em dois sítios, no mesmo PR deste ADR: a lista dos
  ecrãs públicos ganha a abertura entre o cabeçalho e a ementa, e a linha do
  movimento diz que a abertura é uma imagem estática.
- **A fotografia passa a ser, quase de certeza, o elemento que o Q-01 mede.**
  Por isso não pode ter `loading="lazy"`, e o peso é critério de aceitação,
  não sugestão. A F3-07 (Lighthouse no CI) ainda não existe; é recomendada
  antes da tarefa da abertura, para o Q-01 ser medido e não estimado.
- `img-src 'self'` já aceita a fotografia e o logótipo servidos pelo próprio
  site. A CSP não muda.
- A ementa deixa de ser a primeira coisa no ecrã. Quanto da ementa (ou da
  barra de chips) continua visível no 390×844 sem deslizar é decisão de
  desenho da tarefa, para o Tomás aprovar nas capturas: este ADR não a toma.
- A abertura não é animada: não há avanço, fade de entrada nem paralaxe
  ("movimento só em resposta a ações").
- O logótipo vem da tarefa "Logótipo e ícones do site", que é dependência.

## Alternativas consideradas

- **Trazer o vídeo.** Rebenta o Q-01 por uma ordem de grandeza, obriga a abrir
  a CSP e mostra um bar que não é este.
- **Vídeo curto e recomprimido.** Continua a pedir `media-src` na CSP e
  continua a não ser o Tomazia; o ganho sobre uma fotografia é só o movimento,
  que a especificação recusa.
- **Ficar sem abertura** (o que a especificação dizia). Mantém a ementa no
  primeiro ecrã, mas deixa o site sem marca nenhuma à chegada, que é a queixa
  que motivou a análise.
- **Só o logótipo, sem fotografia.** Resolve a marca e não o ambiente; o
  Tomás escolheu as duas coisas.
