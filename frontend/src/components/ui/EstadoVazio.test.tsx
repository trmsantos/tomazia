/**
 * F3-01 — Estado vazio (secção 7.7 de `docs/ecras/F3-01.md`).
 *
 * Contrato:
 *
 * ```tsx
 * export function EstadoVazio(propriedades: {
 *   titulo: string;
 *   linha: string;
 *   tom?: "neutro" | "erro";   // por omissão: "neutro"
 *   children?: ReactNode;      // no máximo um botão
 * }): JSX.Element
 * ```
 *
 * O `tom` é propriedade e não classe no contentor porque o componente fixa
 * a cor do título: um `<div className="text-erro">` à volta era sobreposto
 * e morto, e o ecrã de erro saía exactamente igual ao de vazio. Há um teste
 * com nome próprio para isso, porque a tentação de o fazer por fora volta
 * sempre.
 *
 * O vazio diz **porque** está vazio e **o que fazer**. Os textos dos
 * testes são os da tabela da secção 7.7, em PT-PT, com maiúscula só no
 * início da frase.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Botao } from "./Botao";
import { EstadoVazio } from "./EstadoVazio";

describe("Estado vazio", () => {
  it("tem um título em cabeçalho e uma linha a dizer o que fazer", () => {
    render(
      <EstadoVazio
        titulo="Ainda não há fotos."
        linha="Sê o primeiro a mostrar uma noite no bar."
      />,
    );

    expect(screen.getByRole("heading", { name: "Ainda não há fotos." })).toBeVisible();
    expect(screen.getByText("Sê o primeiro a mostrar uma noite no bar.")).toBeVisible();
  });

  it("leva no máximo um botão", () => {
    const { rerender } = render(
      <EstadoVazio titulo="Ainda não há eventos." linha="Cria o primeiro para aparecer no site.">
        <Botao variante="principal" onClick={vi.fn()}>
          Criar evento
        </Botao>
      </EstadoVazio>,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Criar evento" })).toBeVisible();

    rerender(
      <EstadoVazio
        titulo="Não encontrei nada com esse nome."
        linha="Tenta outra palavra ou escolhe uma categoria."
      />,
    );

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("não é uma região viva: quem anuncia é a lista que o contém", () => {
    const { container } = render(
      <EstadoVazio
        titulo="Não há fotos à espera."
        linha="Aparecem aqui assim que alguém enviar uma."
      />,
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("fica numa coluna estreita e centrada, sem style inline", () => {
    const { container } = render(
      <EstadoVazio
        titulo="Ainda não há fotos."
        linha="Sê o primeiro a mostrar uma noite no bar."
      />,
    );

    expect(container.innerHTML).toContain("max-w-vazio");
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it('tom="erro" pinta o título de erro; por omissão fica o texto normal', () => {
    // O erro de rede usa a mesma forma do vazio — é a quinta linha da
    // tabela de 7.7. Se a cor não mudar, os dois ecrãs ficam
    // indistinguíveis sem ler as palavras.
    const { rerender } = render(
      <EstadoVazio
        titulo="Não consegui carregar a ementa."
        linha="Verifica a ligação e tenta outra vez."
        tom="erro"
      />,
    );

    const comErro = screen.getByRole("heading", { name: "Não consegui carregar a ementa." });
    expect(comErro.className).toContain("text-erro");

    rerender(
      <EstadoVazio
        titulo="Ainda não há fotos."
        linha="Sê o primeiro a mostrar uma noite no bar."
      />,
    );

    const semTom = screen.getByRole("heading", { name: "Ainda não há fotos." });
    expect(semTom.className).toContain("text-texto");
    expect(
      semTom.className,
      "o vazio não é um erro: por omissão o título não pode sair pintado de erro",
    ).not.toContain("text-erro");
  });

  it("o tom tem de ser propriedade, porque um embrulho com text-erro não pinta nada", () => {
    // Era este o defeito: o erro vinha de um `<div className="text-erro">`
    // à volta do componente. Como o componente fixa a cor do título, a
    // classe do embrulho era sobreposta e morta — o ecrã de erro saía
    // exactamente igual ao de vazio. Este teste prova que o embrulho **não
    // funciona**, que é a razão de a propriedade existir; se um dia alguém
    // voltar a tentar pela classe de fora, isto diz-lhe porquê.
    render(
      <div className="text-erro">
        <EstadoVazio
          titulo="Não consegui carregar a ementa."
          linha="Verifica a ligação e tenta outra vez."
        />
      </div>,
    );

    expect(
      screen.getByRole("heading", { name: "Não consegui carregar a ementa." }).className,
      "o título continua a fixar a sua própria cor: o embrulho não chega",
    ).toContain("text-texto");
  });

  it("o tom só mexe no título — a linha e o botão ficam iguais", () => {
    // Um tom que mudasse mais do que o título tornava o erro noutro
    // componente, e a especificação diz que a forma é mesmo a mesma.
    const { container, unmount } = render(
      <EstadoVazio titulo="Ainda não há fotos." linha="Tenta outra vez.">
        <Botao variante="principal" onClick={vi.fn()}>
          Tentar outra vez
        </Botao>
      </EstadoVazio>,
    );
    const neutro = container.innerHTML;
    unmount();

    const { container: contentorDeErro } = render(
      <EstadoVazio titulo="Ainda não há fotos." linha="Tenta outra vez." tom="erro">
        <Botao variante="principal" onClick={vi.fn()}>
          Tentar outra vez
        </Botao>
      </EstadoVazio>,
    );

    // A única diferença entre os dois é a cor do título. Comparar o HTML
    // depois de normalizar essa cor é a forma de o dizer sem listar tudo o
    // resto à mão.
    // `(?![\w-])` para o `text-texto-suave` da linha não entrar na troca:
    // ele é igual nos dois tons e não tem nada que ver com o título.
    const semACorDoTitulo = (html: string): string =>
      html.replace(/text-erro(?![\w-])|text-texto(?![\w-])/g, "«cor-do-titulo»");

    expect(semACorDoTitulo(contentorDeErro.innerHTML)).toBe(semACorDoTitulo(neutro));
    expect(
      screen.getByRole("heading", { name: "Ainda não há fotos." }).className,
      "guarda: se o título deixar de ter cor própria, a normalização acima apaga a diferença " +
        "toda e este teste passa a não dizer nada",
    ).toMatch(/text-erro(?![\w-])/);
  });

  it.each(["neutro", "erro"] as const)("o título (%s) é `font-seccao`, sem peso ao lado", (tom) => {
    // R-01 / ADR 0023 (6.7 de docs/ecras/R-01.md): a Bricolage a 700 lê-se
    // bem a 21 px, por isso sai a regra antiga dos 22 px e o título passa a
    // título de secção. O `font-seccao` traz o peso; um
    // `font-normal|medio|forte` ao lado pedia outro (secção 3).
    render(
      <EstadoVazio
        titulo="Não consegui carregar a ementa."
        linha="Verifica a ligação e tenta outra vez."
        tom={tom}
      />,
    );

    const titulo = screen.getByRole("heading", { name: "Não consegui carregar a ementa." });
    const classes = titulo.className.split(/\s+/);
    expect(classes).toContain("font-seccao");
    expect(classes).toContain("text-seccao");
    expect(classes).not.toContain("font-titulo");
    expect(classes.filter((classe) => /^font-(normal|medio|forte)$/.test(classe))).toEqual([]);
  });
});
