import type { ReactElement, ReactNode } from "react";

/**
 * Estado vazio (secção 7.7 de `docs/ecras/F3-01.md`).
 *
 * Calmo, não uma ilustração grande: um título, uma linha que diz o que fazer
 * e, no máximo, um botão. O vazio explica **porque** está vazio — "Ainda não
 * há fotos." — e não deixa o ecrã mudo.
 *
 * O título é Source Sans 3 a 600 e não Playfair: 21 px fica abaixo dos 22 que
 * a especificação dá como mínimo da Playfair, e na escala não há nada entre 21
 * e 27.
 *
 * O tom `erro` serve o quinto texto da tabela de 7.7, o de rede: o título
 * passa a `text-erro` (5,51 no escuro, 5,16 no creme) e tudo o resto fica
 * igual, porque a forma é mesmo a mesma.
 *
 * Não é uma região viva. Quem anuncia que a lista deixou de estar a carregar é
 * a `<section>` que a contém, ao passar de `aria-busy` para o conteúdo novo;
 * duas regiões a falar ao mesmo tempo lêem a mesma coisa duas vezes.
 */
export type PropriedadesDoEstadoVazio = {
  titulo: string;
  linha: string;
  /**
   * O erro de rede usa a mesma forma do vazio, e é por isso que o tom tem de
   * ser uma propriedade e não uma classe no contentor: o componente fixa a cor
   * do título, por isso um `<div className="text-erro">` à volta era
   * sobreposto e morto — o erro saía exactamente igual ao vazio, e os dois
   * ecrãs deixavam de se distinguir sem ler as palavras.
   */
  tom?: "neutro" | "erro";
  /** No máximo um botão. */
  children?: ReactNode;
};

export function EstadoVazio({
  titulo,
  linha,
  tom = "neutro",
  children,
}: PropriedadesDoEstadoVazio): ReactElement {
  return (
    <div className="mx-auto flex max-w-vazio flex-col items-center gap-3 py-8 text-center">
      <h3
        className={
          tom === "erro" ? "text-seccao font-forte text-erro" : "text-seccao font-forte text-texto"
        }
      >
        {titulo}
      </h3>
      <p className="text-corpo text-texto-suave">{linha}</p>
      {children}
    </div>
  );
}
