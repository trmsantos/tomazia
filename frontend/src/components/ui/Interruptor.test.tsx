/**
 * F3-01 — Interruptor (secção 7.6 de `docs/ecras/F3-01.md`), em
 * `<input type="checkbox" role="switch">`, por ADR 0008.
 *
 * Contrato:
 *
 * ```tsx
 * export function Interruptor(propriedades: {
 *   etiqueta: string;                    // "Disponível" — não muda com o estado
 *   ligado: boolean;
 *   aoMudar: (ligado: boolean) => void;
 *   desativado?: boolean;
 * }): JSX.Element
 * ```
 *
 * **Porque é que o `Espaço` não é testado aqui.** É o browser que o trata,
 * de origem, por ser um `<input type="checkbox">` — foi essa a razão de
 * escolher a primitiva do browser no ADR 0008. Em jsdom, carregar em
 * `Espaço` não gera clique nenhum, por isso um teste desses provaria
 * apenas que o jsdom não o faz. O que este ficheiro prende é a premissa:
 * que o elemento **é** mesmo um `input[type=checkbox]`, e não uma `<div>`
 * com `role="switch"` e um `onKeyDown` à mão. O `Espaço` a sério está no
 * `e2e/componentes.spec.ts`.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { classesDe, diferencaDeClasses } from "../../testes/classes";
import { Interruptor } from "./Interruptor";

/**
 * O desenho do interruptor, separado em três partes, para se poder afirmar
 * o que muda e o que **não** muda entre estados.
 *
 * `marcado` lê-se da propriedade do elemento e não de uma classe: o carril
 * cheio vem do `:checked`, que em jsdom não produz classe nenhuma.
 */
function desenho(
  ligado: boolean,
  desativado: boolean,
): { linha: Set<string>; carril: Set<string>; manipulo: Set<string>; marcado: boolean } {
  const { container, unmount } = render(
    <Interruptor etiqueta="Disponível" ligado={ligado} desativado={desativado} aoMudar={vi.fn()} />,
  );

  const linha = container.querySelector("label");
  const carril = screen.getByRole("switch");
  const manipulo = container.querySelector('[aria-hidden="true"]');
  if (linha === null || manipulo === null) {
    throw new Error("não encontrei a linha ou o manípulo: o desenho mudou de forma");
  }

  const lido = {
    linha: classesDe(linha),
    carril: classesDe(carril),
    manipulo: classesDe(manipulo),
    marcado: (carril as HTMLInputElement).checked,
  };
  unmount();
  return lido;
}

/** O que a linha pode ganhar e perder por estar desativada, e mais nada. */
const CANAL_DO_DESATIVADO = ["opacity-desativado", "cursor-not-allowed"];
const SO_PARA_QUEM_PODE_CARREGAR = ["cursor-pointer"];

describe("Interruptor", () => {
  it("é um input checkbox com role=switch, e o nome vem da etiqueta visível", () => {
    render(<Interruptor etiqueta="Disponível" ligado={false} aoMudar={vi.fn()} />);

    const interruptor = screen.getByRole("switch", { name: "Disponível" });
    expect(interruptor.tagName).toBe("INPUT");
    expect(interruptor).toHaveAttribute("type", "checkbox");
    expect(screen.getByText("Disponível")).toBeVisible();
  });

  it("o estado lê-se no elemento, nos dois sentidos", () => {
    const { rerender } = render(
      <Interruptor etiqueta="Disponível" ligado={false} aoMudar={vi.fn()} />,
    );
    expect(screen.getByRole("switch")).not.toBeChecked();

    rerender(<Interruptor etiqueta="Disponível" ligado aoMudar={vi.fn()} />);
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("avisa com o valor novo quando se mexe nele", () => {
    const aoMudar = vi.fn();
    render(<Interruptor etiqueta="Disponível" ligado={false} aoMudar={aoMudar} />);

    fireEvent.click(screen.getByRole("switch"));

    expect(aoMudar).toHaveBeenCalledWith(true);
  });

  it("a etiqueta não muda com o estado: o nome acessível tem de ser estável", () => {
    // Nada de "Disponível" a virar "Indisponível". Quem ouve o leitor de
    // ecrã precisa do mesmo nome para saber que é o mesmo controlo; o que
    // muda é o estado, que o `switch` já anuncia.
    const { rerender } = render(
      <Interruptor etiqueta="Disponível" ligado={false} aoMudar={vi.fn()} />,
    );
    const nomeDesligado = screen.getByRole("switch").getAttribute("aria-label") ?? "Disponível";

    rerender(<Interruptor etiqueta="Disponível" ligado aoMudar={vi.fn()} />);

    expect(screen.getByRole("switch")).toHaveAccessibleName("Disponível");
    expect(nomeDesligado).toBe("Disponível");
    expect(screen.queryByText(/indispon/i)).toBeNull();
  });

  it("desativado: aria-disabled e nada acontece ao carregar", () => {
    const aoMudar = vi.fn();
    render(<Interruptor etiqueta="Disponível" ligado={false} desativado aoMudar={aoMudar} />);

    const interruptor = screen.getByRole("switch");
    expect(interruptor).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(interruptor);
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("ligado e desativado desenha-se como ligado, não como desligado", () => {
    // O ponto mais importante do componente, e o que estava ao contrário.
    // A regra anterior esvaziava o carril para dizer "desativado" — e o
    // carril vazio é o sinal universal de "desligado". Um produto
    // disponível-mas-bloqueado passava a ler-se como indisponível; no creme
    // ficava igual ao pixel a um interruptor desligado, porque lá
    // `texto-suave` e `contorno` são a mesma cor. Numa ementa que o dono
    // gere a uma mão atrás do balcão, isso é um erro de stock.
    const ligado = desenho(true, false);
    const ligadoEDesativado = desenho(true, true);

    expect(
      ligadoEDesativado.marcado,
      "o carril de um interruptor ligado continua cheio quando ele está desativado",
    ).toBe(true);

    expect(
      [...ligadoEDesativado.carril].sort(),
      "o carril mudou de desenho por estar desativado",
    ).toEqual([...ligado.carril].sort());

    expect(
      [...ligadoEDesativado.manipulo].sort(),
      "o manípulo mudou de desenho por estar desativado — a posição e o preenchimento " +
        "são o que transporta o estado, e não se mexe neles para dizer outra coisa",
    ).toEqual([...ligado.manipulo].sort());
  });

  it("ligado e desativado distingue-se de desligado — é aí que o defeito vivia", () => {
    // A asserção acima sozinha passaria também se ligado e desligado se
    // desenhassem da mesma maneira. É esta que fecha a porta.
    const ligadoEDesativado = desenho(true, true);
    const desligadoEDesativado = desenho(false, true);
    const desligado = desenho(false, false);

    for (const [nome, outro] of [
      ["desligado e desativado", desligadoEDesativado],
      ["desligado", desligado],
    ] as const) {
      expect(
        [...ligadoEDesativado.manipulo].sort(),
        `um interruptor ligado-e-desativado desenha o manípulo como um ${nome}: ` +
          "deixou de se saber se o produto está disponível",
      ).not.toEqual([...outro.manipulo].sort());

      expect(
        ligadoEDesativado.marcado,
        `um interruptor ligado-e-desativado lê-se como ${nome}`,
      ).not.toBe(outro.marcado);
    }

    // E, explicitamente, o que cada um dos dois tem de mostrar: manípulo à
    // direita sobre carril cheio quando está ligado, à esquerda quando não.
    expect(ligadoEDesativado.manipulo.has("translate-x-manipulo")).toBe(true);
    expect(ligadoEDesativado.manipulo.has("bg-fundo")).toBe(true);
    expect(desligadoEDesativado.manipulo.has("translate-x-0")).toBe(true);
  });

  it("quem diz «desativado» é a opacidade da linha, e só ela", () => {
    const { saiu, entrou } = diferencaDeClasses(
      desenho(true, false).linha,
      desenho(true, true).linha,
    );

    expect(
      entrou.filter((classe) => !CANAL_DO_DESATIVADO.includes(classe)),
      "a linha ganhou desenho novo por estar desativada: o estado viaja na opacidade",
    ).toEqual([]);
    expect(
      saiu.filter((classe) => !SO_PARA_QUEM_PODE_CARREGAR.includes(classe)),
      "a linha perdeu desenho por estar desativada — o que se perde é opacidade, não classes",
    ).toEqual([]);
    expect(entrou, "nada na linha diz que o interruptor está desativado").toContain(
      "opacity-desativado",
    );
  });

  it("o carril nunca é dourado — o dourado tem três usos e este não é um deles", () => {
    // Um carril `bg-acao` dentro de um cartão creme ficava a 1,72 contra o
    // creme. Ligado = carril cheio em `bg-texto`, manípulo em `bg-fundo`.
    const { container, rerender } = render(
      <Interruptor etiqueta="Disponível" ligado aoMudar={vi.fn()} />,
    );
    expect(container.innerHTML).not.toMatch(/\bbg-acao\b/);
    expect(container.innerHTML).toMatch(/\bbg-texto\b/);

    rerender(<Interruptor etiqueta="Disponível" ligado={false} aoMudar={vi.fn()} />);
    expect(container.innerHTML).not.toMatch(/\bbg-acao\b/);
  });

  it("a linha inteira tem 44 px, e não há style inline", () => {
    const { container } = render(
      <Interruptor etiqueta="Disponível" ligado={false} aoMudar={vi.fn()} />,
    );

    expect(
      container.innerHTML,
      "o alvo vem do padding da linha, não do tamanho do carril",
    ).toContain("min-h-toque");
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });
});
