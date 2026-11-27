# 0023. Redesign B: letra, forma e superfícies

- Data: 2026-11-27
- Estado: aceite (Tomás, 2026-11-27)

## Contexto

O Tomás acha o site antiquado, sobretudo a letra (Playfair Display e Source
Sans 3) e o layout, e quer um redesign que mantenha as cores (bordô, dourado
latão, creme). Escolheu a direção B ("app acolhedora") de três maquetas e
aprovou-a aplicada à página pública e à gestão (desenho em
`docs/superpowers/specs/2026-11-26-redesign-b-design.md`). Divide-se em três
PRs: R-01 (base), R-02 (público) e R-03 (gestão).

A especificação, na secção Design, fixava coisas que a direção B contraria:
Playfair em títulos, Source Sans no resto, cantos de 4 e 12 px, o cartão creme
com borda de 1 px e "Dourado nunca sobre creme (1,7:1)". O B tem botões
dourados sobre creme.

## Decisão

1. **Letra.** Títulos em Bricolage Grotesque (800 nos de página e no nome do
   bar, 700 nos de secção, `letter-spacing` de -0.02em); texto em DM Sans (400,
   500 e 700). Ficheiros variáveis woff2 em `public/fontes/`, um por família, com
   o subconjunto latino do português e as funcionalidades de que os preços
   precisam (`tnum`). Licença OFL e proveniência registadas, como hoje. Saem a
   Playfair e a Source Sans 3. As duas juntas ficam até 100 KB. Se passarem,
   larga-se primeiro o eixo `opsz`, e o ADR regista-o (decisão do Tomás,
   2026-11-27). Se mesmo assim passarem, pergunta-se ao Tomás; o teto não sobe
   sozinho.
2. **Forma.** Raios de 10 px (etiquetas, miniaturas), 12 px (campos), 14 px
   (botões), 18 px (cartões, avisos), 24 px (cartão de destaque, topo da folha),
   22 px (barra da gestão) e cápsula (chips, interruptores). Contornos de 1 px e
   de 1,5 px (botões). Continua a não haver sombras: o cartão papel tem uma linha
   de 1 px em creme-sombra por baixo.
3. **Superfícies.** Dois âmbitos novos além do escuro, do painel e do creme: o
   **papel** (creme-papel misturado com branco por `color-mix`, cerca de
   `#FDF9F4`) e o **destaque** (bordo-tomazia, texto creme, com um círculo de
   dourado a 18 % de decoração). A paleta continua com os mesmos dez hex; o
   papel e a decoração são derivados em `tokens.css`.
4. **Dourado.** Uma só ação dourada por ecrã. Sobre creme ou papel o dourado só
   aparece num botão e sempre com borda de 1,5 px em bordo-noite: a borda é a
   fronteira do controlo (13,27:1 contra o creme, critério 1.4.11), o texto
   bordo-noite sobre dourado dá 7,73:1. O preenchimento sozinho (1,72:1) não
   chega, por isso sem a borda o botão não existe sobre creme. Chip ativo, foco e
   texto nunca são dourados sobre creme ou papel. No destaque o foco é
   creme-papel e o perigo é erro-escuro com texto bordo-noite (erro-creme dava
   1,93:1 contra bordo-tomazia).
5. **Texto sobre o círculo de decoração.** Só creme-papel ou creme-sombra. A
   exceção é o "Aberto" do R-02, que vai numa cápsula opaca creme-papel com o
   texto em sucesso-creme (4,93:1 contra a cápsula).
6. **Fases.** O R-01 muda a letra, os tokens e os componentes de
   `components/ui/` e **não muda o fundo de nenhuma página**; a pública passa a
   creme no R-02 e a gestão no R-03. Até ao R-02 a linha de produto mantém
   nome, pontilhado e preço; o pontilhado sai no R-02, e a linha da
   especificação sobre ele atualiza-se nesse PR.
7. **Valores.** Os números exatos (tokens, papéis por âmbito, classes de cada
   componente, contrastes) vivem em `docs/ecras/R-01.md`. Quando o desenho e as
   tabelas do plano divergem, vale o `R-01.md`.

Esta decisão substitui, na especificação, a tipografia, os cantos, a regra de
sombras e "Nunca sobre creme", e a "data grande em Playfair". A secção Design
e o `frontend/CLAUDE.md` (paleta e fontes) são atualizados no R-01. Os
`docs/ecras/F3-*.md` e `F4-*.md` **não se reescrevem**: as menções a Playfair,
a raios de 4 e 12 px e a "nunca sobre creme" que contêm ficam substituídas por
este ADR.

## Consequências

- Entre o R-01 e o R-03, `novo.bardatomazia.pt` mistura estilos (letra e
  componentes novos sobre páginas ainda escuras ou como estão). Aceitável: não
  é o site oficial.
- Cada componente tem de estar certo nos cinco âmbitos (escuro, painel, creme,
  papel, destaque), e os testes de pares de cores passam a medi-los todos. O
  leitor de tokens aprende `color-mix`.
- O teste que compara o `tokens.css` com a tabela Design continua a ler dez
  cores. A secção Design passa a ter de nomear as famílias de `fontes.css`
  (teste novo, na tarefa das letras).
- Peso das letras: uma verificação passa a falhar acima de 100 KB, e a Q-02
  (JavaScript) não é afetada porque as letras não entram no pacote.
- A Bricolage só existe entre 700 e 800: `font-titulo` e `font-seccao` trazem o
  peso consigo e nunca se juntam a `font-normal|medio|forte`.
- Testes e e2e que fixam classes ou cores antigas mudam, e cada um diz porquê
  num comentário "R-01 / ADR 0023".

## Alternativas

- **Direção A, "noite editorial":** fundo escuro, letra com serifa, pouco
  dourado. Menos distante do site atual, e por isso não resolve o que o Tomás
  quer mudar.
- **Direção C, "contraste":** blocos de bordô e creme em contraste forte. Mais
  gráfica, mas a ementa de 140 produtos pede uma superfície calma, e o Tomás
  preferiu a B.
- **Aceitar o botão dourado sobre creme sem borda:** recusado, 1,72:1 contra o
  creme; o botão ficava sem fronteira (1.4.11).
- **Botão sobre creme só bordo-noite, sem dourado:** fica como recuo se o ui-ux
  chumbasse a borda. Não foi preciso: confirmou-a em `docs/ecras/R-01.md`.
- **Um só PR, ou ecrã a ecrã:** diff demasiado grande para rever, ou dois
  estilos durante semanas. Escolheu-se R-01, R-02 e R-03 seguidos.
