/**
 * Os ficheiros que a F3-02 traz, por caminho.
 *
 * Mesma função que `COMPONENTES_DA_F3_01` em `componentes.ts`, e pela mesma
 * razão: servem de **sentinela** às varreduras que olham para pastas
 * (`exigirSentinelas` em `percorrer-arvore.ts`). Sem esta lista, a varredura
 * de uma `src/pages/` que ainda não existe devolve zero ficheiros, encontra
 * zero violações e passa — "não consegui procurar" a dar o mesmo resultado
 * que "não encontrei", que é a regra 10 do `CLAUDE.md`.
 *
 * Lista separada da F3-01 de propósito: assim os sete componentes da tarefa
 * anterior não ficam vermelhos por causa de um ficheiro desta.
 *
 * Um ficheiro novo numa destas pastas entra aqui também; é uma linha, e é a
 * linha que faz as varreduras passarem a vê-lo.
 */

/** O ecrã público da ementa e as peças que só ele usa. */
export const FICHEIROS_DA_F3_02 = [
  "src/pages/publico/Ementa.tsx",
  "src/components/ui/LinhaDeProduto.tsx",
];
