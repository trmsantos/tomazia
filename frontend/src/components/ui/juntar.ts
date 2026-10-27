/**
 * Juntar classes, sem dependência nenhuma.
 *
 * `cva`, `clsx` e `tailwind-merge` fazem isto e mais; nenhum deles cabe no
 * orçamento do Q-02, que já vai em 68 KB comprimidos só com o React. Dez
 * linhas chegam: aceita `false`, `undefined` e `null` para as condições
 * ficarem legíveis no sítio onde se decide a classe.
 */
export function juntar(...partes: (string | false | null | undefined)[]): string {
  return partes
    .filter((parte): parte is string => typeof parte === "string" && parte.length > 0)
    .join(" ");
}
