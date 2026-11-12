/**
 * "Podes tentar outra vez daqui a…" — a frase de quanto falta para um bloqueio
 * acabar. Nasceu na F3-05 (limite de envios de fotos) e a F4-01 reutiliza-a
 * para a conta bloqueada do login (secção 3.6 de `docs/ecras/F4-01.md`).
 *
 * Vive aqui, e só aqui, porque a F3-05 já teve de corrigir duas cópias que
 * divergiam na fronteira dos 60–119 s.
 *
 * Arredonda **sempre para cima** acima dos 60 s (proposta do dominio-bar na F4-01, a decidir pelo Tomás no PR): a
 * frase nunca promete menos do que falta. Antes, 60–119 s liam-se "1 minuto"
 * com o botão ainda bloqueado até aos 119 s.
 *
 * Só compõe: quem chama decide antes se há um número válido. "Não sei quanto
 * falta" e "falta pouco" são coisas diferentes (regra 10 do CLAUDE.md), e uma
 * função que recebe um número não pode saber qual das duas aconteceu.
 */
export function tempoComposto(segundos: number): string {
  if (segundos < 60) return "Podes tentar outra vez daqui a menos de um minuto.";
  if (segundos === 60) return "Podes tentar outra vez daqui a 1 minuto.";
  return `Podes tentar outra vez daqui a ${String(Math.ceil(segundos / 60))} minutos.`;
}
