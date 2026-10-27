/**
 * Ler um elemento como **conjunto de classes**, para os testes poderem
 * falar de diferenças em vez de presenças.
 *
 * A diferença importa mais do que parece. Um teste que só pergunta "tem a
 * classe X?" deixa passar tudo o que foi **acrescentado** ao lado, e foi
 * exactamente assim que o Botão discreto desativado ganhou um contorno que
 * o discreto normal não tinha: todas as asserções de presença continuavam
 * verdes, e o botão desligado passou a pesar mais do que o ligado.
 * Comparar conjuntos responde às duas perguntas de uma vez — o que saiu e
 * o que entrou.
 */

export function classesDe(elemento: Element): Set<string> {
  return new Set(elemento.className.split(/\s+/).filter((parte) => parte.length > 0));
}

/** O que está nas `umas` e não está nas `outras`, ordenado para a mensagem ser estável. */
export function soEm(umas: Set<string>, outras: Set<string>): string[] {
  return [...umas].filter((classe) => !outras.has(classe)).sort();
}

/** As duas listas de uma vez, que é o que quase sempre se quer afirmar. */
export function diferencaDeClasses(
  antes: Set<string>,
  depois: Set<string>,
): { saiu: string[]; entrou: string[] } {
  return { saiu: soEm(antes, depois), entrou: soEm(depois, antes) };
}
