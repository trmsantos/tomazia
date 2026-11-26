import { useState } from "react";
import type { ReactElement } from "react";

import { Botao } from "../../components/ui/Botao";
import type { Info } from "../../lib/api/publico";
import { ID_DA_LISTA_DA_EMENTA } from "../../lib/ementa/ancoras";
import { FolhaWifi } from "./FolhaWifi";

/**
 * O cabeçalho fixo da página pública (`docs/ecras/F3-03.md`, secções 2 a 6).
 *
 * Duas coisas lá dentro e não cinco, porque ele custa 61 px de ecrã em todas
 * as páginas e a cada momento: o logótipo, que é o nome do bar, e o botão "WiFi".
 *
 * **O cabeçalho não tem estados.** É o mesmo desenho nas cinco leituras do
 * `/info`: nada aparece, nada desaparece, nada se mexe para o lado depois da
 * primeira pintura (6.3). O botão está lá sempre, mesmo com o WiFi por
 * configurar, porque a pergunta tem sempre resposta do outro lado — a
 * password, ou onde a pedir (6.2, decisão do Tomás).
 *
 * **Não pede o `/info`.** Quem pede é o `App.tsx`, uma vez, ao montar: o
 * `/info` é `no-store` de propósito, a F3-06 precisa do mesmo payload, e quem
 * pede fica responsável por distinguir "não está configurado" de "não consegui
 * perguntar" — distinção que vive melhor num sítio só (secção 2).
 *
 * `fixed` e não `sticky`: o `sticky` pára no fim do seu bloco contentor, que é
 * exactamente o que faz a barra de chips despedir-se quando a ementa acaba, e
 * exactamente o que o cabeçalho **não** pode fazer. As duas posições são os
 * dois tempos de vida, e é essa a relação inteira entre as duas camadas (4.1).
 */

/** Secção 10, palavra por palavra. */
const TEXTOS = {
  nome: "Bar da Tomazia",
  saltar: "Saltar para a ementa",
  wifi: "WiFi",
} as const;

/**
 * As três leituras do `/info`, e são mesmo três.
 *
 * Desenham-se em dois ecrãs (6.2) e isso é uma decisão; **um estado a ser
 * reescrito como o outro é um defeito**. A forma proibida está escrita à vista
 * em 6.5:
 *
 * ```ts
 * .catch(() => setInfo({ wifi: { rede: null, password: null }, … }))
 * ```
 *
 * Transforma "não consegui perguntar" na **afirmação** de que não há WiFi,
 * morada, telefone nem horário. Hoje não se vê a diferença; na F3-06, onde o
 * `horario: null` faz a secção "Visita-nos" sumir-se com um ar de decisão,
 * vê-se — e mal.
 */
export type EstadoDoInfo =
  { estado: "a-carregar" } | { estado: "pronto"; info: Info } | { estado: "falhou" };

export function Cabecalho({ info }: { info: EstadoDoInfo }): ReactElement {
  const [folhaAberta, setFolhaAberta] = useState(false);

  return (
    <>
      {/*
       * A ligação de salto vive **fora** do `<header>`, como primeiro filho do
       * corpo da página. Dentro ficava presa numa caixa de altura fixa de
       * 61 px, e ela cresce até 44 px quando recebe foco. Fora, é fixa por sua
       * conta e nada se mexe (5.3).
       *
       * Sem foco não se pinta e não ocupa lugar nenhum — mas **não** por
       * `display: none` nem por `hidden`, que a tirariam da ordem de tabulação
       * e a tornariam inútil. Fica fixa, uma altura acima do topo da janela, e
       * desce quando recebe foco. A `z-30` fica por cima do cabeçalho:
       * enquanto estiver visível tapa o nome do bar, e é o custo certo, porque
       * é lá que o olho está.
       *
       * **Com foco assenta a 16 da esquerda e a 8 do topo, e os dois números
       * são o anel.** O anel é um `outline` com afastamento: desenha-se 4 px
       * **para fora** da caixa, e no canto a 0,0 esses 4 px caíam fora da
       * janela — ficava um anel de dois lados, num controlo que é a primeira
       * paragem de `Tab` do site. Não chumbava nenhum critério de AA e era
       * por isso que passava: "mostra anel" dava verde com o defeito lá
       * dentro. Os 8 px de cima alinham ainda o topo da ligação com o do botão
       * "WiFi" (44 numa caixa de 60) e os 16 da esquerda com a aresta esquerda
       * do logótipo, que é o `px-4` da coluna (5.3).
       *
       * O desvio de 8 px é **`translate-y-2` e não `top-2`**, e a diferença
       * importa: com `top-2`, o `-translate-y-full` sobe 44 px a partir de 8 e
       * deixava 8 px da ligação dentro da janela — uma tira de painel pintada
       * por cima do cabeçalho, sem foco nenhum. A partir de `top-0` a conta
       * fecha: escondida vai de −44 a 0, com foco vai de 8 a 52.
       *
       * Com o `px-6` mede **198,98** px (de 16 a 214,98, medido na página
       * desenhada) e tapa o logótipo de 44 px, que ocupa o x de 16 a 60. Com
       * `px-4` (182,98 px) também o tapava: o `px-6` vem da F3-03, quando o
       * que havia a tapar era o nome em texto, e fica só porque mudar o
       * espaçamento não é desta tarefa.
       *
       * **`:focus` e não `:focus-visible`**, ao contrário do que a 5.3 escreve.
       * A razão que a 5.3 dá para o `:focus-visible` é "não aparece a quem
       * carrega com o rato" — e aqui esse caso não existe: uma ligação que
       * está uma altura acima do topo da janela não se pode carregar com o
       * rato, porque não há lá nada em que carregar. O que existe é o caso
       * contrário: um foco que chegue por `elemento.focus()` — de script, de
       * uma extensão, de um leitor de ecrã — e que com `:focus-visible` punha
       * o foco num sítio **fora da janela**, que é a definição de ficar
       * perdido no escuro. É isso que a varredura de foco da F3-02
       * (`e2e/ementa-acessibilidade.spec.ts`) mede, e mede bem.
       */}
      <a
        href={`#${ID_DA_LISTA_DA_EMENTA}`}
        className={
          "superficie-painel fixed left-4 top-0 z-30 -translate-y-full inline-flex min-h-toque " +
          "items-center rounded-pequeno px-6 font-corpo font-forte text-corpo text-texto " +
          "focus:translate-y-2"
        }
      >
        {TEXTOS.saltar}
      </a>

      <header className="superficie-painel fixed inset-x-0 top-0 z-20 h-cabecalho border-b border-contorno-superficie">
        {/*
         * Superfície de ponta a ponta com conteúdo contido, como a barra de
         * chips: o fundo e o fio atravessam a janela, o nome e o botão vivem
         * nos mesmos 640 px da coluna. É esse alinhamento — logótipo, chips e
         * cartões na mesma coluna — que faz as duas camadas lerem como uma
         * peça só em vez de duas barras empilhadas (11).
         */}
        <div className="mx-auto flex h-full max-w-coluna items-center justify-between gap-4 px-4">
          {/*
           * O logótipo (F3-08) **substitui o texto**: o nome acessível do `<h1>`
           * é o `alt` da imagem, sem texto escondido nem `aria-label`. Não é
           * uma ligação nem é focável: uma ligação para o topo de uma página
           * que é uma só seria uma paragem de `Tab` a não fazer nada.
           *
           * 44 x 44 é o `--alvo-toque`, a altura da linha: o cabeçalho continua
           * com 61 px e as âncoras da ementa não se mexem. O tamanho vem dos
           * atributos `width` e `height` e do `block shrink-0` (sem `style`, CSP e ADR 0008), e
           * reserva o lugar antes de a imagem chegar. Sem `lazy`: está acima
           * da dobra. Os ficheiros são de `public/`, referidos por caminho e
           * **não importados**, para não entrarem no JS (Q-02).
           */}
          <h1>
            <img
              src="/marca/logo-88.webp"
              srcSet="/marca/logo-44.webp 1x, /marca/logo-88.webp 2x, /marca/logo-132.webp 3x"
              alt={TEXTOS.nome}
              width={44}
              height={44}
              decoding="async"
              className="block shrink-0"
            />
          </h1>

          {/*
           * O único retângulo dourado **utilizável** da página. Com a Folha
           * aberta passa a ser o "Copiar password", e este fica debaixo da
           * cortina a 1,35 de contraste, fora do foco e fora do `aria-modal`
           * (7.5).
           */}
          <Botao
            variante="principal"
            onClick={() => {
              setFolhaAberta(true);
            }}
          >
            {TEXTOS.wifi}
          </Botao>
        </div>
      </header>

      {/*
       * A Folha é **irmã** do cabeçalho, não filha dele. Um `<dialog>` com
       * `showModal()` vai para a camada de topo de qualquer maneira; escrevê-lo
       * dentro de uma caixa fixa de 61 px com contexto de empilhamento próprio
       * é pedir um defeito que só aparece num browser (secção 2).
       */}
      <FolhaWifi
        aberta={folhaAberta}
        info={info}
        aoFechar={() => {
          setFolhaAberta(false);
        }}
      />
    </>
  );
}
