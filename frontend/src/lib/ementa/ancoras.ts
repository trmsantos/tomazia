/**
 * A âncora de uma categoria da ementa (F3-02, secção 2).
 *
 * O chip é `<a href="#ementa-cafes">` e o cartão é
 * `<section id="ementa-cafes">`. O prefixo não é decoração: a página vai
 * ganhar eventos e fotos com nomes próprios, e uma categoria com o mesmo
 * identificador de um evento daria um salto para o sítio errado, em silêncio.
 *
 * O `slug` vem da API e **não tem formato garantido**: na base de dados é uma
 * cadeia de 60 com `unique` e sem verificação de formato nenhuma, e a F4-02
 * vai deixar o dono escrevê-lo. Daí esta função: um `slug` limpo usa-se tal e
 * qual, tudo o resto cai no identificador numérico, que existe sempre.
 *
 * E a regra que não se quebra: o que sai daqui é sempre um nome que serve de
 * seletor. Um identificador com um espaço, um acento ou um ponto **lança**
 * quando chega a um seletor, e isso rebentaria a página inteira por causa de
 * um nome de categoria.
 */

/** Tudo o que vem da ementa leva este prefixo. Ver o cabeçalho. */
const PREFIXO = "ementa-";

/**
 * O destino da ligação "Saltar para a ementa" (F3-03, 5.2).
 *
 * Vive aqui, ao lado do `PREFIXO`, porque o que o torna seguro é uma
 * propriedade **deste** ficheiro: ele não pode colidir com nenhuma âncora de
 * categoria, e as âncoras de categoria são as que saem daqui. Escrito noutro
 * sítio, a garantia ficava a uma distância de leitura do que a dá.
 *
 * Não é `ementa` — a barra de chips vive dentro dessa secção, e saltar para lá
 * deixava as doze paragens exactamente onde estavam. Não é `ementa-conteudo` —
 * esse começa pelo prefixo, e um `slug` `conteudo`, que a F4-02 vai deixar o
 * dono escrever, mandava o salto para o sítio errado, em silêncio.
 */
export const ID_DA_LISTA_DA_EMENTA = "lista-da-ementa";

/** Um `slug` que se pode usar tal e qual: minúsculas, dígitos e hífen. */
const SLUG_LIMPO = /^[a-z0-9-]+$/;

/**
 * A forma que o ramo alternativo reserva para si: `categoria-<id>`.
 *
 * Sem isto, os dois espaços de nomes sobrepõem-se. O `slug` `categoria-7`
 * passa o `SLUG_LIMPO` e produz `ementa-categoria-7`, que é exactamente o que
 * a categoria de `id` 7 recebe quando o `slug` dela é feio: duas `<section>`
 * com o mesmo identificador, um chip a saltar para o cartão errado e um nome
 * de secção a anunciar o título de outra. Só é atingível quando a F4-02
 * deixar o dono escrever `slugs` — e é uma linha.
 */
const RESERVADO_AO_ID = /^categoria-\d+$/;

export function ancoraDaCategoria(categoria: { id: number; slug: string }): string {
  if (SLUG_LIMPO.test(categoria.slug) && !RESERVADO_AO_ID.test(categoria.slug)) {
    return `${PREFIXO}${categoria.slug}`;
  }
  return `${PREFIXO}categoria-${String(categoria.id)}`;
}
