import { definirGuardaDeSaida } from "../pages/gestao/navegacao";

/**
 * Limpa a guarda de saída entre testes (F4-05a): um `afterEach` que a deixasse
 * registada faria o teste seguinte perguntar «Há alterações por guardar?».
 * Só para testes.
 */
export function limparGuardaDeSaida(): void {
  definirGuardaDeSaida(null);
}
