# 0021. Galeria em slide que se passa com o dedo, sem avanço automático

- Data: 2026-11-16
- Estado: aceite

## Contexto

A especificação fixa, nos ecrãs públicos, "Galeria: grelha de duas colunas com
as seis últimas fotos; ecrã inteiro com deslizar", e a F3-05 construiu-a assim
(`docs/ecras/F3-05.md`, secção 4: duas colunas a 390 px, três a 1024 px, seis
fotos e "Ver mais fotos"). Na lista "Fica de fora" está o "carrossel
automático", que era a forma do site antigo (Bootstrap, fade, 4 s).

Na análise de lacunas de 16 de novembro, o Tomás decidiu que a galeria se
apresenta como um slide: uma foto de cada vez, passada com o dedo.

## Decisão

**A secção "Galeria" passa de grelha a slide horizontal que se passa com o
dedo, sem avanço automático.** Há sempre uma alternativa ao gesto: botões
"Foto anterior" e "Foto seguinte" e as setas do teclado, como já tem o
Visualizador da F3-05 (secção 5.3). O "carrossel automático" continua em
"Fica de fora".

## Consequências

- A linha da galeria em "Ecrãs públicos" muda no mesmo PR deste ADR. A
  secção 4 da `docs/ecras/F3-05.md` (a grelha) fica substituída pela
  especificação de ecrã da tarefa "Galeria em slide por toque"; o resto da
  F3-05 (envio, Visualizador, estados) mantém-se até essa tarefa dizer o
  contrário.
- **Sem `style` inline.** A CSP é `style-src 'self'` (ADR 0008), e o
  `frontend/eslint.config.js` e o `src/styles/sem-estilo-inline.test.ts` já
  o proíbem. Um slide feito com `style={{ transform: … }}` passa em
  desenvolvimento e parte em produção. O caminho que cabe é o scroll nativo
  com `scroll-snap` em classes (o mesmo que a barra de chips da ementa já
  usa) e `scrollTo`/`scrollIntoView` para os botões.
- **Sem avanço automático, sem ciclo.** Nos extremos o botão fica
  `aria-disabled`, como no Visualizador, para quem desliza não julgar que há
  mais fotos do que há.
- Só a primeira foto do slide carrega logo; as outras carregam tarde, para a
  galeria não competir com o Q-01 (sobretudo depois da abertura do ADR 0020).
- Fica para o desenho da tarefa, com aprovação do Tomás nas capturas: quantas
  fotos entram no slide, se o toque continua a abrir o Visualizador em ecrã
  inteiro, e onde fica o "Enviar uma foto".

## Alternativas consideradas

- **Manter a grelha.** É o que existe e funciona; o Tomás preferiu a forma do
  slide, que mostra cada foto grande no próprio ecrã da página.
- **Carrossel automático, como o antigo.** Move-se sem ação de quem lê (contra
  "movimento só em resposta a ações"), rouba a foto que a pessoa estava a ver
  e é mais um temporizador a respeitar `prefers-reduced-motion`.
- **Biblioteca de carrossel.** A maioria posiciona os slides com `style`
  inline, que a CSP bloqueia (ADR 0008), e traz peso para o Q-02 por uma coisa
  que o browser faz com `scroll-snap`.
