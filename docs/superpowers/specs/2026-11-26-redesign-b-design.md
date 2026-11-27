# Redesign "B · App acolhedora": desenho

Data: 2026-11-26. Decisão do Tomás, a partir das maquetas guardadas em
`.superpowers/brainstorm/` (fora do repositório): `direcoes.html` (a escolha),
`b-completo.html` (página pública e Início/Ementa da gestão) e `b-gestao.html`
(Entrar, Galeria, Eventos, Mais). As capturas delas vão para
`docs/ecras/capturas/redesign/` no R-01, para que este documento não dependa
de ficheiros fora do repositório.

## Intenção

O Tomás acha o site antiquado, sobretudo a letra (Playfair Display + Source
Sans 3) e o layout. Quer "um redesign completamente novo, como um showcase de
um website digno e moderno", **mantendo as cores** (bordô, dourado latão,
creme). Abrange a página pública **e** a gestão inteira.

Das três direções mostradas (A noite editorial, B app acolhedora, C
contraste), escolheu a **B**, e aprovou-a aplicada à página pública inteira
e a seis ecrãs da gestão.

## Objetivos

- Página pública e gestão com o aspeto B: fundo creme, cantos bem redondos,
  cartões claros, letra grotesca com personalidade, bordô como cor de
  superfície forte e dourado só na ação principal.
- As cores da paleta não mudam (os dez hex da tabela Design ficam).
- Cada ecrã continua a fazer exatamente o que faz hoje.

## Fora de âmbito

- Funcionalidades novas. As pegas de arrastar e os interruptores que
  aparecem na maqueta da Ementa da gestão eram só ilustração: a ementa da
  gestão mantém os controlos que tem (F4-02).
- A fotografia da abertura (F3-11), os atalhos (F3-09), o slide da galeria
  (F3-10), o rodapé com novidades (F2-07/F3-07). Nascem já no estilo B,
  depois do R-02.
- Modo escuro, temas, animações de entrada.

## Anti-objetivos (falha mesmo que "funcione")

- A ementa deixar de aparecer sem um toque no 390×844 (F3-02): o cartão
  bordô de cima tem de ser compacto, e a barra de categorias e o primeiro
  produto têm de se ver sem deslizar.
- Perder acessibilidade: Q-03 (axe), Q-04 (44 px, foco visível), contraste
  AA, texto a 200 % sem scroll horizontal.
- Passar o Q-02 (100 kB de JS) ou carregar letras de outro domínio (a CSP é
  `font-src 'self'`).
- Parecer um template genérico: sem desfoque de vidro, sem cartões que sobem
  no hover, sem emojis, sem maiúsculas em etiquetas (a lista "Fica de fora"
  da especificação continua válida).

## Restrições

- CSP: `style-src 'self'` (sem estilos inline), `font-src 'self'`,
  `img-src 'self' data:`.
- `src/styles/tokens.css` é o único sítio com hex; o teste
  `cores-so-nos-tokens.test.ts` compara-o com a tabela Design da
  especificação.
- O dourado sobre creme tem 1,7:1. Na B há botões dourados sobre creme
  (Entrar, Aprovar, Novo evento, Ir para a fila de fotos).
- Um só botão dourado por ecrã (regra da gestão, F4).
- Alvo de toque 44 px; 56 px nos botões de moderar.
- Regras do CLAUDE.md, em particular a 6 (PT-PT) e a 8 (dependência nova
  com justificação; as letras não são dependências npm).

## Abordagens consideradas

1. **Três PRs seguidos: R-01 base, R-02 público, R-03 gestão.** Escolhida
   pelo Tomás. Separa o que é arriscado (componentes de que tudo depende) dos
   ecrãs, e cada PR tem um tamanho que os revisores conseguem ler. Custo: no
   novo.bardatomazia.pt há uma mistura de estilos entre o R-01 e o R-03,
   aceitável porque ainda não é o site oficial.
2. Um só PR com tudo: coerente de uma vez, mas diff enorme e revisões fracas.
3. Ecrã a ecrã, dentro das tarefas seguintes: dois estilos durante semanas e
   o objetivo do Tomás demora a aparecer.

## O desenho (o que o Tomás decidiu)

### Letra

- Títulos: **Bricolage Grotesque** (800 nos títulos de página e no nome do
  bar, 700 nos de secção), com `letter-spacing` ligeiramente negativo.
- Texto: **DM Sans** (400, 500 e 700).
- Preços com algarismos tabulares, como hoje.
- Servidas pelo site, em `public/fontes/`, com licença (ambas OFL) e
  proveniência, como as de hoje. Saem a Playfair e a Source Sans 3.

### Superfícies e forma

- Fundo da página: creme-papel, na pública e na gestão. (Hoje a pública é
  bordô escuro com cartões creme.)
- Cartões: um creme mais claro ("papel"), com uma linha de 1 px em
  creme-sombra por baixo, e cantos de cerca de 18 px.
- Cartão de destaque (o de cima, na pública; as fotos à espera, no Início):
  bordo-tomazia, texto creme, cantos de cerca de 24 px, e um círculo dourado
  translúcido de decoração no canto.
- Chips e botões: cápsula (raio cheio) nos chips; cerca de 14 px nos botões.
- Barra de baixo da gestão: bordo-noite flutuante, cantos de cerca de 22 px,
  com o separador ativo em creme.

### Página pública (de cima para baixo)

1. Cabeçalho: logótipo à esquerda e botão "WiFi" bordô-noite à direita.
2. Cartão bordô com "Bar da Tomazia", a frase **"Estarreja · café, cervejas
   e petiscos"** (o Tomás pediu para ficar; o dominio-bar confirma que
   descreve o bar antes do merge) e a cápsula do estado ("Aberto até às
   02:00"), que vem do mesmo cálculo da F3-06a.
3. Chips de categoria em cápsula, fixos ao deslizar; o ativo é bordô-noite.
4. Ementa: título de secção, título de categoria e **um cartão por
   produto**, com nome, descrição opcional e o preço numa etiqueta
   bordô-noite. Deixa de haver o pontilhado.
5. Eventos: cartões com a data num bloco bordô (dia grande, mês pequeno).
6. Galeria: a grelha de hoje no estilo B, mais o botão secundário "Enviar
   uma foto". O mosaico da maqueta não entra, porque o slide da F3-10 vem a
   seguir (ver "Decisões minhas").
7. Visita-nos: horário num cartão, com o estado em cima e o dia de hoje a
   negrito; morada e contactos em cartões.
8. Rodapé bordô-noite.

### Gestão

- **Entrar:** a metade de cima bordô (logótipo e "Gestão do Bar da
  Tomazia"), e o formulário num cartão creme que sobe por cima dela. Botão
  dourado "Entrar".
- **Início:** um cartão de destaque bordô com o número de fotos à espera e
  o botão dourado "Ir para a fila de fotos"; dois cartões pequenos (próximos
  eventos, novos registos) com ligação de texto; e a lista dos próximos
  eventos.
- **Ementa:** chips de categoria e os produtos em cartões, com os controlos
  que já tem.
- **Galeria:** a foto grande no cartão, "Rejeitar" (secundário) e "Aprovar"
  (dourado) lado a lado, e o contador "N à espera" junto do título.
- **Eventos:** "Novo evento" dourado, eventos em cartões com o bloco da data,
  e os passados esbatidos.
- **Mais:** um cartão agrupado com Clientes e Definições, e o "Sair" à parte.
- Os ecrãs sem maqueta (Definições, Clientes, formulários de eventos, folhas)
  seguem os mesmos componentes.

## Decisões minhas (o Tomás pode corrigir)

- **Dourado sobre creme:** um botão dourado sobre fundo creme leva uma
  borda de 1,5 px em bordo-noite, para o contorno do controlo passar os 3:1
  da WCAG 1.4.11. O texto é bordo-noite sobre dourado (cerca de 7:1). A
  regra da especificação passa de "Nunca sobre creme" a "Sobre creme, só com
  a borda bordo-noite". O ui-ux confirma no R-01.
- **Cor "papel" dos cartões:** é derivada (`color-mix` de creme-papel com
  branco), e não um hex novo, para a paleta continuar com dez cores e o teste
  da tabela não mudar de forma.
- **Verde do "Aberto":** usa o sucesso-creme (#4F6B2E) da paleta, e não o
  verde da maqueta, que não existe na paleta.
- **ADR 0023** ("Redesign B: letra, forma e superfícies"), que substitui as
  partes da especificação sobre tipografia, cantos, sombras, o cartão por
  categoria com pontilhado e a "data grande em Playfair". A secção Design da
  especificação é reescrita no R-01.
- **Identificadores das tarefas:** R-01, R-02 e R-03 entram no
  `docs/TAREFAS.md`, numa secção "Redesign" antes da F3-09.
- **Botões sobre creme:** só a ação principal de cada ecrã é dourada (com a
  borda bordo-noite); os outros botões "principais" no creme ("Guardar
  alterações", "Copiar password", confirmar numa Folha) são bordo-noite
  cheio com texto creme, como o botão WiFi e as etiquetas de preço da
  maqueta. O `Botao` ganha uma variante dourada à parte e o "principal"
  passa a bordo-noite no creme. Se o ui-ux chumbar a borda, a ação principal
  fica também bordo-noite e o dourado só aparece sobre bordô (cartão de
  destaque, Entrar).
- **Galeria no R-02:** não se constrói o mosaico. A grelha de hoje (todas as
  fotos aprovadas, cada uma abre no Visualizador) passa ao estilo B
  (cantos, espaços), porque a F3-10 a substitui pelo slide logo a seguir e
  um mosaico de três esconderia fotos.
- **O que o R-01 muda e o que não muda:** o R-01 muda a letra, os tokens de
  forma e o aspeto dos componentes, nos dois âmbitos (escuro e creme), mas
  **não** muda o fundo das páginas. A pública passa a creme no R-02 e a
  gestão no R-03. Assim os componentes têm de estar corretos nos dois
  âmbitos até lá, e cada PR muda as capturas só das páginas que são dele.
- **Letras:** ficheiros variáveis em woff2, um por família (Bricolage
  Grotesque e DM Sans), com o subconjunto latino que cobre o português.
  Teto de 100 KB para as duas juntas (hoje são cerca de 55 KB). Se passar,
  larga-se o eixo `opsz` ou fixam-se os pesos antes de subir o teto, e isso
  pergunta-se ao Tomás.
- **Pesquisa e cartazes:** ficam a lupa da pesquisa (ementa pública e
  gestão) e o cartaz 3:2 dos eventos, que as maquetas não mostravam. Ficam
  no estilo B, onde estão hoje.

## Divisão em PRs

- **R-01 Base:** o ADR 0023, a especificação, os tokens, as letras, os
  componentes de `components/ui/` (Botão, Campo, Chip, Folha, Aviso,
  Interruptor, Estado vazio, Linha de produto e um Cartão novo, se fizer
  falta), e as capturas das maquetas. Os ecrãs ficam com o layout de hoje,
  mas já com a letra e os componentes novos.
- **R-02 Público:** o cabeçalho, o cartão de cima, os chips, a ementa em
  cartões, os eventos, a grelha da galeria no estilo B, o Visita-nos e o rodapé.
  Capturas a 390×844 e a 1024.
- **R-03 Gestão:** a moldura (barra de baixo flutuante e cabeçalho) e todos
  os ecrãs. Capturas a 390×844 e a 1024.

Cada PR segue o fluxo normal: arquiteto, qa, implementação, revisor-codigo,
revisor-seguranca (no R-01 por causa das letras e da CSP), ui-ux e
dominio-bar.

## O que fica para quem constrói

- Os valores exatos da escala tipográfica e dos espaços, desde que mantenham
  os 17 px de corpo e os mínimos de toque.
- A largura a partir de 1024 px (coluna pública e as duas colunas da
  gestão, como hoje).
- O subconjunto exato das letras, dentro do teto de 100 KB.
- Como os testes visuais e os e2e que fixam classes ou cores antigas são
  atualizados, desde que cada mudança de teste diga porquê.
