import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { SELETOR_INTERATIVO } from "./pagina";

/**
 * Percorrer a página com `Tab` e descrever o que o foco encontra.
 *
 * Vive aqui, e não dentro do spec, por duas razões: os testes de foco e os
 * da ordem de tabulação usam-no, e assim há uma só definição de "o que é o
 * fundo contra o qual o anel se vê" e de "onde é que o controlo está" — que
 * são as duas partes subtis.
 *
 * ## Porque é que o número de passos não é uma constante
 *
 * A primeira versão deste ficheiro percorria **80 passos fixos** numa
 * página que tem mais de noventa controlos. O varrimento parava a meio e
 * os guardas em vigor (`visitados.length > 20`) continuavam verdes: "não
 * percorri tudo" a passar por "não encontrei nada", que é a regra 10 do
 * `CLAUDE.md` noutra roupagem. Um defeito nos últimos controlos da página
 * era invisível para todos os testes de foco.
 *
 * Agora o limite **deriva do DOM** (`SELETOR_INTERATIVO` mais folga) e o
 * fim normal do varrimento é o `Tab` **sair da página**. Quem usa isto tem
 * de chamar `exigirVarrimentoCompleto`, que é o guarda que distingue as
 * duas coisas.
 */

/**
 * Onde o controlo está, em coordenadas de **layout** e não de viewport.
 *
 * Somar a cadeia de `offsetParent` em vez de usar `getBoundingClientRect()`
 * directamente não é preciosismo: o `Tab` faz o browser deslocar a página
 * (e a barra de chips, que tem `overflow-x-auto`, desloca-se na
 * horizontal). Com coordenadas de viewport, o chip número 8 aparecia à
 * **esquerda** do número 7 só porque a barra rolou — e o invariante da
 * ordem visual falhava por uma razão que nada tem a ver com o teclado.
 * `offsetTop`/`offsetLeft` não mudam com o deslocamento.
 */
export type CaixaDeLayout = {
  topo: number;
  esquerda: number;
  altura: number;
  largura: number;
  /**
   * `true` quando o elemento, ou um antepassado seu, é `position: fixed`.
   * Uma camada fixa (o Aviso) não tem lugar na ordem vertical do
   * documento, por isso o invariante da ordem visual salta-a em vez de a
   * acusar.
   */
  fixo: boolean;
  /**
   * `true` quando o elemento, ou um antepassado seu, é `position: sticky`.
   *
   * Entra na F3-02: um controlo que vive **dentro** da barra colada ao topo
   * (a lupa) não pode ser acusado de estar tapado por ela. Separado do
   * `fixo` porque um elemento colado continua a ter lugar na ordem vertical
   * do documento — só pára de descer a certa altura.
   */
  colado: boolean;
};

export type ElementoFocado = {
  descricao: string;
  estiloDoContorno: string;
  espessura: number;
  corDoContorno: string;
  /** `null` quando não se encontrou nenhum fundo opaco: é "não sei", não "branco". */
  fundoEfetivo: string | null;
  /**
   * Com que opacidade a cor do anel chega ao ecrã. `1` na esmagadora
   * maioria; `--opacidade-desativado` num controlo desativado, que é
   * precisamente onde o anel por medir estava mais perto de desaparecer.
   */
  opacidadeEfetiva: number;
  noCreme: boolean;
  caixa: CaixaDeLayout;
};

export type Varrimento = {
  visitados: ElementoFocado[];
  /** Quantos controlos o `SELETOR_INTERATIVO` encontrou no DOM. */
  focaveisNoDom: number;
  /**
   * Quantos desses o `Tab` devia alcançar: visíveis, não `disabled` e não
   * dentro de uma zona `inert`. Um `<input disabled>` **vê-se** e não
   * recebe foco de propósito (secção 7.2 da especificação) — contá-lo
   * punha o guarda a acusar a especificação.
   */
  focaveisVisiveis: number;
  /** O limite de passos usado nesta corrida. Derivado, nunca escrito à mão. */
  passosDisponiveis: number;
  /** `true` quando o varrimento acabou por o `Tab` sair da página. */
  saiuDaPagina: boolean;
  /**
   * Altura de uma linha de corpo, em px: a tolerância do invariante da
   * ordem visual, para controlos lado a lado. `null` quando não se
   * conseguiu ler — que é "não sei", e tem de falhar, não de virar zero.
   */
  alturaDeLinha: number | null;
};

/** Folga por cima do número de controlos do DOM, em passos de `Tab`. */
const FOLGA_DE_PASSOS = 25;

export async function percorrerComTab(pagina: Page): Promise<Varrimento> {
  const contagem = await pagina.evaluate((seletor) => {
    const alcancavel = (elemento: Element): boolean => {
      const caixa = elemento.getBoundingClientRect();
      if (caixa.width === 0 || caixa.height === 0) return false;
      // `disabled` tira o elemento da ordem de tabulação, e isso é
      // deliberado nos Campos; os Botões usam `aria-disabled` justamente
      // para continuarem focáveis.
      if (elemento.matches(":disabled")) return false;
      // `tabindex="-1"` num `button`/`a` tira-o da ordem de tabulação sem
      // o tirar do `SELETOR_INTERATIVO` (que só exclui a forma
      // `[tabindex="-1"]` quando o elemento entra pela via do `tabindex`).
      if (elemento.getAttribute("tabindex") === "-1") return false;
      return elemento.closest("[inert]") === null;
    };
    const todos = [...document.querySelectorAll(seletor)];

    const bruto = getComputedStyle(document.body).lineHeight;
    const linha = Number.parseFloat(bruto);

    return {
      focaveisNoDom: todos.length,
      focaveisVisiveis: todos.filter(alcancavel).length,
      alturaDeLinha: Number.isFinite(linha) ? linha : null,
    };
  }, SELETOR_INTERATIVO);

  const passosDisponiveis = contagem.focaveisNoDom + FOLGA_DE_PASSOS;
  const visitados: ElementoFocado[] = [];
  let saiuDaPagina = false;

  await pagina.locator("body").press("Tab");

  for (let passo = 0; passo < passosDisponiveis; passo += 1) {
    const atual = await pagina.evaluate(() => {
      const elemento = document.activeElement;
      if (elemento === null || elemento === document.body) return null;

      const estilo = getComputedStyle(elemento);

      // O fundo contra o qual o anel se vê é o do **pai**, não o do
      // próprio elemento: o anel tem 2 px de afastamento, por isso assenta
      // na folga, que é pintada pela superfície por trás. É isso que faz o
      // anel do botão principal (dourado sobre preenchimento dourado, 1,0)
      // ser legível: ele não toca no preenchimento.
      //
      // A opacidade vem no mesmo movimento, e tem de vir: um controlo
      // desativado pinta o anel com a cor inteira e deixa-o chegar ao ecrã
      // apagado a 0,55. Ver `apoio/pintura.ts`.
      const pintura = window.__pintura.medir(elemento);

      // Coordenadas de layout: ver a nota de `CaixaDeLayout`.
      const rectangulo = elemento.getBoundingClientRect();
      let topo = 0;
      let esquerda = 0;
      let fixo = false;
      let colado = false;
      let no: HTMLElement | null = elemento instanceof HTMLElement ? elemento : null;
      // Uma só subida, e chega. A cadeia de `offsetParent` salta os
      // antepassados **sem** posicionamento, e um elemento colado não é um
      // deles: `position: sticky` é posicionamento, por isso a barra da
      // ementa aparece na cadeia de quem vive lá dentro. Medido nos doze
      // controlos desta página, com a pesquisa fechada e aberta: a cadeia
      // de `offsetParent` e uma subida pelo DOM dão o mesmo resultado em
      // todos. Havia aqui um segundo ciclo a subir o DOM, justificado por
      // uma frase falsa — o único caso em que a cadeia pára cedo é um
      // antepassado `position: fixed`, e esse já é marcado como `fixo`.
      while (no !== null) {
        topo += no.offsetTop;
        esquerda += no.offsetLeft;
        const posicao = getComputedStyle(no).position;
        if (posicao === "fixed") fixo = true;
        if (posicao === "sticky") colado = true;
        no = no.offsetParent as HTMLElement | null;
      }

      // O nome, por ordem de utilidade. A `<label>` associada entra na
      // lista porque o Interruptor é um `<input type="checkbox">` com a
      // etiqueta ao lado: sem ela, três controlos diferentes apareciam nas
      // mensagens de falha como `input «»` e não se distinguiam.
      const identificador = elemento.getAttribute("id");
      const etiqueta =
        elemento.closest("label") ??
        (identificador === null
          ? null
          : document.querySelector(`label[for="${CSS.escape(identificador)}"]`));
      const nome = (
        elemento.getAttribute("aria-label") ??
        (elemento.textContent === null || elemento.textContent.trim() === ""
          ? (etiqueta?.textContent ?? "")
          : elemento.textContent)
      )
        .trim()
        .slice(0, 48);

      return {
        descricao: `${elemento.tagName.toLowerCase()} «${nome}» (secção ${
          elemento.closest("section")?.id ?? "?"
        })`,
        estiloDoContorno: estilo.outlineStyle,
        espessura: Number.parseFloat(estilo.outlineWidth),
        corDoContorno: estilo.outlineColor,
        fundoEfetivo: pintura.fundo,
        opacidadeEfetiva: pintura.opacidade,
        noCreme: elemento.closest(".superficie-creme") !== null,
        caixa: {
          topo,
          esquerda,
          altura: rectangulo.height,
          largura: rectangulo.width,
          fixo,
          colado,
        },
      };
    });

    if (atual === null) {
      saiuDaPagina = true;
      break;
    }
    visitados.push(atual);
    await pagina.keyboard.press("Tab");
  }

  return {
    visitados,
    focaveisNoDom: contagem.focaveisNoDom,
    focaveisVisiveis: contagem.focaveisVisiveis,
    passosDisponiveis,
    saiuDaPagina,
    alturaDeLinha: contagem.alturaDeLinha,
  };
}

/**
 * O guarda da regra 10 para tudo o que se afirma a partir de um varrimento.
 *
 * Sem ele, um varrimento que para a meio responde "não encontrei nada de
 * errado" com a mesma cara de um varrimento que chegou ao fim. Chamar isto
 * é obrigatório antes de qualquer `expect` sobre `visitados`.
 */
export function exigirVarrimentoCompleto(varrimento: Varrimento): void {
  expect(
    varrimento.visitados.length,
    "guarda: o Tab não chegou a controlo nenhum — não verifiquei nada",
  ).toBeGreaterThan(20);

  expect(
    varrimento.saiuDaPagina,
    `guarda: o varrimento esgotou os ${varrimento.passosDisponiveis} passos sem o Tab ` +
      `sair da página (parou em ${varrimento.visitados.length} controlos, de ` +
      `${varrimento.focaveisVisiveis} visíveis). Tudo o que este teste diria a ` +
      "seguir seria sobre meia página — «não percorri tudo» a passar por «não " +
      "encontrei nada».",
  ).toBe(true);

  expect(
    varrimento.visitados.length,
    `guarda: o Tab parou em ${varrimento.visitados.length} controlos, mas a página tem ` +
      `${varrimento.focaveisVisiveis} visíveis. Há controlos visíveis fora da ordem ` +
      "de tabulação — ou o varrimento está a saltar algum.",
  ).toBeGreaterThanOrEqual(varrimento.focaveisVisiveis);
}

/** O que o `Tab` encontrou entre um controlo e outro. */
export type Percurso = {
  /** Tabulações desde o controlo focado até ao alvo; `null` se não lá chegou. */
  passos: number | null;
  /** Descrição de cada paragem, por ordem — é o que torna a falha legível. */
  paragens: string[];
  /** O limite de busca usado, para a mensagem poder dizer "nem em N". */
  limite: number;
};

/**
 * Quantas tabulações separam **o controlo que está focado agora** do `alvo`.
 *
 * É esta a medida que interessa e não a distância desde o início da página:
 * é a distância que a pessoa percorre depois de carregar num botão.
 *
 * A identidade do alvo compara-se por nó do DOM (`===`), e não pelo nome
 * acessível: se o alvo desaparecer a meio — que é exactamente o que o Aviso
 * faz ao fim de cinco segundos — a comparação dá `false` em silêncio em vez
 * de rebentar, e quem chamou decide o que dizer sobre isso.
 */
export async function tabulacoesAte(
  pagina: Page,
  alvo: Locator,
  limite: number,
): Promise<Percurso> {
  const puxador = await alvo.elementHandle();
  if (puxador === null) {
    return { passos: null, paragens: ["o alvo não estava no DOM quando comecei a contar"], limite };
  }

  const paragens: string[] = [];

  for (let passo = 1; passo <= limite; passo += 1) {
    await pagina.keyboard.press("Tab");

    const paragem = await pagina.evaluate((alvoNoDom) => {
      const focado = document.activeElement;
      if (focado === null || focado === document.body) {
        return { chegou: false, descricao: "(o Tab saiu da página)" };
      }
      const nome = (focado.getAttribute("aria-label") ?? focado.textContent ?? "")
        .trim()
        .slice(0, 40);
      return {
        chegou: focado === alvoNoDom,
        descricao: `${focado.tagName.toLowerCase()} «${nome}»`,
      };
    }, puxador);

    paragens.push(`${passo}. ${paragem.descricao}`);
    if (paragem.chegou) return { passos: passo, paragens, limite };
  }

  return { passos: null, paragens, limite };
}

/**
 * Pôr o foco num controlo **por teclado**, para o `:focus-visible` ser o
 * verdadeiro.
 *
 * `element.focus()` sozinho não serve: no Chromium a heurística do
 * `:focus-visible` só acende o anel quando a última interacção foi de
 * teclado, por isso uma captura tirada depois de um `focus()` programático
 * sai **sem anel** e passa por prova de que o anel não existe. O par
 * `Shift+Tab` seguido de `Tab` é um ida-e-volta de teclado a sério que
 * acaba no mesmo elemento.
 */
export async function focarPorTeclado(pagina: Page, alvo: Locator): Promise<void> {
  await alvo.focus();
  await pagina.keyboard.press("Shift+Tab");
  await pagina.keyboard.press("Tab");

  const certo = await alvo.evaluate((elemento) => elemento === document.activeElement);
  expect(
    certo,
    "o ida-e-volta de teclado não voltou ao mesmo controlo — a captura mostraria o anel errado",
  ).toBe(true);
}
