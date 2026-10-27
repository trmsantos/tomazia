// @vitest-environment node
/**
 * O chão do `--opacidade-desativado`.
 *
 * O estado desativado deste projeto viaja na `opacity` (secção 6 de
 * `docs/ecras/F3-01.md`), e a `opacity` apaga **tudo** o que o elemento
 * pinta: o preenchimento, o texto, o contorno — e o anel de foco. A 1.4.3
 * isenta os componentes inativos do mínimo de contraste do **texto**, e é
 * por isso que baixar a etiqueta para 4,82 é o comportamento certo. O anel
 * de foco não está isento da mesma maneira: um controlo desativado continua
 * focável de propósito (usa `aria-disabled`, não `disabled`), por isso quem
 * navega por teclado passa por ele e precisa de ver onde está.
 *
 * Isto esteve por medir, e esteve por medir de uma forma particularmente
 * traiçoeira: o `getComputedStyle().outlineColor` devolve a cor **sem** a
 * opacidade aplicada. O teste ponta a ponta afirmava 7,73 no escuro e 9,95
 * no creme; o que se vê são 3,22 e 3,09. Passavam os dois.
 *
 * E o âmbito mais apertado não é nenhum desses: é o **painel**, a
 * superfície da Folha e do Aviso, onde o dourado parte de 6,82 e chega ao
 * ecrã a **3,04**. Quatro centésimas. Não foi medido por ninguém até aqui
 * porque não há botão desativado nenhum numa Folha da demonstração — o que
 * quer dizer que o primeiro que lá for posto já nasce no limite.
 *
 * O 0,55 escolhido está certo. Este ficheiro existe para que continue a
 * estar certo **por cálculo e não por sorte**: se alguém o baixar abaixo do
 * ponto em que o anel atravessa os 3:1, cai aqui, com o número e com o
 * valor mínimo que ainda serve.
 */
import { describe, expect, it } from "vitest";

import { arredondar, contrasteDeCores, lerCor, sobrepor } from "../testes/contraste";
import type { Rgb } from "../testes/contraste";
import { blocosDosTokens, resolver } from "../testes/tokens";

/** 1.4.11: o mínimo de um elemento não textual, que é o que um anel é. */
const MINIMO = 3;

/**
 * Os âmbitos em que um controlo desativado pode aparecer, com o nome que
 * uma falha deve usar. O `.superficie-painel` entra porque é a superfície
 * da Folha e do Aviso, onde há botões.
 */
const AMBITOS = [
  { seletor: ".superficie-escura", nome: "escuro" },
  { seletor: ".superficie-painel", nome: "painel" },
  { seletor: ".superficie-creme", nome: "creme" },
];

function corDoAmbito(seletor: string, nome: string): Rgb {
  const blocos = blocosDosTokens();
  const valor = resolver(blocos, seletor, nome);
  if (valor === null) {
    throw new Error(
      `Não consegui resolver \`${nome}\` em \`${seletor}\` a partir do tokens.css. ` +
        "Isto é uma falha de leitura, não um contraste insuficiente.",
    );
  }
  const cor = lerCor(valor);
  if (cor === null) {
    throw new Error(`Não consegui ler a cor \`${valor}\` (${nome} em ${seletor}).`);
  }
  return cor;
}

function opacidadeDesativado(): number {
  const bruto = blocosDosTokens().get(":root")?.get("--opacidade-desativado");
  if (bruto === undefined) {
    throw new Error("Não encontrei `--opacidade-desativado` no `:root` do tokens.css.");
  }
  const valor = Number.parseFloat(bruto);
  if (!Number.isFinite(valor) || valor <= 0 || valor > 1) {
    throw new Error(`\`--opacidade-desativado\` não é uma opacidade válida: ${bruto}`);
  }
  return valor;
}

/**
 * A opacidade a partir da qual o anel passa a ver-se neste âmbito.
 *
 * O contraste cresce com a opacidade (a cor do anel afasta-se do fundo à
 * medida que deixa de ser apagada contra ele), por isso uma busca binária
 * chega. Vinte e cinco passos dão precisão muito abaixo da centésima que
 * se reporta.
 */
function chao(anel: Rgb, fundo: Rgb): number {
  let baixo = 0;
  let alto = 1;
  for (let passo = 0; passo < 25; passo += 1) {
    const meio = (baixo + alto) / 2;
    if (contrasteDeCores(sobrepor(anel, fundo, meio), fundo) < MINIMO) baixo = meio;
    else alto = meio;
  }
  return alto;
}

describe("o anel de foco de um controlo desativado", () => {
  it.each(AMBITOS)("vê-se no âmbito $nome, depois de a opacidade o apagar", ({ seletor, nome }) => {
    const opacidade = opacidadeDesativado();
    const anel = corDoAmbito(seletor, "--cor-foco");
    const fundo = corDoAmbito(seletor, "--cor-fundo-local");

    const comoSeVe = arredondar(contrasteDeCores(sobrepor(anel, fundo, opacidade), fundo));
    const semOpacidade = arredondar(contrasteDeCores(anel, fundo));
    const limite = arredondar(chao(anel, fundo));

    expect(
      comoSeVe,
      `no ${nome}, o anel de um controlo desativado dá ${comoSeVe} (a conta sem a ` +
        `opacidade dava ${semOpacidade}, que é o número que ninguém vê). O mínimo da ` +
        `1.4.11 é ${MINIMO}, e neste âmbito ele atravessa-o em \`--opacidade-desativado\` ` +
        `= ${limite}. O valor actual é ${opacidade}.`,
    ).toBeGreaterThanOrEqual(MINIMO);
  });

  it("o chão é o do âmbito mais apertado, e fica escrito em vez de redescoberto", () => {
    // Qual é o âmbito apertado **calcula-se**, não se assume: a intuição
    // diz creme (é lá que o dourado é proibido e o contraste de partida é
    // maior), e a conta diz painel. Fixar um âmbito à mão aqui era repetir
    // o erro que este ficheiro existe para apanhar.
    const opacidade = opacidadeDesativado();

    const limites = AMBITOS.map(({ seletor, nome }) => ({
      nome,
      limite: chao(corDoAmbito(seletor, "--cor-foco"), corDoAmbito(seletor, "--cor-fundo-local")),
    }));

    const apertado = limites.reduce((pior, atual) => (atual.limite > pior.limite ? atual : pior));

    expect(
      arredondar(opacidade - apertado.limite),
      `o âmbito mais apertado é o ${apertado.nome}: o anel de um controlo desativado deixa ` +
        `de se ver abaixo de \`--opacidade-desativado\` = ${arredondar(apertado.limite)}, e o ` +
        `valor actual é ${opacidade}. ` +
        limites.map((entrada) => `${entrada.nome} ${arredondar(entrada.limite)}`).join(", ") +
        ".",
    ).toBeGreaterThan(0);

    // A guarda da regra 10 deste ficheiro: se a busca binária alguma vez
    // devolver 0 ou 1, não encontrou chão nenhum, e a asserção acima
    // passava a não dizer nada.
    expect(apertado.limite, "a busca do chão não convergiu: não medi nada").toBeGreaterThan(0);
    expect(apertado.limite).toBeLessThan(1);
  });
});
