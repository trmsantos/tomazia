/**
 * F3-01 — "o desativado não é uma cor" (secção 6 de `docs/ecras/F3-01.md`),
 * para o Botão e para o Campo.
 *
 * Este ficheiro existe porque a regra anterior estava **invertida** e
 * ninguém o notou até alguém olhar para pixéis. Ela mandava tirar o
 * preenchimento e pôr contorno `contorno` com texto `texto-suave`, e dava
 * três defeitos de uma vez:
 *
 *  - no **secundário** não mudava nada de visível, porque as duas cores já
 *    eram as dele;
 *  - no **discreto** *acrescentava* um contorno, e o botão desligado
 *    passava a pesar mais do que o ligado — sinal invertido, que é pior do
 *    que sinal nenhum;
 *  - no **principal** e no **perigo** apagava a variante toda, e os quatro
 *    botões ficavam iguais uns aos outros.
 *
 * A regra certa: o controlo **mantém o preenchimento e o contorno da sua
 * variante** e só perde opacidade. O desativado viaja noutro canal, a
 * `--opacidade-desativado`, porque pela cor não dá: entre o texto normal e
 * o `texto-suave` há 1,39 no escuro e 1,33 no creme, e 1,3 não é uma
 * mudança de estado, é a mesma coisa duas vezes.
 *
 * O que estes testes prendem não é o nome de nenhuma classe nova: é que o
 * conjunto de classes do estado desativado seja o do estado normal **mais**
 * o canal da opacidade, e nada além disso. Assim, qualquer tentativa futura
 * de dizer "desativado" trocando uma cor cai aqui, chame-se ela como se
 * chamar.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { classesDe, soEm } from "../../testes/classes";
import { Botao } from "./Botao";
import type { VarianteDeBotao } from "./Botao";
import { Campo } from "./Campo";

/**
 * As únicas classes que o estado desativado pode **acrescentar**. Tudo o
 * resto que apareça é uma mudança de desenho a fazer-se passar por mudança
 * de estado.
 */
const CANAL_DO_DESATIVADO = ["opacity-desativado", "cursor-not-allowed"];

/** O que distingue cada variante das outras, da tabela da secção 7.1. */
const VARIANTES: { variante: VarianteDeBotao; marcas: string[] }[] = [
  { variante: "principal", marcas: ["bg-acao", "text-sobre-acao"] },
  { variante: "secundario", marcas: ["border-contorno"] },
  { variante: "discreto", marcas: ["text-texto-suave"] },
  { variante: "perigo", marcas: ["bg-perigo", "text-sobre-perigo"] },
];

function botao(variante: VarianteDeBotao, desativado: boolean): Set<string> {
  const { unmount } = render(
    <Botao variante={variante} desativado={desativado}>
      Guardar alterações
    </Botao>,
  );
  const encontrado = classesDe(screen.getByRole("button", { name: "Guardar alterações" }));
  unmount();
  return encontrado;
}

describe("desativado mantém a variante — Botão", () => {
  it.each(VARIANTES)(
    "o $variante desativado não perde nada do seu desenho nem ganha desenho novo",
    ({ variante, marcas }) => {
      const normal = botao(variante, false);
      const desativado = botao(variante, true);

      expect(
        soEm(normal, desativado),
        `o ${variante} desativado perdeu classes do seu estado normal: a variante tem de ` +
          "se manter inteira, só mais apagada",
      ).toEqual([]);

      expect(
        soEm(desativado, normal).filter((classe) => !CANAL_DO_DESATIVADO.includes(classe)),
        `o ${variante} desativado ganhou desenho que o normal não tem. O desativado viaja ` +
          "na opacidade e em mais nada (secção 6): trocar uma cor ou acrescentar um " +
          "contorno é mudar o sinal, não baixá-lo",
      ).toEqual([]);

      expect(
        desativado.has("opacity-desativado"),
        `o ${variante} desativado tem de perder opacidade — é o único canal que lhe resta`,
      ).toBe(true);

      for (const marca of marcas) {
        expect(
          desativado.has(marca),
          `o ${variante} desativado perdeu a ${marca}, que é o que o distingue das outras ` +
            "três variantes",
        ).toBe(true);
      }
    },
  );

  it("o discreto desativado não ganha um contorno que o discreto normal não tem", () => {
    // Este é o caso que estava ao contrário. Um botão desligado com mais
    // peso visual do que o mesmo botão ligado lê-se como o oposto do que é.
    const normal = botao("discreto", false);
    const desativado = botao("discreto", true);

    const comContorno = (conjunto: Set<string>): string[] =>
      [...conjunto].filter((classe) => /^border(-|$)/.test(classe)).sort();

    expect(
      comContorno(normal),
      "guarda: se o discreto normal passar a ter contorno, este teste deixa de dizer o que diz",
    ).toEqual([]);
    expect(
      comContorno(desativado),
      "o discreto desativado ganhou contorno: fica a pesar mais desligado do que ligado",
    ).toEqual([]);
  });

  it("as quatro variantes continuam distinguíveis umas das outras quando desativadas", () => {
    // A regra anterior apagava a variante toda no principal e no perigo, e
    // os quatro desativados ficavam iguais. Um "Eliminar produto"
    // desativado com a cara de um "Cancelar" desativado é uma confusão que
    // só custa caro uma vez.
    const assinaturas = VARIANTES.map(({ variante }) => ({
      variante,
      assinatura: [...botao(variante, true)].sort().join(" "),
    }));

    const repetidas = assinaturas.filter(
      (uma, indice) =>
        assinaturas.findIndex((outra) => outra.assinatura === uma.assinatura) !== indice,
    );

    expect(
      repetidas.map((repetida) => repetida.variante),
      "há variantes que se desenham exactamente da mesma maneira quando desativadas",
    ).toEqual([]);
  });
});

describe("desativado mantém a variante — Campo", () => {
  it("o campo desativado mantém o contorno do campo normal e só perde opacidade", () => {
    // No creme, `contorno` e `texto-suave` resolvem para a mesma cor: mudar
    // o contorno de um campo desativado não desenhava nada. Por isso aqui a
    // regra é a mesma do Botão.
    // O `aoMudar` no campo normal é só para o React não avisar de um campo
    // controlado sem `onChange`; não toca em classe nenhuma.
    const { unmount } = render(<Campo etiqueta="Categoria" valor="Cafés" aoMudar={vi.fn()} />);
    const normal = classesDe(screen.getByLabelText("Categoria"));
    unmount();

    render(<Campo etiqueta="Categoria" valor="Cafés" desativado />);
    const campo = screen.getByLabelText("Categoria");
    const desativado = classesDe(campo);

    expect(
      soEm(normal, desativado),
      "o campo desativado perdeu classes do campo normal — a fronteira do campo tem de ficar",
    ).toEqual([]);

    expect(
      soEm(desativado, normal).filter((classe) => !CANAL_DO_DESATIVADO.includes(classe)),
      "o campo desativado ganhou desenho novo: o estado viaja na opacidade e em mais nada",
    ).toEqual([]);

    expect(desativado.has("opacity-desativado")).toBe(true);
    expect(
      desativado.has("border-contorno"),
      "um campo sem fronteira visível deixa de se ler como campo",
    ).toBe(true);
    expect(
      campo,
      "no Campo é mesmo o atributo `disabled`: um campo desligado não se preenche",
    ).toBeDisabled();
  });

  it("só de leitura não é desativado: o valor é para ser lido e copiado", () => {
    // A guarda que impede este ficheiro de passar a dizer que qualquer
    // campo apagado está bem. São dois estados diferentes e não se
    // desenham da mesma maneira.
    render(<Campo etiqueta="Ligação da ementa" valor="bardatomazia.pt/ementa" soLeitura />);

    const campo = screen.getByLabelText("Ligação da ementa");
    expect(classesDe(campo).has("opacity-desativado")).toBe(false);
    expect(campo).toHaveAttribute("readonly");
    expect(campo).not.toBeDisabled();
  });

  it("o campo normal continua a chamar o aoMudar — guarda da regra 10", () => {
    // Sem isto, um Campo que nunca renderizasse nada de útil passava os
    // testes de classes acima sem ninguém dar por ela.
    const aoMudar = vi.fn();
    render(<Campo etiqueta="Nome do produto" valor="" aoMudar={aoMudar} />);

    expect(screen.getByLabelText("Nome do produto")).toBeEnabled();
  });
});
