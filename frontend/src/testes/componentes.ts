/**
 * Os sete componentes base da F3-01, por caminho.
 *
 * A lista está escrita à mão de propósito: é ela que serve de sentinela
 * (ver `exigirSentinelas` em `percorrer-arvore.ts`) nas varreduras que
 * olham para `src/components/ui/`. Sem ela, enquanto a pasta estiver
 * vazia, cada uma dessas varreduras encontraria zero violações e passaria
 * — a falha silenciosa da regra 10 do `CLAUDE.md`.
 *
 * Um componente novo nesta pasta entra aqui também; é uma linha, e é a
 * linha que faz os testes de varredura passarem a vê-lo.
 */
export const COMPONENTES_DA_F3_01 = [
  "src/components/ui/Botao.tsx",
  "src/components/ui/Campo.tsx",
  "src/components/ui/Chip.tsx",
  "src/components/ui/Folha.tsx",
  "src/components/ui/AvisoTemporario.tsx",
  "src/components/ui/Interruptor.tsx",
  "src/components/ui/EstadoVazio.tsx",
  "src/components/ui/Cartao.tsx",
];
