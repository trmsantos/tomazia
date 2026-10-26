# 0008. Primitivas do browser em vez de Radix, para manter a CSP estrita

- Data: 2026-10-26
- Estado: aceite

## Contexto

Duas decisões do Tomás, escritas em sítios diferentes, não podiam ser ambas cumpridas:

- `frontend/CLAUDE.md`: "Primitivas Radix para folhas, diálogos e interruptores."
- `deploy/htaccess.exemplo`: `style-src 'self'`, com o comentário "CSP decidida pelo Tomás: `style-src 'self'` ESTRITO".

O Radix Dialog aplica estilos inline aos elementos que cria, e arrasta o `react-remove-scroll`, que injeta um `<style>` para travar o scroll do fundo. Um `style-src 'self'` sem `'unsafe-inline'` bloqueia as duas coisas.

O modo de falha é o pior que existe neste projeto: **o servidor de desenvolvimento do Vite não aplica a CSP de produção**, portanto tudo funciona localmente e parte no servidor. A folha que mostra a password do WiFi abriria sem estilos, ou não abriria. Não há teste em jsdom que apanhe isto, porque a CSP é um cabeçalho HTTP que o jsdom não avalia.

Havia ainda um segundo custo, medido: com `App.tsx` a ser apenas um `<h1>`, o pacote público já está em **68 KB comprimidos** — só o React. O critério Q-02 é 100 KB. Sobram cerca de 31 KB para a ementa, a pesquisa, os chips, os eventos, a galeria e os sete componentes base. O Radix gastaria uma fatia disso em duas peças que o browser traz de origem.

## Decisão

A CSP fica como está. As duas primitivas passam a ser do browser:

- **Folha e diálogo**: `<dialog>` nativo, com `showModal()`. Traz de origem o foco preso, o fecho com `Esc`, a camada de topo e o `::backdrop`.
- **Interruptor**: `<input type="checkbox" role="switch">`. Traz de origem o teclado, o estado anunciado e o comportamento de formulário.

A linha do `frontend/CLAUDE.md` muda em conformidade, no mesmo commit.

## Consequências

- A CSP nunca precisa de `'unsafe-inline'`, `nonce` nem hashes em `style-src`. Uma CSP que se abre raramente volta a apertar, e esta existe por causa das falhas do site PHP que este projeto substitui.
- Zero KB acrescentados. O orçamento de ~31 KB fica inteiro para os ecrãs da Fase 3.
- O `<dialog>` e o `role="switch"` têm suporte universal nos browsers-alvo. Não há recurso alternativo a escrever.
- Perde-se o que o Radix dá de graça e que agora é nosso: o `aria-labelledby` do diálogo, o estado do interruptor anunciado em PT-PT, e o retorno do foco ao elemento que abriu a folha. A especificação em `docs/ecras/F3-01.md` trata cada um, e os testes de acessibilidade (Q-03) cobrem-nos.
- A regra vale para folhas, diálogos e interruptores. Se uma tarefa futura precisar de um componente que o browser não traz — um combobox com filtragem, por exemplo — esta decisão não a proíbe: obriga a verificar antes se a CSP o aceita, e a dizê-lo no PR.

## Alternativas consideradas

- **Manter o Radix e pôr `nonce` ou hashes no `style-src`**: funciona, mas enfraquece de forma permanente a defesa principal contra injeção de conteúdo, para ganhar duas peças que já existem no browser. Um `nonce` obriga ainda a gerar o valor por pedido, e o HTML deste site é estático, servido pelo Apache — não há onde o gerar.
- **Manter o Radix e descobrir mais tarde**: é o caminho por omissão, e é o que a F1-04 passou quatro rondas a corrigir noutro contexto — algo que passa em desenvolvimento e falha onde ninguém está a ver.
- **Escrever o nosso próprio diálogo com `div` e gestão de foco à mão**: é mais código do que o Radix, não menos, e é exatamente o código que o `<dialog>` já traz testado por quem fez o browser.
