/**
 * O preço de uma linha da ementa, em texto (F3-02, 6.1).
 *
 * `preco_cent` é um inteiro em cêntimos (`CHECK preco_cent >= 0` na base de
 * dados) e sai daqui pronto para o ecrã: duas casas decimais sempre, vírgula
 * decimal, ponto nos milhares e um espaço **inquebrável** antes do símbolo.
 *
 * Vive em `src/lib/formato/` e não dentro da Linha de produto porque a F4-02
 * precisa dela na gestão, onde não há cartão creme nenhum.
 *
 * Três decisões que não são detalhe:
 *
 *  - **Sem formatadores do browser e sem `toLocaleString`.** Não é por bytes:
 *    é por estabilidade. Conforme a versão do ICU, o formato de moeda de pt-PT
 *    sai ora com espaço inquebrável normal, ora com espaço estreito
 *    inquebrável, e num ambiente sem dados de locale cai para um formato
 *    inglês. Um ecrã em que o separador muda com a versão do browser não se
 *    consegue prender com um teste; três linhas de aritmética sobre um inteiro
 *    saem sempre iguais.
 *  - **O espaço antes do símbolo é U+00A0.** Com um espaço normal, o preço
 *    parte-se em duas linhas no fim de uma linha de ementa e o símbolo aparece
 *    sozinho por baixo. Está escrito como escape de propósito: a regra
 *    `no-irregular-whitespace` recusa o caractere literal, e quem lê o
 *    ficheiro não distingue um do outro a olho.
 *  - **Um valor que não seja um inteiro maior ou igual a zero não produz texto
 *    nenhum.** Um preço impossível numa ementa é pior do que uma linha sem
 *    preço — e a linha sem preço pelo menos diz ao dono que há ali alguma
 *    coisa para arranjar.
 */

/** U+00A0. Ver a nota do cabeçalho. */
const INQUEBRAVEL = " ";

/** O 0 é válido e escreve-se assim numa carta portuguesa (6.2). */
const OFERTA = "Oferta";

/** Ponto de três em três algarismos: a garrafeira existe. */
function comMilhares(euros: number): string {
  return String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * `650` dá «6,50 €»; `0` dá «Oferta»; um valor inválido dá cadeia vazia.
 *
 * O `-0` conta como zero: `Number.isInteger(-0)` é `true` e `-0 < 0` é
 * `false`, por isso cai na oferta e não no ramo do inválido.
 */
export function formatarPreco(precoCent: number): string {
  if (!Number.isInteger(precoCent) || precoCent < 0) return "";
  if (precoCent === 0) return OFERTA;

  const euros = Math.floor(precoCent / 100);
  const centimos = precoCent % 100;

  return `${comMilhares(euros)},${String(centimos).padStart(2, "0")}${INQUEBRAVEL}€`;
}
