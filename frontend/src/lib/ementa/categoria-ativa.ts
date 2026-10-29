/**
 * Qual é a categoria ativa, dada a posição da página (F3-02, 3.3).
 *
 * A regra, numa frase: **o chip ativo é o da última categoria cujo título já
 * passou a linha de leitura.** A linha de leitura é a âncora das categorias
 * mais um píxel — ou seja, um píxel abaixo do sítio onde um título assenta
 * depois de um salto.
 *
 * Esse «mais um» é o detalhe que faz a coisa toda funcionar. O `html` leva
 * `scroll-padding-top`, por isso depois de um salto o topo da secção fica
 * **exactamente** sobre a âncora; com a comparação inclusiva, o chip em que se
 * carregou fica ativo. Com a linha na âncora e a comparação estrita, ficava
 * ativa a categoria **anterior**, logo a seguir a alguém carregar no chip.
 *
 * É uma função pura por uma razão prática: os três guardas abaixo testam-se em
 * milissegundos, e o que sobra para o browser provar é só a ligação.
 *
 * Os topos medem-se no **topo da secção**, não no do título. Com preenchimento
 * dentro do cartão, o título fica uns píxeis abaixo e nunca chega à linha — e
 * o sintoma (o chip anterior fica ativo depois de cada salto) é igualzinho ao
 * de faltar o «mais um píxel».
 */
export function categoriaAtiva(topos: number[], linha: number, noFundo: boolean): number | null {
  // Sem cartões não há chip nenhum para marcar — e «nenhum» é `null`, não
  // zero. Tem de vir antes do guarda do fundo: com a lista vazia, um
  // `length - 1` dava `-1`, um índice que não existe.
  if (topos.length === 0) return null;

  // Guarda 2: a página está no fim e o último cartão é curto de mais para
  // chegar à linha. Sem isto, a última categoria nunca ficava ativa, por mais
  // que se descesse.
  if (noFundo) return topos.length - 1;

  // Guarda 1: no topo da página ainda nenhuma passou, e a primeira fica ativa
  // na mesma — uma barra sem nenhum chip marcado parece avariada.
  let ativa = 0;
  for (let indice = 0; indice < topos.length; indice += 1) {
    const topo = topos[indice];
    if (topo !== undefined && topo <= linha) ativa = indice;
  }

  return ativa;
}
